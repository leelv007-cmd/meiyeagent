import type { DedicatedSupplyPool, SupplyPool } from '@meiye/contracts';
import type {
  ProductEntitlementPolicy,
  ProductEntitlementPolicyPort,
  QualityTierPreference,
} from '../foundation/entitlement-policy.js';
import type { UsageResource } from '../foundation/domain.js';
import type {
  ModelSupplyProviderAdmissionDecision,
  ModelSupplyProviderAdmissionPort,
} from '../model-supply/index.js';
import type {
  AccountAllocation,
  EntitlementPlanTier,
  EntitlementPolicyRevision,
} from './contracts.js';
import { computeEffectiveEntitlement } from './effective-entitlement.js';
import type {
  AcquireFairPostgresCapacityLeaseInput,
  AcquirePostgresCapacityLeaseInput,
  PersistedSupplyPool,
} from './postgres-repository.js';
import type { CapacityAdmissionDecision } from './three-layer-capacity.js';

interface EntitlementPolicyReader {
  getPublished(
    tier: EntitlementPlanTier
  ): Promise<EntitlementPolicyRevision | null>;
}

interface AccountAllocationReader {
  listActive(input: {
    accountId: string;
    workspaceId: string;
    now?: Date;
  }): Promise<AccountAllocation[]>;
}

interface SupplyPoolReader {
  list(kind?: PersistedSupplyPool['kind']): Promise<PersistedSupplyPool[]>;
}

interface CapacityLeasePort {
  tryAcquire(
    input: AcquirePostgresCapacityLeaseInput
  ): Promise<CapacityAdmissionDecision>;
  tryAcquireFair?(
    input: AcquireFairPostgresCapacityLeaseInput
  ): Promise<CapacityAdmissionDecision>;
  reacquireFair?(
    leaseId: string,
    expiresAt: string,
    now?: string,
    maxWaitMs?: number
  ): Promise<CapacityAdmissionDecision | null>;
  renew?(leaseId: string, expiresAt: string, now?: string): Promise<boolean>;
  release(leaseId: string, releasedAt?: string): Promise<boolean>;
}

export interface PostgresModelSupplyProviderAdmissionOptions {
  productEntitlements: ProductEntitlementPolicyPort;
  entitlementPolicies: EntitlementPolicyReader;
  accountAllocations: AccountAllocationReader;
  supplyPools: SupplyPoolReader;
  capacityLeases: CapacityLeasePort;
  defaultSupplyPoolId?: string;
  leaseTtlMs?: number;
  defaultSupplyAccountConcurrency?: number;
  defaultSystemConcurrency?: number;
  capacityQueueWaitMs?: number;
}

const DEFAULT_LEASE_TTL_MS = 15 * 60 * 1_000;

function reject(
  errorCode: string,
  message: string
): ModelSupplyProviderAdmissionDecision {
  return { status: 'rejected', errorCode, message };
}

function resourceForOperation(operation: string): UsageResource {
  if (operation.startsWith('image.')) return 'image';
  if (operation.startsWith('video.')) return 'video';
  if (operation.startsWith('audio.')) return 'audio';
  return 'copy';
}

function policyFromPublishedRevision(
  productPolicy: ProductEntitlementPolicy,
  published: EntitlementPolicyRevision | null
): ProductEntitlementPolicy {
  if (!published) return productPolicy;
  const { rateLabel: _rateLabel, ...body } = published.body;
  return {
    ...productPolicy,
    ...body,
    revision: published.id,
  };
}

function isExplicitlyRestricted(
  allocations: AccountAllocation[],
  predicate: (allocation: AccountAllocation) => boolean
) {
  return allocations.some(
    (allocation) => allocation.kind === 'restrict' && predicate(allocation)
  );
}

function capacityLimits(
  pool: SupplyPool | DedicatedSupplyPool,
  productConcurrency: number,
  defaults: {
    supplyAccount: number;
    system: number;
  }
) {
  const configured =
    pool.kind === 'dedicated' &&
    'reservedCapacity' in pool &&
    pool.reservedCapacity
      ? pool.reservedCapacity
      : pool.capacity;
  const configuredProduct = configured?.productAccount?.concurrency;
  return {
    supplyAccount: {
      concurrency:
        configured?.supplyAccount?.concurrency ?? defaults.supplyAccount,
      ...(configured?.supplyAccount?.rpm !== undefined
        ? { rpm: configured.supplyAccount.rpm }
        : {}),
      ...(configured?.supplyAccount?.tpm !== undefined
        ? { tpm: configured.supplyAccount.tpm }
        : {}),
    },
    productAccount: {
      concurrency: Math.min(
        productConcurrency,
        configuredProduct ?? productConcurrency
      ),
      ...(configured?.productAccount?.queuePriority !== undefined
        ? { queuePriority: configured.productAccount.queuePriority }
        : {}),
    },
    systemTotal: {
      concurrency: configured?.systemTotal?.concurrency ?? defaults.system,
    },
  };
}

/**
 * Request-time H1/H2 adapter. Every call reloads durable policy, allocation,
 * pool, and capacity heads so HTTP and Worker observe the same PostgreSQL facts.
 */
export class PostgresModelSupplyProviderAdmission
  implements ModelSupplyProviderAdmissionPort
{
  private readonly defaultSupplyPoolId: string;
  private readonly leaseTtlMs: number;
  private readonly defaultSupplyAccountConcurrency: number;
  private readonly defaultSystemConcurrency: number;
  private readonly capacityQueueWaitMs: number;

  constructor(
    private readonly options: PostgresModelSupplyProviderAdmissionOptions
  ) {
    this.defaultSupplyPoolId =
      options.defaultSupplyPoolId ?? 'pool-shared-default';
    this.leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
    this.defaultSupplyAccountConcurrency =
      options.defaultSupplyAccountConcurrency ?? 32;
    this.defaultSystemConcurrency = options.defaultSystemConcurrency ?? 256;
    this.capacityQueueWaitMs = options.capacityQueueWaitMs ?? 30_000;
  }

  async admit(
    input: Parameters<ModelSupplyProviderAdmissionPort['admit']>[0]
  ): Promise<ModelSupplyProviderAdmissionDecision> {
    const productPolicy = await this.options.productEntitlements.resolve(
      input.submission.workspaceId
    );
    if (!productPolicy) {
      return reject(
        'ENTITLEMENT_POLICY_UNAVAILABLE',
        'No active product entitlement is available for this workspace.'
      );
    }
    const [published, allocations, pools] = await Promise.all([
      this.options.entitlementPolicies.getPublished(productPolicy.tier),
      this.options.accountAllocations.listActive({
        accountId: input.submission.actorId,
        workspaceId: input.submission.workspaceId,
      }),
      this.options.supplyPools.list(),
    ]);
    const planPolicy = policyFromPublishedRevision(productPolicy, published);
    const effective = computeEffectiveEntitlement({
      planPolicy,
      accountOverrides: allocations.filter(
        (allocation) => allocation.source !== 'campaign'
      ),
      campaignGrants: allocations.filter(
        (allocation) => allocation.source === 'campaign'
      ),
      requestPreferences:
        input.submission.selection.mode === 'auto'
          ? {
              preferredQualityTier: [
                (input.submission.selection.profile ??
                  'auto') as QualityTierPreference,
              ],
            }
          : undefined,
    });
    const now = new Date();
    if (
      (effective.validity.validFrom &&
        Date.parse(effective.validity.validFrom) > now.getTime()) ||
      (effective.validity.validUntil &&
        Date.parse(effective.validity.validUntil) <= now.getTime())
    ) {
      return reject(
        'ENTITLEMENT_POLICY_INACTIVE',
        'The effective entitlement policy is outside its validity window.'
      );
    }

    const modelRestricted = isExplicitlyRestricted(
      allocations,
      (allocation) =>
        allocation.target.type === 'catalog_model' &&
        allocation.target.catalogModelId === input.model.id
    );
    if (
      modelRestricted ||
      (effective.allowedCatalogModelIds.length > 0 &&
        !effective.allowedCatalogModelIds.includes(input.model.id))
    ) {
      return reject(
        'CATALOG_MODEL_NOT_ENTITLED',
        `CatalogModel ${input.model.id} is not allowed by the effective entitlement.`
      );
    }
    const resource = resourceForOperation(input.submission.operation);
    if (effective.allowance[resource] <= 0) {
      return reject(
        'RESOURCE_NOT_ENTITLED',
        `The effective entitlement does not allow ${resource} usage.`
      );
    }
    if (
      input.submission.selection.mode === 'auto' &&
      effective.allowedQualityTiers.length > 0 &&
      !effective.allowedQualityTiers.includes(
        (input.submission.selection.profile ?? 'auto') as QualityTierPreference
      )
    ) {
      return reject(
        'QUALITY_TIER_NOT_ENTITLED',
        'The requested quality tier is not allowed by the effective entitlement.'
      );
    }

    const allowedPoolIds = new Set(effective.availableSupplyPoolIds);
    const requestedDataClasses =
      input.submission.dataClass.length > 0
        ? input.submission.dataClass
        : ['public' as const];
    const entitledPools = pools.filter((pool) => {
      if (!pool.deploymentIds.includes(input.deployment.id)) return false;
      if (allowedPoolIds.size > 0 && !allowedPoolIds.has(pool.id)) return false;
      if (
        isExplicitlyRestricted(
          allocations,
          (allocation) =>
            allocation.target.type === 'supply_pool' &&
            allocation.target.supplyPoolId === pool.id
        )
      ) {
        return false;
      }
      return true;
    });
    const eligiblePools = entitledPools.filter((pool) => {
      if (
        input.snapshot.credentialAccountId &&
        !pool.credentialAccountIds.includes(input.snapshot.credentialAccountId)
      ) {
        return false;
      }
      if (
        pool.kind === 'dedicated' &&
        !(
          'authorizedWorkspaceIds' in pool &&
          pool.authorizedWorkspaceIds?.includes(input.submission.workspaceId)
        ) &&
        !allocations.some(
          (allocation) =>
            allocation.kind === 'grant' &&
            allocation.target.type === 'supply_pool' &&
            allocation.target.supplyPoolId === pool.id
        )
      ) {
        return false;
      }
      if (pool.kind === 'dedicated') {
        const dedicated = pool as DedicatedSupplyPool;
        if (
          dedicated.regionRestriction?.length &&
          !dedicated.regionRestriction.includes(input.deployment.region)
        ) {
          return false;
        }
        if (
          dedicated.dataClassRestriction?.length &&
          requestedDataClasses.some(
            (dataClass) => !dedicated.dataClassRestriction!.includes(dataClass)
          )
        ) {
          return false;
        }
      }
      return true;
    });
    const pool =
      eligiblePools.find(
        (candidate) => candidate.id === this.defaultSupplyPoolId
      ) ?? eligiblePools[0];
    if (!pool) {
      return reject(
        'SUPPLY_POOL_NOT_ENTITLED',
        `No entitled SupplyPool contains deployment ${input.deployment.id}.`
      );
    }
    const preferredPool =
      entitledPools.find(
        (candidate) => candidate.id === this.defaultSupplyPoolId
      ) ?? entitledPools[0];
    if (preferredPool && preferredPool.kind !== pool.kind) {
      const contractEntitlementAuthorized = allocations.some(
        (allocation) =>
          allocation.kind === 'grant' &&
          allocation.target.type === 'supply_pool' &&
          allocation.target.supplyPoolId === pool.id
      );
      const dataPolicyAuthorized = Boolean(input.snapshot.dataPolicyRevisionId);
      if (!contractEntitlementAuthorized || !dataPolicyAuthorized) {
        return reject(
          'CROSS_KIND_FALLBACK_DENIED',
          `Cross-kind fallback from ${preferredPool.kind} pool ${preferredPool.id} to ${pool.kind} pool ${pool.id} requires explicit contract entitlement and data policy authorization.`
        );
      }
    }

    const acquiredAt = input.snapshot.createdAt;
    const expiresAt = new Date(now.getTime() + this.leaseTtlMs).toISOString();
    const supplyAccountId =
      input.snapshot.credentialAccountId ?? pool.credentialAccountIds[0];
    if (!supplyAccountId) {
      return reject(
        'SUPPLY_ACCOUNT_UNAVAILABLE',
        `SupplyPool ${pool.id} has no CredentialAccount binding.`
      );
    }
    const capacityIdentity = [
      input.attemptId,
      input.deployment.id,
      pool.id,
      supplyAccountId,
      input.submission.actorId,
    ].join(':');
    const leaseId = input.lifecycleLease
      ? `capacity:${input.attemptId}`
      : `capacity:${capacityIdentity}`;
    const acquireInput: AcquirePostgresCapacityLeaseInput = {
      leaseId,
      supplyAccountId,
      productAccountId: input.submission.actorId,
      workspaceId: input.submission.workspaceId,
      limits: capacityLimits(pool, effective.concurrencyLimit, {
        supplyAccount: this.defaultSupplyAccountConcurrency,
        system: this.defaultSystemConcurrency,
      }),
      productAccountLimit: effective.concurrencyLimit,
      acquiredAt,
      expiresAt,
      now: now.toISOString(),
    };
    const admission = this.options.capacityLeases.tryAcquireFair
      ? await this.options.capacityLeases.tryAcquireFair({
          ...acquireInput,
          queueRequestId: `capacity-queue:${capacityIdentity}`,
          queuePriority: effective.queuePriority,
          maxWaitMs: this.capacityQueueWaitMs,
        })
      : await this.options.capacityLeases.tryAcquire(acquireInput);
    if (admission.status === 'rejected') {
      return reject(admission.code, admission.message);
    }
    return {
      status: 'admitted',
      leaseId: admission.lease.leaseId,
      supplyPoolId: pool.id,
      entitlementPolicyRevision: effective.planPolicyRevision,
      appliedAllocationIds: effective.appliedAllocationIds,
    };
  }

  async release(leaseId: string): Promise<void> {
    await this.options.capacityLeases.release(leaseId);
  }

  async renew(leaseId: string): Promise<boolean> {
    if (!this.options.capacityLeases.renew) return false;
    const renewedAt = new Date();
    return this.options.capacityLeases.renew(
      leaseId,
      new Date(renewedAt.getTime() + this.leaseTtlMs).toISOString(),
      renewedAt.toISOString()
    );
  }

  async reacquire(leaseId: string): Promise<boolean> {
    if (!this.options.capacityLeases.reacquireFair) return false;
    const reacquiredAt = new Date();
    const decision = await this.options.capacityLeases.reacquireFair(
      leaseId,
      new Date(reacquiredAt.getTime() + this.leaseTtlMs).toISOString(),
      reacquiredAt.toISOString(),
      this.capacityQueueWaitMs
    );
    return decision?.status === 'admitted';
  }
}
