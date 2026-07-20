/**
 * MP-04T / provider-conformance shared contracts (I1 contract-side).
 * Runtime wiring is deferred to G3+Z2-WIRING; G publish gates consume
 * {@link ActivationEvidenceInput} produced from conformance results.
 *
 * Channel / activation status types are local until S2a lands
 * `packages/contracts` supply-registry + `provider-lifecycle.ts` extract.
 * Port shape matches existing ProviderExecutionPort (S2a will re-export).
 */
import type { Acceptance } from '../index.js';

/** Official direct vs real third-party reseller (D-068 dual-channel). */
export type SupplyChannelKind = 'official_direct' | 'upstream_reseller';

/** Activation evidence status consumed by Deployment publish gates. */
export type ActivationEvidenceStatus =
  | 'documented'
  | 'recorded'
  | 'live_verified';

/** Route attempt ceiling ("两候选") — not live LLM three-copy candidates. */
export const TEXT_ROUTE_ATTEMPT_LIMIT = 2 as const;
export type TextRouteAttemptLimit = typeof TEXT_ROUTE_ATTEMPT_LIMIT;

/**
 * Mapping confidence for providerModel → CatalogModelId (D-058 / cutover).
 * exact: declared stable name or explicit alias match
 * compatible: protocol-compatible alias with declared mapping revision
 * inferred: heuristic only
 * unknown: no trustworthy mapping evidence
 */
export type MappingConfidenceGrade =
  | 'exact'
  | 'compatible'
  | 'inferred'
  | 'unknown';

/**
 * New API / Sub2API are gateway fingerprints only — never ProviderProfile identity.
 * official_native / none apply to official direct channels.
 */
export type GatewayFingerprintProduct =
  | 'none'
  | 'official_native'
  | 'new_api'
  | 'sub2api'
  | 'other'
  | 'unknown';

export interface GatewayFingerprintMetadata {
  product: GatewayFingerprintProduct;
  version?: string;
  evidence?: string;
  observedAt?: string;
}

export type TextConformanceCheckId =
  | 'protocol_completion'
  | 'error_normalization'
  | 'usage_evidence'
  | 'gateway_fingerprint'
  | 'acceptance_semantics'
  | 'mapping_confidence';

export type TextConformanceOperation =
  | 'copy.generate'
  | 'copy.adapt'
  | 'text.respond';

export interface NormalizedProviderError {
  acceptance: Acceptance;
  errorCode: string;
  retryable: boolean;
  message: string;
  /** HTTP / transport status when known. */
  statusCode?: number;
}

export interface UsageEvidence {
  inputTokens?: number;
  outputTokens?: number;
  amount: number;
  currency: 'CNY' | 'USD';
  source: 'observed_usage' | 'gateway_estimate' | 'missing';
}

export interface ProtocolEvidence {
  family: string;
  completed: boolean;
  providerTaskRef?: string;
  hasCopyCandidates?: boolean;
  hasText?: boolean;
  hasPlatformVariants?: boolean;
}

export interface TextConformanceCheckResult {
  checkId: TextConformanceCheckId;
  passed: boolean;
  detail: string;
  evidence?: Record<string, unknown>;
}

/**
 * Per-channel conformance result. One Deployment / one ExecutionChannel.
 */
export interface TextChannelConformanceResult {
  id: string;
  modality: 'llm';
  operation: TextConformanceOperation;
  channelKind: SupplyChannelKind;
  catalogModelId: string;
  deploymentId: string;
  providerProfileId: string;
  executionChannelId: string;
  providerModel: string;
  endpointRevision: string;
  configurationRevision: string;
  gatewayFingerprint: GatewayFingerprintMetadata;
  mappingConfidence: MappingConfidenceGrade;
  checks: TextConformanceCheckResult[];
  passed: boolean;
  protocol?: ProtocolEvidence;
  usage?: UsageEvidence;
  normalizedError?: NormalizedProviderError;
  /** Attempts spent on this channel during the run (≤ TEXT_ROUTE_ATTEMPT_LIMIT overall). */
  attemptCount: number;
  observedAt: string;
  evidenceKind: 'recorded' | 'live_provider';
}

/**
 * Dual-channel matrix result for a text operation.
 * Requires at least one official_direct + one upstream_reseller when claiming dual-channel ready.
 */
export interface TextDualChannelConformanceResult {
  id: string;
  operation: TextConformanceOperation;
  /** Always 2 — max provider route attempts (两候选). */
  attemptLimit: TextRouteAttemptLimit;
  channels: TextChannelConformanceResult[];
  dualChannelReady: boolean;
  observedAt: string;
  /**
   * Activation-evidence input shape for Deployment publish gates (G consumes later).
   * Not persisted here; contract-side only.
   */
  activationEvidenceInputs: ActivationEvidenceInput[];
}

/**
 * Input shape G publish gates consume when promoting a Deployment.
 * Distinct from catalog ActivationEvidence storage — this is the conformance → gate seam.
 */
export interface ActivationEvidenceInput {
  deploymentId: string;
  catalogModelId: string;
  channelKind: SupplyChannelKind;
  status: ActivationEvidenceStatus;
  verifiedAt: string;
  evidenceRef: string;
  configurationRevision: string;
  mappingConfidence: MappingConfidenceGrade;
  gatewayFingerprint: GatewayFingerprintMetadata;
  conformance: {
    resultId: string;
    channelResultId: string;
    operation: TextConformanceOperation;
    passed: boolean;
    checkIds: TextConformanceCheckId[];
    failedCheckIds: TextConformanceCheckId[];
    evidenceKind: 'recorded' | 'live_provider';
  };
}
