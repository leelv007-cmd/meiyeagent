import type { UsageResource } from '../foundation/domain.js';
import type {
  OverageRule,
  ProductEntitlementPolicy,
  ProductEntitlementPolicyExtension,
  QualityTierPreference,
} from '../foundation/entitlement-policy.js';

/** Plan tier bound to a versioned EntitlementPolicy revision. */
export type EntitlementPlanTier = ProductEntitlementPolicy['tier'];

export type EntitlementPolicyStage =
  | 'draft'
  | 'published'
  | 'superseded'
  | 'rolled_back';

/**
 * Versioned plan EntitlementPolicy body (D-063).
 * Bound to a tier; publish applies batch-wide — never per-account copy.
 */
export interface EntitlementPolicyBody
  extends ProductEntitlementPolicyExtension
{
  tier: EntitlementPlanTier;
  allowance: Record<UsageResource, number>;
  concurrencyLimit: number;
  queuePriority: number;
  supportLabel: 'standard' | 'priority';
  /** Product-side rate label (not upstream RPM/TPM). */
  rateLabel: 'standard' | 'elevated';
}

export interface EntitlementPolicyRevision {
  id: string;
  tier: EntitlementPlanTier;
  body: EntitlementPolicyBody;
  revision: number;
  stage: EntitlementPolicyStage;
  actorId: string;
  reason: string;
  correlationId: string;
  createdAt: string;
  /** Prior published revision this rolled back to, when stage=rolled_back. */
  rolledBackToRevision: number | null;
}

export type AccountAllocationKind = 'grant' | 'restrict';

export type AccountAllocationSource =
  | 'campaign'
  | 'support_compensation'
  | 'enterprise_contract'
  | 'canary'
  | 'risk_control'
  | 'temporary_ban'
  | 'account_override';

export type AccountAllocationTarget =
  | { type: 'catalog_model'; catalogModelId: string }
  | { type: 'quality_tier'; qualityTier: QualityTierPreference }
  | { type: 'supply_pool'; supplyPoolId: string }
  | { type: 'allowance'; resource: UsageResource }
  | { type: 'concurrency' }
  | { type: 'queue_priority' };

export type AccountAllocationDelta =
  | { mode: 'delta'; amount: number }
  | { mode: 'cap'; amount: number }
  | { mode: 'set'; enabled: boolean };

export type AccountAllocationStatus = 'active' | 'expired' | 'rolled_back';

/**
 * Explicit account exception (D-063). Target workspace is selected only inside
 * the account-allocation drilldown — never as top-level IA.
 */
export interface AccountAllocation {
  id: string;
  /** Product account identity (login principal). */
  accountId: string;
  /** Target workspace chosen inside allocation drilldown. */
  workspaceId: string;
  kind: AccountAllocationKind;
  target: AccountAllocationTarget;
  delta: AccountAllocationDelta;
  source: AccountAllocationSource;
  reason: string;
  actorId: string;
  startsAt: string;
  endsAt: string | null;
  status: AccountAllocationStatus;
  rolledBackAt: string | null;
  correlationId: string;
  createdAt: string;
}

export type EntitlementLayer =
  | 'platform_hard_limit'
  | 'plan_policy'
  | 'account_override'
  | 'campaign_grant'
  | 'request_preference';

/** Platform safety / compliance ceilings that no grant may exceed. */
export interface PlatformHardLimits {
  maxConcurrency: number;
  maxQueuePriority: number;
  maxAllowance: Record<UsageResource, number>;
  /** CatalogModels permanently disallowed platform-wide. */
  deniedCatalogModelIds: string[];
  /** SupplyPools permanently disallowed platform-wide. */
  deniedSupplyPoolIds: string[];
  /** Quality tiers permanently disallowed platform-wide. */
  deniedQualityTiers: QualityTierPreference[];
}

export interface RequestLevelPreferences {
  preferredCatalogModelIds?: string[];
  preferredQualityTier?: QualityTierPreference[];
  preferredSupplyPoolIds?: string[];
  preferredConcurrency?: number;
  preferredQueuePriority?: number;
}

export interface EffectiveEntitlement {
  tier: EntitlementPlanTier;
  planPolicyRevision: string;
  allowance: Record<UsageResource, number>;
  concurrencyLimit: number;
  queuePriority: number;
  supportLabel: 'standard' | 'priority';
  allowedCatalogModelIds: string[];
  allowedQualityTiers: QualityTierPreference[];
  availableSupplyPoolIds: string[];
  overage: OverageRule;
  validity: ProductEntitlementPolicyExtension['validity'];
  /** Layer that won for each surface (audit / explainability). */
  sources: {
    allowance: EntitlementLayer;
    concurrencyLimit: EntitlementLayer;
    queuePriority: EntitlementLayer;
    catalogModels: EntitlementLayer;
    qualityTiers: EntitlementLayer;
    supplyPools: EntitlementLayer;
  };
  /** Active allocations that contributed (non-expired, non-rolled-back). */
  appliedAllocationIds: string[];
}

export interface EffectiveEntitlementPreview {
  before: EffectiveEntitlement;
  after: EffectiveEntitlement;
  changed: Array<
    | 'allowance'
    | 'concurrencyLimit'
    | 'queuePriority'
    | 'allowedCatalogModelIds'
    | 'allowedQualityTiers'
    | 'availableSupplyPoolIds'
    | 'overage'
  >;
}

/**
 * Dual-truth product-side projection (D-061).
 * Users receive only these product surfaces — never upstream tokens/accounts/balances.
 */
export interface ProductSideEntitlementProjection {
  entitlement: {
    tier: EntitlementPlanTier;
    revision: string;
    allowedCatalogModelIds: string[];
    allowedQualityTiers: QualityTierPreference[];
  };
  usageAllowance: {
    allowance: Record<UsageResource, number>;
    overage: OverageRule;
  };
  concurrencyPolicy: {
    concurrencyLimit: number;
    queuePriority: number;
  };
  routePolicy: {
    availableSupplyPoolIds: string[];
    /** Fixed model → strategy picks Deployment only; Auto may pick CatalogModel+Deployment. */
    selectionBoundary: 'fixed_deployment_only' | 'auto_catalog_and_deployment';
  };
}

/** Forbidden upstream resource keys that must never appear on product projections. */
export const UPSTREAM_RESOURCE_KEYS = [
  'upstreamToken',
  'upstreamAccountId',
  'upstreamAccount',
  'gatewayBalance',
  'providerToken',
  'providerApiKey',
  'credentialSecret',
  'rpmLimit',
  'tpmLimit',
  'providerBalance',
] as const;

export type UpstreamResourceKey = (typeof UPSTREAM_RESOURCE_KEYS)[number];
