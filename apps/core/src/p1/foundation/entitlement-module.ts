import { createHash } from 'node:crypto';
import {
  P1DomainError,
  USAGE_RESOURCES,
  type AutoTopUpConfiguration,
  type P1Context,
  type ProductPlanPolicy,
  type ProductPlanTier,
  type UsageResource,
} from './domain.js';
import type { ProductEntitlementApplicationService } from './entitlement-service.js';
import type { P1OperationModule } from './ports.js';

export interface PlanOffer {
  id: ProductPlanTier;
  allowance: Record<UsageResource, number>;
  concurrencyLimit: number;
  queuePriority: number;
  supportLabel: 'standard' | 'priority';
}

export interface AddOnOffer {
  id: string;
  resource: UsageResource;
  quantity: number;
  amountMicros: number;
  currency: string;
}

export const DEFAULT_PLAN_OFFERS: PlanOffer[] = [
  {
    id: 'starter',
    allowance: { audio: 0, copy: 30, image: 10, video: 5 },
    concurrencyLimit: 1,
    queuePriority: 1,
    supportLabel: 'standard',
  },
  {
    id: 'growth',
    allowance: { audio: 0, copy: 100, image: 40, video: 20 },
    concurrencyLimit: 4,
    queuePriority: 5,
    supportLabel: 'priority',
  },
  {
    id: 'pro',
    allowance: { audio: 0, copy: 300, image: 120, video: 60 },
    concurrencyLimit: 8,
    queuePriority: 10,
    supportLabel: 'priority',
  },
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

function offer<T extends { id: string }>(offers: T[], id: string, kind: string) {
  const value = offers.find((candidate) => candidate.id === id);
  if (!value) {
    throw new P1DomainError('INVALID_STATE', `Unknown ${kind} offer ${id}.`);
  }
  return value;
}

function period(clock: () => Date) {
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
  };
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

export class ProductEntitlementFoundationModule implements P1OperationModule {
  readonly name = 'entitlements';

  constructor(
    private readonly entitlements: ProductEntitlementApplicationService,
    private readonly clock: () => Date = () => new Date(),
    private readonly options: {
      recordedCommerceEnabled?: boolean;
      catalogSource?: {
        get(): Promise<{ plans: PlanOffer[]; addOns: AddOnOffer[] }>;
      };
    } = {},
  ) {}

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
        const selected = offer(
          catalog.plans,
          string(payload, 'tier'),
          'plan',
        );
        const currentPeriod = period(this.clock);
        const { id: tier, ...definition } = selected;
        const policy: ProductPlanPolicy = {
          ...structuredClone(definition),
          tier,
          revision: `recorded-${selected.id}-${currentPeriod.periodId}`,
          ...currentPeriod,
        };
        return this.entitlements.activatePlan(
          args.context,
          {
            paymentEventId: `recorded-plan-${digest(`${args.context.workspaceId}:${args.idempotencyKey}`)}`,
            policy,
          },
          args.idempotencyKey,
        );
      }
      case 'checkout_add_on': {
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
        return this.entitlements.configureAutoTopUp(
          args.context,
          this.autoTopUpConfiguration(payload, catalog.addOns),
          args.idempotencyKey,
        );
      case 'auto_top_up': {
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
      const catalog = await this.catalog();
      return {
        mode: this.options.recordedCommerceEnabled
          ? ('recorded' as const)
          : ('disabled' as const),
        plans: structuredClone(catalog.plans),
        addOns: structuredClone(catalog.addOns),
      };
    }
    if (action === 'projection') {
      return this.entitlements.getProjection(
        args.context,
        typeof payload.month === 'string' ? payload.month : undefined,
      );
    }
    throw new P1DomainError(
      'INVALID_STATE',
      `Unknown entitlements query ${action}.`,
    );
  }

  private requireRecordedCommerce(action: string) {
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
    };
  }
}
