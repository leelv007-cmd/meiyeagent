/**
 * S2a behavior-preserving extract: route / simulation contracts.
 */
import type {
	Acceptance,
	AdvancedCanvasGenerationOrigin,
	AdvancedCanvasGenerationOriginRef,
  CatalogModel,
  CanvasGenerationInputAsset,
  CanvasGenerationInputNodeBinding,
  DataClass,
  DeploymentStatus,
  ModelDeployment,
  ModelModality,
  ModelOperation,
} from './supply-contracts.js';
import type { RouteDecisionExplanation } from '../supply-registry/route-explanation.js';

export interface RequestedSelection {
  mode: 'fixed' | 'auto';
  catalogModelId?: string;
  profile?: 'quality' | 'balanced';
  fallbackConsent?: boolean;
}

export interface ModelSupplySubmission {
  workspaceId: string;
  actorId: string;
  correlationId?: string;
  idempotencyKey: string;
  /** Canonical ProductUsage task owned by the outer Operations lifecycle. */
  billingTaskId?: string;
  /** Accepted ProductQuote revision checked before provider dispatch. */
  billingQuoteRevision?: string;
  operation: ModelOperation;
  selection: RequestedSelection;
  dataClass: DataClass[];
  /**
   * Server-derived dispatch predicate for reference assets whose classification
   * has no current server fact. It narrows routing without inventing a class.
   */
  referenceAssetRegionBoundary?: 'domestic';
	prompt: string;
	origin?: AdvancedCanvasGenerationOrigin;
	originRef?: AdvancedCanvasGenerationOriginRef;
	lineage?: {
    inputNodeBindings: CanvasGenerationInputNodeBinding[];
  };
  /** Product entitlement units billed for this provider execution. Defaults to 1. */
  productUsageQuantity?: 0 | 1;
  /** Explicit bounded quality-probe breadth; ordinary copy generation omits this and defaults to one. */
  copyCandidateCount?: 1 | 3;
  promptRevision?: string;
  exampleSetRevision?: string;
  input?: {
    width?: number;
    height?: number;
    durationSeconds?: number;
    referenceAssetIds?: string[];
    inputAssets?: CanvasGenerationInputAsset[];
    ratio?: string;
    resolution?: string;
    generateAudio?: boolean;
    watermark?: boolean;
    maxOutputTokens?: number;
    temperature?: number;
    strength?: number;
    format?: string;
    language?: string;
    maxDurationSeconds?: number;
    speed?: number;
    tone?: string;
    voice?: string;
  };
  frozenRouteSnapshot?: RouteSnapshot;
}

export type RouteSimulationFailureScenario =
  | 'success'
  | 'rejected_before_accept'
  | 'accepted_failure'
  | 'acceptance_unknown';

export type RouteCandidateExclusionReason =
  | 'catalog_model_missing'
  | 'deployment_inactive'
  | 'operation_unsupported'
  | 'fixed_model_mismatch'
  | 'custom_requires_fixed_selection'
  | 'data_class_disallowed'
  | 'simulated_unavailable'
  /** G4 RoutePolicy cost boundary (only when a published policy sets one). */
  | 'cost_boundary_exceeded'
  /** G5 DataPolicyRevision hard-filter codes. */
  | 'data_policy_region_mismatch'
  | 'dual_approval_missing'
  | 'data_policy_missing_for_restricted_class'
  | 'content_safety_no_vendor_switch'
  | 'no_compliant_candidate'
  /** G5 three-layer ranking / guardrail codes (string may also be namespaced). */
  | 'circuit_open'
  | 'rate_limited'
  | 'balance_quota_exhausted'
  | 'concurrency_exhausted'
  | 'capacity_headroom_exhausted'
  | 'recorded_placeholder_ignored_for_sort'
  | 'risk_discount_applied'
  /** F-G-04: ranking inputs omitted — do not synthesize perfect scores. */
  | 'missing_ranking_evidence'
  | `critical_evidence_missing:${string}`
  | `critical_evidence_stale:${string}`
  | `below_sample_threshold:${string}`
  | `health_overlay_${string}`;

export interface RouteCandidateCostEstimate {
  amountMicros: number;
  currency: 'CNY' | 'USD';
  source: 'catalog' | 'recorded_estimate';
  unit: string;
}

export interface RouteCandidateEvaluation {
  catalogModelId: string;
  deploymentId: string;
  eligible: boolean;
  exclusionReasons: RouteCandidateExclusionReason[];
  qualityRank: number | null;
  region: ModelDeployment['region'];
  channel: ModelDeployment['channel'];
  costEstimate: RouteCandidateCostEstimate;
}

export interface ModelSupplyRouteSimulationInput {
  workspaceId: string;
  operation: ModelOperation;
  selection: RequestedSelection;
  dataClass: DataClass[];
  failureScenario: RouteSimulationFailureScenario;
  unavailableDeploymentIds?: string[];
  /** Validate this immutable candidate revision instead of the published head. */
  routePolicyRevisionId?: string;
}

export interface ModelSupplyRouteSimulation {
  catalogRevisionId: string;
  operation: ModelOperation;
  selection: RequestedSelection;
  dataClass: DataClass[];
  failureScenario: RouteSimulationFailureScenario;
  candidateEvaluations: RouteCandidateEvaluation[];
  rankedCandidates: Array<RouteCandidateEvaluation & { rank: number }>;
  expectedOutcome: {
    action:
      | 'complete'
      | 'fallback'
      | 'stop'
      | 'recover_without_resubmit'
      | 'awaiting_selection';
    attemptLimit: 2;
    expectedAttempts: 0 | 1 | 2;
    primaryDeploymentId?: string;
    fallbackDeploymentId?: string;
    reason:
      | 'no_eligible_candidate'
      | 'provider_completed'
      | 'safe_auto_fallback'
      | 'fallback_not_authorized'
      | 'no_safe_fallback_candidate'
      | 'provider_already_accepted'
      | 'provider_acceptance_unknown';
  };
  estimatedMaximumCost: RouteCandidateCostEstimate | null;
}

/**
 * Model-supply rich RouteSnapshot (planning / frozen execution facts).
 * S2b: normalize via `fromModelSupplyRouteSnapshot` onto CanonicalRouteSnapshot.
 */
export interface RouteSnapshot {
  id: string;
  catalogRevisionId: string;
  capabilityRevisionId?: string;
  routePolicyRevisionId?: string;
  dataPolicyRevisionId?: string;
  runtimeExclusionReasons?: string[];
  decisionExplanation?: RouteDecisionExplanation;
  requestedSelection: RequestedSelection;
  candidateCatalogModelIds: string[];
  actualCatalogModelId: string;
  deploymentId: string;
  policyRevision?: string;
  priceRevision?: string;
  credentialMode?: 'platform' | 'byok_strict';
  credentialVersion?: string;
  credentialAccountId?: string;
  supplyPoolId?: string;
  entitlementPolicyRevision?: string;
  appliedAllocationIds?: string[];
  providerProfileId?: string;
  executionChannelId?: string;
  providerModel?: string;
  endpointRevision?: string;
  apiCounterparty?: string;
  credentialOwner?: ModelDeployment['credentialOwner'];
  deploymentLifecycleRevision?: string;
  fallbackConsent?: boolean;
  maxAttempts?: number;
  fallbackAuthorized?: boolean;
  allowedCandidates?: Array<{
    catalogModelId: string;
    deploymentId: string;
    modelModality: ModelModality;
    modelOperations: ModelOperation[];
    modelDisplayName: string;
    modelQualityRank: number;
    modelManufacturer: string | null;
    modelCapabilities: ModelOperation[] | null;
    providerProfileId?: string | null;
    executionChannelId?: string | null;
    providerModel?: string | null;
    endpointRevision?: string | null;
    apiCounterparty?: string | null;
    credentialOwner?: ModelDeployment['credentialOwner'] | null;
    accountIdentity?: string | null;
    endpointFingerprint?: string | null;
    deploymentLifecycleRevision?: string | null;
    dataPolicyRevisionId?: string | null;
    apiFamily: ModelDeployment['apiFamily'];
    channel: ModelDeployment['channel'];
    region: ModelDeployment['region'];
    deploymentStatus: DeploymentStatus;
    allowedDataClasses: Array<'public' | DataClass> | null;
    stableModelName: string | null;
    modelVersion: string | null;
    credentialMode: 'platform' | 'byok_strict';
    credentialVersion: string;
    policyRevision: string;
    priceRevision: string;
    unitPriceMicros: number;
    pricingStatus?: 'unknown';
    currency: 'CNY' | 'USD';
    unit: string;
    fallbackRank: number;
    activationStatus?: NonNullable<
      ModelDeployment['activationEvidence']
    >['status'];
  }>;
  reason:
    | 'fixed_selection'
    | 'auto_quality_after_hard_filters'
    | 'auto_fallback_before_accept';
  dataClass: DataClass[];
  promptRevision?: string;
  exampleSetRevision?: string;
  createdAt: string;
}

export interface ProviderAttempt {
  id: string;
  jobId: string;
  catalogModelId: string;
  deploymentId: string;
  acceptance: Acceptance;
  providerTaskRef?: string;
  status: 'completed' | 'unknown' | 'failed';
  createdAt: string;
}
