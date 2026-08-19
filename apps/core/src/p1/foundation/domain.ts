import type {
  ProductBillingMode,
  ProductRole,
  ProductSettlementStatus,
  ProviderCostSnapshot,
} from '@meiye/contracts';

/** Re-export canonical supply-route evidence shape (S2b). */
export type {
  CanonicalRouteCandidate,
  CanonicalRouteSnapshot,
} from '@meiye/contracts';

export interface P1Context {
  workspaceId: string;
  userId: string;
  correlationId: string;
  /** payment = trusted webhook/internal service actor for plan grants (Tc-2). */
  actor?: ProductRole | 'worker' | 'payment';
}

export class P1DomainError extends Error {
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'FORBIDDEN'
      | 'INSUFFICIENT_ENTITLEMENT'
      | 'IDEMPOTENCY_CONFLICT'
      | 'INVALID_STATE'
      | 'COMMANDS_FROZEN'
      | 'P1_WRITE_DISABLED'
      | 'WRITE_OWNERSHIP_MISSING',
    message: string
  ) {
    super(message);
  }
}

export class PrewriteDeterministicRejectionError extends P1DomainError {
  constructor(message: string) {
    super('INVALID_STATE', message);
    this.name = 'PrewriteDeterministicRejectionError';
  }
}

export type RelationFactKind =
  | 'store'
  | 'project'
  | 'asset_rights'
  | 'content'
  | 'content_version'
  | 'platform_variant'
  | 'storyboard'
  | 'video_job'
  | 'video_render_evidence'
  | 'owned_asset'
  | 'publish_package'
  | 'publish_record'
  | 'usage_event'
  | 'audit';

export interface RelationFact {
  id: string;
  workspaceId: string;
  kind: RelationFactKind;
  parentId?: string;
  data: Record<string, unknown>;
  legacySource?: string;
  mappingConfidence?: 'exact' | 'inferred' | 'unknown';
  actorId: string;
  correlationId: string;
  createdAt: string;
}

export interface RecordRelationFactInput {
  id: string;
  kind: RelationFactKind;
  parentId?: string;
  data: Record<string, unknown>;
  legacySource?: string;
  mappingConfidence?: 'exact' | 'inferred' | 'unknown';
}

export const USAGE_RESOURCES = ['copy', 'image', 'video', 'audio'] as const;
export type UsageResource = (typeof USAGE_RESOURCES)[number];
export type UsageAction = 'reserve' | 'commit' | 'refund' | 'expire' | 'adjust' | 'compensate';

export interface UsageEvent {
  id: string;
  workspaceId: string;
  resource: UsageResource;
  action: UsageAction;
  amount: number;
  reservationId?: string;
  reason: string;
  actorId: string;
  correlationId: string;
  createdAt: string;
  /** ProductUsage facts attached to the canonical usage event chain (#92). */
  billing?: {
    quoteId: string;
    taskId: string;
    billingMode: ProductBillingMode;
    settlementStatus: ProductSettlementStatus;
    settledQuantity?: number;
    refundedQuantity?: number;
    evidenceRef?: string;
  };
}

export type AppendUsageEventInput = Omit<
  UsageEvent,
  'workspaceId' | 'actorId' | 'correlationId' | 'createdAt'
>;

export interface UsageProjection {
  allowance: number;
  reserved: number;
  committed: number;
  released: number;
  available: number;
}

export type GenerationOperation = UsageResource;
export type GenerationDataClass = 'public' | 'contains_face' | 'pii' | 'medical';

/**
 * Durable checkpoint candidate (persisted on p1_route_snapshots.allowed_candidates).
 * Canonical supply evidence lives on CanonicalRouteSnapshot; use
 * `fromFoundationRouteSnapshot` / `toFoundationRouteCheckpoint` to convert.
 */
export interface RouteCandidate {
  catalogModelId: string;
  deploymentId: string;
  region: 'cn' | 'global';
  credentialMode: 'platform' | 'byok_strict';
  credentialVersion: string;
  providerModel?: string;
  endpointRevision?: string;
  executionChannelId?: string;
  accountIdentity?: string;
  endpointFingerprint?: string;
  dataPolicyRevisionId?: string;
  lifecycleRevision?: string;
  policyRevision?: string;
  priceRevision?: string;
  unitPriceMicros?: number;
  currency?: string;
  unit?: string;
  fallbackRank?: number;
  activationStatus?: 'documented' | 'recorded' | 'live_verified';
}

/**
 * Foundation durable RouteSnapshot (checkpoint form).
 * S2b: supply evidence normalizes via CanonicalRouteSnapshot adapters;
 * this shape remains the persistence contract (workspace + selection + data class).
 */
export interface RouteSnapshot {
  id: string;
  workspaceId: string;
  catalogRevision: string;
  policyRevision: string;
  priceRevision: string;
  requestedCatalogModelId: string;
  selectionMode: 'fixed' | 'llm_auto';
  dataClass: GenerationDataClass;
  dataClasses?: GenerationDataClass[];
  fallbackConsent: boolean;
  maxAttempts?: number;
  fallbackAuthorized?: boolean;
  allowedCandidates: RouteCandidate[];
  /** Top-level data policy revision (F-S2-03 round-trip with CanonicalRouteSnapshot). */
  dataPolicyRevisionId?: string;
  /** Top-level supply channel kind (F-S2-03 round-trip with CanonicalRouteSnapshot). */
  sourceKind?:
    | 'official_direct'
    | 'upstream_reseller'
    | 'workspace_byok'
    | 'third_party_proxy';
  retryOwner?: 'product';
  providerRetryDisabled?: true;
  createdAt: string;
}

export interface GenerationJob {
  id: string;
  workspaceId: string;
  operation: GenerationOperation;
  routeSnapshotId: string;
  usageReservationId: string;
  status: 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancel_requested' | 'cancelled' | 'unknown';
  createdBy: string;
  correlationId: string;
  result?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderAttempt {
  id: string;
  workspaceId: string;
  jobId: string;
  ordinal: number;
  deploymentId: string;
  acceptance: 'pending' | 'rejected_before_accept' | 'accepted' | 'acceptance_unknown';
  providerTaskRef?: string;
  status: 'pending' | 'submitted' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
}

export interface ProviderCostEvent {
  id: string;
  workspaceId: string;
  attemptId: string;
  stage: 'estimated' | 'observed' | 'reconciled' | 'adjusted';
  amountMicros: number | null;
  currency: string;
  unit: string;
  evidence: string;
  payer: 'platform' | 'workspace_byok';
  billingStatus?: 'known' | 'externally_billed' | 'unknown';
  actorId: string;
  correlationId: string;
  createdAt: string;
  /** Frozen attempt cost facts; the event remains the canonical append-only chain. */
  snapshot?: ProviderCostSnapshot;
}

export type ProductPlanTier = 'trial' | 'starter' | 'growth' | 'pro';

/**
 * Period strategy:
 * - fixed_days: trial gift window
 * - calendar_month: dev/recorded checkout without provider period
 * - provider_period: paid grants using provider billing period (Tc-2)
 */
export type ProductPlanPeriodStrategy =
  | 'fixed_days'
  | 'calendar_month'
  | 'provider_period';

/** Stable once-per-tenant gift grant key (workspace-scoped uniqueness). */
export const REGISTER_GIFT_GRANT_KEY = 'REGISTER_GIFT' as const;
export type EntitlementGrantKey = typeof REGISTER_GIFT_GRANT_KEY | (string & {});

export interface ProductPlanPolicy {
  revision: string;
  tier: ProductPlanTier;
  periodId: string;
  periodStartsAt: string;
  periodEndsAt: string;
  /** Present on activated policies so projection can restate strategy without catalog. */
  periodStrategy?: ProductPlanPeriodStrategy;
  allowance: Record<UsageResource, number>;
  concurrencyLimit: number;
  queuePriority: number;
  supportLabel: 'standard' | 'priority';
}

export interface AutoTopUpPackage {
  quantity: number;
  amountMicros: number;
  currency: string;
}

export interface AutoTopUpConfiguration {
  enabled: boolean;
  monthlyCapMicros: number;
  packages: Partial<Record<UsageResource, AutoTopUpPackage>>;
}

interface ProductEntitlementEventBase {
  id: string;
  workspaceId: string;
  actorId: string;
  correlationId: string;
  createdAt: string;
}

export type ProductEntitlementEvent =
  | (ProductEntitlementEventBase & {
      kind: 'plan_activated';
      paymentEventId: string;
      policy: ProductPlanPolicy;
      /** Optional grant source; REGISTER_GIFT is unique per workspace. */
      grantKey?: EntitlementGrantKey;
    })
  | (ProductEntitlementEventBase & {
      kind: 'plan_expired';
      planEventId: string;
      policy: ProductPlanPolicy;
      reason: 'period_ended';
    })
  | (ProductEntitlementEventBase & {
      kind: 'add_on_purchased';
      paymentEventId: string;
      purchaseId: string;
      resource: UsageResource;
      quantity: number;
      amountMicros: number;
      currency: string;
    })
  | (ProductEntitlementEventBase & {
      kind: 'auto_top_up_configured';
      configuration: AutoTopUpConfiguration;
    })
  | (ProductEntitlementEventBase & {
      kind: 'auto_top_up_pending';
      paymentIntentId: string;
      purchaseId: string;
      resource: UsageResource;
      quantity: number;
      amountMicros: number;
      currency: string;
      month: string;
    })
  | (ProductEntitlementEventBase & {
      kind: 'auto_top_up_purchased';
      paymentEventId: string;
      purchaseId: string;
      resource: UsageResource;
      quantity: number;
      amountMicros: number;
      currency: string;
      month: string;
    });

export interface ProductEntitlementProjection {
  workspaceId: string;
  monthlyOutput?: {
    month: string;
    copy: number;
    image: number;
    video: number;
  };
  plan: ProductPlanPolicy | null;
  concurrencyLimit: number;
  queuePriority: number;
  supportLabel: 'standard' | 'priority';
  usage: Record<UsageResource, UsageProjection>;
  addOns: Record<UsageResource, number>;
  addOnPurchases: Array<{
    purchaseId: string;
    paymentEventId: string;
    resource: UsageResource;
    quantity: number;
    amountMicros: number;
    currency: string;
  }>;
  autoTopUp: AutoTopUpConfiguration & {
    month: string;
    spentThisMonthMicros: number;
  };
}

export interface OwnedAsset {
  id: string;
  workspaceId: string;
  jobId: string;
  attemptId: string;
  objectKey: string;
  sha256: string;
  sizeBytes: number;
  mediaType: string;
  storageRevision?: string;
  createdAt: string;
}

export interface CutoverRecord {
  id: string;
  workspaceId: string;
  sourceRevision: string;
  targetRevision: string;
  backupRef: string;
  dryRunDifferenceCount: number;
  inFlightDecision: 'legacy_drain' | 'new_owner_recovery' | 'manual';
  status: 'active' | 'rolled_back';
  futureWriteOwner: 'legacy' | 'p1';
  rollbackReason?: string;
  actorId: string;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommandAuditEvent {
  workspaceId: string;
  idempotencyKey: string;
  payloadHash: string;
  actorId: string;
  correlationId: string;
  createdAt: string;
}
