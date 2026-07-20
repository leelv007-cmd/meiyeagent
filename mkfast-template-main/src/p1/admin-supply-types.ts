/**
 * Shared input types for the model-supply control center (J4 / D-070).
 * Pure presentation contracts — live Core fetch lands in Z2-WIRING.
 */
import type {
  CredentialAccountMetadata,
  HealthOverlayView,
  RoutePolicyRevision,
  SupplyCatalogModel,
  SupplyContract,
  SupplyDataClass,
  SupplyDeployment,
  SupplyExecutionChannel,
  SupplyOperation,
  SupplyPool,
  SupplyProviderProfile,
  SupplierPriceRevision,
} from '@meiye/contracts';

/** Core tri-modal operations for readiness / dual-channel gates (D-069). */
export const CORE_SUPPLY_OPERATIONS = [
  'copy.generate',
  'image.generate',
  'video.generate',
] as const satisfies readonly SupplyOperation[];

export type CoreSupplyOperation = (typeof CORE_SUPPLY_OPERATIONS)[number];

export type OperationReadinessStatus =
  | 'multi_channel_ready'
  | 'single_channel'
  | 'degraded'
  | 'blocked'
  | 'not_verified';

export type DualChannelCoverageStatus =
  | 'multi_channel_ready'
  | 'single_channel'
  | 'no_fallback'
  | 'not_verified'
  | 'blocked';

export type FaultDomainKind =
  | 'independent_counterparty'
  | 'independent_channel'
  | 'shared_manufacturer_only';

/** One durable run row for the high-density operation table. */
export interface SupplyRunRecord {
  id: string;
  taskId: string;
  operation: SupplyOperation;
  modality: 'llm' | 'image' | 'video' | 'audio';
  status:
    | 'queued'
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'draining'
    | 'accepted'
    | 'acceptance_unknown'
    | 'rejected_before_accept';
  catalogModelId: string;
  deploymentId: string;
  providerProfileId: string;
  executionChannelId: string;
  channelKind: 'official_direct' | 'upstream_reseller';
  workspaceId: string;
  accountId: string;
  dataClass: SupplyDataClass;
  startedAt: string;
  endedAt?: string;
  latencyMs?: number;
  queueMs?: number;
  providerMs?: number;
  postprocessMs?: number;
  costMicros?: number;
  currency?: 'CNY' | 'USD';
  errorCode?: string;
  errorMessage?: string;
  artifactPreviewUrl?: string;
  attemptCount: number;
  lifecycle:
    | 'sync_attempt'
    | 'async_submit'
    | 'async_poll'
    | 'async_recover'
    | 'terminal';
  routePolicyRevisionId?: string;
  poolId?: string;
}

export interface SupplyAuditChange {
  id: string;
  at: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
  correlationId: string;
}

export interface SupplyGatewayDeepLink {
  id: string;
  label: string;
  /** External console URL — evidence only, never a second source of truth. */
  href: string;
  gatewayFingerprint: string;
  evidenceOnly: true;
}

/** Snapshot consumed by overview / run table / association views. */
export interface SupplyControlSnapshot {
  catalogRevisionId: string;
  catalogRevisionNumber: number;
  capturedAt: string;
  models: SupplyCatalogModel[];
  providerProfiles: SupplyProviderProfile[];
  executionChannels: SupplyExecutionChannel[];
  deployments: SupplyDeployment[];
  contracts: SupplyContract[];
  credentials: CredentialAccountMetadata[];
  pools: SupplyPool[];
  routePolicies: RoutePolicyRevision[];
  priceRevisions: SupplierPriceRevision[];
  healthOverlays: HealthOverlayView[];
  runs: SupplyRunRecord[];
  recentChanges: SupplyAuditChange[];
  gatewayDeepLinks: SupplyGatewayDeepLink[];
  /** Featured core CatalogModel ids for dual-channel gate display. */
  featuredCoreModelIds: Partial<Record<CoreSupplyOperation, string>>;
}
