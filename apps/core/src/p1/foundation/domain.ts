import type { ProductRole } from '@meiye/contracts';

export interface P1Context {
  workspaceId: string;
  userId: string;
  correlationId: string;
  actor?: ProductRole | 'worker';
}

export class P1DomainError extends Error {
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'FORBIDDEN'
      | 'IDEMPOTENCY_CONFLICT'
      | 'INVALID_STATE'
      | 'COMMANDS_FROZEN'
      | 'P1_WRITE_DISABLED',
    message: string
  ) {
    super(message);
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
  | 'lead'
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

export interface RouteCandidate {
  catalogModelId: string;
  deploymentId: string;
  region: 'cn' | 'global';
  credentialMode: 'platform' | 'byok_strict';
  credentialVersion: string;
  providerModel?: string;
  endpointRevision?: string;
  executionChannelId?: string;
  lifecycleRevision?: string;
  policyRevision?: string;
  priceRevision?: string;
  unitPriceMicros?: number;
  currency?: string;
  unit?: string;
  fallbackRank?: number;
  activationStatus?: 'documented' | 'recorded' | 'live_verified';
}

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
  allowedCandidates: RouteCandidate[];
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
}

export type ProductPlanTier = 'starter' | 'growth' | 'pro';

export interface ProductPlanPolicy {
  revision: string;
  tier: ProductPlanTier;
  periodId: string;
  periodStartsAt: string;
  periodEndsAt: string;
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
