import { createHash } from 'node:crypto';
import {
  P1DomainError,
  USAGE_RESOURCES,
  type AutoTopUpConfiguration,
  type P1Context,
  type ProductEntitlementEvent,
  type ProductEntitlementProjection,
  type ProductPlanPolicy,
  type UsageEvent,
  type UsageResource,
} from './domain.js';
import { projectUsage } from './application-service.js';
import type {
  ProductEntitlementPolicy,
  ProductEntitlementPolicyPort,
  ProductEntitlementSupplement,
  ProductEntitlementSupplementPort,
} from './entitlement-policy.js';
import type { FoundationRepository, FoundationStore } from './ports.js';

const RESOURCES: UsageResource[] = [...USAGE_RESOURCES];
const EMPTY_AUTO_TOP_UP: AutoTopUpConfiguration = {
  enabled: false,
  monthlyCapMicros: 0,
  packages: {},
};

export interface AutoTopUpPaymentPort {
  /**
   * Creates a deterministic local authorization only. Implementations MUST NOT
   * perform payment-network I/O or capture funds here because Foundation calls
   * this method while holding the workspace transaction lock.
   */
  prepareLocal(input: {
    workspaceId: string;
    idempotencyKey: string;
    amountMicros: number;
    currency: string;
    resource: UsageResource;
    quantity: number;
  }): Promise<
    | { status: 'prepared'; paymentEventId: string }
    | { status: 'declined'; reason: string }
  >;
  /** Idempotently accepts/captures payment after the entitlement transaction commits. */
  settle(input: {
    workspaceId: string;
    idempotencyKey: string;
    paymentEventId: string;
    entitlementEventId: string;
  }): Promise<void>;
}

export class RecordedAutoTopUpPaymentPort implements AutoTopUpPaymentPort {
  private readonly prepared = new Map<
    string,
    Parameters<AutoTopUpPaymentPort['prepareLocal']>[0]
  >();
  private readonly settled = new Map<
    string,
    Parameters<AutoTopUpPaymentPort['settle']>[0]
  >();
  private declineReason?: string;
  private settlementFailure?: string;

  declineNext(reason = 'recorded payment declined') {
    this.declineReason = reason;
  }

  failNextSettlement(reason = 'recorded payment settlement unavailable') {
    this.settlementFailure = reason;
  }

  charges() {
    return structuredClone(
      [...this.settled.keys()].flatMap((key) => {
        const prepared = this.prepared.get(key);
        return prepared ? [prepared] : [];
      })
    );
  }

  settlements() {
    return structuredClone([...this.settled.values()]);
  }

  async prepareLocal(
    input: Parameters<AutoTopUpPaymentPort['prepareLocal']>[0]
  ) {
    const key = `${input.workspaceId}:${input.idempotencyKey}`;
    const existing = this.prepared.get(key);
    if (existing && canonical(existing) !== canonical(input)) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Auto top-up payment key was reused with another quote.'
      );
    }
    if (this.declineReason) {
      const reason = this.declineReason;
      this.declineReason = undefined;
      return { status: 'declined' as const, reason };
    }
    this.prepared.set(key, structuredClone(input));
    return {
      status: 'prepared' as const,
      paymentEventId: `recorded-payment-${digest(key).slice(0, 24)}`,
    };
  }

  async settle(
    input: Parameters<AutoTopUpPaymentPort['settle']>[0]
  ): Promise<void> {
    const key = `${input.workspaceId}:${input.idempotencyKey}`;
    if (
      input.paymentEventId !== `recorded-payment-${digest(key).slice(0, 24)}` ||
      !input.entitlementEventId.trim()
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Automatic top-up payment cannot settle before its entitlement.'
      );
    }
    if (this.settlementFailure) {
      const reason = this.settlementFailure;
      this.settlementFailure = undefined;
      throw new Error(reason);
    }
    this.settled.set(key, structuredClone(input));
  }
}

export class ProductEntitlementApplicationService
  implements ProductEntitlementPolicyPort, ProductEntitlementSupplementPort
{
  constructor(
    private readonly repository: FoundationRepository,
    private readonly payments?: AutoTopUpPaymentPort
  ) {}

  async activatePlan(
    context: P1Context,
    input: { paymentEventId: string; policy: ProductPlanPolicy },
    idempotencyKey: string
  ) {
    validatePlan(input.policy);
    requireNonEmpty(input.paymentEventId, 'paymentEventId');
    const result = await this.repository.executeIdempotent(
      context,
      idempotencyKey,
      digest(canonical(input)),
      async (store) => {
        await authorizeOwner(store, context);
        const events = await store.listProductEntitlementEvents(
          context.workspaceId
        );
        const duplicate = paidEvent(events, input.paymentEventId);
        if (duplicate) {
          if (
            duplicate.kind !== 'plan_activated' ||
            canonical(duplicate.policy) !== canonical(input.policy)
          ) {
            throw new P1DomainError(
              'IDEMPOTENCY_CONFLICT',
              'Payment event is already bound to another entitlement.'
            );
          }
          return projectionFromStore(store, context.workspaceId);
        }
        const previous = latestPlan(events);
        const event: ProductEntitlementEvent = {
          id: `plan-${digest(input.paymentEventId).slice(0, 28)}`,
          workspaceId: context.workspaceId,
          actorId: context.userId,
          correlationId: context.correlationId,
          createdAt: new Date().toISOString(),
          kind: 'plan_activated',
          paymentEventId: input.paymentEventId,
          policy: structuredClone(input.policy),
        };
        await store.appendProductEntitlementEvent(event);
        for (const resource of RESOURCES) {
          const amount = previous
            ? previous.policy.periodId === input.policy.periodId
              ? input.policy.allowance[resource] -
                previous.policy.allowance[resource]
              : input.policy.allowance[resource] -
                previous.policy.allowance[resource] +
                Math.min(
                  previous.policy.allowance[resource],
                  await periodCommittedUsage(
                    store,
                    context.workspaceId,
                    resource,
                    previous.policy
                  )
                )
            : input.policy.allowance[resource] -
              (await existingPlanOpeningAllowance(
                store,
                context.workspaceId,
                resource
              ));
          if (amount !== 0) {
            await appendAllowanceAdjustment(
              store,
              event,
              resource,
              amount,
              `plan:${input.policy.tier}:${input.policy.revision}:${input.policy.periodId}`
            );
          }
        }
        return projectionFromStore(store, context.workspaceId);
      }
    );
    return result.value;
  }

  async recordAddOnPurchase(
    context: P1Context,
    input: {
      paymentEventId: string;
      purchaseId: string;
      resource: UsageResource;
      quantity: number;
      amountMicros: number;
      currency: string;
    },
    idempotencyKey: string
  ) {
    validatePurchase(input);
    const result = await this.repository.executeIdempotent(
      context,
      idempotencyKey,
      digest(canonical(input)),
      async (store) => {
        await authorizeOwner(store, context);
        const events = await store.listProductEntitlementEvents(
          context.workspaceId
        );
        const duplicate = paidEvent(events, input.paymentEventId);
        if (duplicate) {
          if (
            duplicate.kind !== 'add_on_purchased' ||
            canonical(paidPurchase(duplicate)) !== canonical(input)
          ) {
            throw new P1DomainError(
              'IDEMPOTENCY_CONFLICT',
              'Payment event is already bound to another entitlement.'
            );
          }
          return projectionFromStore(store, context.workspaceId);
        }
        const event: ProductEntitlementEvent = {
          ...structuredClone(input),
          id: `addon-${digest(input.paymentEventId).slice(0, 28)}`,
          workspaceId: context.workspaceId,
          actorId: context.userId,
          correlationId: context.correlationId,
          createdAt: new Date().toISOString(),
          kind: 'add_on_purchased',
        };
        await store.appendProductEntitlementEvent(event);
        await appendAllowanceAdjustment(
          store,
          event,
          input.resource,
          input.quantity,
          `add_on:${input.purchaseId}:payment:${input.paymentEventId}`
        );
        return projectionFromStore(store, context.workspaceId);
      }
    );
    return result.value;
  }

  async configureAutoTopUp(
    context: P1Context,
    configuration: AutoTopUpConfiguration,
    idempotencyKey: string
  ) {
    validateAutoTopUp(configuration);
    const result = await this.repository.executeIdempotent(
      context,
      idempotencyKey,
      digest(canonical(configuration)),
      async (store) => {
        await authorizeOwner(store, context);
        const event: ProductEntitlementEvent = {
          id: `auto-config-${digest(idempotencyKey).slice(0, 28)}`,
          workspaceId: context.workspaceId,
          actorId: context.userId,
          correlationId: context.correlationId,
          createdAt: new Date().toISOString(),
          kind: 'auto_top_up_configured',
          configuration: structuredClone(configuration),
        };
        await store.appendProductEntitlementEvent(event);
        return projectionFromStore(store, context.workspaceId);
      }
    );
    return result.value;
  }

  async autoTopUp(
    context: P1Context,
    input: {
      resource: UsageResource;
      requiredAvailable: number;
      month?: string;
    },
    idempotencyKey: string
  ) {
    if (
      !Number.isInteger(input.requiredAvailable) ||
      input.requiredAvailable <= 0
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Required available usage must be a positive integer.'
      );
    }
    if (!this.payments) {
      throw new P1DomainError(
        'INVALID_STATE',
        'No automatic top-up payment adapter is configured.'
      );
    }
    const month = input.month ?? currentMonth();
    validateMonth(month);
    const execution = await this.repository.executeIdempotent(
      context,
      idempotencyKey,
      digest(canonical({ action: 'auto_top_up', ...input, month })),
      async (store) => {
        await authorizeOwner(store, context);
        const projection = await projectionFromStore(
          store,
          context.workspaceId,
          month
        );
        if (
          projection.usage[input.resource].available >= input.requiredAvailable
        ) {
          return { projection, settlement: null };
        }
        const configuration = projection.autoTopUp;
        const packageDefinition = configuration.packages[input.resource];
        if (!configuration.enabled || !packageDefinition) {
          throw new P1DomainError(
            'INVALID_STATE',
            'Owner has not enabled automatic top-up for this resource.'
          );
        }
        const deficit =
          input.requiredAvailable - projection.usage[input.resource].available;
        const packageCount = Math.ceil(deficit / packageDefinition.quantity);
        const quantity = packageCount * packageDefinition.quantity;
        const amountMicros = packageCount * packageDefinition.amountMicros;
        const entitlementEvents = await store.listProductEntitlementEvents(
          context.workspaceId
        );
        if (
          autoTopUpCapCommitment(entitlementEvents, month) + amountMicros >
          configuration.monthlyCapMicros
        ) {
          throw new P1DomainError(
            'INVALID_STATE',
            'Automatic top-up would exceed the Owner monthly cap.'
          );
        }
        const payment = await this.payments!.prepareLocal({
          workspaceId: context.workspaceId,
          idempotencyKey,
          amountMicros,
          currency: packageDefinition.currency,
          resource: input.resource,
          quantity,
        });
        if (payment.status === 'declined') {
          throw new P1DomainError('INVALID_STATE', payment.reason);
        }
        const purchase = {
          paymentEventId: payment.paymentEventId,
          purchaseId: `auto-${digest(idempotencyKey).slice(0, 24)}`,
          resource: input.resource,
          quantity,
          amountMicros,
          currency: packageDefinition.currency,
          month,
        };
        const { paymentEventId, ...purchaseWithoutPaymentEvent } = purchase;
        const entitlementEvent: Extract<
          ProductEntitlementEvent,
          { kind: 'auto_top_up_pending' }
        > = {
          ...structuredClone(purchaseWithoutPaymentEvent),
          id: `auto-pending-${digest(payment.paymentEventId).slice(0, 24)}`,
          paymentIntentId: paymentEventId,
          workspaceId: context.workspaceId,
          actorId: context.userId,
          correlationId: context.correlationId,
          createdAt: new Date().toISOString(),
          kind: 'auto_top_up_pending',
        };
        await store.appendProductEntitlementEvent(entitlementEvent);
        return {
          projection,
          settlement: {
            workspaceId: context.workspaceId,
            idempotencyKey,
            paymentEventId,
            entitlementEventId: entitlementEvent.id,
            purchase,
          },
        };
      }
    );
    if (execution.value.settlement) {
      const { purchase, ...settlement } = execution.value.settlement;
      await this.payments.settle(settlement);
      return this.recordAutoTopUpPurchase(
        context,
        purchase,
        `${idempotencyKey}:activate`
      );
    }
    return execution.value.projection;
  }

  async recordAutoTopUpPurchase(
    context: P1Context,
    input: {
      paymentEventId: string;
      purchaseId: string;
      resource: UsageResource;
      quantity: number;
      amountMicros: number;
      currency: string;
      month: string;
    },
    idempotencyKey: string
  ) {
    validatePurchase(input);
    validateMonth(input.month);
    const result = await this.repository.executeIdempotent(
      context,
      idempotencyKey,
      digest(canonical(input)),
      async (store) => {
        await authorizeOwner(store, context);
        const events = await store.listProductEntitlementEvents(
          context.workspaceId
        );
        const duplicate = paidEvent(events, input.paymentEventId);
        if (duplicate) {
          if (
            duplicate.kind !== 'auto_top_up_purchased' ||
            canonical(paidPurchase(duplicate)) !== canonical(input)
          ) {
            throw new P1DomainError(
              'IDEMPOTENCY_CONFLICT',
              'Payment event is already bound to another entitlement.'
            );
          }
          return projectionFromStore(store, context.workspaceId, input.month);
        }
        await appendAutoTopUpPurchase(store, context, input, events);
        return projectionFromStore(store, context.workspaceId, input.month);
      }
    );
    return result.value;
  }

  async getProjection(context: P1Context, month = currentMonth()) {
    await authorizeOwner(this.repository, context);
    return projectionFromStore(this.repository, context.workspaceId, month);
  }

  /** Actor-independent execution policy seam; UI queries still require owner. */
  async resolve(workspaceId: string): Promise<ProductEntitlementPolicy | null> {
    return (await this.resolveSupplement(workspaceId)).policy;
  }

  async resolveSupplement(
    workspaceId: string
  ): Promise<ProductEntitlementSupplement> {
    const projection = await projectionFromStore(this.repository, workspaceId);
    const plan = projection.plan;
    const addOns = projection.addOnPurchases.map((purchase) => ({
      purchaseId: purchase.purchaseId,
      quantity: purchase.quantity,
      resource: purchase.resource,
    }));
    const autoTopUp = {
      enabled: projection.autoTopUp.enabled,
      monthlyCapMicros: projection.autoTopUp.monthlyCapMicros,
      spentThisMonthMicros: projection.autoTopUp.spentThisMonthMicros,
    };
    return {
      addOns,
      autoTopUp,
      policy: plan
        ? {
            addOns: structuredClone(addOns),
            allowance: structuredClone(plan.allowance),
            autoTopUp: structuredClone(autoTopUp),
            concurrencyLimit: plan.concurrencyLimit,
            queuePriority: plan.queuePriority,
            revision: plan.revision,
            supportLabel: plan.supportLabel,
            tier: plan.tier,
          }
        : null,
      revision: `foundation-supplement:${digest(
        canonical({ addOns, autoTopUp })
      )}`,
    };
  }
}

async function projectionFromStore(
  store: FoundationStore,
  workspaceId: string,
  month = currentMonth()
): Promise<ProductEntitlementProjection> {
  const events = await store.listProductEntitlementEvents(workspaceId);
  const usageLists: UsageEvent[][] = [];
  for (const resource of RESOURCES) {
    usageLists.push(await store.listUsageEvents(workspaceId, resource));
  }
  const plan = latestPlan(events)?.policy ?? null;
  const configuration = latestAutoTopUp(events);
  const addOnPurchases = events.flatMap((event) =>
    event.kind === 'add_on_purchased'
      ? [
          {
            purchaseId: event.purchaseId,
            paymentEventId: event.paymentEventId,
            resource: event.resource,
            quantity: event.quantity,
            amountMicros: event.amountMicros,
            currency: event.currency,
          },
        ]
      : []
  );
  const addOns = Object.fromEntries(
    RESOURCES.map((resource) => [
      resource,
      addOnPurchases
        .filter((purchase) => purchase.resource === resource)
        .reduce((sum, purchase) => sum + purchase.quantity, 0),
    ])
  ) as Record<UsageResource, number>;
  const usage = Object.fromEntries(
    RESOURCES.map((resource, index) => [
      resource,
      projectUsage(usageLists[index] as UsageEvent[]),
    ])
  ) as Record<UsageResource, ReturnType<typeof projectUsage>>;
  return {
    workspaceId,
    plan,
    concurrencyLimit: plan?.concurrencyLimit ?? 1,
    queuePriority: plan?.queuePriority ?? 0,
    supportLabel: plan?.supportLabel ?? 'standard',
    usage,
    addOns,
    addOnPurchases,
    autoTopUp: {
      ...structuredClone(configuration),
      month,
      spentThisMonthMicros: autoTopUpSpend(events, month),
    },
  };
}

async function appendAutoTopUpPurchase(
  store: FoundationStore,
  context: P1Context,
  input: {
    paymentEventId: string;
    purchaseId: string;
    resource: UsageResource;
    quantity: number;
    amountMicros: number;
    currency: string;
    month: string;
  },
  existingEvents?: ProductEntitlementEvent[]
) {
  const events =
    existingEvents ??
    (await store.listProductEntitlementEvents(context.workspaceId));
  const configuration = latestAutoTopUp(events);
  const packageDefinition = configuration.packages[input.resource];
  if (!configuration.enabled || !packageDefinition) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Owner has not enabled automatic top-up for this resource.'
    );
  }
  if (
    input.quantity % packageDefinition.quantity !== 0 ||
    input.amountMicros !==
      (input.quantity / packageDefinition.quantity) *
        packageDefinition.amountMicros
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Automatic top-up does not match the Owner-approved package.'
    );
  }
  const spent = autoTopUpCapCommitment(events, input.month, input.purchaseId);
  if (spent + input.amountMicros > configuration.monthlyCapMicros) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Automatic top-up would exceed the Owner monthly cap.'
    );
  }
  const event: ProductEntitlementEvent = {
    ...structuredClone(input),
    id: `auto-purchase-${digest(input.paymentEventId).slice(0, 24)}`,
    workspaceId: context.workspaceId,
    actorId: context.userId,
    correlationId: context.correlationId,
    createdAt: new Date().toISOString(),
    kind: 'auto_top_up_purchased',
  };
  await store.appendProductEntitlementEvent(event);
  await appendAllowanceAdjustment(
    store,
    event,
    input.resource,
    input.quantity,
    `auto_top_up:${input.purchaseId}:payment:${input.paymentEventId}`
  );
  return event;
}

async function appendAllowanceAdjustment(
  store: FoundationStore,
  event: ProductEntitlementEvent,
  resource: UsageResource,
  amount: number,
  reason: string
) {
  await store.appendUsageEvent({
    id: `${event.id}:${resource}:allowance`,
    workspaceId: event.workspaceId,
    resource,
    action: 'adjust',
    amount,
    reason,
    actorId: event.actorId,
    correlationId: event.correlationId,
    createdAt: event.createdAt,
  });
}

async function authorizeOwner(store: FoundationStore, context: P1Context) {
  if ((await store.getOwnerRole(context)) !== 'owner') {
    throw new P1DomainError('NOT_FOUND', 'Workspace resource was not found.');
  }
}

function latestPlan(events: ProductEntitlementEvent[]) {
  return events
    .filter(
      (
        event
      ): event is Extract<
        ProductEntitlementEvent,
        { kind: 'plan_activated' }
      > => event.kind === 'plan_activated'
    )
    .at(-1);
}

function latestAutoTopUp(events: ProductEntitlementEvent[]) {
  return (
    events
      .filter(
        (
          event
        ): event is Extract<
          ProductEntitlementEvent,
          { kind: 'auto_top_up_configured' }
        > => event.kind === 'auto_top_up_configured'
      )
      .at(-1)?.configuration ?? EMPTY_AUTO_TOP_UP
  );
}

function paidEvent(events: ProductEntitlementEvent[], paymentEventId: string) {
  return events.find(
    (event) =>
      'paymentEventId' in event && event.paymentEventId === paymentEventId
  );
}

function paidPurchase(
  event: Extract<
    ProductEntitlementEvent,
    { kind: 'add_on_purchased' | 'auto_top_up_purchased' }
  >
) {
  const base = {
    paymentEventId: event.paymentEventId,
    purchaseId: event.purchaseId,
    resource: event.resource,
    quantity: event.quantity,
    amountMicros: event.amountMicros,
    currency: event.currency,
  };
  return event.kind === 'auto_top_up_purchased'
    ? { ...base, month: event.month }
    : base;
}

function autoTopUpSpend(events: ProductEntitlementEvent[], month: string) {
  return events
    .filter(
      (
        event
      ): event is Extract<
        ProductEntitlementEvent,
        { kind: 'auto_top_up_purchased' }
      > => event.kind === 'auto_top_up_purchased' && event.month === month
    )
    .reduce((sum, event) => sum + event.amountMicros, 0);
}

function autoTopUpCapCommitment(
  events: ProductEntitlementEvent[],
  month: string,
  activatingPurchaseId?: string
) {
  const purchasedIds = new Set(
    events.flatMap((event) =>
      event.kind === 'auto_top_up_purchased' ? [event.purchaseId] : []
    )
  );
  const pending = events
    .filter(
      (
        event
      ): event is Extract<
        ProductEntitlementEvent,
        { kind: 'auto_top_up_pending' }
      > =>
        event.kind === 'auto_top_up_pending' &&
        event.month === month &&
        event.purchaseId !== activatingPurchaseId &&
        !purchasedIds.has(event.purchaseId)
    )
    .reduce((sum, event) => sum + event.amountMicros, 0);
  return autoTopUpSpend(events, month) + pending;
}

async function existingPlanOpeningAllowance(
  store: FoundationStore,
  workspaceId: string,
  resource: UsageResource
) {
  const events = await store.listUsageEvents(workspaceId, resource);
  return events
    .filter(
      (event) =>
        event.action === 'adjust' && event.reason.startsWith('plan_opening:')
    )
    .reduce((sum, event) => {
      const explicit = event.reason.match(/(?:^|;)plan_allowance=(\d+)(?:;|$)/);
      if (explicit) return sum + Number(explicit[1]);
      // Older recorded openings are unambiguous only when they contain no
      // add-on quantity. Never infer an add-on-bearing adjustment as plan-only.
      return event.reason.includes('addons=none') ? sum + event.amount : sum;
    }, 0);
}

async function periodCommittedUsage(
  store: FoundationStore,
  workspaceId: string,
  resource: UsageResource,
  policy: ProductPlanPolicy
) {
  const events = await store.listUsageEvents(workspaceId, resource);
  const startsAt = Date.parse(policy.periodStartsAt);
  const endsAt = Date.parse(policy.periodEndsAt);
  const terminals = new Map(
    events
      .filter(
        (event) =>
          event.action === 'commit' ||
          event.action === 'refund' ||
          event.action === 'expire'
      )
      .map((event) => [event.reservationId, event.action])
  );
  return events
    .filter((event) => {
      if (event.action !== 'reserve' || !event.reservationId) return false;
      const createdAt = Date.parse(event.createdAt);
      if (createdAt < startsAt || createdAt >= endsAt) return false;
      const terminal = terminals.get(event.reservationId);
      return terminal === 'commit';
    })
    .reduce((sum, event) => sum + event.amount, 0);
}

function validatePlan(policy: ProductPlanPolicy) {
  requireNonEmpty(policy.revision, 'plan revision');
  requireNonEmpty(policy.periodId, 'plan period');
  const startsAt = Date.parse(policy.periodStartsAt);
  const endsAt = Date.parse(policy.periodEndsAt);
  if (
    !Number.isFinite(startsAt) ||
    !Number.isFinite(endsAt) ||
    endsAt <= startsAt
  ) {
    throw new P1DomainError('INVALID_STATE', 'Plan period is invalid.');
  }
  for (const resource of RESOURCES) {
    if (
      !Number.isInteger(policy.allowance[resource]) ||
      policy.allowance[resource] < 0
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Plan ${resource} allowance must be a non-negative integer.`
      );
    }
  }
  if (
    !Number.isInteger(policy.concurrencyLimit) ||
    policy.concurrencyLimit <= 0 ||
    !Number.isInteger(policy.queuePriority) ||
    policy.queuePriority < 0
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Plan concurrency and queue priority are invalid.'
    );
  }
}

function validatePurchase(input: {
  paymentEventId: string;
  purchaseId: string;
  resource: UsageResource;
  quantity: number;
  amountMicros: number;
  currency: string;
}) {
  requireNonEmpty(input.paymentEventId, 'paymentEventId');
  requireNonEmpty(input.purchaseId, 'purchaseId');
  requireNonEmpty(input.currency, 'currency');
  if (!RESOURCES.includes(input.resource)) {
    throw new P1DomainError('INVALID_STATE', 'Unknown usage resource.');
  }
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Purchase quantity must be a positive integer.'
    );
  }
  if (!Number.isInteger(input.amountMicros) || input.amountMicros < 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Purchase amount must be non-negative integer micros.'
    );
  }
}

function validateAutoTopUp(configuration: AutoTopUpConfiguration) {
  if (
    !Number.isInteger(configuration.monthlyCapMicros) ||
    configuration.monthlyCapMicros < 0
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Automatic top-up monthly cap must be non-negative integer micros.'
    );
  }
  for (const [resource, definition] of Object.entries(configuration.packages)) {
    if (!definition || !RESOURCES.includes(resource as UsageResource)) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Automatic top-up resource is invalid.'
      );
    }
    validatePurchase({
      paymentEventId: 'configuration',
      purchaseId: 'configuration',
      resource: resource as UsageResource,
      ...definition,
    });
  }
  if (
    configuration.enabled &&
    Object.keys(configuration.packages).length === 0
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Enabled automatic top-up requires at least one package.'
    );
  }
}

function validateMonth(value: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new P1DomainError('INVALID_STATE', 'Month must use YYYY-MM.');
  }
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function requireNonEmpty(value: string, field: string) {
  if (!value.trim()) {
    throw new P1DomainError('INVALID_STATE', `${field} must not be empty.`);
  }
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}
