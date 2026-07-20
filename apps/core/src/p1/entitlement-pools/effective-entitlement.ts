import { USAGE_RESOURCES, type UsageResource } from '../foundation/domain.js';
import {
  normalizeProductEntitlementPolicy,
  type ProductEntitlementPolicy,
  type QualityTierPreference,
} from '../foundation/entitlement-policy.js';
import type {
  AccountAllocation,
  EffectiveEntitlement,
  EffectiveEntitlementPreview,
  EntitlementLayer,
  PlatformHardLimits,
  RequestLevelPreferences,
} from './contracts.js';

const RESOURCES: UsageResource[] = [...USAGE_RESOURCES];

export const DEFAULT_PLATFORM_HARD_LIMITS: PlatformHardLimits = {
  maxConcurrency: 32,
  maxQueuePriority: 100,
  maxAllowance: {
    audio: 10_000,
    copy: 100_000,
    image: 50_000,
    video: 20_000,
  },
  deniedCatalogModelIds: [],
  deniedSupplyPoolIds: [],
  deniedQualityTiers: [],
};

export interface ComputeEffectiveEntitlementInput {
  planPolicy: ProductEntitlementPolicy;
  platformHardLimits?: PlatformHardLimits;
  /** Approved account-level overrides (source ≠ campaign). */
  accountOverrides?: AccountAllocation[];
  /** Temporary campaign / promo grants. */
  campaignGrants?: AccountAllocation[];
  requestPreferences?: RequestLevelPreferences;
  now?: Date;
}

/**
 * Five-layer priority (D-063):
 * platform hard limits > plan EntitlementPolicy > account approved overrides
 * > temporary campaign grants > request-level legal prefs.
 *
 * Hard limits cannot be overridden by grants. Restrict beats grant within a layer.
 */
export function computeEffectiveEntitlement(
  input: ComputeEffectiveEntitlementInput
): EffectiveEntitlement {
  const plan = normalizeProductEntitlementPolicy(input.planPolicy);
  const hard = input.platformHardLimits ?? DEFAULT_PLATFORM_HARD_LIMITS;
  const now = input.now ?? new Date();

  const accountOverrides = (input.accountOverrides ?? []).filter((item) =>
    isLive(item, now)
  );
  const campaignGrants = (input.campaignGrants ?? []).filter((item) =>
    isLive(item, now)
  );
  const prefs = input.requestPreferences ?? {};

  const allowance = Object.fromEntries(
    RESOURCES.map((resource) => [resource, plan.allowance[resource]])
  ) as Record<UsageResource, number>;
  let allowanceLayer: EntitlementLayer = 'plan_policy';

  let concurrencyLimit = plan.concurrencyLimit;
  let concurrencyLayer: EntitlementLayer = 'plan_policy';
  let queuePriority = plan.queuePriority;
  let queueLayer: EntitlementLayer = 'plan_policy';

  let catalogModels = new Set(plan.allowedCatalogModelIds);
  let catalogLayer: EntitlementLayer = 'plan_policy';
  let qualityTiers = new Set(plan.allowedQualityTiers);
  let qualityLayer: EntitlementLayer = 'plan_policy';
  let supplyPools = new Set(plan.availableSupplyPoolIds);
  let supplyLayer: EntitlementLayer = 'plan_policy';

  const appliedAllocationIds: string[] = [];

  // Layer order for additive grants (lower priority applied first so higher wins):
  // request prefs → campaign → account override → plan (already base) → hard clamp.
  // Restricts within a layer apply after grants of that layer.

  const applyNumeric = (
    allocations: AccountAllocation[],
    layer: EntitlementLayer
  ) => {
    // Grants first, then restricts so restrict always wins within the same layer.
    const ordered = [
      ...allocations.filter((item) => item.kind === 'grant'),
      ...allocations.filter((item) => item.kind === 'restrict'),
    ];
    for (const allocation of ordered) {
      appliedAllocationIds.push(allocation.id);
      const { target, delta, kind } = allocation;
      if (target.type === 'allowance') {
        allowance[target.resource] = applyNumber(
          allowance[target.resource],
          delta,
          kind
        );
        allowanceLayer = layer;
      } else if (target.type === 'concurrency') {
        concurrencyLimit = applyNumber(concurrencyLimit, delta, kind);
        concurrencyLayer = layer;
      } else if (target.type === 'queue_priority') {
        queuePriority = applyNumber(queuePriority, delta, kind);
        queueLayer = layer;
      } else if (target.type === 'catalog_model') {
        catalogModels = applySet(
          catalogModels,
          target.catalogModelId,
          delta,
          kind
        );
        catalogLayer = layer;
      } else if (target.type === 'quality_tier') {
        qualityTiers = applySet(qualityTiers, target.qualityTier, delta, kind);
        qualityLayer = layer;
      } else if (target.type === 'supply_pool') {
        supplyPools = applySet(supplyPools, target.supplyPoolId, delta, kind);
        supplyLayer = layer;
      }
    }
  };

  // Campaign temporary grants (layer 4) then account overrides (layer 3).
  // Account overrides must win over campaign, so apply campaign first.
  applyNumeric(campaignGrants, 'campaign_grant');
  applyNumeric(accountOverrides, 'account_override');

  // Request-level legal prefs (lowest additive layer) — only narrow or prefer
  // within already-allowed sets; never expand past plan/override/hard limits.
  if (prefs.preferredCatalogModelIds?.length) {
    const preferred = new Set(prefs.preferredCatalogModelIds);
    const narrowed = [...catalogModels].filter((id) => preferred.has(id));
    if (narrowed.length > 0) {
      catalogModels = new Set(narrowed);
      catalogLayer = 'request_preference';
    }
  }
  if (prefs.preferredQualityTier?.length) {
    const preferred = new Set(prefs.preferredQualityTier);
    const narrowed = [...qualityTiers].filter((tier) => preferred.has(tier));
    if (narrowed.length > 0) {
      qualityTiers = new Set(narrowed);
      qualityLayer = 'request_preference';
    }
  }
  if (prefs.preferredSupplyPoolIds?.length) {
    const preferred = new Set(prefs.preferredSupplyPoolIds);
    const narrowed = [...supplyPools].filter((id) => preferred.has(id));
    if (narrowed.length > 0) {
      supplyPools = new Set(narrowed);
      supplyLayer = 'request_preference';
    }
  }
  if (
    typeof prefs.preferredConcurrency === 'number' &&
    prefs.preferredConcurrency > 0 &&
    prefs.preferredConcurrency < concurrencyLimit
  ) {
    concurrencyLimit = prefs.preferredConcurrency;
    concurrencyLayer = 'request_preference';
  }
  if (
    typeof prefs.preferredQueuePriority === 'number' &&
    prefs.preferredQueuePriority >= 0 &&
    prefs.preferredQueuePriority < queuePriority
  ) {
    queuePriority = prefs.preferredQueuePriority;
    queueLayer = 'request_preference';
  }

  // Platform hard limits (highest layer) — clamp everything; grants cannot exceed.
  let hardApplied = false;
  for (const resource of RESOURCES) {
    if (allowance[resource] > hard.maxAllowance[resource]) {
      allowance[resource] = hard.maxAllowance[resource];
      allowanceLayer = 'platform_hard_limit';
      hardApplied = true;
    }
    if (allowance[resource] < 0) allowance[resource] = 0;
  }
  if (concurrencyLimit > hard.maxConcurrency) {
    concurrencyLimit = hard.maxConcurrency;
    concurrencyLayer = 'platform_hard_limit';
    hardApplied = true;
  }
  if (concurrencyLimit < 1) concurrencyLimit = 1;
  if (queuePriority > hard.maxQueuePriority) {
    queuePriority = hard.maxQueuePriority;
    queueLayer = 'platform_hard_limit';
    hardApplied = true;
  }
  if (queuePriority < 0) queuePriority = 0;

  for (const denied of hard.deniedCatalogModelIds) {
    if (catalogModels.delete(denied)) {
      catalogLayer = 'platform_hard_limit';
      hardApplied = true;
    }
  }
  for (const denied of hard.deniedQualityTiers) {
    if (qualityTiers.delete(denied)) {
      qualityLayer = 'platform_hard_limit';
      hardApplied = true;
    }
  }
  for (const denied of hard.deniedSupplyPoolIds) {
    if (supplyPools.delete(denied)) {
      supplyLayer = 'platform_hard_limit';
      hardApplied = true;
    }
  }
  void hardApplied;

  return {
    tier: plan.tier,
    planPolicyRevision: plan.revision,
    allowance,
    concurrencyLimit,
    queuePriority,
    supportLabel: plan.supportLabel,
    allowedCatalogModelIds: [...catalogModels].sort(),
    allowedQualityTiers: sortQualityTiers([...qualityTiers]),
    availableSupplyPoolIds: [...supplyPools].sort(),
    overage: structuredClone(plan.overage),
    validity: structuredClone(plan.validity),
    sources: {
      allowance: allowanceLayer,
      concurrencyLimit: concurrencyLayer,
      queuePriority: queueLayer,
      catalogModels: catalogLayer,
      qualityTiers: qualityLayer,
      supplyPools: supplyLayer,
    },
    appliedAllocationIds: [...new Set(appliedAllocationIds)],
  };
}

export function previewEffectiveEntitlementChange(input: {
  before: ComputeEffectiveEntitlementInput;
  after: ComputeEffectiveEntitlementInput;
}): EffectiveEntitlementPreview {
  const before = computeEffectiveEntitlement(input.before);
  const after = computeEffectiveEntitlement(input.after);
  const changed: EffectiveEntitlementPreview['changed'] = [];
  if (!deepEqual(before.allowance, after.allowance)) changed.push('allowance');
  if (before.concurrencyLimit !== after.concurrencyLimit) {
    changed.push('concurrencyLimit');
  }
  if (before.queuePriority !== after.queuePriority) {
    changed.push('queuePriority');
  }
  if (
    !deepEqual(before.allowedCatalogModelIds, after.allowedCatalogModelIds)
  ) {
    changed.push('allowedCatalogModelIds');
  }
  if (!deepEqual(before.allowedQualityTiers, after.allowedQualityTiers)) {
    changed.push('allowedQualityTiers');
  }
  if (
    !deepEqual(before.availableSupplyPoolIds, after.availableSupplyPoolIds)
  ) {
    changed.push('availableSupplyPoolIds');
  }
  if (!deepEqual(before.overage, after.overage)) changed.push('overage');
  return { before, after, changed };
}

function isLive(allocation: AccountAllocation, now: Date): boolean {
  if (allocation.status === 'rolled_back' || allocation.status === 'expired') {
    return false;
  }
  const nowMs = now.getTime();
  const startsAtMs = Date.parse(allocation.startsAt);
  if (!Number.isFinite(startsAtMs) || startsAtMs > nowMs) return false;
  if (allocation.endsAt === null) return true;
  const endsAtMs = Date.parse(allocation.endsAt);
  return Number.isFinite(endsAtMs) && endsAtMs > nowMs;
}

function applyNumber(
  current: number,
  delta: AccountAllocation['delta'],
  kind: AccountAllocation['kind']
): number {
  if (delta.mode === 'set') {
    return kind === 'restrict' ? 0 : current;
  }
  if (delta.mode === 'cap') {
    return Math.min(current, delta.amount);
  }
  // delta mode
  if (kind === 'restrict') {
    return Math.max(0, current + delta.amount);
  }
  return Math.max(0, current + delta.amount);
}

function applySet<T extends string>(
  current: Set<T>,
  value: T,
  delta: AccountAllocation['delta'],
  kind: AccountAllocation['kind']
): Set<T> {
  const next = new Set(current);
  if (kind === 'restrict' || (delta.mode === 'set' && delta.enabled === false)) {
    next.delete(value);
    return next;
  }
  if (kind === 'grant' || (delta.mode === 'set' && delta.enabled === true)) {
    next.add(value);
  }
  return next;
}

function sortQualityTiers(
  tiers: QualityTierPreference[]
): QualityTierPreference[] {
  const order: QualityTierPreference[] = ['auto', 'balanced', 'quality'];
  return order.filter((tier) => tiers.includes(tier));
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
