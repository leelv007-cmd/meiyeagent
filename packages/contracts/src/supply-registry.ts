/**
 * Supply registry type layer (D-058 / D-060 / D-064 / D-065 / D-066).
 * Runtime expand/migrate and persistence live in apps/core `p1/supply-registry/**` (WT-G).
 * ProductUsage / ProductQuote naming stay with #92 — this file uses SupplierPriceRevision.
 */

import { z } from 'zod';

import type { HealthOverlayState } from './capability-registry.js';

export type SupplyModality = 'llm' | 'image' | 'video' | 'audio';

export type SupplyOperation =
  | 'copy.generate'
  | 'copy.adapt'
  | 'text.respond'
  | 'image.generate'
  | 'image.edit'
  | 'video.generate'
  | 'audio.speech'
  | 'audio.sfx';

export type SupplyDataClass = 'public' | 'contains_face' | 'pii' | 'medical' | 'medical-health';

export type SupplyChannelKind = 'official_direct' | 'upstream_reseller';

export type CredentialAccountLifecycle = 'pending' | 'active' | 'retired';

/** Sub-state for async media drain (D-080 C4). */
export type CredentialDrainSubstate = 'draining' | 'none';

export type ActivationEvidenceStatus = 'documented' | 'recorded' | 'live_verified';

export const MODEL_CAPABILITY_VOCABULARY_VERSION = 'model-capability-v1';

export const modelCapabilityClaimBasisSchema = z.enum([
  'inferred',
  'explicit_override',
]);

const modelCapabilityClaimEvidenceSchema = z
  .object({
    basis: modelCapabilityClaimBasisSchema,
    evidenceRef: z.string().trim().min(1),
  })
  .strict();

export const modelProtocolCapabilityClaimSchema =
  modelCapabilityClaimEvidenceSchema
    .extend({
      value: z.boolean(),
    })
    .strict();

export const modelCapabilityMimeSchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/(?:[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*|\*)$/,
  );

export const modelModalityClaimSchema = modelCapabilityClaimEvidenceSchema
  .extend({
    mime: modelCapabilityMimeSchema,
    supported: z.boolean(),
  })
  .strict();

export const modelBusinessTagClaimSchema = modelCapabilityClaimEvidenceSchema
  .extend({
    tag: z.string().trim().min(1),
    supported: z.boolean(),
  })
  .strict();

export const modelModalityScopedCapabilityClaimSchema =
  modelCapabilityClaimEvidenceSchema
    .extend({
      modality: modelCapabilityMimeSchema,
      capability: z.string().trim().min(1),
      supported: z.boolean(),
      channelBound: z.boolean(),
    })
    .strict();

export const modelCapabilityProfileSchema = z
  .object({
    vocabularyVersion: z.literal(MODEL_CAPABILITY_VOCABULARY_VERSION),
    protocolCapabilities: z.record(
      z.string().trim().min(1),
      modelProtocolCapabilityClaimSchema,
    ),
    modalities: z.array(modelModalityClaimSchema),
    businessTags: z.array(modelBusinessTagClaimSchema),
    modalityCapabilities: z.array(
      modelModalityScopedCapabilityClaimSchema,
    ),
  })
  .strict();

const modelModalityScopedCapabilityRequirementSchema = z
  .object({
    modality: modelCapabilityMimeSchema,
    capability: z.string().trim().min(1),
  })
  .strict();

export const modelCapabilityRequirementAxisSchema = z
  .object({
    axisId: z.string().trim().min(1),
    vocabularyVersion: z.literal(MODEL_CAPABILITY_VOCABULARY_VERSION),
    requiredProtocolCapabilities: z.array(z.string().trim().min(1)),
    requiredModalities: z.array(modelCapabilityMimeSchema),
    requiredBusinessTags: z.array(z.string().trim().min(1)),
    requiredModalityCapabilities: z.array(
      modelModalityScopedCapabilityRequirementSchema,
    ),
    unknownPolicy: z.literal('conservative_always_available'),
  })
  .strict();

export type ModelCapabilityClaimBasis = z.infer<
  typeof modelCapabilityClaimBasisSchema
>;
export type ModelProtocolCapabilityClaim = z.infer<
  typeof modelProtocolCapabilityClaimSchema
>;
export type ModelModalityClaim = z.infer<typeof modelModalityClaimSchema>;
export type ModelBusinessTagClaim = z.infer<
  typeof modelBusinessTagClaimSchema
>;
export type ModelModalityScopedCapabilityClaim = z.infer<
  typeof modelModalityScopedCapabilityClaimSchema
>;
export type ModelCapabilityProfile = z.infer<
  typeof modelCapabilityProfileSchema
>;
export type ModelCapabilityRequirementAxis = z.infer<
  typeof modelCapabilityRequirementAxisSchema
>;

/** Layer 1: manufacturer model identity. */
export interface SupplyCatalogModel {
  id: string;
  modality: SupplyModality;
  operations: SupplyOperation[];
  displayName: string;
  manufacturer?: string;
  stableModelName?: string;
  version?: string;
  qualityRank?: number;
}

/** Layer 2: real contracted counterparty (New API/Sub2API = gatewayFingerprint only). */
export interface SupplyProviderProfile {
  id: string;
  displayName: string;
  counterparty: string;
  gatewayFingerprint?: 'new_api' | 'sub2api' | 'none' | string;
  regionScope?: string[];
  revisionId: string;
}

/** Layer 3: official direct / reseller / region / protocol / account ownership. */
export interface SupplyExecutionChannel {
  id: string;
  providerProfileId: string;
  kind: SupplyChannelKind;
  region: 'domestic' | 'overseas' | string;
  protocolFamily?: string;
  accountOwnership: 'platform' | 'workspace_byok' | 'provider_managed';
  /** Persisted control-plane lifecycle CAS revision, independent of catalog revisionId. */
  lifecycleRevision?: string;
  revisionId: string;
}

export interface SupplyContract {
  id: string;
  providerProfileId: string;
  termsRevisionId: string;
  dataProcessingSummary?: string;
  retentionTrainingSubprocessor?: string;
  effectiveFrom: string;
  effectiveTo?: string;
}

/** Layer 4: model × channel binding. */
export interface SupplyDeployment {
  id: string;
  catalogModelId: string;
  providerProfileId: string;
  executionChannelId: string;
  endpointRevision?: string;
  lifecycleStatus: 'active' | 'inactive' | 'retired' | 'draining';
  dataPolicyRevisionId?: string;
  priceRevisionId?: string;
  credentialAccountId?: string;
  /** Opaque stable upstream account fingerprint used to collapse credential aliases. */
  accountIdentity?: string;
  /** Opaque stable endpoint/fault-domain fingerprint used to collapse endpoint aliases. */
  endpointFingerprint?: string;
  activationEvidence?: {
    status: ActivationEvidenceStatus;
    verifiedAt?: string;
    evidenceRef?: string;
    configurationRevision?: string;
  };
  capabilityProfile?: ModelCapabilityProfile;
  revisionId: string;
}

/**
 * CredentialAccount metadata only — secret material never leaves SecretStorePort.
 * Lifecycle trunk: pending → active → retired; tested = activation gate; draining = sub-state.
 */
export interface CredentialAccountMetadata {
  id: string;
  label: string;
  providerProfileId: string;
  projectRegion?: string;
  type: string;
  scope: 'platform' | 'workspace_byok';
  secretReference: string;
  version: string;
  status: CredentialAccountLifecycle;
  drainSubstate?: CredentialDrainSubstate;
  source: 'registry' | 'env_fallback' | 'migration';
  verifiedAt?: string;
  expiresAt?: string;
  publicQuotaHint?: string;
  lastTestEvidenceRef?: string;
}

export interface SupplyPool {
  id: string;
  kind: 'shared' | 'dedicated';
  displayName: string;
  credentialAccountIds: string[];
  deploymentIds: string[];
  capacity?: SupplyCapacityLimits;
  revisionId: string;
}

/** First-class dedicated pool exception (D-080 C4). */
export interface DedicatedSupplyPool extends SupplyPool {
  kind: 'dedicated';
  contractRef?: string;
  authorizedWorkspaceIds?: string[];
  regionRestriction?: string[];
  dataClassRestriction?: SupplyDataClass[];
  exclusiveBilling?: boolean;
  reservedCapacity?: SupplyCapacityLimits;
}

/** Three-layer capacity model (D-066). */
export interface SupplyCapacityLimits {
  supplyAccount?: { rpm?: number; tpm?: number; concurrency?: number; balanceHeadroom?: number };
  productAccount?: { concurrency?: number; queuePriority?: number };
  systemTotal?: { concurrency?: number };
}

export interface RoutePolicyRevision {
  id: string;
  operation: SupplyOperation;
  qualityTier?: 'quality' | 'balanced' | 'auto';
  hardConstraints: string[];
  candidateDeploymentIds: string[];
  orderBands?: string[];
  maxAttempts: number;
  costBoundaryMicros?: number;
  fallbackAuthorized: boolean;
  publishedAt?: string;
  revisionId: string;
}

export interface DataPolicyRevision {
  id: string;
  sourceTrustLevel: string;
  processingRegion: string;
  retentionTrainingSubprocessor?: string;
  allowedDataClasses: SupplyDataClass[];
  dualApprovalRequiredFor?: SupplyDataClass[];
  revisionId: string;
}

/** Supply-side price evidence — never named QuotePolicy (product quote is #92). */
export interface SupplierPriceRevision {
  id: string;
  deploymentId: string;
  amountMicros: number;
  currency: 'CNY' | 'USD';
  unit: string;
  evidence: PricingEvidence;
  revisionId: string;
}

export type PricingEvidenceSource = 'invoice' | 'observed_usage' | 'gateway_estimate';

export interface PricingEvidence {
  source: PricingEvidenceSource;
  riskDiscountApplied?: boolean;
  trafficCapHint?: string;
  observedAt?: string;
  note?: string;
}

export interface HealthOverlayView {
  targetId: string;
  state: HealthOverlayState;
  reason: string;
  source: string;
  startedAt: string;
  endsAt?: string;
}

/**
 * One allowed candidate in a frozen route decision, ranked for fallback order.
 * Extra evidence fields are optional so legacy shapes round-trip without loss.
 */
export interface CanonicalRouteCandidate {
  catalogModelId: string;
  deploymentId: string;
  /** 1-based rank in the authorized candidate order (lower = preferred). */
  rank: number;
  exclusionReasons?: string[];
  region?: string;
  credentialMode?: 'platform' | 'byok_strict';
  credentialVersion?: string;
  providerProfileId?: string;
  executionChannelId?: string;
  accountIdentity?: string;
  endpointFingerprint?: string;
  providerModel?: string;
  endpointRevision?: string;
  dataPolicyRevisionId?: string;
  lifecycleRevision?: string;
  policyRevision?: string;
  priceRevision?: string;
  unitPriceMicros?: number;
  currency?: string;
  unit?: string;
  activationStatus?: ActivationEvidenceStatus;
  sourceKind?: SupplyChannelKind;
}

/**
 * Canonical RouteSnapshot field set (S2b: four shapes normalize onto this).
 *
 * Field set (D-058/D-059/D-064): model / counterparty / channel / deployment /
 * credential version / policy version / price version / endpoint version /
 * data policy revision / all allowed candidates+rank / actual Deployment /
 * runtime exclusion reasons / fallback chain / source kind.
 *
 * Product-local durable columns (workspaceId, selectionMode, dataClass, …)
 * live on the foundation checkpoint form and are restored via adapters.
 */
export interface CanonicalRouteSnapshot {
  id: string;
  /** Resolved / actual catalog model for the chosen deployment. */
  catalogModelId: string;
  requestedCatalogModelId?: string;
  providerProfileId?: string;
  executionChannelId?: string;
  deploymentId: string;
  credentialAccountVersion?: string;
  credentialMode?: 'platform' | 'byok_strict';
  policyRevisionId?: string;
  priceRevisionId?: string;
  endpointRevisionId?: string;
  dataPolicyRevisionId?: string;
  catalogRevisionId?: string;
  allowedCandidates: CanonicalRouteCandidate[];
  actualDeploymentId: string;
  runtimeExclusionReasons?: string[];
  /**
   * Authorized fallback chain as ordered deployment ids.
   * Strict BYOK: single entry, no alternate hops (fallbackConsent=false).
   */
  fallbackChain?: string[];
  fallbackConsent?: boolean;
  maxAttempts?: number;
  fallbackAuthorized?: boolean;
  sourceKind?: SupplyChannelKind;
  selectionMode?: 'fixed' | 'llm_auto' | 'auto';
  primaryDataClass?: string;
  dataClasses?: string[];
  workspaceId?: string;
  /** Strict BYOK public shape carries the controlled endpoint profile id. */
  endpointProfileId?: string;
  createdAt: string;
}
