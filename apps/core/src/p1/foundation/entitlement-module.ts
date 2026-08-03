import { createHash } from 'node:crypto';
import {
  PUBLIC_PLAN_ALLOWANCE_SEED,
  merchantCreditDetailSchema,
  publicBillingBalanceSchema,
  publicCreditBalanceSchema,
  type PublicCreditBalance,
} from '@meiye/contracts';
import {
  P1DomainError,
  USAGE_RESOURCES,
  type AutoTopUpConfiguration,
  type P1Context,
  type ProductPlanPeriodStrategy,
  type ProductPlanPolicy,
  type ProductPlanTier,
  type UsageResource,
} from './domain.js';
import type { ProductEntitlementApplicationService } from './entitlement-service.js';
import {
  billingPeriodFromProvider,
  resolvePaymentTier,
  type PaymentMappingConfig,
} from './payment-mapping.js';
import type { P1OperationModule } from './ports.js';
import {
  WorkspaceProvisionService,
  type PlatformDefaultModelPort,
} from './workspace-provision.js';
import {
  CreditBillingService,
  type CreditPaymentLifecycle,
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
const PERSISTENT_STARTER_PERIOD_END = '9999-12-31T23:59:59.999Z';

/**
 * Temporary read-only shape adapter for pre-#305 consumers. The credit
 * balance remains the only billing authority; this never writes or derives a
 * second ledger. Legacy consumers only need a defined usage shape while the
 * credit UI takes ownership of this query.
 */
function legacyCreditUsageProjection(
  balance: PublicCreditBalance,
  tier: ProductPlanTier,
) {
  const plan =
    DEFAULT_PLAN_OFFERS.find((candidate) => candidate.id === tier) ??
    DEFAULT_PLAN_OFFERS.find((candidate) => candidate.id === 'trial')!;
  const bucket = (resource: UsageResource) => {
    const allowance = plan.allowance[resource];
    return {
      allowance,
      reserved: 0,
      committed: 0,
      released: 0,
      available: Math.min(allowance, balance.availableCredits),
    };
  };
  return {
    plan: { tier: plan.id },
    usage: {
      copy: bucket('copy'),
      image: bucket('image'),
      video: bucket('video'),
      audio: bucket('audio'),
    },
  };
}

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
 * Seed values only — the running numbers are the `plan.allowances.*`
 * admin-config keys operations fills in (D-123 数字＝运营参数, D-132 §C-1).
 *
 * The sold tiers take their allowances from `PUBLIC_PLAN_ALLOWANCE_SEED` in
 * the shared contract, which is the same literal the pricing page falls back
 * to — one seed, not two that drift. Trial stays here at 文案5/图5/视频1: the
 * manifest records it as 已定 (C-3) and it is never quoted publicly.
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

function optionalString(input: Record<string, unknown>, key: string) {
  const value = input[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function offer<T extends { id: string }>(offers: T[], id: string, kind: string) {
  const value = offers.find((candidate) => candidate.id === id);
  if (!value) {
    throw new P1DomainError('INVALID_STATE', `Unknown ${kind} offer ${id}.`);
  }
  return value;
}

export interface ProviderBillingPeriodInput {
  periodStartsAt?: string | null;
  periodEndsAt?: string | null;
  interval?:
    | 'single_month'
    | 'monthly'
    | 'yearly'
    | 'month'
    | 'year'
    | 'lifetime'
    | 'one_time'
    | null;
}

/**
 * Build the billing period for a plan offer.
 * - trial / fixed_days: periodStartsAt = grant time, periodEndsAt = +expireDays
 * - paid + provider period input: use provider billing window (Tc-2)
 * - paid tiers / calendar_month: UTC natural month fallback
 */
export function periodForOffer(
  selected: PlanOffer,
  clock: () => Date = () => new Date(),
  providerPeriod?: ProviderBillingPeriodInput | null,
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

  // Paid path: prefer provider billing period when the webhook supplies it.
  if (providerPeriod && hasProviderPeriod(providerPeriod)) {
    const period = billingPeriodFromProvider({
      interval: providerPeriod.interval ?? null,
      periodStartsAt: providerPeriod.periodStartsAt,
      periodEndsAt: providerPeriod.periodEndsAt,
      clock,
    });
    return {
      periodId: period.periodId,
      periodStartsAt: period.periodStartsAt,
      periodEndsAt: period.periodEndsAt,
      periodStrategy: 'provider_period',
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

function hasProviderPeriod(input: ProviderBillingPeriodInput) {
  return Boolean(
    (input.periodStartsAt && input.periodStartsAt.trim()) ||
      (input.periodEndsAt && input.periodEndsAt.trim()) ||
      input.interval
  );
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function policyFromOffer(
  selected: PlanOffer,
  clock: () => Date,
  providerPeriod?: ProviderBillingPeriodInput | null,
): ProductPlanPolicy {
  const currentPeriod = periodForOffer(selected, clock, providerPeriod);
  const { id: tier, expireDays: _expireDays, periodStrategy: _strategy, ...definition } =
    selected;
  const revisionPrefix = providerPeriod ? 'payment' : 'recorded';
  return {
    ...structuredClone(definition),
    tier,
    revision: `${revisionPrefix}-${selected.id}-${currentPeriod.periodId}`,
    periodId: currentPeriod.periodId,
    periodStartsAt: currentPeriod.periodStartsAt,
    periodEndsAt: currentPeriod.periodEndsAt,
    periodStrategy: currentPeriod.periodStrategy,
  };
}

export class ProductEntitlementFoundationModule implements P1OperationModule {
  readonly name = 'entitlements';

  private readonly provisioner: WorkspaceProvisionService;

  constructor(
    private readonly entitlements: ProductEntitlementApplicationService,
    private readonly clock: () => Date = () => new Date(),
    private readonly options: {
      recordedCommerceEnabled?: boolean;
      catalogSource?: {
        get(): Promise<{
          plans: PlanOffer[];
          addOns: AddOnOffer[];
          trialEnabled?: boolean;
        }>;
        getPaymentMapping?(): Promise<PaymentMappingConfig | null>;
      };
      monthlyOutput?: {
        getMonthlyOutput(
          workspaceId: string,
          month: string,
        ): Promise<{ copy: number; image: number; video: number }>;
      };
      /** Optional platform default model binding for workspace provision (Tb). */
      modelDefaults?: PlatformDefaultModelPort;
      /** Production commerce writes only the credit ledger and subscription store. */
      creditBilling?: CreditBillingService;
      /** Read-only paid tier source for the legacy projection bridge. */
      creditEntitlements?: ProductEntitlementPolicyPort;
      /** Read-only task status joins a credit reservation to its settlement. */
      creditUsage?: CreditUsageReader;
      modelCatalogTenantAllowlist?: readonly string[];
      warn?: (message: string) => void;
    } = {},
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
    this.requireRecordedCommerce(action);
    const catalog = await this.catalog();
    switch (action) {
      case 'checkout_plan': {
        if (this.options.creditBilling) {
          throw new P1DomainError(
            'INVALID_STATE',
            'Recorded plan checkout is retired; verified payment settlement owns credit subscriptions.',
          );
        }
        const selected = offer(
          catalog.plans,
          string(payload, 'tier'),
          'plan',
        );
        const policy = policyFromOffer(selected, this.clock);
        return this.entitlements.activatePlan(
          args.context,
          {
            paymentEventId: `recorded-plan-${digest(`${args.context.workspaceId}:${args.idempotencyKey}`)}`,
            policy,
          },
          args.idempotencyKey,
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
        if (this.options.creditBilling) {
          return this.options.creditBilling.settlePayment(args.context, {
            lifecycle: lifecycle as CreditPaymentLifecycle,
            paymentEventId,
            paymentProductId,
            paymentProvider: paymentProvider ?? undefined,
            interval: providerPeriod?.interval,
            periodStartsAt: providerPeriod?.periodStartsAt,
            subscriptionId: optionalString(payload, 'subscriptionId'),
          });
        }
        const selected = offer(
          catalog.plans,
          resolvePaymentTier({
            paymentProductId,
            interval: providerPeriod?.interval,
            config:
              (await this.options.catalogSource?.getPaymentMapping?.()) ??
              null,
            paymentProvider,
          }),
          'plan',
        );
        if (selected.id === 'trial') {
          throw new P1DomainError(
            'INVALID_STATE',
            'payment_grant cannot activate trial; use register_gift.',
          );
        }

        // cancel_at_period_end: do not re-grant; ensure active plan's
        // periodEndsAt is the cancel boundary (provider period). Access
        // continues until periodEndsAt; Ta projection zeros after that.
        if (lifecycle === 'cancel_at_period_end') {
          if (!providerPeriod?.periodEndsAt) {
            throw new P1DomainError(
              'INVALID_STATE',
              'cancel_at_period_end requires provider periodEndsAt.',
            );
          }
          // Re-activate same tier with explicit end so projection honors it.
          // paymentEventId is unique per cancel event → idempotent audit.
          const policy = policyFromOffer(selected, this.clock, {
            ...providerPeriod,
            interval: providerPeriod.interval ?? 'month',
          });
          return this.entitlements.activatePlan(
            args.context,
            { paymentEventId, policy },
            args.idempotencyKey,
          );
        }

        if (lifecycle === 'expire') {
          // Paid expiry falls back to the durable Starter baseline. Keep its
          // own long-lived period active so later reads cannot revive the old
          // paid plan or collapse to no plan; add-on lots remain independent.
          const startsAt = this.clock().toISOString();
          const starter = offer(catalog.plans, 'starter', 'plan');
          const policy = policyFromOffer(starter, this.clock, {
            periodStartsAt: startsAt,
            periodEndsAt: PERSISTENT_STARTER_PERIOD_END,
            interval: 'month',
          });
          return this.entitlements.activatePlan(
            args.context,
            { paymentEventId, policy },
            args.idempotencyKey,
          );
        }

        const policy = policyFromOffer(
          selected,
          this.clock,
          providerPeriod,
        );
        return this.entitlements.activatePlan(
          args.context,
          { paymentEventId, policy },
          args.idempotencyKey,
        );
      }
      case 'register_gift': {
        // Trusted internal REGISTER_GIFT grant (Tb). Not gated by dev commerce.
        this.requireProvisioningActor(args.context);
        if (this.options.creditBilling) {
          return this.options.creditBilling.grantTrial(args.context);
        }
        return this.provisioner.provisionTrial(
          args.context,
          args.idempotencyKey,
        );
      }
      case 'provision_model_defaults': {
        // Trusted model-default step. Its outer module command is durably keyed
        // by workspace-provision:model-default:v1, independently of trial.
        this.requireProvisioningActor(args.context);
        return this.provisioner.provisionModelDefaults(args.context);
      }
      case 'checkout_add_on': {
        if (this.options.creditBilling) {
          throw new P1DomainError(
            'INVALID_STATE',
            'Recorded add-on checkout is retired; verified payment settlement must grant a credit package.',
          );
        }
        const selected = offer(
          catalog.addOns,
          string(payload, 'offerId'),
          'add-on',
        );
        const checkoutId = digest(
          `${args.context.workspaceId}:${args.idempotencyKey}`,
        );
        return this.entitlements.recordAddOnPurchase(
          args.context,
          {
            paymentEventId: `recorded-add-on-${checkoutId}`,
            purchaseId: `recorded-purchase-${checkoutId}`,
            resource: selected.resource,
            quantity: selected.quantity,
            amountMicros: selected.amountMicros,
            currency: selected.currency,
          },
          args.idempotencyKey,
        );
      }
      case 'configure_auto_top_up':
        if (this.options.creditBilling) {
          throw new P1DomainError(
            'INVALID_STATE',
            'Credit billing does not support legacy resource auto top-up.',
          );
        }
        return this.entitlements.configureAutoTopUp(
          args.context,
          this.autoTopUpConfiguration(payload, catalog.addOns),
          args.idempotencyKey,
        );
      case 'auto_top_up': {
        if (this.options.creditBilling) {
          throw new P1DomainError(
            'INVALID_STATE',
            'Credit billing does not support legacy resource auto top-up.',
          );
        }
        const resource = string(payload, 'resource');
        if (!USAGE_RESOURCES.includes(resource as UsageResource)) {
          throw new P1DomainError('INVALID_STATE', 'resource is invalid.');
        }
        return this.entitlements.autoTopUp(
          args.context,
          {
            resource: resource as UsageResource,
            requiredAvailable: Number(payload.requiredAvailable),
            ...(typeof payload.month === 'string'
              ? { month: payload.month }
              : {}),
          },
          args.idempotencyKey,
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
    const payload = object(args.input.payload ?? {}, 'payload');
    if (action === 'catalog') {
      if (this.options.creditBilling) {
        const catalog = await this.options.creditBilling.catalog();
        return {
          mode: 'credit' as const,
          plans: structuredClone(catalog.plans),
          addOns: structuredClone(catalog.addOns),
          trialEnabled: catalog.trialEnabled,
        };
      }
      const catalog = await this.catalog();
      return {
        mode: this.options.recordedCommerceEnabled
          ? ('recorded' as const)
          : ('disabled' as const),
        plans: structuredClone(catalog.plans),
        addOns: structuredClone(catalog.addOns),
        trialEnabled: catalog.trialEnabled,
      };
    }
    if (action === 'balance') {
      if (this.options.creditBilling) {
        return publicCreditBalanceSchema.parse(
          await this.options.creditBilling.balance(args.context.workspaceId),
        );
      }
      const projection = await this.entitlements.getProjection(args.context);
      const bucket = (resource: 'copy' | 'image' | 'video') => {
        const usage = projection.usage[resource];
        return {
          allowance: usage.allowance,
          reserved: usage.reserved,
          committed: usage.committed,
          released: usage.released,
          available: usage.available,
        };
      };
      return publicBillingBalanceSchema.parse({
        copy: bucket('copy'),
        image: bucket('image'),
        video: bucket('video'),
      });
    }
    if (action === 'credit_detail') {
      if (!this.options.creditBilling) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Credit detail is unavailable before credit billing is configured.',
        );
      }
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
      if (this.options.creditBilling) {
        const credits = publicCreditBalanceSchema.parse(
          await this.options.creditBilling.balance(
            args.context.workspaceId,
          ),
        );
        const legacyPlan = await this.options.creditEntitlements?.resolve(
          args.context.workspaceId,
        );
        return {
          ...legacyCreditUsageProjection(credits, legacyPlan?.tier ?? 'trial'),
          credits,
        };
      }
      const month =
        typeof payload.month === 'string'
          ? payload.month
          : monthInShanghai(this.clock());
      const projection = await this.entitlements.getProjection(
        args.context,
        month,
      );
      const output = this.options.monthlyOutput
        ? await this.options.monthlyOutput.getMonthlyOutput(
            args.context.workspaceId,
            month,
          )
        : { copy: 0, image: 0, video: 0 };
      return {
        ...projection,
        monthlyOutput: { month, ...output },
      };
    }
    throw new P1DomainError(
      'INVALID_STATE',
      `Unknown entitlements query ${action}.`,
    );
  }

  private requireRecordedCommerce(action: string) {
    // payment_grant is trusted webhook path — not gated by dev commerce.
    if (
      !this.options.recordedCommerceEnabled &&
      [
        'checkout_plan',
        'checkout_add_on',
        'configure_auto_top_up',
        'auto_top_up',
      ].includes(action)
    ) {
      throw new P1DomainError(
        'FORBIDDEN',
        'Recorded commerce is disabled outside an explicit development environment.',
      );
    }
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

  private autoTopUpConfiguration(
    payload: Record<string, unknown>,
    addOns: AddOnOffer[],
  ): AutoTopUpConfiguration {
    const packageOfferIds = object(payload.packageOfferIds ?? {}, 'packageOfferIds');
    const packages: AutoTopUpConfiguration['packages'] = {};
    for (const resource of USAGE_RESOURCES) {
      const offerId = packageOfferIds[resource];
      if (offerId === undefined) continue;
      if (typeof offerId !== 'string') {
        throw new P1DomainError(
          'INVALID_STATE',
          `${resource} package offer is invalid.`,
        );
      }
      const selected = offer(addOns, offerId, 'add-on');
      if (selected.resource !== resource) {
        throw new P1DomainError(
          'INVALID_STATE',
          `${offerId} cannot top up ${resource}.`,
        );
      }
      packages[resource] = {
        quantity: selected.quantity,
        amountMicros: selected.amountMicros,
        currency: selected.currency,
      };
    }
    return {
      enabled: payload.enabled === true,
      monthlyCapMicros: Number(payload.monthlyCapMicros),
      packages,
    };
  }

  private async catalog() {
    return this.options.catalogSource?.get() ?? {
      plans: structuredClone(DEFAULT_PLAN_OFFERS),
      addOns: structuredClone(DEFAULT_ADD_ON_OFFERS),
      trialEnabled: true,
    };
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

function monthInShanghai(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  if (!year || !month) {
    throw new P1DomainError('INVALID_STATE', 'Current billing month is unavailable.');
  }
  return `${year}-${month}`;
}

function optionalProviderPeriod(
  payload: Record<string, unknown>,
): ProviderBillingPeriodInput | null {
  const periodStartsAt =
    typeof payload.periodStartsAt === 'string' ? payload.periodStartsAt : null;
  const periodEndsAt =
    typeof payload.periodEndsAt === 'string' ? payload.periodEndsAt : null;
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
  if (!periodStartsAt && !periodEndsAt && !interval) return null;
  return { periodStartsAt, periodEndsAt, interval };
}
