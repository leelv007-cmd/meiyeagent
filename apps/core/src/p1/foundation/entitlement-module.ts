import {
  PUBLIC_PLAN_ALLOWANCE_SEED,
  frozenPlanSettlementAuthoritySchema,
  merchantCreditDetailSchema,
  publicCreditBalanceSchema,
  type FrozenPlanSettlementAuthority,
} from '@meiye/contracts';
import {
  P1DomainError,
  type P1Context,
  type ProductPlanPeriodStrategy,
  type ProductPlanTier,
  type UsageResource,
} from './domain.js';
import type { ProductEntitlementApplicationService } from './entitlement-service.js';
import type { P1OperationModule } from './ports.js';
import {
  WorkspaceProvisionService,
  type PlatformDefaultModelPort,
} from './workspace-provision.js';
import type {
  CreditBillingService,
  CreditPaymentLifecycle,
} from '../credit-billing/credit-billing-service.js';
import {
  compareCreditLotsForFefo,
  type CreditGrantLot,
  type CreditLotTransaction,
} from '../credit-billing/credit-ledger.js';
import type { ProductEntitlementPolicyPort } from './entitlement-policy.js';

export interface PlanOffer {
  id: ProductPlanTier;
  allowance: Record<UsageResource, number>;
  concurrencyLimit: number;
  queuePriority: number;
  supportLabel: 'standard' | 'priority';
  /** fixed_days length for trial; ignored by calendar_month tiers. */
  expireDays?: number;
  periodStrategy?: ProductPlanPeriodStrategy;
}

export interface AddOnOffer {
  id: string;
  resource: UsageResource;
  quantity: number;
  amountMicros: number;
  currency: string;
}

type CreditUsageStatus =
  | 'reserved'
  | 'committed'
  | 'partially_refunded'
  | 'refunded';

const MAX_CONCURRENT_CREDIT_USAGE_READS = 16;

interface CreditUsageReader {
  getUsage(
    workspaceId: string,
    taskId: string,
  ): Promise<{ status: CreditUsageStatus } | null>;
}

/** Stable idempotency keys for workspace bootstrap provisioning (Tb). */
export const WORKSPACE_PROVISION_TRIAL_KEY = 'workspace-provision:trial:v1';
export const WORKSPACE_PROVISION_MODEL_DEFAULT_KEY =
  'workspace-provision:model-default:v1';

export const DEFAULT_TRIAL_EXPIRE_DAYS = 7;

/** Everything about a sold tier that is not its D-123 allowance seed. */
const SOLD_PLAN_TERMS: Record<
  'starter' | 'growth' | 'pro',
  Pick<PlanOffer, 'queuePriority' | 'supportLabel' | 'periodStrategy'>
> = {
  starter: {
    queuePriority: 1,
    supportLabel: 'standard',
    periodStrategy: 'calendar_month',
  },
  growth: {
    queuePriority: 5,
    supportLabel: 'priority',
    periodStrategy: 'calendar_month',
  },
  pro: {
    queuePriority: 10,
    supportLabel: 'priority',
    periodStrategy: 'calendar_month',
  },
};

/**
 * Cutover-only seed for legacy modality scaffolding (workspace model defaults).
 *
 * Merchant billing truth is `plan.credits.*` (#311). `PUBLIC_PLAN_ALLOWANCE_SEED`
 * remains a cutover-only resource seed in contracts and must not be hot-read
 * from admin-config. Trial stays at 文案5/图5/视频1 for Day-0 modality gating
 * only — it is never quoted as a public billing price.
 */
export const DEFAULT_PLAN_OFFERS: PlanOffer[] = [
  {
    id: 'trial',
    allowance: { audio: 0, copy: 5, image: 5, video: 1 },
    concurrencyLimit: 1,
    queuePriority: 1,
    supportLabel: 'standard',
    expireDays: DEFAULT_TRIAL_EXPIRE_DAYS,
    periodStrategy: 'fixed_days',
  },
  ...PUBLIC_PLAN_ALLOWANCE_SEED.map((seed) => ({
    id: seed.id,
    allowance: { audio: 0, ...seed.allowance },
    concurrencyLimit: seed.concurrencyLimit,
    ...SOLD_PLAN_TERMS[seed.id],
  })),
];

export const DEFAULT_ADD_ON_OFFERS: AddOnOffer[] = [
  {
    id: 'copy-20',
    resource: 'copy',
    quantity: 20,
    amountMicros: 990_000,
    currency: 'CNY',
  },
  {
    id: 'image-10',
    resource: 'image',
    quantity: 10,
    amountMicros: 1_990_000,
    currency: 'CNY',
  },
  {
    id: 'video-5',
    resource: 'video',
    quantity: 5,
    amountMicros: 4_990_000,
    currency: 'CNY',
  },
];

function object(value: unknown, field = 'input'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new P1DomainError('INVALID_STATE', `${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function string(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new P1DomainError('INVALID_STATE', `${key} is required.`);
  }
  return value;
}

function positiveInteger(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new P1DomainError('INVALID_STATE', `${key} must be a positive integer.`);
  }
  return value;
}

function optionalString(input: Record<string, unknown>, key: string) {
  const value = input[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export interface ProviderBillingPeriodInput {
  periodStartsAt?: string | null;
  interval?:
    | 'single_month'
    | 'monthly'
    | 'yearly'
    | 'month'
    | 'year'
    | 'lifetime'
    | 'one_time'
    | null;
  providerOccurredAt?: string | null;
}

/**
 * Build the billing period for a plan offer.
 * - trial / fixed_days: periodStartsAt = grant time, periodEndsAt = +expireDays
 * - paid tiers / calendar_month: UTC natural month fallback
 */
export function periodForOffer(
  selected: PlanOffer,
  clock: () => Date = () => new Date(),
): {
  periodId: string;
  periodStartsAt: string;
  periodEndsAt: string;
  periodStrategy: ProductPlanPeriodStrategy;
} {
  const strategy: ProductPlanPeriodStrategy =
    selected.periodStrategy ??
    (selected.id === 'trial' || selected.expireDays != null
      ? 'fixed_days'
      : 'calendar_month');

  if (strategy === 'fixed_days') {
    const expireDays =
      selected.expireDays ??
      (selected.id === 'trial' ? DEFAULT_TRIAL_EXPIRE_DAYS : undefined);
    if (
      !Number.isInteger(expireDays) ||
      expireDays === undefined ||
      expireDays <= 0
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'fixed_days plan offers require a positive integer expireDays.',
      );
    }
    const startsAt = clock();
    const endsAt = new Date(
      startsAt.getTime() + expireDays * 24 * 60 * 60 * 1000,
    );
    return {
      periodId: `fixed-${startsAt.toISOString().slice(0, 10)}-${expireDays}d`,
      periodStartsAt: startsAt.toISOString(),
      periodEndsAt: endsAt.toISOString(),
      periodStrategy: 'fixed_days',
    };
  }

  const current = clock();
  const startsAt = new Date(
    Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1),
  );
  const endsAt = new Date(
    Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1),
  );
  return {
    periodId: startsAt.toISOString().slice(0, 7),
    periodStartsAt: startsAt.toISOString(),
    periodEndsAt: endsAt.toISOString(),
    periodStrategy: 'calendar_month',
  };
}

export class ProductEntitlementFoundationModule implements P1OperationModule {
  readonly name = 'entitlements';

  private readonly provisioner: WorkspaceProvisionService;

  constructor(
    entitlements: ProductEntitlementApplicationService,
    private readonly clock: () => Date = () => new Date(),
    private readonly options: {
      catalogSource?: {
        get(): Promise<{
          plans: PlanOffer[];
          addOns: AddOnOffer[];
          trialEnabled?: boolean;
        }>;
      };
      /** Optional platform default model binding for workspace provision (Tb). */
      modelDefaults?: PlatformDefaultModelPort;
      /** Production commerce writes only the credit ledger and subscription store. */
      creditBilling: CreditBillingService;
      /** Read-only paid tier source; resource-bucket usage is not projected. */
      creditEntitlements?: ProductEntitlementPolicyPort;
      /** Read-only task status joins a credit reservation to its settlement. */
      creditUsage?: CreditUsageReader;
      modelCatalogTenantAllowlist?: readonly string[];
      warn?: (message: string) => void;
    },
  ) {
    this.provisioner = new WorkspaceProvisionService(entitlements, {
      clock,
      catalog: options.catalogSource
        ? {
            get: async () => {
              const catalog = await options.catalogSource!.get();
              return {
                plans: catalog.plans,
                trialEnabled: catalog.trialEnabled,
              };
            },
          }
        : undefined,
      modelDefaults: options.modelDefaults,
      modelCatalogTenantAllowlist: options.modelCatalogTenantAllowlist,
      warn: options.warn,
    });
  }

  async execute(args: {
    context: P1Context;
    idempotencyKey: string;
    input: Record<string, unknown>;
  }) {
    const action = string(args.input, 'action');
    const payload = object(args.input.payload ?? {}, 'payload');
    switch (action) {
      case 'checkout_plan': {
        throw new P1DomainError(
          'INVALID_STATE',
          'Recorded plan checkout is retired; verified payment settlement owns credit subscriptions.',
        );
      }
      case 'payment_grant': {
        // Trusted payment/webhook path (Tc-2). Not gated by dev commerce.
        // Idempotent on paymentEventId; uses provider billing period when present.
        // Cancel lifecycle = end-of-period fall back (keep plan until periodEndsAt).
        this.requirePaymentActor(args.context);
        const lifecycle = string(payload, 'lifecycle');
        if (
          lifecycle !== 'activate' &&
          lifecycle !== 'renew' &&
          lifecycle !== 'resume' &&
          lifecycle !== 'uncancel_at_period_end' &&
          lifecycle !== 'past_due' &&
          lifecycle !== 'cancel_at_period_end' &&
          lifecycle !== 'expire'
        ) {
          throw new P1DomainError(
            'INVALID_STATE',
            'payment_grant lifecycle is invalid.',
          );
        }
        const paymentEventId = string(payload, 'paymentEventId');
        const requestedPaymentProvider = optionalString(payload, 'paymentProvider');
        if (requestedPaymentProvider && requestedPaymentProvider !== 'waffo') {
          throw new P1DomainError(
            'INVALID_STATE',
            'payment_grant paymentProvider is invalid.',
          );
        }
        const paymentProvider =
          requestedPaymentProvider === 'waffo' ? 'waffo' : undefined;
        const providerPeriod = optionalProviderPeriod(payload);
        const paymentProductId = string(payload, 'paymentProductId');
        const settlementAuthority = optionalFrozenSettlementAuthority(payload);
        if (paymentProvider === 'waffo' && !settlementAuthority) {
          throw new P1DomainError(
            'INVALID_STATE',
            'Waffo payment_grant requires frozen settlement authority.',
          );
        }
        return this.options.creditBilling.settlePayment(args.context, {
          lifecycle: lifecycle as CreditPaymentLifecycle,
          paymentEventId,
          paymentProductId,
          paymentProvider: paymentProvider ?? undefined,
          interval: providerPeriod?.interval,
          periodStartsAt: providerPeriod?.periodStartsAt,
          subscriptionId: optionalString(payload, 'subscriptionId'),
          providerOccurredAt: providerPeriod?.providerOccurredAt,
          ...(settlementAuthority ? { settlementAuthority } : {}),
        });
      }
      case 'payment_add_on_grant': {
        // Trusted payment/webhook path. Packages are ledger grants, never
        // subscription settlements, so no product mapping or period is read.
        this.requirePaymentActor(args.context);
        return this.options.creditBilling.grantAddOn(args.context, {
          offerId: string(payload, 'offerId'),
          paymentEventId: string(payload, 'paymentEventId'),
          credits: positiveInteger(payload, 'credits'),
          expireDays: positiveInteger(payload, 'expireDays'),
        });
      }
      case 'register_gift': {
        // Trusted internal REGISTER_GIFT grant (Tb). Not gated by dev commerce.
        this.requireProvisioningActor(args.context);
        return this.options.creditBilling.grantTrial(args.context);
      }
      case 'provision_model_defaults': {
        // Trusted model-default step. Its outer module command is durably keyed
        // by workspace-provision:model-default:v1, independently of trial.
        this.requireProvisioningActor(args.context);
        return this.provisioner.provisionModelDefaults(args.context);
      }
      case 'checkout_add_on': {
        throw new P1DomainError(
          'INVALID_STATE',
          'Recorded add-on checkout is retired; verified payment settlement must grant a credit package.',
        );
      }
      case 'configure_auto_top_up':
        throw new P1DomainError(
          'INVALID_STATE',
          'Credit billing does not support legacy resource auto top-up.',
        );
      case 'auto_top_up': {
        throw new P1DomainError(
          'INVALID_STATE',
          'Credit billing does not support legacy resource auto top-up.',
        );
      }
      default:
        throw new P1DomainError(
          'INVALID_STATE',
          `Unknown entitlements command ${action}.`,
        );
    }
  }

  async query(args: {
    context: P1Context;
    input: Record<string, unknown>;
  }) {
    const action = string(args.input, 'action');
    object(args.input.payload ?? {}, 'payload');
    if (action === 'catalog') {
      const catalog = await this.options.creditBilling.catalog();
      return {
        mode: 'credit' as const,
        plans: structuredClone(catalog.plans),
        addOns: structuredClone(catalog.addOns),
        trialEnabled: catalog.trialEnabled,
      };
    }
    if (action === 'balance') {
      return publicCreditBalanceSchema.parse(
        await this.options.creditBilling.balance(args.context.workspaceId),
      );
    }
    if (action === 'credit_detail') {
      const detail = await this.options.creditBilling.detail(
        args.context.workspaceId,
      );
      return merchantCreditDetailSchema.parse(
        await merchantCreditDetailProjection(
          detail,
          args.context.workspaceId,
          this.clock().toISOString(),
          this.options.creditUsage,
        ),
      );
    }
    if (action === 'projection') {
      const credits = publicCreditBalanceSchema.parse(
        await this.options.creditBilling.balance(
          args.context.workspaceId,
        ),
      );
      const activePlan = await this.options.creditEntitlements?.resolve(
        args.context.workspaceId,
      );
      return {
        credits,
        plan: { tier: activePlan?.tier ?? 'trial' },
      };
    }
    throw new P1DomainError(
      'INVALID_STATE',
      `Unknown entitlements query ${action}.`,
    );
  }

  private requirePaymentActor(context: P1Context) {
    if (context.actor !== 'payment' && context.actor !== 'admin') {
      throw new P1DomainError(
        'FORBIDDEN',
        'payment_grant requires the payment service actor.',
      );
    }
  }

  private requireProvisioningActor(context: P1Context) {
    if (context.actor !== 'worker') {
      throw new P1DomainError(
        'FORBIDDEN',
        'Workspace provisioning requires the trusted worker actor.',
      );
    }
  }

}

async function merchantCreditDetailProjection(
  detail: {
    billing: {
      creditsThisPeriod: number;
      interval: 'single_month' | 'monthly' | 'yearly';
      periodEndsAt: string;
      tier: 'trial' | 'starter' | 'growth' | 'pro';
    } | null;
    lots: readonly CreditGrantLot[];
    transactions: readonly CreditLotTransaction[];
  },
  workspaceId: string,
  asOf: string,
  creditUsage?: CreditUsageReader,
) {
  const lots = [...detail.lots].sort(compareCreditLotsForFefo);
  const batchNumbers = new Map(lots.map((lot, index) => [lot.id, index + 1]));
  const now = Date.parse(asOf);
  const transactions = [...detail.transactions].sort(
    (left, right) =>
      Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
  const transactionsById = new Map(
    transactions.map((transaction) => [transaction.id, transaction]),
  );
  const taskIds = new Set(
    transactions
      .filter((transaction) => transaction.transactionType === 'USAGE')
      .map((transaction) => creditUsageTaskId(transaction.operationId))
      .filter((taskId): taskId is string => taskId !== null),
  );
  const usageByTask = new Map(
    await mapWithConcurrency(
      [...taskIds],
      MAX_CONCURRENT_CREDIT_USAGE_READS,
      async (taskId) => [
        taskId,
        (await creditUsage?.getUsage(workspaceId, taskId)) ?? null,
      ] as const,
    ),
  );
  return {
    billing: detail.billing,
    batches: lots.map((lot, index) => ({
      batchNumber: index + 1,
      expiresAt: lot.expirationDate,
      remainingCredits: lot.remainingCredits,
      source: merchantCreditBatchSource(lot.transactionType),
      status:
        lot.expirationDate !== null && Date.parse(lot.expirationDate) <= now
          ? ('expired' as const)
          : lot.remainingCredits === 0
            ? ('depleted' as const)
            : ('active' as const),
    })),
    transactions: transactions.map((transaction) => {
        const batchNumber = batchNumbers.get(transaction.lotId);
        if (!batchNumber) {
          throw new P1DomainError(
            'INVALID_STATE',
            'Credit transaction source lot is missing.',
          );
        }
        return {
        batchNumber,
        credits: transaction.credits,
        creditedAmount:
          transaction.transactionType === 'REFUND' && transaction.credited
            ? transaction.credits
            : 0,
        operation: merchantCreditTransactionOperation(
          transaction,
          transactionsById,
        ),
        occurredAt: transaction.createdAt,
        refundDisposition:
          transaction.transactionType !== 'REFUND'
            ? ('not_applicable' as const)
            : transaction.credited
              ? ('credited' as const)
              : ('expired_uncredited' as const),
        status: merchantCreditTransactionStatus(
          transaction,
          transactionsById,
          usageByTask,
        ),
        type: merchantCreditTransactionType(transaction.transactionType),
      };
      }),
  };
}

async function mapWithConcurrency<T, TResult>(
  values: readonly T[],
  concurrency: number,
  map: (value: T) => Promise<TResult>,
) {
  const results: TResult[] = new Array(values.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await map(values[index]!);
      }
    }),
  );
  return results;
}

function creditUsageTaskId(operationId: string) {
  const prefix = 'consume:task:';
  return operationId.startsWith(prefix)
    ? operationId.slice(prefix.length) || null
    : null;
}

function merchantCreditTransactionStatus(
  transaction: CreditLotTransaction,
  transactionsById: ReadonlyMap<string, CreditLotTransaction>,
  usageByTask: ReadonlyMap<string, { status: CreditUsageStatus } | null>,
) {
  const usage =
    transaction.transactionType === 'USAGE'
      ? transaction
      : transaction.relatedTransactionId
        ? transactionsById.get(transaction.relatedTransactionId)
        : undefined;
  const taskId = usage ? creditUsageTaskId(usage.operationId) : null;
  const usageStatus = taskId ? usageByTask.get(taskId)?.status : null;
  if (usageStatus === 'committed') return 'settled' as const;
  if (usageStatus === 'partially_refunded') {
    return 'partially_refunded' as const;
  }
  if (usageStatus === 'refunded') return 'refunded' as const;
  if (transaction.transactionType === 'REFUND') return 'refunded' as const;
  if (transaction.transactionType === 'USAGE') return 'reserved' as const;
  return 'not_applicable' as const;
}

function merchantCreditTransactionOperation(
  transaction: CreditLotTransaction,
  transactionsById: ReadonlyMap<string, CreditLotTransaction>,
) {
  const usage =
    transaction.transactionType === 'USAGE'
      ? transaction
      : transaction.relatedTransactionId
        ? transactionsById.get(transaction.relatedTransactionId)
        : undefined;
  return usage && creditUsageTaskId(usage.operationId)
    ? ('creation' as const)
    : ('account_credit' as const);
}

function merchantCreditBatchSource(
  type: CreditGrantLot['transactionType'],
) {
  switch (type) {
    case 'REGISTER_GIFT':
      return 'trial' as const;
    case 'SUBSCRIPTION_RENEWAL':
      return 'subscription' as const;
    case 'PURCHASE_PACKAGE':
      return 'booster' as const;
    case 'REDEMPTION_CODE':
      return 'redemption' as const;
  }
}

function merchantCreditTransactionType(
  type: CreditLotTransaction['transactionType'],
) {
  switch (type) {
    case 'USAGE':
      return 'reserve' as const;
    case 'REFUND':
      return 'refund' as const;
    case 'EXPIRE':
      return 'expire' as const;
    default:
      return 'grant' as const;
  }
}

function optionalProviderPeriod(
  payload: Record<string, unknown>,
): ProviderBillingPeriodInput | null {
  const periodStartsAt =
    typeof payload.periodStartsAt === 'string' ? payload.periodStartsAt : null;
  const intervalRaw =
    typeof payload.interval === 'string' ? payload.interval : null;
  const interval =
    intervalRaw === 'single_month' ||
    intervalRaw === 'monthly' ||
    intervalRaw === 'yearly' ||
    intervalRaw === 'month' ||
    intervalRaw === 'year' ||
    intervalRaw === 'lifetime' ||
    intervalRaw === 'one_time'
      ? intervalRaw
      : null;
  const providerOccurredAt =
    typeof payload.providerOccurredAt === 'string'
      ? payload.providerOccurredAt
      : null;
  if (!periodStartsAt && !interval && !providerOccurredAt) {
    return null;
  }
  return { periodStartsAt, interval, providerOccurredAt };
}

function optionalFrozenSettlementAuthority(
  payload: Record<string, unknown>,
): FrozenPlanSettlementAuthority | null {
  if (payload.settlementAuthority == null) return null;
  const parsed = frozenPlanSettlementAuthoritySchema.safeParse(
    payload.settlementAuthority,
  );
  if (!parsed.success) {
    throw new P1DomainError(
      'INVALID_STATE',
      'settlementAuthority is invalid.',
    );
  }
  return parsed.data;
}
