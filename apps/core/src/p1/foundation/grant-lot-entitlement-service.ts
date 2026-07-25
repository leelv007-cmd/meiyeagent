import { createHash } from 'node:crypto';
import {
  REGISTER_GIFT_GRANT_KEY,
  USAGE_RESOURCES,
  type P1Context,
  type ProductEntitlementEvent,
  type ProductPlanPolicy,
  type UsageResource,
} from './domain.js';
import {
  ProductEntitlementApplicationService,
  type AutoTopUpPaymentPort,
} from './entitlement-service.js';
import { projectUsage } from './application-service.js';
import type {
  GrantLot,
  GrantLotEntitlementReconciliationInput,
  GrantLotGrantInput,
  GrantLotProjection,
  GrantLotTransaction,
  LegacyGrantLotMigrationInput,
} from './grant-lot.js';
import type { FoundationRepository } from './ports.js';
import type { ProductUsageProjection } from '../product-billing/postgres-repository.js';

export interface GrantLotGrantPort {
  withResourceLocks<T>(
    workspaceId: string,
    resources: readonly UsageResource[],
    work: () => Promise<T>
  ): Promise<T>;
  grant(input: GrantLotGrantInput): Promise<GrantLot> | GrantLot;
  listLots(
    workspaceId: string,
    resource?: UsageResource
  ): Promise<GrantLot[]> | GrantLot[];
  isLegacyBalanceMigrated(
    workspaceId: string,
    resource: UsageResource
  ): Promise<boolean> | boolean;
  markLegacyBalanceMigrated(input: {
    workspaceId: string;
    resource: UsageResource;
    completedAt: string;
  }): Promise<void> | void;
  migrateLegacyBalance(
    input: LegacyGrantLotMigrationInput
  ): Promise<void> | void;
  consume(input: {
    workspaceId: string;
    resource: UsageResource;
    amount: number;
    transactionId: string;
    actorId: string;
    correlationId: string;
    createdAt: string;
  }): Promise<GrantLotTransaction[]> | GrantLotTransaction[];
  reconcileEntitlementLots(
    input: GrantLotEntitlementReconciliationInput
  ): Promise<GrantLotTransaction[]> | GrantLotTransaction[];
  rebuildProjection(input: {
    workspaceId: string;
    asOf: string;
    actorId: string;
    correlationId: string;
  }): Promise<GrantLotProjection[]> | GrantLotProjection[];
  expireLots?(input: {
    workspaceId: string;
    now: string;
    actorId: string;
    correlationId: string;
  }): Promise<unknown> | unknown;
}

export interface ProductUsageProjectionPort {
  getUsageProjection(
    workspaceId: string
  ): Promise<ProductUsageProjection> | ProductUsageProjection;
}

/**
 * Keeps entitlement events and grant lots convergent. The source entitlement
 * command is already idempotent; a retry replays it and resumes this
 * deterministic grant synchronization without duplicating a lot.
 */
export class GrantLotAwareProductEntitlementService extends ProductEntitlementApplicationService {
  constructor(
    private readonly entitlementRepository: FoundationRepository,
    private readonly grantLots: GrantLotGrantPort,
    payments?: AutoTopUpPaymentPort,
    private readonly grantClock: () => Date = () => new Date(),
    private readonly productUsage?: ProductUsageProjectionPort
  ) {
    super(entitlementRepository, payments, grantClock);
  }

  override async activatePlan(
    context: P1Context,
    input: {
      paymentEventId: string;
      policy: ProductPlanPolicy;
      grantKey?: string;
    },
    idempotencyKey: string
  ) {
    return this.withGrantResourceLocks(context.workspaceId, async () => {
      const projection = await super.activatePlan(context, input, idempotencyKey);
      await this.synchronize(context.workspaceId);
      return projection;
    });
  }

  override async recordAddOnPurchase(
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
    return this.withGrantResourceLocks(context.workspaceId, async () => {
      const projection = await super.recordAddOnPurchase(
        context,
        input,
        idempotencyKey
      );
      await this.synchronize(context.workspaceId);
      return projection;
    });
  }

  override async recordAutoTopUpPurchase(
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
    return this.withGrantResourceLocks(context.workspaceId, async () => {
      const projection = await super.recordAutoTopUpPurchase(
        context,
        input,
        idempotencyKey
      );
      await this.synchronize(context.workspaceId);
      return projection;
    });
  }

  override async resolveSupplement(workspaceId: string) {
    return this.withGrantResourceLocks(workspaceId, async () => {
      const supplement = await super.resolveSupplement(workspaceId);
      await this.synchronize(workspaceId);
      return supplement;
    });
  }

  override async getProjection(context: P1Context, month?: string) {
    return this.withGrantResourceLocks(context.workspaceId, async () => {
      const projection = await super.getProjection(context, month);
      await this.synchronize(context.workspaceId);
      const grantProjection = await this.grantLots.rebuildProjection({
        workspaceId: context.workspaceId,
        asOf: this.grantClock().toISOString(),
        actorId: context.userId,
        correlationId: context.correlationId,
      });
      const byResource = new Map(
        grantProjection.map((resource) => [resource.resource, resource])
      );
      const productUsage = await this.productUsage?.getUsageProjection(
        context.workspaceId
      );
      return {
        ...projection,
        usage: Object.fromEntries(
          USAGE_RESOURCES.map((resource) => {
            const grants = byResource.get(resource);
            const legacy = projection.usage[resource];
            if (!grants) {
              return [
                resource,
                {
                  allowance: 0,
                  reserved: 0,
                  committed: 0,
                  released: 0,
                  available: 0,
                },
              ];
            }
            const allowance = Math.max(legacy.allowance, grants.remainingAmount);
            const canonical = productUsage?.[resource];
            const classified =
              (canonical?.reserved ?? 0) + (canonical?.committed ?? 0);
            const netGrantUsage = Math.max(
              0,
              grants.usedAmount - grants.refundedAmount
            );
            return [
              resource,
              {
                ...legacy,
                allowance,
                reserved: canonical?.reserved ?? 0,
                committed:
                  (canonical?.committed ?? 0) +
                  Math.max(0, netGrantUsage - classified),
                released: canonical?.released ?? 0,
                available: grants.remainingAmount,
              },
            ];
          })
        ) as typeof projection.usage,
      };
    });
  }

  private withGrantResourceLocks<T>(
    workspaceId: string,
    work: () => Promise<T>
  ) {
    return this.grantLots.withResourceLocks(
      workspaceId,
      USAGE_RESOURCES,
      work
    );
  }

  private synchronize(workspaceId: string) {
    return this.synchronizeAndExpire(workspaceId);
  }

  private async synchronizeAndExpire(workspaceId: string) {
    const asOf = this.grantClock().toISOString();
    const pendingResources = await pendingLegacyReservationResources(
      this.entitlementRepository,
      workspaceId
    );
    const blockedResources = new Set<UsageResource>();
    for (const resource of pendingResources) {
      if (!(await this.grantLots.isLegacyBalanceMigrated(workspaceId, resource))) {
        blockedResources.add(resource);
      }
    }
    await synchronizeEntitlementGrantLots(
      this.entitlementRepository,
      this.grantLots,
      workspaceId,
      asOf,
      blockedResources
    );
    await this.grantLots.expireLots?.({
      workspaceId,
      now: asOf,
      actorId: 'system-entitlement-expiry',
      correlationId: `grant-lot-expire:${workspaceId}`,
    });
    await backfillLegacyUsageBalance(
      this.entitlementRepository,
      this.grantLots,
      workspaceId,
      asOf,
      blockedResources
    );
  }
}

async function backfillLegacyUsageBalance(
  repository: Pick<FoundationRepository, 'listUsageEvents'>,
  grantLots: GrantLotGrantPort,
  workspaceId: string,
  asOf: string,
  blockedResources: ReadonlySet<UsageResource> = new Set()
) {
  await grantLots.rebuildProjection({
    workspaceId,
    asOf,
    actorId: 'system-legacy-grant-migration',
    correlationId: `legacy-grant-migration:${workspaceId}`,
  });
  for (const resource of USAGE_RESOURCES) {
    if (blockedResources.has(resource)) continue;
    if (await grantLots.isLegacyBalanceMigrated(workspaceId, resource)) {
      continue;
    }
    const events = await repository.listUsageEvents(workspaceId, resource);
    const legacyEvents = events.filter(
      (event) =>
        !(
          event.action === 'adjust' &&
          event.reason.startsWith('redemption_code:')
        )
    );
    const available = projectUsage(legacyEvents).available;
    const createdAt = legacyEvents
      .map((event) => new Date(event.createdAt).toISOString())
      .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
    const fingerprint = digest(
      JSON.stringify(
        legacyEvents.map((event) => [
          event.id,
          event.action,
          event.amount,
          event.reservationId ?? null,
          new Date(event.createdAt).toISOString(),
        ])
      )
    ).slice(0, 20);
    await grantLots.migrateLegacyBalance({
      workspaceId,
      resource,
      legacyAvailable: available,
      legacySnapshotId: fingerprint,
      balanceLotId: `lot-legacy-balance-${digest(`${workspaceId}:${resource}:v1`).slice(0, 24)}`,
      createdAt: createdAt ?? asOf,
      asOf,
    });
  }
}

async function pendingLegacyReservationResources(
  repository: Pick<FoundationRepository, 'listUsageEvents'>,
  workspaceId: string
) {
  const pending = new Set<UsageResource>();
  for (const resource of USAGE_RESOURCES) {
    const events = await repository.listUsageEvents(workspaceId, resource);
    const terminals = new Set(
      events
        .filter(
          (event) =>
            event.reservationId &&
            (event.action === 'commit' ||
              event.action === 'refund' ||
              event.action === 'expire')
        )
        .map((event) => event.reservationId!)
    );
    if (
      events.some(
        (event) =>
          event.action === 'reserve' &&
          event.amount > 0 &&
          event.reservationId &&
          !terminals.has(event.reservationId)
      )
    ) {
      pending.add(resource);
    }
  }
  return pending;
}

export async function synchronizeEntitlementGrantLots(
  repository: Pick<FoundationRepository, 'listProductEntitlementEvents'>,
  grantLots: GrantLotGrantPort,
  workspaceId: string,
  asOf: string,
  blockedResources: ReadonlySet<UsageResource> = new Set()
) {
  const events = await repository.listProductEntitlementEvents(workspaceId);
  let previousPlan: Extract<
    ProductEntitlementEvent,
    { kind: 'plan_activated' }
  > | null = null;
  let periodLotIds = emptyPeriodLotIds();

  for (const event of events) {
    if (event.kind === 'plan_activated') {
      const samePeriod = previousPlan?.policy.periodId === event.policy.periodId;
      if (previousPlan && !samePeriod) {
        for (const resource of USAGE_RESOURCES) {
          if (blockedResources.has(resource)) continue;
          await grantLots.reconcileEntitlementLots({
            workspaceId,
            resource,
            lotIds: periodLotIds[resource],
            targetAmount: 0,
            expirationDate: event.createdAt,
            operationId: `entitlement-period-close:${event.id}:${resource}`,
            actorId: event.actorId,
            correlationId: event.correlationId,
            asOf,
          });
        }
        periodLotIds = emptyPeriodLotIds();
      }
      const expirationDate = event.policy.periodEndsAt;
      for (const resource of USAGE_RESOURCES) {
        if (blockedResources.has(resource)) continue;
        const previousAmount = samePeriod
          ? (previousPlan?.policy.allowance[resource] ?? 0)
          : 0;
        const amount = Math.max(
          0,
          event.policy.allowance[resource] - previousAmount
        );
        if (
          amount > 0 &&
          Date.parse(expirationDate) > Date.parse(event.createdAt)
        ) {
          const lotId = entitlementLotId(event.id, resource);
          await grantLots.grant({
            id: lotId,
            workspaceId,
            resource,
            amount,
            expirationDate,
            transactionType:
              event.grantKey === REGISTER_GIFT_GRANT_KEY
                ? 'REGISTER_GIFT'
                : 'SUBSCRIPTION_RENEWAL',
            sourceRef: event.id,
            actorId: event.actorId,
            correlationId: event.correlationId,
            createdAt: event.createdAt,
          });
          periodLotIds[resource].push(lotId);
        }
        await grantLots.reconcileEntitlementLots({
          workspaceId,
          resource,
          lotIds: periodLotIds[resource],
          targetAmount: event.policy.allowance[resource],
          expirationDate,
          operationId: `entitlement-plan-reconcile:${event.id}:${resource}`,
          actorId: event.actorId,
          correlationId: event.correlationId,
          asOf,
        });
      }
      previousPlan = event;
      continue;
    }

    if (
      event.kind === 'add_on_purchased' ||
      event.kind === 'auto_top_up_purchased'
    ) {
      if (blockedResources.has(event.resource)) continue;
      await grantLots.grant({
        id: entitlementLotId(event.id, event.resource),
        workspaceId,
        resource: event.resource,
        amount: event.quantity,
        expirationDate: null,
        transactionType: 'PURCHASE_PACKAGE',
        sourceRef: event.purchaseId,
        actorId: event.actorId,
        correlationId: event.correlationId,
        createdAt: event.createdAt,
      });
    }
  }
}

function emptyPeriodLotIds(): Record<UsageResource, string[]> {
  return { audio: [], copy: [], image: [], video: [] };
}

function entitlementLotId(eventId: string, resource: UsageResource) {
  return `lot-entitlement-${digest(`${eventId}:${resource}`).slice(0, 24)}`;
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
