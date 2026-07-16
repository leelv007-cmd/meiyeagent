import { createHash, randomUUID } from 'node:crypto';
import type {
  GeneratedCopyCandidateContent,
  GeneratedPlatformVariants,
} from '@meiye/contracts';
import type { AiStreamingRunner } from './ai-sdk-runner.js';
import type {
  ReferenceAssetResolverPort,
  ResolvedReferenceAsset,
} from './reference-asset-resolver.js';

export const MODEL_MODALITIES = ['llm', 'image', 'video', 'audio'] as const;
export type ModelModality = (typeof MODEL_MODALITIES)[number];
export const MODEL_OPERATIONS = [
  'copy.generate',
  'copy.adapt',
  'text.respond',
  'image.generate',
  'image.edit',
  'video.generate',
  'audio.speech',
  'audio.sfx',
] as const;
export type ModelOperation = (typeof MODEL_OPERATIONS)[number];
export type DataClass = 'contains_face' | 'pii' | 'medical';
export const CANVAS_GENERATION_PARAMETER_NAMES = [
  'width',
  'height',
  'durationSeconds',
  'ratio',
  'resolution',
  'generateAudio',
  'watermark',
  'maxOutputTokens',
  'temperature',
  'strength',
  'format',
  'language',
  'maxDurationSeconds',
  'speed',
  'tone',
  'voice',
] as const;
export type CanvasGenerationParameterName =
  (typeof CANVAS_GENERATION_PARAMETER_NAMES)[number];
export const CANVAS_GENERATION_INPUT_ASSET_ROLES = [
  'reference_image',
  'reference_video',
  'reference_audio',
  'mask',
] as const;
export type CanvasGenerationInputAssetRole =
  (typeof CANVAS_GENERATION_INPUT_ASSET_ROLES)[number];
export interface CanvasGenerationInputAsset {
  assetId: string;
  role: CanvasGenerationInputAssetRole;
}
export type AdvancedCanvasGenerationOrigin = import('@meiye/contracts').AdvancedCanvasEditingContext & {
  /** Present only on historical Canvas-local dispatches. */
  localJobId?: string;
};
export interface CanvasGenerationCapability {
  operation: ModelOperation;
  parameters: CanvasGenerationParameterName[];
  inputAssetRoles: CanvasGenerationInputAssetRole[];
}
export type DeploymentStatus = 'active' | 'inactive' | 'retired';
export type Acceptance =
  | 'rejected_before_accept'
  | 'accepted'
  | 'acceptance_unknown';

export const QUALITY_NORTH_STAR_MIN_SAMPLE_SIZE = 20;

export interface CatalogModel {
  id: string;
  modality: ModelModality;
  operations: ModelOperation[];
  displayName: string;
  qualityRank: number;
  /** Frontend-safe business metadata. Legacy fixtures may omit these fields. */
  manufacturer?: string;
  stableModelName?: string;
  version?: string;
  capabilities?: ModelOperation[];
}

export interface ModelDeployment {
  id: string;
  catalogModelId: string;
  providerProfileId?: string;
  executionChannelId?: string;
  providerModel?: string;
  endpointRevision?: string;
  apiCounterparty?: string;
  credentialOwner?: 'platform' | 'workspace_byok' | 'provider_managed';
  lifecycleRevision?: string;
  apiFamily:
    | 'openai'
    | 'anthropic'
    | 'gemini'
    | 'custom'
    | 'image'
    | 'media'
    | 'audio';
  channel: 'direct' | 'managed' | 'bifrost' | 'litellm';
  region: 'domestic' | 'overseas';
  status: DeploymentStatus;
  allowedDataClasses?: Array<'public' | DataClass>;
  policyRevision?: string;
  priceRevision?: string;
  credentialMode?: 'platform' | 'byok_strict';
  credentialVersion?: string;
  unitPrice?: {
    amountMicros: number;
    currency: 'CNY' | 'USD';
    unit: string;
  };
  canvasGenerationCapabilities?: CanvasGenerationCapability[];
  activationEvidence?: {
    status: 'documented' | 'recorded' | 'live_verified';
    verifiedAt?: string;
    evidenceRef?: string;
    configurationRevision?: string;
  };
}

export type RuntimeDeploymentCapability = Pick<
  ModelDeployment,
  | 'id'
  | 'catalogModelId'
  | 'apiFamily'
  | 'channel'
  | 'region'
  | 'executionChannelId'
  | 'providerModel'
  | 'endpointRevision'
  | 'lifecycleRevision'
  | 'credentialVersion'
>;

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
  operation: ModelOperation;
  selection: RequestedSelection;
  dataClass: DataClass[];
  prompt: string;
  origin?: AdvancedCanvasGenerationOrigin;
  /** Product entitlement units billed for this provider execution. Defaults to 1. */
  productUsageQuantity?: 0 | 1;
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

function modelSupplyProductUsageQuantity(
  submission: ModelSupplySubmission
): 0 | 1 {
  const quantity = submission.productUsageQuantity ?? 1;
  if (quantity !== 0 && quantity !== 1) {
    throw new Error('Product usage quantity must be either zero or one.');
  }
  return quantity;
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
  | 'simulated_unavailable';

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

export interface RouteSnapshot {
  id: string;
  catalogRevisionId: string;
  requestedSelection: RequestedSelection;
  candidateCatalogModelIds: string[];
  actualCatalogModelId: string;
  deploymentId: string;
  policyRevision?: string;
  priceRevision?: string;
  credentialMode?: 'platform' | 'byok_strict';
  credentialVersion?: string;
  providerProfileId?: string;
  executionChannelId?: string;
  providerModel?: string;
  endpointRevision?: string;
  apiCounterparty?: string;
  credentialOwner?: ModelDeployment['credentialOwner'];
  deploymentLifecycleRevision?: string;
  fallbackConsent?: boolean;
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
    deploymentLifecycleRevision?: string | null;
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

export const AUDIO_ASSET_FORMATS = [
  { codec: 'mp3', container: 'mp3', contentType: 'audio/mpeg' },
  { codec: 'pcm_s16le', container: 'wav', contentType: 'audio/wav' },
  { codec: 'opus', container: 'ogg', contentType: 'audio/ogg' },
  { codec: 'aac', container: 'mp4', contentType: 'audio/mp4' },
] as const;
export const OWNED_ASSET_CONTENT_TYPES = [
  'application/zip',
  'image/png',
  'video/mp4',
  ...AUDIO_ASSET_FORMATS.map(({ contentType }) => contentType),
] as const;

export interface OwnedAsset {
  id: string;
  objectKey: string;
  sha256: string;
  sizeBytes: number;
  contentType: (typeof OWNED_ASSET_CONTENT_TYPES)[number];
  sourceTaskRef?: string;
  sourceTtlEvidence?: {
    providerTaskRef: string;
    expiresAt: string;
    recordedAt: string;
  };
  compositionEvidence?: {
    rendererRevision: string;
    clipCount: number;
    sourceAssetIds: string[];
    outputSha256: string;
    outputSizeBytes: number;
  };
  technicalValidation?: {
    playable: boolean;
    codec: 'h264';
    durationSeconds: number;
    width?: number;
    height?: number;
    hashVerified?: boolean;
    evidenceKind?: 'measured' | 'recorded_synthetic';
  };
}

export type CustodyOwnedAssetContentType =
  | OwnedAsset['contentType']
  | 'image/jpeg'
  | 'image/webp';

export type PersistedCustodyOwnedAsset = Omit<OwnedAsset, 'contentType'> & {
  contentType: CustodyOwnedAssetContentType;
};

export interface ModelAssetStoragePort {
  persistGeneratedAsset(input: {
    workspaceId: string;
    bytes: Uint8Array;
    contentType: OwnedAsset['contentType'];
    sourceTaskRef?: string;
    sourceExpiresAt?: string;
  }): Promise<OwnedAsset>;
  persistOwnedAsset?(input: {
    workspaceId: string;
    bytes: Uint8Array;
    contentType: CustodyOwnedAssetContentType;
  }): Promise<PersistedCustodyOwnedAsset>;
  inspectOwnedAsset?(input: {
    workspaceId: string;
    objectKey: string;
    sha256: string;
    sizeBytes?: number;
    contentType: CustodyOwnedAssetContentType;
  }): Promise<boolean>;
  publicUrl?(objectKey: string): string;
}

/** Test/default storage keeps the bytes instead of manufacturing a receipt. */
export class MemoryModelAssetStorage implements ModelAssetStoragePort {
  private readonly objects = new Map<string, Uint8Array>();

  async persistGeneratedAsset(input: {
    workspaceId: string;
    bytes: Uint8Array;
    contentType: OwnedAsset['contentType'];
    sourceTaskRef?: string;
    sourceExpiresAt?: string;
  }) {
    const sha256 = hash(input.bytes);
    const receiptDigest = input.sourceTaskRef
      ? hash(`provider-task\0${input.sourceTaskRef}\0${sha256}`)
      : sha256;
    const objectKey = `${input.workspaceId}/generated/${receiptDigest}.${assetExtension(input.contentType)}`;
    this.objects.set(objectKey, Uint8Array.from(input.bytes));
    return {
      id: `asset-${receiptDigest.slice(0, 32)}`,
      objectKey,
      sha256,
      sizeBytes: input.bytes.byteLength,
      contentType: input.contentType,
      ...(input.sourceTaskRef ? { sourceTaskRef: input.sourceTaskRef } : {}),
      ...(input.sourceTaskRef && input.sourceExpiresAt
        ? {
            sourceTtlEvidence: {
              providerTaskRef: input.sourceTaskRef,
              expiresAt: input.sourceExpiresAt,
              recordedAt: now(),
            },
          }
        : {}),
      ...(input.contentType === 'video/mp4'
        ? {
            technicalValidation: {
              playable: true,
              codec: 'h264' as const,
              durationSeconds: 15,
              width: 720,
              height: 1280,
              hashVerified: true,
              evidenceKind: 'recorded_synthetic' as const,
            },
          }
        : {}),
    };
  }

  async persistOwnedAsset(input: {
    workspaceId: string;
    bytes: Uint8Array;
    contentType: CustodyOwnedAssetContentType;
  }) {
    const sha256 = hash(input.bytes);
    const objectKey = `${input.workspaceId}/owned/${sha256}.${assetExtension(input.contentType)}`;
    this.objects.set(objectKey, Uint8Array.from(input.bytes));
    return {
      id: `owned-${sha256.slice(0, 32)}`,
      objectKey,
      sha256,
      sizeBytes: input.bytes.byteLength,
      contentType: input.contentType,
    };
  }

  async inspectOwnedAsset(input: {
    workspaceId: string;
    objectKey: string;
    sha256: string;
    sizeBytes?: number;
    contentType: CustodyOwnedAssetContentType;
  }) {
    const bytes = this.objects.get(input.objectKey);
    return Boolean(
      input.objectKey.startsWith(`${input.workspaceId}/owned/`) &&
        input.objectKey.endsWith(`.${assetExtension(input.contentType)}`) &&
        bytes &&
        hash(bytes) === input.sha256 &&
        (input.sizeBytes === undefined || bytes.byteLength === input.sizeBytes),
    );
  }

  read(objectKey: string) {
    const bytes = this.objects.get(objectKey);
    return bytes ? Uint8Array.from(bytes) : undefined;
  }
}

export interface ProductUsage {
  id: string;
  status: 'reserved' | 'committed' | 'refunded';
  quantity: number;
}

export interface ProviderCost {
  id: string;
  status: 'estimated' | 'observed';
  amount: number;
  currency: 'CNY' | 'USD';
  usage: { inputTokens?: number; outputTokens?: number; mediaUnits?: number };
}

export interface CancelledMediaProviderTerminalReconciliation {
  reconciliationKey: string;
  providerTaskRef: string;
  providerStatus: 'completed' | 'failed';
  isolatedFromCancelledWorkflow: true;
  providerCost: ProviderCost;
  asset?: OwnedAsset;
  errorCode?: string;
  retryable?: boolean;
  error?: string;
  reconciledAt: string;
}

export type CopyCandidate = GeneratedCopyCandidateContent;

export function copyCandidateBodiesAreDistinct(
  candidates: readonly Pick<CopyCandidate, 'body'>[]
) {
  const normalizedBodies = candidates.map((candidate) =>
    candidate.body.replace(/\s+/gu, ' ').trim().toLowerCase()
  );
  return new Set(normalizedBodies).size === candidates.length;
}

export interface ModelSupplyResult {
  jobId: string;
  operation?: ModelOperation;
  dispatchStatus?: 'queued';
  status: 'completed' | 'unknown' | 'failed';
  failureCode?: string;
  origin?: AdvancedCanvasGenerationOrigin;
  snapshot: RouteSnapshot;
  attempt: ProviderAttempt;
  attempts: ProviderAttempt[];
  asset?: OwnedAsset;
  copyCandidates?: CopyCandidate[];
  platformVariants?: GeneratedPlatformVariants;
  text?: string;
  usage: ProductUsage;
  providerCost: ProviderCost;
  providerCosts: ProviderCost[];
  cancelledProviderTerminal?: CancelledMediaProviderTerminalReconciliation;
}

export interface DurableMediaGenerationJobView {
  jobId: string;
  workspaceId: string;
  status:
    | 'queued'
    | 'running'
    | 'unknown'
    | 'cancel_requested'
    | 'cancelled'
    | 'completed'
    | 'failed';
  providerTaskRef?: string;
  /** End-to-end provider lifecycle observed by the durable tracer. */
  providerLifecycleLatencyMs: number;
  cancelledProviderTerminal?: CancelledMediaProviderTerminalReconciliation;
  result: ModelSupplyResult;
}

export type CancelledMediaProviderTerminalOutcome =
  | {
      status: 'pending';
      result: ModelSupplyResult;
      errorCode?: string;
      retryable?: boolean;
      error?: string;
    }
  | {
      status: 'completed' | 'failed';
      result: ModelSupplyResult;
      reconciliation: CancelledMediaProviderTerminalReconciliation;
    };

export interface DurableMediaGenerationRuntimePort {
  submit(submission: ModelSupplySubmission): Promise<ModelSupplyResult>;
  get(
    workspaceId: string,
    jobId: string
  ): Promise<DurableMediaGenerationJobView>;
  cancel(input: {
    workspaceId: string;
    jobId: string;
    actorId: string;
  }): Promise<DurableMediaGenerationJobView>;
  reconcileCancelledProviderTerminal(input: {
    workspaceId: string;
    jobId: string;
    providerTaskRef: string;
  }): Promise<CancelledMediaProviderTerminalOutcome>;
}

export interface ModelSupplyResultSink {
  saveResult(workspaceId: string, result: ModelSupplyResult): Promise<void>;
}

export interface ModelSupplyLedgerCheckpointInput {
  submission: ModelSupplySubmission;
  jobId: string;
  attemptId: string;
  ordinal: number;
  snapshot: RouteSnapshot;
  model: CatalogModel;
  deployment: ModelDeployment;
  previousAttempts: ProviderAttempt[];
  previousProviderCosts: ProviderCost[];
}

export interface ModelSupplyLedgerPort {
  checkpointAttempt(
    input: ModelSupplyLedgerCheckpointInput
  ): Promise<{ replayed: boolean; recoveredResult?: ModelSupplyResult }>;
  settleAttempt(input: {
    submission: ModelSupplySubmission;
    result: ModelSupplyResult;
    evidence: string;
  }): Promise<void>;
  recordCancelledProviderTerminal?(input: {
    submission: ModelSupplySubmission;
    result: ModelSupplyResult;
    reconciliation: CancelledMediaProviderTerminalReconciliation;
    evidence: string;
  }): Promise<void>;
}

export interface ProviderExecutionRequest {
  jobId: string;
  model: CatalogModel;
  deployment: ModelDeployment;
  submission: ModelSupplySubmission;
  resolvedReferenceAssets?: import('./reference-asset-resolver.js').ResolvedReferenceAsset[];
  resolvedInputAssets?: Array<
    import('./reference-asset-resolver.js').ResolvedReferenceAsset & {
      role: CanvasGenerationInputAssetRole;
    }
  >;
}

export type ProviderExecutionResponse =
  | {
      kind: 'completed';
      providerTaskRef?: string;
      copyCandidates?: CopyCandidate[];
      platformVariants?: GeneratedPlatformVariants;
      text?: string;
      assetBytes?: Uint8Array;
      contentType?: OwnedAsset['contentType'];
      providerCost: Omit<ProviderCost, 'id' | 'status'>;
    }
  | {
      kind: 'failure';
      acceptance: Acceptance;
      providerTaskRef?: string;
      errorCode?: string;
      retryable?: boolean;
      message: string;
      providerCost: Omit<ProviderCost, 'id' | 'status'>;
    };

/**
 * The only execution seam used by ModelSupplyApplicationService. Direct,
 * managed and gateway adapters all normalize into this contract.
 */
export interface ProviderExecutionPort {
  execute(
    request: ProviderExecutionRequest
  ): Promise<ProviderExecutionResponse>;
}

export interface MediaProviderEffectRequest extends ProviderExecutionRequest {
  effectIdempotencyKey: string;
  resolvedReferenceAssets?: import('./reference-asset-resolver.js').ResolvedReferenceAsset[];
}

export interface MediaProviderSubmissionReceipt {
  acceptance: 'accepted' | 'acceptance_unknown' | 'rejected_before_accept';
  taskRef?: string;
  sourceExpiresAt?: string;
  providerCost: Omit<ProviderCost, 'id' | 'status'>;
  errorCode?: string;
  retryable?: boolean;
  error?: string;
}

export interface MediaProviderLifecyclePort {
  submit(
    request: MediaProviderEffectRequest
  ): Promise<MediaProviderSubmissionReceipt>;
  recover(
    request: MediaProviderEffectRequest
  ): Promise<MediaProviderSubmissionReceipt | null>;
  poll(request: MediaProviderEffectRequest & { taskRef: string }): Promise<{
    status: 'queued' | 'running' | 'completed' | 'failed' | 'unknown';
    providerCost: Omit<ProviderCost, 'id' | 'status'>;
    errorCode?: string;
    retryable?: boolean;
    error?: string;
    sourceExpiresAt?: string;
  }>;
  download(request: MediaProviderEffectRequest & { taskRef: string }): Promise<{
    bytes: Uint8Array;
    contentType: OwnedAsset['contentType'];
    sourceExpiresAt?: string;
  }>;
  cancel(
    request: MediaProviderEffectRequest & { taskRef: string }
  ): Promise<void | {
    status: 'cancelled' | 'pending';
    errorCode?: string;
    retryable?: boolean;
    error?: string;
  }>;
}

function hash(value: string | Uint8Array) {
  return createHash('sha256').update(value).digest('hex');
}

function assetExtension(contentType: CustodyOwnedAssetContentType) {
  switch (contentType) {
    case 'application/zip':
      return 'zip';
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'video/mp4':
      return 'mp4';
    case 'audio/mp4':
      return 'm4a';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/wav':
      return 'wav';
  }
}

function now() {
  return new Date().toISOString();
}

function deploymentAllowsDataClass(
  deployment: ModelDeployment,
  dataClass: DataClass[]
) {
  const regionalBoundary = new Set<'public' | DataClass>(
    deployment.region === 'domestic'
      ? ['public', 'contains_face', 'pii', 'medical']
      : ['public']
  );
  const declared = new Set(deployment.allowedDataClasses ?? regionalBoundary);
  const requested: Array<'public' | DataClass> =
    dataClass.length === 0 ? ['public'] : dataClass;
  return requested.every(
    (value) => regionalBoundary.has(value) && declared.has(value)
  );
}

interface RoutePlanningCatalog {
  modelById: Map<string, CatalogModel>;
  deployments: ModelDeployment[];
}

interface PlannedRouteCandidate {
  model: CatalogModel;
  deployment: ModelDeployment;
}

function recordedCostEstimate(
  operation: ModelOperation,
  region: ModelDeployment['region']
): RouteCandidateCostEstimate {
  const amountMicros =
    operation.startsWith('copy.') || operation === 'text.respond'
      ? 20_000
      : operation === 'video.generate'
        ? 500_000
        : 100_000;
  return {
    amountMicros,
    currency: region === 'domestic' ? 'CNY' : 'USD',
    source: 'recorded_estimate',
    unit: 'request',
  };
}

function routeCandidateCostEstimate(
  deployment: ModelDeployment,
  operation: ModelOperation
): RouteCandidateCostEstimate {
  return deployment.unitPrice
    ? {
        amountMicros: deployment.unitPrice.amountMicros,
        currency: deployment.unitPrice.currency,
        source: 'catalog',
        unit: deployment.unitPrice.unit,
      }
    : recordedCostEstimate(operation, deployment.region);
}

/**
 * Shared hard-filter and ranking function for real execution and the admin
 * simulator. Simulator-only availability overrides add exclusions; they never
 * mutate the published catalog.
 */
export function planModelSupplyCandidates(input: {
  catalog: RoutePlanningCatalog;
  operation: ModelOperation;
  selection: RequestedSelection;
  dataClass: DataClass[];
  unavailableDeploymentIds?: readonly string[];
}) {
  const unavailable = new Set(input.unavailableDeploymentIds ?? []);
  const candidateEvaluations = input.catalog.deployments.map(
    (deployment): RouteCandidateEvaluation => {
      const model = input.catalog.modelById.get(deployment.catalogModelId);
      const exclusionReasons: RouteCandidateExclusionReason[] = [];
      if (!model) exclusionReasons.push('catalog_model_missing');
      if (deployment.status !== 'active') {
        exclusionReasons.push('deployment_inactive');
      }
      if (model && !model.operations.includes(input.operation)) {
        exclusionReasons.push('operation_unsupported');
      }
      if (
        input.selection.mode === 'fixed' &&
        model?.id !== input.selection.catalogModelId
      ) {
        exclusionReasons.push('fixed_model_mismatch');
      }
      if (
        input.selection.mode === 'auto' &&
        deployment.apiFamily === 'custom'
      ) {
        exclusionReasons.push('custom_requires_fixed_selection');
      }
      if (!deploymentAllowsDataClass(deployment, input.dataClass)) {
        exclusionReasons.push('data_class_disallowed');
      }
      if (unavailable.has(deployment.id)) {
        exclusionReasons.push('simulated_unavailable');
      }
      return {
        catalogModelId: deployment.catalogModelId,
        deploymentId: deployment.id,
        eligible: exclusionReasons.length === 0,
        exclusionReasons,
        qualityRank: model?.qualityRank ?? null,
        region: deployment.region,
        channel: deployment.channel,
        costEstimate: routeCandidateCostEstimate(deployment, input.operation),
      };
    }
  );
  const evaluationByDeploymentId = new Map(
    candidateEvaluations.map((evaluation) => [
      evaluation.deploymentId,
      evaluation,
    ])
  );
  const candidates = input.catalog.deployments.flatMap((deployment) => {
    const evaluation = evaluationByDeploymentId.get(deployment.id);
    const model = input.catalog.modelById.get(deployment.catalogModelId);
    return evaluation?.eligible && model ? [{ model, deployment }] : [];
  });
  if (input.selection.mode === 'auto') {
    candidates.sort(
      (left, right) => right.model.qualityRank - left.model.qualityRank
    );
  }
  return { candidateEvaluations, candidates };
}

function sumRouteCosts(
  costs: RouteCandidateCostEstimate[]
): RouteCandidateCostEstimate | null {
  const first = costs[0];
  if (!first) return null;
  if (
    costs.some(
      (cost) => cost.currency !== first.currency || cost.unit !== first.unit
    )
  ) {
    return null;
  }
  return {
    amountMicros: costs.reduce((total, cost) => total + cost.amountMicros, 0),
    currency: first.currency,
    source: costs.some((cost) => cost.source === 'recorded_estimate')
      ? 'recorded_estimate'
      : 'catalog',
    unit: first.unit,
  };
}

function canonical(submission: ModelSupplySubmission) {
  return JSON.stringify({
    ...submission,
    dataClass: [...submission.dataClass].sort(),
  });
}

export function modelSupplyJobId(submission: ModelSupplySubmission) {
  return modelSupplyJobIdForKey(
    submission.workspaceId,
    submission.idempotencyKey
  );
}

export function modelSupplyJobIdForKey(
  workspaceId: string,
  idempotencyKey: string
) {
  return `model-${hash(`${workspaceId}:${idempotencyKey}`).slice(0, 32)}`;
}

export function mediaSubmissionFingerprint(submission: ModelSupplySubmission) {
  const { frozenRouteSnapshot: _frozen, ...request } = submission;
  return hash(
    JSON.stringify({
      ...request,
      dataClass: [...submission.dataClass].sort(),
    })
  );
}

function modelAttemptId(jobId: string, ordinal: number, deploymentId: string) {
  return `model-attempt-${hash(`${jobId}:${ordinal}:${deploymentId}`).slice(
    0,
    28
  )}`;
}

function recoveryProviderCost(
  attemptId: string,
  region: ModelDeployment['region']
): ProviderCost {
  return {
    id: `provider-cost-${hash(`${attemptId}:estimated`).slice(0, 24)}`,
    status: 'estimated',
    amount: 0,
    currency: region === 'domestic' ? 'CNY' : 'USD',
    usage: {},
  };
}

/** Recorded adapters are the default P1 contract runner; they never require a Key. */
export class RecordedProviderExecutionPort implements ProviderExecutionPort {
  private readonly nextFailure = new Map<string, Acceptance>();

  constructor(readonly name = 'recorded-direct') {}

  failNext(catalogModelId: string, acceptance: Acceptance) {
    this.nextFailure.set(catalogModelId, acceptance);
  }

  async execute(
    request: ProviderExecutionRequest
  ): Promise<ProviderExecutionResponse> {
    const failure = this.nextFailure.get(request.model.id);
    if (failure) {
      this.nextFailure.delete(request.model.id);
      return {
        kind: 'failure',
        acceptance: failure,
        message: `${request.model.id} recorded ${failure}.`,
        providerCost: {
          amount: failure === 'rejected_before_accept' ? 0 : 0.01,
          currency: request.deployment.region === 'domestic' ? 'CNY' : 'USD',
          usage:
            failure === 'rejected_before_accept' ? {} : { inputTokens: 12 },
        },
      };
    }

    if (request.model.modality === 'llm') {
      if (request.submission.operation === 'text.respond') {
        return {
          kind: 'completed',
          text: request.submission.prompt,
          providerCost: {
            amount: 0.02,
            currency:
              request.deployment.region === 'domestic' ? 'CNY' : 'USD',
            usage: {
              inputTokens: Math.max(1, request.submission.prompt.length),
              outputTokens: 32,
            },
          },
        };
      }
      const variants = ['真实门店版', '熟客推荐版', '同城到店版'];
      return {
        kind: 'completed',
        copyCandidates: variants.map((variant, index) => ({
          title: `${request.submission.prompt.slice(0, 18)}｜${variant}`,
          body: `${request.submission.prompt}。${variant}强调${['到店体验', '服务细节', '预约行动'][index]}。`,
          conversionHook:
            ['先沟通需求', '收藏后预约', '到店前留言'][index] ?? '先沟通需求',
        })),
        providerCost: {
          amount: 0.02,
          currency: request.deployment.region === 'domestic' ? 'CNY' : 'USD',
          usage: {
            inputTokens: Math.max(1, request.submission.prompt.length),
            outputTokens: 180,
          },
        },
      };
    }

    const payload = JSON.stringify({
      provider: this.name,
      model: request.model.id,
      operation: request.submission.operation,
      prompt: request.submission.prompt,
    });
    const isVideo = request.model.modality === 'video';
    return {
      kind: 'completed',
      providerTaskRef: isVideo
        ? `recorded-task-${hash(payload).slice(0, 18)}`
        : undefined,
      assetBytes: Buffer.from(payload),
      contentType: isVideo ? 'video/mp4' : 'image/png',
      providerCost: {
        amount: isVideo ? 0.5 : 0.1,
        currency: request.deployment.region === 'domestic' ? 'CNY' : 'USD',
        usage: { mediaUnits: 1 },
      },
    };
  }
}

/** Recorded LLM gateway comparison; managed media uses its lifecycle port. */
export class RecordedGatewayPocPort extends RecordedProviderExecutionPort {
  private readonly cooldownUntil = new Map<string, number>();
  private readonly events: Array<{
    gateway: 'bifrost' | 'litellm';
    workspaceHash: string;
    deploymentId: string;
    outcome: 'completed' | Acceptance | 'cooldown';
  }> = [];

  constructor(
    readonly gateway: 'bifrost' | 'litellm',
    private readonly clock: () => number = Date.now
  ) {
    super(`recorded-${gateway}`);
  }

  override async execute(
    request: ProviderExecutionRequest
  ): Promise<ProviderExecutionResponse> {
    const isolationKey = `${request.submission.workspaceId}:${request.deployment.id}:${request.deployment.credentialVersion ?? 'platform'}`;
    if ((this.cooldownUntil.get(isolationKey) ?? 0) > this.clock()) {
      this.record(request, 'cooldown');
      return {
        kind: 'failure',
        acceptance: 'rejected_before_accept',
        message: `${this.gateway} workspace route is cooling down.`,
        providerCost: {
          amount: 0,
          currency: request.deployment.region === 'domestic' ? 'CNY' : 'USD',
          usage: {},
        },
      };
    }
    const result = await super.execute(request);
    const outcome =
      result.kind === 'completed' ? 'completed' : result.acceptance;
    this.record(request, outcome);
    if (
      result.kind === 'failure' &&
      result.acceptance !== 'rejected_before_accept'
    ) {
      this.cooldownUntil.set(isolationKey, this.clock() + 30_000);
    }
    return result;
  }

  safeExecutionEvents() {
    return structuredClone(this.events);
  }

  clearWorkspaceCooldown(workspaceId: string) {
    for (const key of this.cooldownUntil.keys()) {
      if (key.startsWith(`${workspaceId}:`)) this.cooldownUntil.delete(key);
    }
  }

  private record(
    request: ProviderExecutionRequest,
    outcome: 'completed' | Acceptance | 'cooldown'
  ) {
    this.events.push({
      gateway: this.gateway,
      workspaceHash: hash(request.submission.workspaceId).slice(0, 16),
      deploymentId: request.deployment.id,
      outcome,
    });
  }
}

interface StoredIdempotency {
  canonical: string;
  result: ModelSupplyResult;
}

export class ModelSupplyApplicationService {
  readonly execution: RecordedProviderExecutionPort | ProviderExecutionPort;
  private readonly modelById = new Map<string, CatalogModel>();
  private readonly deployments: ModelDeployment[];
  private readonly catalogRevisionId: string;
  private readonly workspaceCatalogs = new Map<
    string,
    {
      revisionId: string;
      modelById: Map<string, CatalogModel>;
      deployments: ModelDeployment[];
    }
  >();
  private readonly storedAttempts: ProviderAttempt[] = [];
  private readonly idempotency = new Map<string, StoredIdempotency>();
  private readonly qualityEvents: QualityEvent[] = [];
  private readonly resultSink?: ModelSupplyResultSink;
  private readonly ledger?: ModelSupplyLedgerPort;
  private readonly assetStorage: ModelAssetStoragePort;
  private readonly referenceAssets?: ReferenceAssetResolverPort;
  private mediaRuntime?: DurableMediaGenerationRuntimePort;
  private readonly runtimeCapabilities?: Map<
    string,
    RuntimeDeploymentCapability
  >;
  private readonly submissionGate?: {
    blocksNewSubmission(): Promise<boolean>;
  };

  constructor(options: {
    models: CatalogModel[];
    deployments: ModelDeployment[];
    execution: ProviderExecutionPort;
    resultSink?: ModelSupplyResultSink;
    ledger?: ModelSupplyLedgerPort;
    catalogRevisionId?: string;
    runtimeCapabilities?: RuntimeDeploymentCapability[];
    assetStorage?: ModelAssetStoragePort;
    referenceAssets?: ReferenceAssetResolverPort;
    submissionGate?: { blocksNewSubmission(): Promise<boolean> };
  }) {
    for (const model of options.models) this.modelById.set(model.id, model);
    this.runtimeCapabilities = options.runtimeCapabilities
      ? new Map(
          options.runtimeCapabilities.map((capability) => [
            capability.id,
            structuredClone(capability),
          ])
        )
      : undefined;
    this.deployments = this.constrainRuntimeDeployments(options.deployments);
    this.catalogRevisionId = options.catalogRevisionId ?? 'recorded-runtime';
    this.execution = options.execution;
    this.resultSink = options.resultSink;
    this.ledger = options.ledger;
    this.assetStorage = options.assetStorage ?? new MemoryModelAssetStorage();
    this.referenceAssets = options.referenceAssets;
    this.submissionGate = options.submissionGate;
  }

  attempts() {
    return [...this.storedAttempts];
  }

  attachDurableMediaRuntime(runtime: DurableMediaGenerationRuntimePort) {
    if (this.mediaRuntime && this.mediaRuntime !== runtime) {
      throw new Error('Durable media runtime is already attached.');
    }
    this.mediaRuntime = runtime;
  }

  getDurableMediaJob(workspaceId: string, jobId: string) {
    if (!this.mediaRuntime) {
      throw new Error('Durable media runtime is not configured.');
    }
    return this.mediaRuntime.get(workspaceId, jobId);
  }

  cancelDurableMediaJob(input: {
    workspaceId: string;
    jobId: string;
    actorId: string;
  }) {
    if (!this.mediaRuntime) {
      throw new Error('Durable media runtime is not configured.');
    }
    return this.mediaRuntime.cancel(input);
  }

  reconcileCancelledProviderTerminal(input: {
    workspaceId: string;
    jobId: string;
    providerTaskRef: string;
  }) {
    if (!this.mediaRuntime) {
      throw new Error('Durable media runtime is not configured.');
    }
    return this.mediaRuntime.reconcileCancelledProviderTerminal(input);
  }

  hasDurableMediaRuntime() {
    return Boolean(this.mediaRuntime);
  }

  constrainRuntimeDeployments<T extends ModelDeployment>(
    deployments: T[]
  ): T[] {
    return deployments.map((deployment) => {
      const stored = structuredClone(deployment);
      if (
        stored.status !== 'active' ||
        this.supportsRuntimeDeployment(stored)
      ) {
        return stored;
      }
      return {
        ...stored,
        status: 'inactive',
        unavailableReason: 'deployment_unavailable',
      } as T;
    });
  }

  assertRuntimeCatalogCompatible(deployments: ModelDeployment[]) {
    const unsupported = deployments.find(
      (deployment) =>
        deployment.status === 'active' &&
        !this.supportsRuntimeDeployment(deployment)
    );
    if (unsupported) {
      throw new Error(
        `Deployment ${unsupported.id} is outside the immutable runtime capability.`
      );
    }
  }

  /**
   * Switches only the catalog used by future submissions. Existing jobs keep
   * their immutable route snapshot and catalogRevisionId.
   */
  applyCatalogRevision(
    workspaceId: string,
    revisionId: string,
    models: CatalogModel[],
    deployments: ModelDeployment[]
  ) {
    const modelIds = new Set(models.map((model) => model.id));
    const unknownDeployment = deployments.find(
      (deployment) => !modelIds.has(deployment.catalogModelId)
    );
    if (unknownDeployment) {
      throw new Error(
        `Deployment ${unknownDeployment.id} references an unknown CatalogModel.`
      );
    }
    this.workspaceCatalogs.set(workspaceId, {
      revisionId,
      modelById: new Map(
        models.map((model) => [model.id, structuredClone(model)] as const)
      ),
      deployments: this.constrainRuntimeDeployments(deployments),
    });
  }

  freezeFixedRoute(input: {
    workspaceId: string;
    operation: ModelOperation;
    catalogModelId: string;
    deploymentId?: string;
    dataClass: DataClass[];
    promptRevision?: string;
  }) {
    const submission: ModelSupplySubmission = {
      workspaceId: input.workspaceId,
      actorId: 'workflow-gate',
      idempotencyKey: 'route-preview-only',
      operation: input.operation,
      selection: { mode: 'fixed', catalogModelId: input.catalogModelId },
      dataClass: [...input.dataClass],
      prompt: '',
      ...(input.promptRevision ? { promptRevision: input.promptRevision } : {}),
    };
    const catalog = this.workspaceCatalogs.get(input.workspaceId) ?? {
      revisionId: this.catalogRevisionId,
      modelById: this.modelById,
      deployments: this.deployments,
    };
    const resolvedCandidates = this.resolveCandidates(submission, catalog);
    const candidates =
      submission.selection.mode === 'auto'
        ? resolvedCandidates.slice(0, 2)
        : resolvedCandidates;
    const selected = input.deploymentId
      ? candidates.find(
          (candidate) => candidate.deployment.id === input.deploymentId,
        )
      : candidates[0];
    if (!selected)
      throw new Error('No active deployment can be frozen for this workflow.');
    return this.snapshotFor(
      submission,
      input.deploymentId ? [selected] : candidates,
      selected,
      catalog.revisionId
    );
  }

  simulateRoute(
    input: ModelSupplyRouteSimulationInput
  ): ModelSupplyRouteSimulation {
    if (
      input.selection.mode === 'auto' &&
      input.operation !== 'copy.generate'
    ) {
      throw new Error(
        'Auto selection is available only for LLM copy generation.'
      );
    }
    if (input.selection.mode === 'fixed' && !input.selection.catalogModelId) {
      throw new Error('Fixed selection requires catalogModelId.');
    }
    const catalog = this.workspaceCatalogs.get(input.workspaceId) ?? {
      revisionId: this.catalogRevisionId,
      modelById: this.modelById,
      deployments: this.deployments,
    };
    const knownDeploymentIds = new Set(
      catalog.deployments.map((deployment) => deployment.id)
    );
    const unknownUnavailableDeploymentId = input.unavailableDeploymentIds?.find(
      (deploymentId) => !knownDeploymentIds.has(deploymentId)
    );
    if (unknownUnavailableDeploymentId) {
      throw new Error(
        `Unknown simulated deployment ${unknownUnavailableDeploymentId}.`
      );
    }
    const plan = planModelSupplyCandidates({
      catalog,
      operation: input.operation,
      selection: input.selection,
      dataClass: input.dataClass,
      unavailableDeploymentIds: input.unavailableDeploymentIds,
    });
    const evaluationByDeploymentId = new Map(
      plan.candidateEvaluations.map((evaluation) => [
        evaluation.deploymentId,
        evaluation,
      ])
    );
    const rankedCandidates = plan.candidates.map(({ deployment }, index) => ({
      ...(evaluationByDeploymentId.get(
        deployment.id
      ) as RouteCandidateEvaluation),
      rank: index + 1,
    }));
    const primary = rankedCandidates[0];
    const fallback = rankedCandidates[1];
    let expectedOutcome: ModelSupplyRouteSimulation['expectedOutcome'];
    let estimatedCosts: RouteCandidateCostEstimate[] = [];
    if (!primary) {
      expectedOutcome = {
        action: 'awaiting_selection',
        attemptLimit: 2,
        expectedAttempts: 0,
        reason: 'no_eligible_candidate',
      };
    } else if (input.failureScenario === 'success') {
      estimatedCosts = [primary.costEstimate];
      expectedOutcome = {
        action: 'complete',
        attemptLimit: 2,
        expectedAttempts: 1,
        primaryDeploymentId: primary.deploymentId,
        reason: 'provider_completed',
      };
    } else if (input.failureScenario === 'accepted_failure') {
      estimatedCosts = [primary.costEstimate];
      expectedOutcome = {
        action: 'recover_without_resubmit',
        attemptLimit: 2,
        expectedAttempts: 1,
        primaryDeploymentId: primary.deploymentId,
        reason: 'provider_already_accepted',
      };
    } else if (input.failureScenario === 'acceptance_unknown') {
      estimatedCosts = [primary.costEstimate];
      expectedOutcome = {
        action: 'recover_without_resubmit',
        attemptLimit: 2,
        expectedAttempts: 1,
        primaryDeploymentId: primary.deploymentId,
        reason: 'provider_acceptance_unknown',
      };
    } else {
      const fallbackAuthorized =
        input.selection.mode === 'auto' &&
        (input.selection.fallbackConsent ?? true);
      if (fallbackAuthorized && fallback) {
        estimatedCosts = [primary.costEstimate, fallback.costEstimate];
        expectedOutcome = {
          action: 'fallback',
          attemptLimit: 2,
          expectedAttempts: 2,
          primaryDeploymentId: primary.deploymentId,
          fallbackDeploymentId: fallback.deploymentId,
          reason: 'safe_auto_fallback',
        };
      } else {
        estimatedCosts = [primary.costEstimate];
        expectedOutcome = {
          action: 'stop',
          attemptLimit: 2,
          expectedAttempts: 1,
          primaryDeploymentId: primary.deploymentId,
          reason: fallbackAuthorized
            ? 'no_safe_fallback_candidate'
            : 'fallback_not_authorized',
        };
      }
    }
    return {
      catalogRevisionId: catalog.revisionId,
      operation: input.operation,
      selection: structuredClone(input.selection),
      dataClass: [...input.dataClass].sort(),
      failureScenario: input.failureScenario,
      candidateEvaluations: structuredClone(plan.candidateEvaluations),
      rankedCandidates: structuredClone(rankedCandidates),
      expectedOutcome,
      estimatedMaximumCost: sumRouteCosts(estimatedCosts),
    };
  }

  async submit(submission: ModelSupplySubmission): Promise<ModelSupplyResult> {
    if (
      this.mediaRuntime &&
      (submission.operation === 'image.generate' ||
        submission.operation === 'image.edit' ||
        submission.operation === 'video.generate' ||
        submission.operation === 'audio.speech' ||
        submission.operation === 'audio.sfx')
    ) {
      return this.mediaRuntime.submit(submission);
    }
    return this.executeSubmission(submission, this.execution);
  }

  async startCopyStream(
    submission: ModelSupplySubmission,
    runner: AiStreamingRunner,
    abortSignal?: AbortSignal
  ) {
    if (
      submission.operation !== 'copy.generate' ||
      submission.selection.mode !== 'fixed' ||
      !submission.selection.catalogModelId
    ) {
      throw new Error('Streaming copy requires one fixed copy model.');
    }
    let resolveResponse!: (response: Response) => void;
    let rejectResponse!: (error: unknown) => void;
    let streamStarted = false;
    const response = new Promise<Response>((resolve, reject) => {
      resolveResponse = resolve;
      rejectResponse = reject;
    });
    const completion = this.executeSubmission(submission, {
      execute: async (request) => {
        if (this.submissionGate && (await this.submissionGate.blocksNewSubmission())) {
          return {
            kind: 'failure',
            acceptance: 'rejected_before_accept',
            message: '模型执行已停用。',
            providerCost: {
              amount: 0,
              currency:
                request.deployment.region === 'domestic' ? 'CNY' : 'USD',
              usage: {},
            },
          };
        }
        if (!runner.supportsCatalogModel(request.model.id)) {
          return {
            kind: 'failure',
            acceptance: 'rejected_before_accept',
            message: `Streaming runner is not bound to ${request.model.id}.`,
            providerCost: {
              amount: 0,
              currency:
                request.deployment.region === 'domestic' ? 'CNY' : 'USD',
              usage: {},
            },
          };
        }
        const started = runner.startCopyStream(
          {
            catalogModelId: request.model.id,
            prompt: request.submission.prompt,
          },
          abortSignal
        );
        let providerOutputStarted = false;
        streamStarted = true;
        resolveResponse(
          observeResponseChunks(started.response, () => {
            providerOutputStarted = true;
          })
        );
        let generated;
        try {
          generated = await started.result;
        } catch (error) {
          const statusCode =
            error &&
            typeof error === 'object' &&
            'statusCode' in error &&
            typeof error.statusCode === 'number'
              ? error.statusCode
              : undefined;
          return {
            kind: 'failure',
            acceptance:
              !providerOutputStarted &&
              statusCode !== undefined &&
              statusCode < 500
                ? 'rejected_before_accept'
                : 'acceptance_unknown',
            message: `AI SDK stream failed: ${
              error instanceof Error ? error.name : 'unknown'
            }`,
            providerCost: {
              amount: 0,
              currency:
                request.deployment.region === 'domestic' ? 'CNY' : 'USD',
              usage: {},
            },
          };
        }
        return {
          kind: 'completed',
          providerTaskRef: generated.providerTaskRef,
          copyCandidates: generated.candidates,
          providerCost: runner.providerCost(generated.usage),
        };
      },
    });
    completion.then(() => {
      if (!streamStarted) {
        resolveResponse(
          new Response(
            JSON.stringify({
              error: {
                code: 'COPY_STREAM_NOT_STARTED',
                message: 'The provider did not start a copy stream.',
              },
            }),
            {
              status: 502,
              headers: { 'content-type': 'application/json' },
            }
          )
        );
      }
    }, rejectResponse);
    return { response: await response, completion };
  }

  /**
   * Executes an admin quality probe through the same catalog, route snapshot
   * and provider port as Product copy generation. It deliberately does not
   * consume Product Usage or write a generation Job; the immutable evaluation
   * Run is the owning record for this provider cost and output. An inactive
   * recorded deployment may be exercised here without becoming user-routable;
   * its inactive status remains frozen in the probe snapshot.
  */
  async executeCopyQualityProbe(submission: ModelSupplySubmission) {
    if (submission.operation !== 'copy.generate') {
      throw new Error('Copy quality probes require copy.generate.');
    }
    const result = await this.executeLanguageQualityProbe(submission);
    if (!('copyCandidates' in result)) {
      throw new Error('Copy quality probe provider returned no candidates.');
    }
    return result;
  }

  async executeLanguageQualityProbe(submission: ModelSupplySubmission) {
    if (
      ![
        'copy.generate',
        'copy.adapt',
        'text.respond',
      ].includes(submission.operation) ||
      submission.selection.mode !== 'fixed'
    ) {
      throw new Error('Language quality probes require a fixed language model.');
    }
    const catalog = this.workspaceCatalogs.get(submission.workspaceId) ?? {
      revisionId: this.catalogRevisionId,
      modelById: this.modelById,
      deployments: this.deployments,
    };
    const probeCatalog = {
      ...catalog,
      deployments: catalog.deployments.map((deployment) =>
        deployment.status === 'inactive' &&
        deployment.catalogModelId === submission.selection.catalogModelId
          ? { ...deployment, status: 'active' as const }
          : deployment
      ),
    };
    const deploymentById = new Map(
      catalog.deployments.map((deployment) => [deployment.id, deployment])
    );
    const candidates = this.resolveCandidates(submission, probeCatalog).map(
      ({ model, deployment }) => ({
        model,
        deployment: structuredClone(
          deploymentById.get(deployment.id) ?? deployment
        ),
      })
    );
    const selected = candidates[0];
    if (!selected) {
      throw new Error('No deployment satisfies this quality probe.');
    }
    const snapshot = this.snapshotFor(
      submission,
      candidates,
      selected,
      catalog.revisionId
    );
    const jobId = `quality-probe-${hash(
      `${submission.workspaceId}:${submission.idempotencyKey}`
    ).slice(0, 28)}`;
    const response = await this.execution.execute({
      jobId,
      model: selected.model,
      deployment: selected.deployment,
      submission,
    });
    if (response.kind === 'failure') {
      throw new Error(`Quality probe provider failed: ${response.message}`);
    }
    if (!response.copyCandidates && !response.text) {
      throw new Error('Quality probe provider returned no language output.');
    }
    return {
      ...(response.copyCandidates
        ? { copyCandidates: structuredClone(response.copyCandidates) }
        : { text: response.text! }),
      snapshot,
      providerCost: {
        id: `provider-cost-${hash(`${jobId}:observed`).slice(0, 24)}`,
        status: 'observed' as const,
        ...structuredClone(response.providerCost),
      },
    };
  }

  executeMediaProviderSubmission(
    submission: ModelSupplySubmission,
    execution: ProviderExecutionPort
  ) {
    if (
      submission.operation.startsWith('copy.') ||
      submission.operation === 'text.respond'
    ) {
      throw new Error(
        'Durable media execution cannot submit language generation.',
      );
    }
    return this.executeSubmission(submission, execution);
  }

  previewMediaSubmission(submission: ModelSupplySubmission): ModelSupplyResult {
    if (
      submission.operation.startsWith('copy.') ||
      submission.operation === 'text.respond' ||
      submission.selection.mode !== 'fixed'
    ) {
      throw new Error('Durable media generation requires a fixed media model.');
    }
    const request = this.mediaProviderRequest(submission);
    const catalog = this.workspaceCatalogs.get(submission.workspaceId) ?? {
      revisionId: this.catalogRevisionId,
      modelById: this.modelById,
      deployments: this.deployments,
    };
    const candidates = this.resolveCandidates(submission, catalog);
    const selected = { model: request.model, deployment: request.deployment };
    const jobId = request.jobId;
    const snapshot = this.snapshotFor(
      submission,
      candidates,
      selected,
      catalog.revisionId
    );
    const attempt: ProviderAttempt = {
      id: modelAttemptId(jobId, 1, selected.deployment.id),
      jobId,
      catalogModelId: selected.model.id,
      deploymentId: selected.deployment.id,
      acceptance: 'acceptance_unknown',
      status: 'unknown',
      createdAt: now(),
    };
    const providerCost = recoveryProviderCost(
      attempt.id,
      selected.deployment.region
    );
    return {
      jobId,
      operation: submission.operation,
      status: 'unknown',
      ...(submission.origin
        ? { origin: structuredClone(submission.origin) }
        : {}),
      snapshot,
      attempt,
      attempts: [attempt],
      usage: {
        id: `model-usage-${hash(jobId).slice(0, 28)}`,
        status: 'reserved',
        quantity: modelSupplyProductUsageQuantity(submission),
      },
      providerCost,
      providerCosts: [providerCost],
    };
  }

  previewTextSubmission(submission: ModelSupplySubmission): ModelSupplyResult {
    if (
      submission.operation !== 'text.respond' ||
      submission.selection.mode !== 'fixed'
    ) {
      throw new Error('Durable text generation requires fixed text.respond.');
    }
    const catalog = this.workspaceCatalogs.get(submission.workspaceId) ?? {
      revisionId: this.catalogRevisionId,
      modelById: this.modelById,
      deployments: this.deployments,
    };
    const candidates = this.resolveCandidates(submission, catalog);
    const selected = candidates[0];
    if (!selected) {
      throw new Error('No active deployment satisfies this text request.');
    }
    const jobId = modelSupplyJobId(submission);
    const snapshot = this.snapshotFor(
      submission,
      candidates,
      selected,
      catalog.revisionId,
    );
    const attempt: ProviderAttempt = {
      id: modelAttemptId(jobId, 1, selected.deployment.id),
      jobId,
      catalogModelId: selected.model.id,
      deploymentId: selected.deployment.id,
      acceptance: 'acceptance_unknown',
      status: 'unknown',
      createdAt: now(),
    };
    const providerCost = recoveryProviderCost(
      attempt.id,
      selected.deployment.region,
    );
    return {
      jobId,
      operation: submission.operation,
      dispatchStatus: 'queued',
      status: 'unknown',
      ...(submission.origin
        ? { origin: structuredClone(submission.origin) }
        : {}),
      snapshot,
      attempt,
      attempts: [attempt],
      usage: {
        id: `model-usage-${hash(jobId).slice(0, 28)}`,
        status: 'reserved',
        quantity: modelSupplyProductUsageQuantity(submission),
      },
      providerCost,
      providerCosts: [providerCost],
    };
  }

  mediaProviderRequest(
    submission: ModelSupplySubmission
  ): ProviderExecutionRequest {
    if (
      submission.operation.startsWith('copy.') ||
      submission.operation === 'text.respond' ||
      submission.selection.mode !== 'fixed'
    ) {
      throw new Error('Durable media generation requires a fixed media model.');
    }
    const catalog = this.workspaceCatalogs.get(submission.workspaceId) ?? {
      revisionId: this.catalogRevisionId,
      modelById: this.modelById,
      deployments: this.deployments,
    };
    const selected = this.resolveCandidates(submission, catalog)[0];
    if (!selected) {
      throw new Error('No active deployment satisfies this media request.');
    }
    return {
      jobId: modelSupplyJobId(submission),
      model: structuredClone(selected.model),
      deployment: structuredClone(selected.deployment),
      submission: structuredClone(submission),
    };
  }

  persistProviderAsset(input: {
    workspaceId: string;
    bytes: Uint8Array;
    contentType: OwnedAsset['contentType'];
    sourceTaskRef: string;
    sourceExpiresAt?: string;
  }) {
    return this.assetStorage.persistGeneratedAsset(input);
  }

  persistGenerationResult(workspaceId: string, result: ModelSupplyResult) {
    return this.resultSink?.saveResult(workspaceId, result) ?? Promise.resolve();
  }

  assetPublicUrl(objectKey: string) {
    return this.assetStorage.publicUrl?.(objectKey);
  }

  private async executeSubmission(
    submission: ModelSupplySubmission,
    execution: ProviderExecutionPort
  ): Promise<ModelSupplyResult> {
    const productUsageQuantity = modelSupplyProductUsageQuantity(submission);
    if (
      submission.operation !== 'copy.generate' &&
      submission.operation !== 'text.respond' &&
      submission.selection.mode === 'auto'
    ) {
      throw new Error(
        'Auto selection is available only for LLM copy or text generation.'
      );
    }
    const key = `${submission.workspaceId}:${submission.idempotencyKey}`;
    const payload = canonical(submission);
    const existing = this.idempotency.get(key);
    if (existing) {
      if (existing.canonical !== payload)
        throw new Error('Idempotency key conflicts with a different payload.');
      return existing.result;
    }

    const catalog = this.workspaceCatalogs.get(submission.workspaceId) ?? {
      revisionId: this.catalogRevisionId,
      modelById: this.modelById,
      deployments: this.deployments,
    };
    const resolvedCandidates = this.resolveCandidates(submission, catalog);
    const candidates =
      submission.selection.mode === 'auto'
        ? resolvedCandidates.slice(0, 2)
        : resolvedCandidates;
    if (candidates.length === 0)
      throw new Error(
        'No active deployment satisfies the requested data class and operation.'
      );
    let lastFailure: ModelSupplyResult | undefined;
    const jobId = modelSupplyJobId(submission);
    const attemptChain: ProviderAttempt[] = [];
    const providerCostChain: ProviderCost[] = [];

    for (const [candidateIndex, candidate] of candidates.entries()) {
      const snapshot = this.snapshotFor(
        submission,
        candidates,
        candidate,
        catalog.revisionId,
        lastFailure ? 'auto_fallback_before_accept' : undefined
      );
      const attemptId = modelAttemptId(
        jobId,
        candidateIndex + 1,
        candidate.deployment.id
      );
      const checkpoint = await this.ledger?.checkpointAttempt({
        submission,
        jobId,
        attemptId,
        ordinal: candidateIndex + 1,
        snapshot,
        model: candidate.model,
        deployment: candidate.deployment,
        previousAttempts: structuredClone(attemptChain),
        previousProviderCosts: structuredClone(providerCostChain),
      });
      if (checkpoint?.recoveredResult) {
        const recovered = checkpoint.recoveredResult;
        for (const attempt of recovered.attempts) {
          if (!this.storedAttempts.some((stored) => stored.id === attempt.id)) {
            this.storedAttempts.push(structuredClone(attempt));
          }
        }
        if (
          recovered.status === 'failed' &&
          recovered.attempt.acceptance === 'rejected_before_accept' &&
          submission.selection.mode === 'auto' &&
          recovered.snapshot.fallbackConsent === true &&
          candidateIndex < candidates.length - 1
        ) {
          attemptChain.splice(
            0,
            attemptChain.length,
            ...structuredClone(recovered.attempts)
          );
          providerCostChain.splice(
            0,
            providerCostChain.length,
            ...structuredClone(recovered.providerCosts)
          );
          lastFailure = recovered;
          continue;
        }
        await this.resultSink?.saveResult(submission.workspaceId, recovered);
        this.idempotency.set(key, { canonical: payload, result: recovered });
        return recovered;
      }

      let response: ProviderExecutionResponse;
      try {
        let resolvedReferenceAssets: ResolvedReferenceAsset[] | undefined;
        const referenceAssetIds = submission.input?.inputAssets
          ?.filter((asset) => asset.role === 'reference_image')
          .map((asset) => asset.assetId) ?? submission.input?.referenceAssetIds;
        if (
          submission.operation === 'text.respond' &&
          (referenceAssetIds?.length ?? 0) > 0
        ) {
          if (!this.referenceAssets) {
            response = {
              kind: 'failure',
              acceptance: 'rejected_before_accept',
              errorCode: 'REFERENCE_ASSET_RESOLVER_INACTIVE',
              retryable: false,
              message: 'Authorized multimodal Asset resolution is inactive.',
              providerCost: {
                amount: 0,
                currency: candidate.deployment.region === 'domestic' ? 'CNY' : 'USD',
                usage: {},
              },
            };
          } else {
            const resolutions = await this.referenceAssets.resolve(
              submission.workspaceId,
              [...new Set(referenceAssetIds)],
            );
            const invalid = resolutions.find(
              (asset) =>
                asset.kind === 'failure' ||
                !asset.contentType.startsWith('image/'),
            );
            if (invalid) {
              response = {
                kind: 'failure',
                acceptance: 'rejected_before_accept',
                errorCode: 'REFERENCE_ASSET_UNAVAILABLE',
                retryable: false,
                message: 'A multimodal Asset is unauthorized or unreadable.',
                providerCost: {
                  amount: 0,
                  currency: candidate.deployment.region === 'domestic' ? 'CNY' : 'USD',
                  usage: {},
                },
              };
            } else {
              resolvedReferenceAssets = resolutions as ResolvedReferenceAsset[];
              const roleByAssetId = new Map(
                submission.input?.inputAssets?.map((asset) => [
                  asset.assetId,
                  asset.role,
                ]) ?? [],
              );
              response = await execution.execute({
                jobId,
                model: candidate.model,
                deployment: candidate.deployment,
                submission,
                resolvedReferenceAssets,
                resolvedInputAssets: resolvedReferenceAssets.map((asset) => ({
                  ...asset,
                  role: roleByAssetId.get(asset.assetId) ?? 'reference_image',
                })),
              });
            }
          }
        } else {
          response = await execution.execute({
            jobId,
            model: candidate.model,
            deployment: candidate.deployment,
            submission,
          });
        }
      } catch (error) {
        const attempt: ProviderAttempt = {
          id: attemptId,
          jobId,
          catalogModelId: candidate.model.id,
          deploymentId: candidate.deployment.id,
          acceptance: 'acceptance_unknown',
          status: 'unknown',
          createdAt: now(),
        };
        attemptChain.push(attempt);
        this.storedAttempts.push(attempt);
        const usage: ProductUsage = {
          id: `model-usage-${hash(jobId).slice(0, 28)}`,
          status: 'reserved',
          quantity: productUsageQuantity,
        };
        const providerCost: ProviderCost = {
          id: `provider-cost-${hash(`${attemptId}:estimated`).slice(0, 24)}`,
          status: 'estimated',
          amount: 0,
          currency: candidate.deployment.region === 'domestic' ? 'CNY' : 'USD',
          usage: {},
        };
        providerCostChain.push(providerCost);
        const unknown: ModelSupplyResult = {
          jobId,
          operation: submission.operation,
          status: 'unknown',
          ...(submission.origin
            ? { origin: structuredClone(submission.origin) }
            : {}),
          snapshot,
          attempt,
          attempts: [...attemptChain],
          usage,
          providerCost,
          providerCosts: [...providerCostChain],
        };
        await this.ledger?.settleAttempt({
          submission,
          result: unknown,
          evidence: `provider_exception:${error instanceof Error ? error.name : 'unknown'}`,
        });
        await this.resultSink?.saveResult(submission.workspaceId, unknown);
        this.idempotency.set(key, { canonical: payload, result: unknown });
        return unknown;
      }
      if (
        response.kind === 'completed' &&
        submission.operation === 'text.respond' &&
        !response.text?.trim()
      ) {
        response = {
          kind: 'failure',
          acceptance: 'accepted',
          errorCode: 'EMPTY_TEXT_DELIVERABLE',
          retryable: false,
          message: 'The provider completed without a non-empty text deliverable.',
          providerCost: response.providerCost,
        };
      }
      const attempt: ProviderAttempt = {
        id: attemptId,
        jobId,
        catalogModelId: candidate.model.id,
        deploymentId: candidate.deployment.id,
        acceptance:
          response.kind === 'failure' ? response.acceptance : 'accepted',
        ...(response.providerTaskRef
          ? { providerTaskRef: response.providerTaskRef }
          : {}),
        status:
          response.kind === 'completed'
            ? 'completed'
            : response.errorCode === 'EMPTY_TEXT_DELIVERABLE'
              ? 'failed'
            : response.acceptance === 'rejected_before_accept'
              ? 'failed'
              : 'unknown',
        createdAt: now(),
      };
      this.storedAttempts.push(attempt);
      attemptChain.push(attempt);
      const usage: ProductUsage = {
        id: `model-usage-${hash(jobId).slice(0, 28)}`,
        status:
          response.kind === 'completed'
            ? 'committed'
            : response.errorCode === 'EMPTY_TEXT_DELIVERABLE'
              ? 'refunded'
            : response.acceptance === 'acceptance_unknown' ||
                response.acceptance === 'accepted'
              ? 'reserved'
              : response.acceptance === 'rejected_before_accept' &&
                  submission.selection.mode === 'auto' &&
                  snapshot.fallbackConsent === true &&
                  candidateIndex < candidates.length - 1
                ? 'reserved'
                : 'refunded',
        quantity: productUsageQuantity,
      };
      const providerCost: ProviderCost = {
        id: `provider-cost-${hash(
          `${attemptId}:${response.kind === 'completed' ? 'observed' : 'estimated'}`
        ).slice(0, 24)}`,
        status: response.kind === 'completed' ? 'observed' : 'estimated',
        ...response.providerCost,
      };
      providerCostChain.push(providerCost);

      if (response.kind === 'failure') {
        const failed: ModelSupplyResult = {
          jobId,
          operation: submission.operation,
          status: attempt.status === 'unknown' ? 'unknown' : 'failed',
          ...(submission.origin
            ? { origin: structuredClone(submission.origin) }
            : {}),
          ...(response.errorCode ? { failureCode: response.errorCode } : {}),
          snapshot,
          attempt,
          attempts: [...attemptChain],
          usage,
          providerCost,
          providerCosts: [...providerCostChain],
        };
        await this.ledger?.settleAttempt({
          submission,
          result: failed,
          evidence: response.errorCode
            ? `provider_response:${response.errorCode}`
            : 'provider_response',
        });
        if (
          response.acceptance !== 'rejected_before_accept' ||
          submission.selection.mode === 'fixed' ||
          snapshot.fallbackConsent !== true
        ) {
          await this.resultSink?.saveResult(submission.workspaceId, failed);
          if (failed.status !== 'failed') {
            this.idempotency.set(key, { canonical: payload, result: failed });
          }
          return failed;
        }
        lastFailure = failed;
        continue;
      }

      const asset =
        response.assetBytes && response.contentType
          ? await this.assetStorage.persistGeneratedAsset({
              workspaceId: submission.workspaceId,
              bytes: response.assetBytes,
              contentType: response.contentType,
              ...(response.providerTaskRef
                ? { sourceTaskRef: response.providerTaskRef }
                : {}),
            })
          : undefined;
      const result: ModelSupplyResult = {
        jobId,
        operation: submission.operation,
        status: 'completed',
        ...(submission.origin
          ? { origin: structuredClone(submission.origin) }
          : {}),
        snapshot,
        attempt,
        attempts: [...attemptChain],
        ...(asset ? { asset } : {}),
        ...(response.copyCandidates
          ? { copyCandidates: response.copyCandidates }
          : {}),
        ...(response.platformVariants
          ? { platformVariants: response.platformVariants }
          : {}),
        ...(response.text ? { text: response.text } : {}),
        usage,
        providerCost,
        providerCosts: [...providerCostChain],
      };
      await this.ledger?.settleAttempt({
        submission,
        result,
        evidence: 'provider_response',
      });
      await this.resultSink?.saveResult(submission.workspaceId, result);
      this.idempotency.set(key, { canonical: payload, result });
      return result;
    }

    if (lastFailure) {
      const failed = {
        ...lastFailure,
        attempts: [...attemptChain],
        providerCosts: [...providerCostChain],
      };
      await this.resultSink?.saveResult(submission.workspaceId, failed);
      return failed;
    }
    throw new Error('No candidate produced an execution result.');
  }

  /**
   * Monotonic late-outcome seam for a poll/webhook worker. It never invokes a
   * provider; it only advances an unknown attempt using new provider evidence.
   */
  async reconcileProviderResult(
    submission: ModelSupplySubmission,
    result: ModelSupplyResult,
    evidence = 'provider_reconciliation'
  ) {
    if (!this.ledger) {
      throw new Error(
        'Provider reconciliation requires the Foundation ledger.'
      );
    }
    const expectedJobId = `model-${hash(
      `${submission.workspaceId}:${submission.idempotencyKey}`
    ).slice(0, 32)}`;
    if (
      result.jobId !== expectedJobId ||
      result.attempt.jobId !== expectedJobId
    ) {
      throw new Error(
        'Reconciled provider result does not match the submission job.'
      );
    }
    await this.ledger.settleAttempt({ submission, result, evidence });
    await this.resultSink?.saveResult(submission.workspaceId, result);
    this.idempotency.set(
      `${submission.workspaceId}:${submission.idempotencyKey}`,
      { canonical: canonical(submission), result: structuredClone(result) }
    );
    return structuredClone(result);
  }

  /**
   * Persists a provider terminal fact that arrived after Product cancellation.
   * The cancelled attempt and refunded Product Usage remain terminal; only the
   * append-only provider cost/usage and isolated asset evidence advance.
   */
  async recordCancelledProviderTerminal(
    submission: ModelSupplySubmission,
    cancelled: ModelSupplyResult,
    reconciliation: CancelledMediaProviderTerminalReconciliation
  ) {
    const expectedJobId = `model-${hash(
      `${submission.workspaceId}:${submission.idempotencyKey}`
    ).slice(0, 32)}`;
    if (
      cancelled.jobId !== expectedJobId ||
      cancelled.attempt.jobId !== expectedJobId ||
      cancelled.status !== 'failed' ||
      cancelled.usage.status !== 'refunded' ||
      cancelled.attempt.providerTaskRef !== reconciliation.providerTaskRef
    ) {
      throw new Error(
        'Late provider terminal evidence must belong to the cancelled media attempt.'
      );
    }
    const providerCosts = cancelled.providerCosts.some(
      (cost) => cost.id === reconciliation.providerCost.id
    )
      ? structuredClone(cancelled.providerCosts)
      : [
          ...structuredClone(cancelled.providerCosts),
          structuredClone(reconciliation.providerCost),
        ];
    const result: ModelSupplyResult = {
      ...structuredClone(cancelled),
      providerCost: structuredClone(reconciliation.providerCost),
      providerCosts,
      cancelledProviderTerminal: structuredClone(reconciliation),
    };
    await this.ledger?.recordCancelledProviderTerminal?.({
      submission,
      result,
      reconciliation,
      evidence: `provider_late_${reconciliation.providerStatus}_after_cancel`,
    });
    await this.resultSink?.saveResult(submission.workspaceId, result);
    this.idempotency.set(
      `${submission.workspaceId}:${submission.idempotencyKey}`,
      { canonical: canonical(submission), result: structuredClone(result) }
    );
    return structuredClone(result);
  }

  recordQuality(event: QualityEvent) {
    const stored = {
      ...structuredClone(event),
      id: event.id ?? randomUUID(),
      createdAt: event.createdAt ?? now(),
    };
    this.qualityEvents.push(stored);
    return structuredClone(stored);
  }

  qualityNorthStar(): {
    status: 'unknown' | 'known';
    rate: number | undefined;
    sampleSize: number;
    minimumSampleSize: number;
  } {
    const adoptionEvents = this.qualityEvents.filter(
      (event) => event.outcome !== 'published'
    );
    if (adoptionEvents.length < QUALITY_NORTH_STAR_MIN_SAMPLE_SIZE) {
      return {
        status: 'unknown',
        rate: undefined,
        sampleSize: adoptionEvents.length,
        minimumSampleSize: QUALITY_NORTH_STAR_MIN_SAMPLE_SIZE,
      };
    }
    const accepted = adoptionEvents.filter(
      (event) =>
        event.outcome === 'adopted_directly' ||
        event.outcome === 'adopted_with_small_edit'
    ).length;
    return {
      status: 'known',
      rate: accepted / adoptionEvents.length,
      sampleSize: adoptionEvents.length,
      minimumSampleSize: QUALITY_NORTH_STAR_MIN_SAMPLE_SIZE,
    };
  }

  private resolveCandidates(
    submission: ModelSupplySubmission,
    catalog: {
      modelById: Map<string, CatalogModel>;
      deployments: ModelDeployment[];
    }
  ) {
    if (submission.frozenRouteSnapshot) {
      const frozen = submission.frozenRouteSnapshot;
      if (
        submission.selection.mode !== 'fixed' ||
        submission.selection.catalogModelId !== frozen.actualCatalogModelId
      ) {
        throw new Error(
          'Frozen RouteSnapshot conflicts with the requested fixed model.'
        );
      }
      if (
        JSON.stringify([...submission.dataClass].sort()) !==
        JSON.stringify([...frozen.dataClass].sort())
      ) {
        throw new Error(
          'Frozen RouteSnapshot conflicts with the requested data class.'
        );
      }
      const frozenCandidate = frozen.allowedCandidates?.find(
        (candidate) =>
          candidate.catalogModelId === frozen.actualCatalogModelId &&
          candidate.deploymentId === frozen.deploymentId
      );
      if (!frozenCandidate) {
        throw new Error(
          'Frozen RouteSnapshot is missing its execution candidate facts.'
        );
      }
      if (
        !frozenCandidate.apiFamily ||
        !frozenCandidate.channel ||
        !('modelModality' in frozenCandidate) ||
        !Array.isArray(frozenCandidate.modelOperations) ||
        !('modelDisplayName' in frozenCandidate) ||
        !('modelQualityRank' in frozenCandidate) ||
        !('modelManufacturer' in frozenCandidate) ||
        !('modelCapabilities' in frozenCandidate) ||
        !('deploymentStatus' in frozenCandidate) ||
        !('allowedDataClasses' in frozenCandidate) ||
        !('stableModelName' in frozenCandidate) ||
        !('modelVersion' in frozenCandidate)
      ) {
        throw new Error(
          'Frozen RouteSnapshot predates the complete execution contract.'
        );
      }
      const model: CatalogModel = {
        id: frozenCandidate.catalogModelId,
        modality: frozenCandidate.modelModality,
        operations: [...frozenCandidate.modelOperations],
        displayName: frozenCandidate.modelDisplayName,
        qualityRank: frozenCandidate.modelQualityRank,
        ...(frozenCandidate.modelManufacturer
          ? { manufacturer: frozenCandidate.modelManufacturer }
          : {}),
        stableModelName: frozenCandidate.stableModelName ?? undefined,
        version: frozenCandidate.modelVersion ?? undefined,
        ...(frozenCandidate.modelCapabilities
          ? { capabilities: [...frozenCandidate.modelCapabilities] }
          : {}),
      };
      const deployment: ModelDeployment = {
        id: frozenCandidate.deploymentId,
        catalogModelId: frozenCandidate.catalogModelId,
        ...(frozenCandidate.providerProfileId
          ? { providerProfileId: frozenCandidate.providerProfileId }
          : {}),
        ...(frozenCandidate.executionChannelId
          ? { executionChannelId: frozenCandidate.executionChannelId }
          : {}),
        ...(frozenCandidate.providerModel
          ? { providerModel: frozenCandidate.providerModel }
          : {}),
        ...(frozenCandidate.endpointRevision
          ? { endpointRevision: frozenCandidate.endpointRevision }
          : {}),
        ...(frozenCandidate.apiCounterparty
          ? { apiCounterparty: frozenCandidate.apiCounterparty }
          : {}),
        ...(frozenCandidate.credentialOwner
          ? { credentialOwner: frozenCandidate.credentialOwner }
          : {}),
        ...(frozenCandidate.deploymentLifecycleRevision
          ? {
              lifecycleRevision: frozenCandidate.deploymentLifecycleRevision,
            }
          : {}),
        apiFamily: frozenCandidate.apiFamily,
        channel: frozenCandidate.channel,
        region: frozenCandidate.region,
        status: frozenCandidate.deploymentStatus,
        ...(frozenCandidate.allowedDataClasses
          ? { allowedDataClasses: [...frozenCandidate.allowedDataClasses] }
          : {}),
        credentialMode: frozenCandidate.credentialMode,
        credentialVersion: frozenCandidate.credentialVersion,
        policyRevision: frozenCandidate.policyRevision,
        priceRevision: frozenCandidate.priceRevision,
        unitPrice: {
          amountMicros: frozenCandidate.unitPriceMicros,
          currency: frozenCandidate.currency,
          unit: frozenCandidate.unit,
        },
      };
      if (!model.operations.includes(submission.operation)) {
        throw new Error(
          'Frozen RouteSnapshot is not executable for this operation.'
        );
      }
      const currentDeployment = catalog.deployments.find(
        (candidate) => candidate.id === frozen.deploymentId
      );
      if (
        !deploymentAllowsDataClass(
          currentDeployment ?? deployment,
          submission.dataClass
        )
      ) {
        throw new Error(
          'Frozen RouteSnapshot violates the deployment data-class policy.'
        );
      }
      return [
        {
          model,
          deployment,
        },
      ];
    }
    const plan = planModelSupplyCandidates({
      catalog,
      operation: submission.operation,
      selection: submission.selection,
      dataClass: submission.dataClass,
    });
    if (submission.selection.mode === 'fixed') {
      if (!submission.selection.catalogModelId)
        throw new Error('Fixed selection requires catalogModelId.');
      const fixedOperationCandidates = catalog.deployments.filter(
        (deployment) => {
          const model = catalog.modelById.get(deployment.catalogModelId);
          return (
            model !== undefined &&
            model.id === submission.selection.catalogModelId &&
            deployment.status === 'active' &&
            model.operations.includes(submission.operation)
          );
        }
      );
      if (fixedOperationCandidates.length > 0 && plan.candidates.length === 0) {
        throw new Error(
          'The requested data class is not allowed by the deployment policy.'
        );
      }
      if (plan.candidates.length === 0)
        throw new Error(
          `Catalog model ${submission.selection.catalogModelId} is not active for this operation.`
        );
    }
    return plan.candidates;
  }

  private snapshotFor(
    submission: ModelSupplySubmission,
    candidates: Array<{ model: CatalogModel; deployment: ModelDeployment }>,
    selected: { model: CatalogModel; deployment: ModelDeployment },
    catalogRevisionId: string,
    fallback?: RouteSnapshot['reason']
  ): RouteSnapshot {
    if (submission.frozenRouteSnapshot) {
      if (
        submission.frozenRouteSnapshot.actualCatalogModelId !==
          selected.model.id ||
        submission.frozenRouteSnapshot.deploymentId !== selected.deployment.id
      ) {
        throw new Error(
          'Execution candidate conflicts with the frozen RouteSnapshot.'
        );
      }
      return structuredClone(submission.frozenRouteSnapshot);
    }
    return {
      id: `model-route-${hash(
        `${canonical(submission)}:${catalogRevisionId}:${selected.deployment.id}:${fallback ?? 'primary'}`
      ).slice(0, 28)}`,
      catalogRevisionId,
      requestedSelection: { ...submission.selection },
      candidateCatalogModelIds: [
        ...new Set(candidates.map(({ model }) => model.id)),
      ],
      actualCatalogModelId: selected.model.id,
      deploymentId: selected.deployment.id,
      policyRevision:
        selected.deployment.policyRevision ?? 'recorded-policy-v1',
      priceRevision: selected.deployment.priceRevision ?? 'recorded-price-v1',
      credentialMode: selected.deployment.credentialMode ?? 'platform',
      credentialVersion:
        selected.deployment.credentialVersion ?? 'recorded-credential-v1',
      ...(selected.deployment.providerProfileId
        ? { providerProfileId: selected.deployment.providerProfileId }
        : {}),
      ...(selected.deployment.executionChannelId
        ? { executionChannelId: selected.deployment.executionChannelId }
        : {}),
      ...(selected.deployment.providerModel
        ? { providerModel: selected.deployment.providerModel }
        : {}),
      ...(selected.deployment.endpointRevision
        ? { endpointRevision: selected.deployment.endpointRevision }
        : {}),
      ...(selected.deployment.apiCounterparty
        ? { apiCounterparty: selected.deployment.apiCounterparty }
        : {}),
      ...(selected.deployment.credentialOwner
        ? { credentialOwner: selected.deployment.credentialOwner }
        : {}),
      ...(selected.deployment.lifecycleRevision
        ? {
            deploymentLifecycleRevision: selected.deployment.lifecycleRevision,
          }
        : {}),
      fallbackConsent:
        submission.selection.fallbackConsent ??
        submission.selection.mode === 'auto',
      allowedCandidates: candidates.map(({ model, deployment }, index) => ({
        catalogModelId: model.id,
        deploymentId: deployment.id,
        modelModality: model.modality,
        modelOperations: [...model.operations],
        modelDisplayName: model.displayName,
        modelQualityRank: model.qualityRank,
        modelManufacturer: model.manufacturer ?? null,
        modelCapabilities: model.capabilities ? [...model.capabilities] : null,
        providerProfileId: deployment.providerProfileId ?? null,
        executionChannelId: deployment.executionChannelId ?? null,
        providerModel: deployment.providerModel ?? null,
        endpointRevision: deployment.endpointRevision ?? null,
        apiCounterparty: deployment.apiCounterparty ?? null,
        credentialOwner: deployment.credentialOwner ?? null,
        deploymentLifecycleRevision: deployment.lifecycleRevision ?? null,
        apiFamily: deployment.apiFamily,
        channel: deployment.channel,
        region: deployment.region,
        deploymentStatus: deployment.status,
        allowedDataClasses: deployment.allowedDataClasses
          ? [...deployment.allowedDataClasses]
          : null,
        stableModelName:
          deployment.providerModel ?? model.stableModelName ?? null,
        modelVersion: deployment.endpointRevision ?? model.version ?? null,
        credentialMode: deployment.credentialMode ?? 'platform',
        credentialVersion:
          deployment.credentialVersion ?? 'recorded-credential-v1',
        policyRevision: deployment.policyRevision ?? 'recorded-policy-v1',
        priceRevision: deployment.priceRevision ?? 'recorded-price-v1',
        unitPriceMicros: deployment.unitPrice?.amountMicros ?? 0,
        currency:
          deployment.unitPrice?.currency ??
          (deployment.region === 'domestic' ? 'CNY' : 'USD'),
        unit: deployment.unitPrice?.unit ?? 'request',
        fallbackRank: index + 1,
        ...(deployment.activationEvidence
          ? { activationStatus: deployment.activationEvidence.status }
          : {}),
      })),
      reason:
        fallback ??
        (submission.selection.mode === 'fixed'
          ? 'fixed_selection'
          : 'auto_quality_after_hard_filters'),
      dataClass: [...submission.dataClass].sort(),
      ...(submission.promptRevision
        ? { promptRevision: submission.promptRevision }
        : {}),
      ...(submission.exampleSetRevision
        ? { exampleSetRevision: submission.exampleSetRevision }
        : {}),
      createdAt: now(),
    };
  }

  private supportsRuntimeDeployment(deployment: ModelDeployment) {
    if (!this.runtimeCapabilities) return true;
    const capability = this.runtimeCapabilities.get(deployment.id);
    return Boolean(
      capability &&
      capability.catalogModelId === deployment.catalogModelId &&
      capability.apiFamily === deployment.apiFamily &&
      capability.channel === deployment.channel &&
      capability.region === deployment.region &&
      capability.executionChannelId === deployment.executionChannelId &&
      capability.providerModel === deployment.providerModel &&
      capability.endpointRevision === deployment.endpointRevision &&
      capability.lifecycleRevision === deployment.lifecycleRevision &&
      capability.credentialVersion === deployment.credentialVersion
    );
  }
}

function observeResponseChunks(response: Response, onChunk: () => void) {
  if (!response.body) return response;
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          controller.close();
          return;
        }
        onChunk();
        controller.enqueue(chunk.value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return new Response(body, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

export interface QualityEvent {
  id?: string;
  createdAt?: string;
  contentId?: string;
  outcome:
    | 'adopted_directly'
    | 'adopted_with_small_edit'
    | 'rerolled'
    | 'abandoned'
    | 'published';
  catalogModelId: string;
  promptRevision: string;
  exampleSetRevision: string;
  scenario: string;
  templateRevision?: string;
  editDistance?: number;
}

/**
 * Fixed, versioned offline contract for beauty-copy regression. It records
 * failures without changing the generated text; policy/quality interpretation
 * stays a separate human-calibrated concern.
 */
export interface BeautyOfflineEvaluationCase {
  id: string;
  revision: string;
  platform: 'xiaohongshu' | 'douyin';
  knownPrice?: number;
  requiredFacts?: string[];
  brandVoiceTerms?: string[];
  platformTerms?: string[];
  candidates: CopyCandidate[];
}

export interface BeautyOfflineEvaluationResult {
  caseId: string;
  revision: string;
  differentiated: boolean;
  priceIntegrity: boolean;
  factAccuracy: boolean;
  brandVoiceMatch: boolean;
  platformFit: boolean;
  conversationalNaturalness: boolean;
  dimensionScore: number;
  unsafeOrDeceptiveWarning: boolean;
  warnings: string[];
}

export function evaluateBeautyOfflineCase(
  evaluation: BeautyOfflineEvaluationCase
): BeautyOfflineEvaluationResult {
  const rendered = evaluation.candidates.map(
    (candidate) =>
      `${candidate.title}\n${candidate.body}\n${candidate.conversionHook}`
  );
  const differentiated = copyCandidateBodiesAreDistinct(evaluation.candidates);
  const prices = rendered.flatMap((value) =>
    [...value.matchAll(/(?:¥|￥)\s?(\d+(?:\.\d+)?)/g)].map((match) =>
      Number(match[1])
    )
  );
  const priceIntegrity =
    prices.length === 0 ||
    (evaluation.knownPrice !== undefined &&
      prices.every((price) => price === evaluation.knownPrice));
  const unsafeOrDeceptiveWarning = rendered.some((value) =>
    /保证|治愈|永久|最便宜/.test(value)
  );
  const factAccuracy =
    priceIntegrity &&
    (evaluation.requiredFacts ?? []).every((fact) =>
      rendered.some((value) => value.includes(fact))
    );
  const brandVoiceMatch = (evaluation.brandVoiceTerms ?? []).every((term) =>
    rendered.some((value) => value.includes(term))
  );
  const platformFit = (evaluation.platformTerms ?? []).every((term) =>
    rendered.some((value) => value.includes(term))
  );
  const conversationalNaturalness = rendered.every(
    (value) => !/作为(?:一个)?AI|根据您的需求|。{3,}|!{3,}|！{3,}/i.test(value)
  );
  const warnings = [
    ...(differentiated ? [] : ['candidates_not_differentiated']),
    ...(priceIntegrity ? [] : ['price_not_grounded']),
    ...(factAccuracy ? [] : ['required_fact_missing']),
    ...(brandVoiceMatch ? [] : ['brand_voice_mismatch']),
    ...(platformFit ? [] : ['platform_context_missing']),
    ...(conversationalNaturalness ? [] : ['unnatural_language']),
    ...(unsafeOrDeceptiveWarning ? ['unsafe_or_deceptive_language'] : []),
  ];
  return {
    caseId: evaluation.id,
    revision: evaluation.revision,
    differentiated,
    priceIntegrity,
    factAccuracy,
    brandVoiceMatch,
    platformFit,
    conversationalNaturalness,
    dimensionScore:
      [
        differentiated,
        priceIntegrity,
        factAccuracy,
        brandVoiceMatch,
        platformFit,
        conversationalNaturalness,
        !unsafeOrDeceptiveWarning,
      ].filter(Boolean).length / 7,
    unsafeOrDeceptiveWarning,
    warnings,
  };
}

export interface VideoCompositionPort {
  compose(input: {
    workspaceId: string;
    workflowId: string;
    compositionKey: string;
    clips: OwnedAsset[];
    aigcLabelEnabled: boolean;
    brandWatermarkText?: string;
  }): Promise<OwnedAsset>;
}

export class RecordedVideoCompositionPort implements VideoCompositionPort {
  async compose(input: {
    workspaceId: string;
    workflowId: string;
    compositionKey: string;
    clips: OwnedAsset[];
    aigcLabelEnabled: boolean;
    brandWatermarkText?: string;
  }): Promise<OwnedAsset> {
    const bytes = Buffer.from(
      `${input.clips.map((clip) => clip.sha256).join(':')}:aigc-label-${input.aigcLabelEnabled ? 'on' : 'off'}:watermark-${input.brandWatermarkText ?? 'off'}`
    );
    const sha256 = hash(bytes);
    return {
      id: `composition-${hash(Buffer.from(input.compositionKey)).slice(0, 24)}`,
      objectKey: `${input.workspaceId}/composed/${input.workflowId}-${sha256}.mp4`,
      sha256,
      sizeBytes: bytes.byteLength,
      contentType: 'video/mp4',
      technicalValidation: {
        playable: true,
        codec: 'h264',
        durationSeconds: input.clips.length * 15,
        width: 720,
        height: 1280,
        hashVerified: true,
        evidenceKind: 'recorded_synthetic',
      },
    };
  }
}

export interface VideoQualityDimensions {
  humanAnatomy: number;
  sourceConsistency: number;
  crossShotContinuity: number;
  subtitleOcclusion: number;
  publishRisk: number;
}

interface VideoQualityAssessmentBase {
  score: number;
  dimensions: VideoQualityDimensions;
  publishWarnings: string[];
  scorerRevision: string;
}

export type VideoQualityAssessment =
  | (VideoQualityAssessmentBase & {
      calibration: 'recorded_human_fixture';
      calibrationEvidence: {
        datasetRevision: string;
        sampleId: string;
        raterCount: number;
        annotatedAt: string;
        assetFingerprint: string;
        priorAssetFingerprints: string[];
        peerCandidateFingerprints: string[];
        subtitleEvidenceHash: string;
      };
    })
  | (VideoQualityAssessmentBase & {
      calibration: 'unscored_requires_human_review';
      calibrationEvidence?: never;
    });

export interface VideoQualityScoringPort {
  score(input: {
    workflowId: string;
    workspaceId: string;
    storyboardRevision: string;
    shotId: string;
    prompt: string;
    candidateIndex: number;
    asset: OwnedAsset;
    priorSelectedAssets: OwnedAsset[];
    peerCandidateAssets: OwnedAsset[];
    subtitleText: string;
  }): Promise<VideoQualityAssessment>;
}

/**
 * Versioned recorded scores stand in for a human-rated evaluation set. The
 * scorer deliberately does not read resolution or technical validation when
 * estimating aesthetic/brand quality.
 */
export const RECORDED_BEAUTY_VIDEO_CALIBRATION_SET_V1 = {
  revision: 'beauty-video-human-calibration-v1',
  samples: [
    {
      id: 'recorded-h264-beauty-sequence-001',
      assetFingerprints: ['0'.repeat(64)],
      raterCount: 4,
      annotatedAt: '2026-07-01T00:00:00.000Z',
      score: 0.78,
      dimensions: {
        humanAnatomy: 0.82,
        sourceConsistency: 0.8,
        crossShotContinuity: 0.78,
        subtitleOcclusion: 0.76,
        publishRisk: 0.74,
      },
      publishWarnings: ['review_subtitle_safe_area_before_publish'],
    },
  ],
} as const;

export class RecordedHumanCalibratedVideoQualityScorer implements VideoQualityScoringPort {
  async score(input: Parameters<VideoQualityScoringPort['score']>[0]) {
    const fixture = RECORDED_BEAUTY_VIDEO_CALIBRATION_SET_V1.samples.find(
      (sample) =>
        sample.assetFingerprints.some(
          (fingerprint) => fingerprint === input.asset.sha256
        )
    );
    if (!fixture) {
      return {
        score: 0.5,
        dimensions: {
          humanAnatomy: 0.5,
          sourceConsistency: 0.5,
          crossShotContinuity: 0.5,
          subtitleOcclusion: 0.5,
          publishRisk: 0.5,
        },
        publishWarnings: ['human_quality_review_required_before_publish'],
        scorerRevision: 'unscored-video-quality-v1',
        calibration: 'unscored_requires_human_review' as const,
      };
    }
    const fingerprint = input.asset.sha256.slice(0, 16);
    return {
      score: fixture.score,
      dimensions: { ...fixture.dimensions },
      publishWarnings: [...fixture.publishWarnings],
      scorerRevision: 'recorded-human-calibrated-beauty-video-v2',
      calibration: 'recorded_human_fixture' as const,
      calibrationEvidence: {
        datasetRevision: RECORDED_BEAUTY_VIDEO_CALIBRATION_SET_V1.revision,
        sampleId: fixture.id,
        raterCount: fixture.raterCount,
        annotatedAt: fixture.annotatedAt,
        assetFingerprint: fingerprint,
        priorAssetFingerprints: input.priorSelectedAssets.map((asset) =>
          asset.sha256.slice(0, 16)
        ),
        peerCandidateFingerprints: input.peerCandidateAssets.map((asset) =>
          asset.sha256.slice(0, 16)
        ),
        subtitleEvidenceHash: hash(input.subtitleText).slice(0, 16),
      },
    };
  }
}

export interface VideoWorkflowShotInput {
  id?: string;
  prompt: string;
  candidatesPerShot: number;
}

export interface DurableVideoCandidate {
  index: number;
  generationKey: string;
  prompt: string;
  status: 'generated' | 'completed' | 'unknown' | 'failed';
  attempt: ProviderAttempt;
  attempts: ProviderAttempt[];
  taskRef?: string;
  providerCost: ProviderCost;
  providerCosts: ProviderCost[];
  latencyMs: number;
  asset?: OwnedAsset;
  technicalValidation?: OwnedAsset['technicalValidation'];
  quality?: VideoQualityAssessment;
  failureCode?: string;
  selectionReason?: string;
  routeSnapshot: RouteSnapshot;
}

export interface DurableVideoShot {
  id: string;
  prompt: string;
  candidatesPerShot: number;
  candidates: DurableVideoCandidate[];
  selectedCandidateIndex?: number;
  selectionReason?: string;
  selectionAudit?: {
    selectedBy: string;
    correlationId: string;
    selectedAt: string;
    source: 'human_quality_review';
  };
}

export interface SelectVideoCandidateInput {
  workflowId: string;
  shotId: string;
  candidateIndex: number;
  workspaceId: string;
  actorId: string;
  correlationId: string;
}

export interface DurableVideoWorkflow {
  id: string;
  workspaceId: string;
  actorId: string;
  /** Missing only on workflows created before the Work-bound UI shipped. */
  workId?: string;
  derivedFromWorkflowId?: string;
  storyboardVersion: number;
  dataClass: DataClass[];
  aigcLabelEnabled: boolean;
  brandWatermarkText?: string;
  storyboardRevision: string;
  confirmed: boolean;
  catalogModelId: string;
  referenceAssetIds?: string[];
  shots: DurableVideoShot[];
  attempts: ProviderAttempt[];
  clipAssets: OwnedAsset[];
  status:
    | 'draft'
    | 'running'
    | 'awaiting_quality_review'
    | 'cancel_requested'
    | 'completed'
    | 'cancelled'
    | 'failed';
  failureCode?: string;
  composedAsset?: OwnedAsset & { qualityScore?: never };
  routeSnapshot?: RouteSnapshot;
  revision: number;
  cancelRequestedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateVideoWorkflowInput {
  workflowId?: string;
  workspaceId: string;
  actorId: string;
  workId?: string;
  derivedFromWorkflowId?: string;
  dataClass: DataClass[];
  aigcLabelEnabled?: boolean;
  brandWatermarkText?: string;
  storyboardRevision: string;
  catalogModelId: string;
  referenceAssetIds?: string[];
  shots: Array<string | VideoWorkflowShotInput>;
}

/** A production adapter persists this serializable state beside the JobPort. */
export interface DurableVideoWorkflowSaveOptions {
  expectedRevision?: number;
  runLeaseToken?: string;
  completeCancellation?: boolean;
}

export class VideoWorkflowConcurrencyError extends Error {
  readonly code = 'VIDEO_WORKFLOW_STALE_LEASE';
}

export class VideoWorkflowCancellationError extends Error {
  readonly code = 'VIDEO_WORKFLOW_CANCEL_REQUESTED';
}

export interface DurableVideoWorkflowStore {
  get(id: string): DurableVideoWorkflow | undefined;
  list(workspaceId: string, actorId: string): DurableVideoWorkflow[];
  findLatest(
    workspaceId: string,
    actorId: string,
    workId?: string
  ): DurableVideoWorkflow | undefined;
  save(
    workflow: DurableVideoWorkflow,
    options?: DurableVideoWorkflowSaveOptions
  ): DurableVideoWorkflow;
  claimRun(
    id: string,
    workspaceId: string,
    leaseToken: string
  ): DurableVideoWorkflow;
  requestCancel(
    id: string,
    workspaceId: string,
    requestedAt: string
  ): DurableVideoWorkflow;
  assertRunnable(
    id: string,
    workspaceId: string,
    revision: number,
    leaseToken: string
  ): void;
}

export class InMemoryDurableVideoWorkflowStore implements DurableVideoWorkflowStore {
  private readonly workflows = new Map<string, DurableVideoWorkflow>();
  private readonly runLeases = new Map<string, string>();

  get(id: string) {
    const workflow = this.workflows.get(id);
    return workflow ? structuredClone(workflow) : undefined;
  }

  list(workspaceId: string, actorId: string) {
    return [...this.workflows.values()]
      .filter(
        (workflow) =>
          workflow.workspaceId === workspaceId && workflow.actorId === actorId
      )
      .sort((left, right) => {
        const updated = right.updatedAt.localeCompare(left.updatedAt);
        return updated === 0 ? right.id.localeCompare(left.id) : updated;
      })
      .map((workflow) => structuredClone(workflow));
  }

  findLatest(workspaceId: string, actorId: string, workId?: string) {
    const workflow = [...this.workflows.values()]
      .filter(
        (candidate) =>
          candidate.workspaceId === workspaceId &&
          candidate.actorId === actorId &&
          (!workId || candidate.workId === workId)
      )
      .sort(
        workId
          ? compareVideoWorkflowWorkRecoveryPriority
          : compareVideoWorkflowRecoveryPriority
      )[0];
    return workflow ? structuredClone(workflow) : undefined;
  }

  restore(workflow: DurableVideoWorkflow) {
    const restored = normalizeStoredVideoWorkflow(workflow);
    this.workflows.set(restored.id, structuredClone(restored));
    return structuredClone(restored);
  }

  save(
    workflow: DurableVideoWorkflow,
    options: DurableVideoWorkflowSaveOptions = {}
  ) {
    const candidate = normalizeStoredVideoWorkflow(workflow);
    const current = this.workflows.get(candidate.id);
    if (!current) {
      if ((options.expectedRevision ?? candidate.revision) !== 0) {
        throw new VideoWorkflowConcurrencyError(
          'Video workflow creation used a stale revision.'
        );
      }
      this.workflows.set(candidate.id, structuredClone(candidate));
      return structuredClone(candidate);
    }
    const expectedRevision = options.expectedRevision ?? candidate.revision;
    assertVideoWorkflowMutationAllowed(
      current,
      candidate,
      expectedRevision,
      this.runLeases.get(candidate.id),
      options
    );
    if (isSameVideoWorkflow(current, candidate)) {
      return structuredClone(current);
    }
    const saved = {
      ...structuredClone(candidate),
      revision: current.revision + 1,
    };
    if (
      saved.status === 'completed' ||
      saved.status === 'cancelled' ||
      saved.status === 'failed' ||
      saved.status === 'awaiting_quality_review'
    ) {
      this.runLeases.delete(saved.id);
    }
    this.workflows.set(saved.id, structuredClone(saved));
    return structuredClone(saved);
  }

  claimRun(id: string, workspaceId: string, leaseToken: string) {
    const current = this.require(id, workspaceId);
    if (
      current.status === 'cancel_requested' ||
      current.status === 'cancelled'
    ) {
      throw new VideoWorkflowCancellationError(
        'Video workflow cancellation was requested.'
      );
    }
    if (current.status === 'completed' || current.status === 'failed') {
      return structuredClone(current);
    }
    if (!current.confirmed) {
      throw new Error(
        'Storyboard must be confirmed before clip attempts are created.'
      );
    }
    const claimed = {
      ...structuredClone(current),
      status: 'running' as const,
      revision: current.revision + 1,
    };
    this.runLeases.set(id, leaseToken);
    this.workflows.set(id, structuredClone(claimed));
    return structuredClone(claimed);
  }

  requestCancel(id: string, workspaceId: string, requestedAt: string) {
    const current = this.require(id, workspaceId);
    if (current.status === 'completed' || current.status === 'failed') {
      throw new Error('A terminal video workflow cannot be cancelled.');
    }
    if (
      current.status === 'cancel_requested' ||
      current.status === 'cancelled'
    ) {
      return structuredClone(current);
    }
    const requested: DurableVideoWorkflow = {
      ...structuredClone(current),
      status: 'cancel_requested',
      cancelRequestedAt: requestedAt,
      revision: current.revision + 1,
      updatedAt: requestedAt,
    };
    this.runLeases.delete(id);
    this.workflows.set(id, structuredClone(requested));
    return structuredClone(requested);
  }

  assertRunnable(
    id: string,
    workspaceId: string,
    revision: number,
    leaseToken: string
  ) {
    const current = this.require(id, workspaceId);
    assertVideoWorkflowRunnable(
      current,
      revision,
      this.runLeases.get(id),
      leaseToken
    );
  }

  private require(id: string, workspaceId: string) {
    const current = this.workflows.get(id);
    if (!current || current.workspaceId !== workspaceId) {
      throw new Error(`Unknown workflow ${id}.`);
    }
    return current;
  }
}

/** Thin, restart-safe business runner. A pg-boss JobPort can call it repeatedly. */
export class ContentWorkflowRunner {
  constructor(
    private readonly models: ModelSupplyApplicationService,
    private readonly composer: VideoCompositionPort = new RecordedVideoCompositionPort(),
    private readonly workflows: DurableVideoWorkflowStore = new InMemoryDurableVideoWorkflowStore(),
    private readonly qualityScorer: VideoQualityScoringPort = new RecordedHumanCalibratedVideoQualityScorer(),
    private readonly clock: () => number = () => Date.now()
  ) {}

  createVideoWorkflow(input: CreateVideoWorkflowInput) {
    const workflowId = input.workflowId ?? randomUUID();
    if (!workflowId.trim()) throw new Error('workflowId must not be empty.');
    const existing = this.workflows.get(workflowId);
    if (existing) {
      assertSameWorkflowDraft(existing, input);
      return structuredClone(existing);
    }
    const sourceWorkflow = input.derivedFromWorkflowId
      ? this.requireWorkflow(input.derivedFromWorkflowId, input.workspaceId)
      : undefined;
    if (sourceWorkflow) {
      if (sourceWorkflow.id === workflowId) {
        throw new Error('A storyboard version requires a new workflow id.');
      }
      if (
        sourceWorkflow.actorId !== input.actorId ||
        sourceWorkflow.workId !== input.workId
      ) {
        throw new Error(
          'A storyboard version must stay in the same actor and Work lineage.'
        );
      }
    }
    const timestamp = new Date(this.clock()).toISOString();
    const workflow: DurableVideoWorkflow = {
      id: workflowId,
      workspaceId: input.workspaceId,
      actorId: requireVideoWorkflowText(input.actorId, 'actorId'),
      ...(input.workId
        ? { workId: requireVideoWorkflowText(input.workId, 'workId') }
        : {}),
      ...(sourceWorkflow ? { derivedFromWorkflowId: sourceWorkflow.id } : {}),
      storyboardVersion: sourceWorkflow
        ? sourceWorkflow.storyboardVersion + 1
        : 1,
      dataClass: normalizeDataClass(input.dataClass),
      aigcLabelEnabled: input.aigcLabelEnabled === true,
      ...(input.brandWatermarkText?.trim()
        ? { brandWatermarkText: input.brandWatermarkText.trim() }
        : {}),
      storyboardRevision: input.storyboardRevision,
      confirmed: false,
      catalogModelId: input.catalogModelId,
      referenceAssetIds: normalizeReferenceAssetIds(input.referenceAssetIds),
      shots: normalizeVideoShots(input.shots),
      attempts: [],
      clipAssets: [],
      status: 'draft',
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    return this.workflows.save(workflow);
  }

  getVideoWorkflow(id: string, workspaceId?: string) {
    return structuredClone(this.requireWorkflow(id, workspaceId));
  }

  listVideoWorkflows(workspaceId: string, actorId: string) {
    return this.workflows.list(workspaceId, actorId);
  }

  findLatestVideoWorkflow(
    workspaceId: string,
    actorId: string,
    workId?: string
  ) {
    return this.workflows.findLatest(workspaceId, actorId, workId);
  }

  confirmVideoWorkflow(id: string, workspaceId?: string) {
    const workflow = this.requireWorkflow(id, workspaceId);
    if (
      workflow.status === 'cancel_requested' ||
      workflow.status === 'cancelled'
    ) {
      throw new VideoWorkflowCancellationError(
        'A cancelled video workflow cannot be confirmed.'
      );
    }
    const expectedRevision = workflow.revision;
    workflow.routeSnapshot ??= this.models.freezeFixedRoute({
      workspaceId: workflow.workspaceId,
      operation: 'video.generate',
      catalogModelId: workflow.catalogModelId,
      dataClass: workflow.dataClass,
      promptRevision: workflow.storyboardRevision,
    });
    workflow.confirmed = true;
    workflow.updatedAt = new Date(this.clock()).toISOString();
    return this.workflows.save(workflow, { expectedRevision });
  }

  selectVideoCandidate(input: SelectVideoCandidateInput) {
    const workflow = this.requireWorkflow(input.workflowId, input.workspaceId);
    if (workflow.status !== 'awaiting_quality_review') {
      throw new Error(
        'A video candidate can be selected only while quality review is pending.'
      );
    }
    const shotIndex = workflow.shots.findIndex(
      (shot) => shot.id === input.shotId
    );
    const shot = workflow.shots[shotIndex];
    if (!shot) throw new Error(`Unknown video shot ${input.shotId}.`);
    const candidate = shot.candidates.find(
      (value) => value.index === input.candidateIndex
    );
    if (
      !candidate?.asset ||
      candidate.status !== 'completed' ||
      candidate.technicalValidation?.playable !== true
    ) {
      throw new Error(
        `Candidate ${input.candidateIndex} for shot ${input.shotId} is not eligible for selection.`
      );
    }
    const expectedRevision = workflow.revision;
    const selectedAt = new Date(this.clock()).toISOString();
    shot.selectedCandidateIndex = candidate.index;
    shot.selectionReason = `Candidate ${candidate.index + 1} was explicitly selected during human quality review.`;
    shot.selectionAudit = {
      selectedBy: requireVideoWorkflowText(input.actorId, 'actorId'),
      correlationId: requireVideoWorkflowText(
        input.correlationId,
        'correlationId'
      ),
      selectedAt,
      source: 'human_quality_review',
    };
    for (const peer of shot.candidates) {
      peer.selectionReason =
        peer.index === candidate.index
          ? shot.selectionReason
          : 'Not selected during explicit human quality review.';
    }
    workflow.clipAssets[shotIndex] = structuredClone(candidate.asset);
    workflow.updatedAt = selectedAt;
    return this.workflows.save(workflow, { expectedRevision });
  }

  async runVideoWorkflow(id: string, workspaceId?: string) {
    const existing = this.requireWorkflow(id, workspaceId);
    if (
      existing.status === 'completed' ||
      existing.status === 'cancelled' ||
      existing.status === 'failed'
    ) {
      return structuredClone(existing);
    }
    const leaseToken = randomUUID();
    const workflow = this.workflows.claimRun(
      id,
      existing.workspaceId,
      leaseToken
    );
    return runDurableVideoWorkflow({
      workflow,
      models: this.models,
      composer: this.composer,
      qualityScorer: this.qualityScorer,
      clock: this.clock,
      guard: async (checkpoint) =>
        this.workflows.assertRunnable(
          checkpoint.id,
          checkpoint.workspaceId,
          checkpoint.revision,
          leaseToken
        ),
      checkpoint: async (checkpoint) =>
        this.workflows.save(checkpoint, { runLeaseToken: leaseToken }),
    });
  }

  requestVideoWorkflowCancel(id: string, workspaceId?: string) {
    const workflow = this.requireWorkflow(id, workspaceId);
    return this.workflows.requestCancel(
      id,
      workflow.workspaceId,
      new Date(this.clock()).toISOString()
    );
  }

  async cancelVideoWorkflow(id: string, workspaceId?: string) {
    const workflow = this.requestVideoWorkflowCancel(id, workspaceId);
    if (workflow.status === 'cancelled') return workflow;
    if (!(await cancelVideoWorkflowChildren(workflow, this.models))) {
      throw new VideoWorkflowCancellationError(
        'Video workflow child cancellation is still pending.'
      );
    }
    const expectedRevision = workflow.revision;
    workflow.status = 'cancelled';
    workflow.updatedAt = new Date(this.clock()).toISOString();
    return this.workflows.save(workflow, {
      completeCancellation: true,
      expectedRevision,
    });
  }

  private requireWorkflow(id: string, workspaceId?: string) {
    const workflow = this.workflows.get(id);
    if (!workflow) throw new Error(`Unknown workflow ${id}.`);
    if (workspaceId && workflow.workspaceId !== workspaceId) {
      throw new Error('Video workflow belongs to another workspace.');
    }
    return workflow;
  }
}

export function normalizeStoredVideoWorkflow(
  workflow: DurableVideoWorkflow
): DurableVideoWorkflow {
  return {
    ...structuredClone(workflow),
    referenceAssetIds: normalizeReferenceAssetIds(workflow.referenceAssetIds),
    storyboardVersion:
      Number.isInteger(workflow.storyboardVersion) &&
      workflow.storyboardVersion >= 1
        ? workflow.storyboardVersion
        : 1,
    revision:
      Number.isInteger(workflow.revision) && workflow.revision >= 0
        ? workflow.revision
        : 0,
  };
}

function isSameVideoWorkflow(
  left: DurableVideoWorkflow,
  right: DurableVideoWorkflow
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function assertVideoWorkflowMutationAllowed(
  current: DurableVideoWorkflow,
  candidate: DurableVideoWorkflow,
  expectedRevision: number,
  activeLeaseToken: string | undefined,
  options: DurableVideoWorkflowSaveOptions
) {
  if (
    current.workspaceId !== candidate.workspaceId ||
    current.id !== candidate.id
  ) {
    throw new VideoWorkflowConcurrencyError(
      'Video workflow identity changed during persistence.'
    );
  }
  if (current.status === 'completed' || current.status === 'failed') {
    if (isSameVideoWorkflow(current, candidate)) return;
    throw new VideoWorkflowConcurrencyError(
      'A terminal video workflow cannot be overwritten.'
    );
  }
  if (current.status === 'cancelled') {
    if (isSameVideoWorkflow(current, candidate)) return;
    throw new VideoWorkflowCancellationError(
      'Video workflow cancellation was requested.'
    );
  }
  if (current.status === 'cancel_requested') {
    if (
      !options.completeCancellation ||
      candidate.status !== 'cancelled' ||
      candidate.cancelRequestedAt !== current.cancelRequestedAt
    ) {
      throw new VideoWorkflowCancellationError(
        'Video workflow cancellation was requested.'
      );
    }
  } else if (options.completeCancellation) {
    throw new VideoWorkflowConcurrencyError(
      'Video workflow cancellation has not been requested.'
    );
  }
  if (current.revision !== expectedRevision) {
    throw new VideoWorkflowConcurrencyError(
      'Video workflow revision is stale.'
    );
  }
  if (options.runLeaseToken) {
    if (activeLeaseToken !== options.runLeaseToken) {
      throw new VideoWorkflowConcurrencyError(
        'Video workflow result belongs to a stale run lease.'
      );
    }
  } else if (current.status === 'running' && !options.completeCancellation) {
    throw new VideoWorkflowConcurrencyError(
      'A running video workflow requires its run lease.'
    );
  }
  if (candidate.status === 'completed' && !options.runLeaseToken) {
    throw new VideoWorkflowConcurrencyError(
      'Video workflow completion requires its run lease.'
    );
  }
}

export function assertVideoWorkflowRunnable(
  current: DurableVideoWorkflow,
  revision: number,
  activeLeaseToken: string | undefined,
  leaseToken: string
) {
  if (current.status === 'cancel_requested' || current.status === 'cancelled') {
    throw new VideoWorkflowCancellationError(
      'Video workflow cancellation was requested.'
    );
  }
  if (
    current.status !== 'running' ||
    current.revision !== revision ||
    activeLeaseToken !== leaseToken
  ) {
    throw new VideoWorkflowConcurrencyError(
      'Video workflow result belongs to a stale run lease.'
    );
  }
}

async function cancelVideoWorkflowChildren(
  workflow: DurableVideoWorkflow,
  models: ModelSupplyApplicationService
) {
  if (!models.hasDurableMediaRuntime()) return true;
  let settled = true;
  for (const shot of workflow.shots) {
    for (let index = 0; index < shot.candidatesPerShot; index += 1) {
      const candidate = shot.candidates.find((value) => value.index === index);
      if (candidate && candidate.status !== 'unknown') continue;
      const generationKey =
        candidate?.generationKey ??
        `${workflow.id}:shot:${shot.id}:candidate:${index}`;
      const jobId =
        candidate?.attempt.jobId ??
        modelSupplyJobIdForKey(workflow.workspaceId, generationKey);
      try {
        const child = await models.getDurableMediaJob(
          workflow.workspaceId,
          jobId
        );
        if (
          child.status === 'completed' ||
          child.status === 'failed' ||
          child.status === 'cancelled'
        ) {
          if (candidate && child.status === 'cancelled') {
            candidate.status = 'failed';
          }
          continue;
        }
        const cancellation = await models.cancelDurableMediaJob({
          actorId: workflow.actorId,
          jobId,
          workspaceId: workflow.workspaceId,
        });
        if (cancellation.status !== 'cancelled') {
          settled = false;
        } else if (candidate) {
          candidate.status = 'failed';
        }
      } catch (error) {
        if (!hasErrorCode(error, 'NOT_FOUND')) throw error;
      }
    }
  }
  return settled;
}

async function cancelUncheckpointedVideoChild(
  workflow: DurableVideoWorkflow,
  jobId: string,
  status: ModelSupplyResult['status'],
  models: ModelSupplyApplicationService
) {
  if (status === 'completed' || !models.hasDurableMediaRuntime()) {
    return;
  }
  await models
    .cancelDurableMediaJob({
      actorId: workflow.actorId,
      jobId,
      workspaceId: workflow.workspaceId,
    })
    .catch((error) => {
      if (!hasErrorCode(error, 'NOT_FOUND')) throw error;
    });
}

function hasErrorCode(error: unknown, code: string) {
  return Boolean(
    error && typeof error === 'object' && 'code' in error && error.code === code
  );
}

function compareVideoWorkflowRecoveryPriority(
  left: DurableVideoWorkflow,
  right: DurableVideoWorkflow
) {
  const leftTerminal =
    left.status === 'completed' ||
    left.status === 'cancelled' ||
    left.status === 'failed';
  const rightTerminal =
    right.status === 'completed' ||
    right.status === 'cancelled' ||
    right.status === 'failed';
  if (leftTerminal !== rightTerminal) return leftTerminal ? 1 : -1;
  const storyboardVersion = right.storyboardVersion - left.storyboardVersion;
  if (storyboardVersion !== 0) return storyboardVersion;
  const updated = right.updatedAt.localeCompare(left.updatedAt);
  return updated === 0 ? right.id.localeCompare(left.id) : updated;
}

function compareVideoWorkflowWorkRecoveryPriority(
  left: DurableVideoWorkflow,
  right: DurableVideoWorkflow
) {
  const storyboardVersion = right.storyboardVersion - left.storyboardVersion;
  return storyboardVersion === 0
    ? compareVideoWorkflowRecoveryPriority(left, right)
    : storyboardVersion;
}

export async function runDurableVideoWorkflow(input: {
  workflow: DurableVideoWorkflow;
  models: ModelSupplyApplicationService;
  composer: VideoCompositionPort;
  qualityScorer: VideoQualityScoringPort;
  guard?: (workflow: DurableVideoWorkflow) => Promise<void>;
  checkpoint: (workflow: DurableVideoWorkflow) => Promise<DurableVideoWorkflow>;
  clock?: () => number;
}) {
  const clock = input.clock ?? (() => Date.now());
  const workflow = input.workflow;
  if (!workflow.confirmed) {
    throw new Error(
      'Storyboard must be confirmed before clip attempts are created.'
    );
  }
  if (
    workflow.status === 'completed' ||
    workflow.status === 'cancelled' ||
    workflow.status === 'failed'
  ) {
    return structuredClone(workflow);
  }
  workflow.status = 'running';
  await saveWorkflowCheckpoint(workflow, input.checkpoint, input.guard, clock);

  for (const [shotIndex, shot] of workflow.shots.entries()) {
    for (
      let candidateIndex = 0;
      candidateIndex < shot.candidatesPerShot;
      candidateIndex += 1
    ) {
      let candidate = shot.candidates.find(
        (value) => value.index === candidateIndex
      );
      if (!candidate) {
        const startedAt = clock();
        const generationKey = `${workflow.id}:shot:${shot.id}:candidate:${candidateIndex}`;
        await guardVideoWorkflowRun(workflow, input.guard);
        const result = await input.models.submit({
          workspaceId: workflow.workspaceId,
          actorId: workflow.actorId,
          correlationId: `video-workflow:${workflow.id}`,
          idempotencyKey: generationKey,
          operation: 'video.generate',
          selection: { mode: 'fixed', catalogModelId: workflow.catalogModelId },
          dataClass: workflow.dataClass,
          ...(workflow.referenceAssetIds?.length
            ? { input: { referenceAssetIds: [...workflow.referenceAssetIds] } }
            : {}),
          prompt: `${shot.prompt}\nCandidate ${candidateIndex + 1} of ${shot.candidatesPerShot}.`,
          frozenRouteSnapshot: workflow.routeSnapshot,
        });
        candidate = {
          index: candidateIndex,
          generationKey,
          prompt: shot.prompt,
          status:
            result.status === 'completed'
              ? 'generated'
              : result.status === 'unknown'
                ? 'unknown'
                : 'failed',
          attempt: structuredClone(result.attempt),
          attempts: structuredClone(result.attempts),
          ...(result.attempt.providerTaskRef
            ? { taskRef: result.attempt.providerTaskRef }
            : {}),
          providerCost: structuredClone(result.providerCost),
          providerCosts: structuredClone(result.providerCosts),
          ...(result.failureCode ? { failureCode: result.failureCode } : {}),
          routeSnapshot: structuredClone(result.snapshot),
          latencyMs: Math.max(0, clock() - startedAt),
          ...(result.asset
            ? {
                asset: structuredClone(result.asset),
                technicalValidation: result.asset.technicalValidation
                  ? structuredClone(result.asset.technicalValidation)
                  : undefined,
              }
            : {}),
        };
        shot.candidates.push(candidate);
        for (const attempt of result.attempts) {
          if (
            !workflow.attempts.some((existing) => existing.id === attempt.id)
          ) {
            workflow.attempts.push(structuredClone(attempt));
          }
        }
        try {
          await saveWorkflowCheckpoint(
            workflow,
            input.checkpoint,
            input.guard,
            clock
          );
        } catch (error) {
          if (error instanceof VideoWorkflowCancellationError) {
            await cancelUncheckpointedVideoChild(
              workflow,
              result.jobId,
              result.status,
              input.models
            );
          }
          throw error;
        }
      }

      if (candidate.status === 'unknown') {
        await guardVideoWorkflowRun(workflow, input.guard);
        const recoverySubmission: ModelSupplySubmission = {
          workspaceId: workflow.workspaceId,
          actorId: workflow.actorId,
          correlationId: `video-workflow:${workflow.id}`,
          idempotencyKey: candidate.generationKey,
          operation: 'video.generate',
          selection: {
            mode: 'fixed',
            catalogModelId: workflow.catalogModelId,
          },
          dataClass: workflow.dataClass,
          ...(workflow.referenceAssetIds?.length
            ? { input: { referenceAssetIds: [...workflow.referenceAssetIds] } }
            : {}),
          prompt: `${shot.prompt}\nCandidate ${candidateIndex + 1} of ${shot.candidatesPerShot}.`,
          frozenRouteSnapshot: workflow.routeSnapshot,
        };
        let recovered: ModelSupplyResult;
        let providerLifecycleLatencyMs: number | undefined;
        if (input.models.hasDurableMediaRuntime()) {
          try {
            const child = await input.models.getDurableMediaJob(
              workflow.workspaceId,
              candidate.attempt.jobId
            );
            recovered = child.result;
            providerLifecycleLatencyMs = child.providerLifecycleLatencyMs;
          } catch (error) {
            if (!hasErrorCode(error, 'NOT_FOUND')) throw error;
            recovered = await input.models.submit(recoverySubmission);
          }
        } else {
          recovered = await input.models.submit(recoverySubmission);
        }
        candidate.status =
          recovered.status === 'completed'
            ? 'generated'
            : recovered.status === 'failed'
              ? 'failed'
              : 'unknown';
        candidate.attempt = structuredClone(recovered.attempt);
        candidate.attempts = structuredClone(recovered.attempts);
        candidate.providerCost = structuredClone(recovered.providerCost);
        candidate.providerCosts = structuredClone(recovered.providerCosts);
        candidate.failureCode = recovered.failureCode;
        if (providerLifecycleLatencyMs !== undefined) {
          candidate.latencyMs = providerLifecycleLatencyMs;
        }
        if (recovered.attempt.providerTaskRef) {
          candidate.taskRef = recovered.attempt.providerTaskRef;
        }
        if (recovered.asset) {
          candidate.asset = structuredClone(recovered.asset);
          candidate.technicalValidation = recovered.asset.technicalValidation
            ? structuredClone(recovered.asset.technicalValidation)
            : undefined;
        }
        await saveWorkflowCheckpoint(
          workflow,
          input.checkpoint,
          input.guard,
          clock
        );
      }

      if (candidate.status === 'unknown') {
        throw new Error(
          `Candidate ${candidateIndex} for shot ${shot.id} has unknown provider acceptance; reconcile it before retrying.`
        );
      }
      if (candidate.status === 'failed' || !candidate.asset) {
        workflow.status = 'failed';
        workflow.failureCode =
          candidate.failureCode ??
          (candidate.status === 'failed'
            ? 'VIDEO_CANDIDATE_FAILED'
            : 'MISSING_VIDEO_CANDIDATE_ASSET');
        await saveWorkflowCheckpoint(
          workflow,
          input.checkpoint,
          input.guard,
          clock
        );
        return structuredClone(workflow);
      }
      if (!candidate.quality) {
        await guardVideoWorkflowRun(workflow, input.guard);
        const assessment = await input.qualityScorer.score({
          workflowId: workflow.id,
          workspaceId: workflow.workspaceId,
          storyboardRevision: workflow.storyboardRevision,
          shotId: shot.id,
          prompt: shot.prompt,
          candidateIndex,
          asset: structuredClone(candidate.asset),
          priorSelectedAssets: structuredClone(workflow.clipAssets),
          peerCandidateAssets: shot.candidates.flatMap((peer) =>
            peer.asset && peer.index !== candidateIndex
              ? [structuredClone(peer.asset)]
              : []
          ),
          subtitleText: shot.prompt,
        });
        try {
          candidate.quality = validateVideoQualityAssessment(assessment);
        } catch {
          return failDurableVideoWorkflow(
            workflow,
            'VIDEO_QUALITY_SCORING_FAILED',
            input,
            clock
          );
        }
        candidate.status = 'completed';
        await saveWorkflowCheckpoint(
          workflow,
          input.checkpoint,
          input.guard,
          clock
        );
      }
    }

    if (!workflow.clipAssets[shotIndex]) {
      const eligible = shot.candidates
        .filter(
          (
            candidate
          ): candidate is DurableVideoCandidate & {
            asset: OwnedAsset;
            quality: VideoQualityAssessment;
          } =>
            candidate.status === 'completed' &&
            Boolean(candidate.asset) &&
            Boolean(candidate.quality) &&
            candidate.technicalValidation?.playable === true
        )
        .sort(
          (left, right) =>
            right.quality.score - left.quality.score || left.index - right.index
        );
      if (eligible.length === 0) {
        return failDurableVideoWorkflow(
          workflow,
          'NO_PLAYABLE_VIDEO_CANDIDATE',
          input,
          clock
        );
      }
      const allHumanCalibrated = eligible.every(
        (candidate) =>
          candidate.quality.calibration === 'recorded_human_fixture'
      );
      const topScoreIsUnique =
        eligible.length === 1 ||
        eligible[0]!.quality.score > eligible[1]!.quality.score;
      if (eligible.length > 1 && (!allHumanCalibrated || !topScoreIsUnique)) {
        shot.selectionReason = allHumanCalibrated
          ? 'Human-calibrated candidates are tied; explicit quality review is required.'
          : 'Candidate quality is not human-calibrated; explicit quality review is required.';
        for (const candidate of shot.candidates) {
          candidate.selectionReason = shot.selectionReason;
        }
        workflow.status = 'awaiting_quality_review';
        await saveWorkflowCheckpoint(
          workflow,
          input.checkpoint,
          input.guard,
          clock
        );
        return structuredClone(workflow);
      }
      const selected = eligible[0]!;
      shot.selectedCandidateIndex = selected.index;
      shot.selectionReason =
        selected.quality.calibration === 'recorded_human_fixture'
          ? `Candidate ${selected.index + 1} had the highest human-calibrated quality score among technically valid candidates.`
          : `Candidate ${selected.index + 1} had the highest provisional score; human quality review is required before publish.`;
      for (const candidate of shot.candidates) {
        candidate.selectionReason =
          candidate.index === selected.index
            ? shot.selectionReason
            : selected.quality.calibration === 'recorded_human_fixture'
              ? 'Not selected because another technically valid candidate had a higher human-calibrated quality score.'
              : 'Not selected because another technically valid candidate had a higher provisional score.';
      }
      workflow.clipAssets[shotIndex] = structuredClone(selected.asset);
      await saveWorkflowCheckpoint(
        workflow,
        input.checkpoint,
        input.guard,
        clock
      );
    }
  }

  if (!workflow.composedAsset) {
    const compositionKey = videoCompositionKey(workflow);
    await guardVideoWorkflowRun(workflow, input.guard);
    const composedAsset = await input.composer.compose({
      workspaceId: workflow.workspaceId,
      workflowId: workflow.id,
      compositionKey,
      clips: workflow.clipAssets,
      aigcLabelEnabled: workflow.aigcLabelEnabled,
      ...(workflow.brandWatermarkText
        ? { brandWatermarkText: workflow.brandWatermarkText }
        : {}),
    });
    if (!hasValidComposedVideoTechnicalEvidence(composedAsset)) {
      return failDurableVideoWorkflow(
        workflow,
        'COMPOSED_VIDEO_TECHNICAL_VALIDATION_FAILED',
        input,
        clock
      );
    }
    workflow.composedAsset = composedAsset;
    await saveWorkflowCheckpoint(
      workflow,
      input.checkpoint,
      input.guard,
      clock
    );
  }
  workflow.status = 'completed';
  await saveWorkflowCheckpoint(workflow, input.checkpoint, input.guard, clock);
  return structuredClone(workflow);
}

async function failDurableVideoWorkflow(
  workflow: DurableVideoWorkflow,
  failureCode: string,
  input: Pick<
    Parameters<typeof runDurableVideoWorkflow>[0],
    'checkpoint' | 'guard'
  >,
  clock: () => number
) {
  workflow.status = 'failed';
  workflow.failureCode = failureCode;
  workflow.composedAsset = undefined;
  await saveWorkflowCheckpoint(workflow, input.checkpoint, input.guard, clock);
  return structuredClone(workflow);
}

function hasValidComposedVideoTechnicalEvidence(
  asset: unknown
): asset is OwnedAsset {
  if (!asset || typeof asset !== 'object') return false;
  const candidate = asset as Partial<OwnedAsset>;
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.objectKey !== 'string' ||
    typeof candidate.sha256 !== 'string' ||
    typeof candidate.sizeBytes !== 'number'
  ) {
    return false;
  }
  const validation = candidate.technicalValidation;
  return (
    candidate.contentType === 'video/mp4' &&
    candidate.id.trim().length > 0 &&
    candidate.objectKey.trim().length > 0 &&
    /^[a-f0-9]{64}$/i.test(candidate.sha256) &&
    Number.isFinite(candidate.sizeBytes) &&
    candidate.sizeBytes > 0 &&
    validation?.playable === true &&
    validation.codec === 'h264' &&
    Number.isFinite(validation.durationSeconds) &&
    validation.durationSeconds > 0 &&
    Number.isFinite(validation.width) &&
    (validation.width ?? 0) > 0 &&
    Number.isFinite(validation.height) &&
    (validation.height ?? 0) > 0 &&
    validation.hashVerified === true &&
    (validation.evidenceKind === 'measured' ||
      validation.evidenceKind === 'recorded_synthetic')
  );
}

function normalizeVideoShots(
  shots: CreateVideoWorkflowInput['shots']
): DurableVideoShot[] {
  if (shots.length === 0)
    throw new Error('A composed video requires at least one shot.');
  const normalizedShots = shots.map((shot, index) => {
    const normalized =
      typeof shot === 'string'
        ? { id: `shot-${index + 1}`, prompt: shot, candidatesPerShot: 1 }
        : {
            id: shot.id ?? `shot-${index + 1}`,
            prompt: shot.prompt,
            candidatesPerShot: shot.candidatesPerShot,
          };
    if (!normalized.id.trim() || !normalized.prompt.trim()) {
      throw new Error('Every video shot requires a non-empty id and prompt.');
    }
    if (
      !Number.isInteger(normalized.candidatesPerShot) ||
      normalized.candidatesPerShot < 1 ||
      normalized.candidatesPerShot > 8
    ) {
      throw new Error('candidatesPerShot must be an integer from 1 through 8.');
    }
    return { ...normalized, candidates: [] };
  });
  if (
    new Set(normalizedShots.map((shot) => shot.id)).size !==
    normalizedShots.length
  ) {
    throw new Error('Video shot ids must be unique within a workflow.');
  }
  return normalizedShots;
}

function validateVideoQualityAssessment(
  value: VideoQualityAssessment
): VideoQualityAssessment {
  const measurements = [value.score, ...Object.values(value.dimensions)];
  if (
    measurements.some(
      (measurement) =>
        !Number.isFinite(measurement) || measurement < 0 || measurement > 1
    ) ||
    !value.scorerRevision.trim() ||
    !Array.isArray(value.publishWarnings) ||
    value.publishWarnings.some(
      (warning) => typeof warning !== 'string' || !warning.trim()
    ) ||
    !['recorded_human_fixture', 'unscored_requires_human_review'].includes(
      value.calibration
    )
  ) {
    throw new Error('Video quality scorer returned an invalid assessment.');
  }
  if (
    value.calibration === 'recorded_human_fixture' &&
    (!value.calibrationEvidence.datasetRevision.trim() ||
      !value.calibrationEvidence.sampleId.trim() ||
      value.calibrationEvidence.raterCount < 1 ||
      !Number.isFinite(Date.parse(value.calibrationEvidence.annotatedAt)) ||
      !/^[a-f0-9]{16}$/i.test(value.calibrationEvidence.assetFingerprint) ||
      value.calibrationEvidence.priorAssetFingerprints.some(
        (fingerprint) => !/^[a-f0-9]{16}$/i.test(fingerprint)
      ) ||
      value.calibrationEvidence.peerCandidateFingerprints.some(
        (fingerprint) => !/^[a-f0-9]{16}$/i.test(fingerprint)
      ) ||
      !/^[a-f0-9]{16}$/i.test(value.calibrationEvidence.subtitleEvidenceHash))
  ) {
    throw new Error('Video quality calibration evidence is invalid.');
  }
  return structuredClone(value);
}

function assertSameWorkflowDraft(
  existing: DurableVideoWorkflow,
  input: CreateVideoWorkflowInput
) {
  const requested = {
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    workId: input.workId,
    derivedFromWorkflowId: input.derivedFromWorkflowId,
    dataClass: normalizeDataClass(input.dataClass),
    aigcLabelEnabled: input.aigcLabelEnabled === true,
    brandWatermarkText: input.brandWatermarkText?.trim() || undefined,
    storyboardRevision: input.storyboardRevision,
    catalogModelId: input.catalogModelId,
    referenceAssetIds: normalizeReferenceAssetIds(input.referenceAssetIds),
    shots: normalizeVideoShots(input.shots).map(
      ({ candidates: _candidates, ...shot }) => shot
    ),
  };
  const stored = {
    workspaceId: existing.workspaceId,
    actorId: existing.actorId,
    workId: existing.workId,
    derivedFromWorkflowId: existing.derivedFromWorkflowId,
    dataClass: existing.dataClass,
    aigcLabelEnabled: existing.aigcLabelEnabled,
    brandWatermarkText: existing.brandWatermarkText,
    storyboardRevision: existing.storyboardRevision,
    catalogModelId: existing.catalogModelId,
    referenceAssetIds: normalizeReferenceAssetIds(existing.referenceAssetIds),
    shots: existing.shots.map(
      ({
        candidates: _candidates,
        selectedCandidateIndex: _selected,
        selectionReason: _reason,
        selectionAudit: _audit,
        ...shot
      }) => shot
    ),
  };
  if (JSON.stringify(stored) !== JSON.stringify(requested)) {
    throw new Error(
      'Video workflow id was reused with a different draft payload.'
    );
  }
}

function normalizeDataClass(dataClass: DataClass[]) {
  const normalized = [...new Set(dataClass)].sort();
  if (
    normalized.some(
      (value) => !['contains_face', 'pii', 'medical'].includes(value)
    )
  ) {
    throw new Error('Video workflow dataClass contains an unsupported value.');
  }
  return normalized;
}

function normalizeReferenceAssetIds(assetIds: string[] | undefined) {
  if (!assetIds) return [];
  if (assetIds.some((assetId) => !assetId.trim())) {
    throw new Error('referenceAssetIds must contain only non-empty ids.');
  }
  return [...new Set(assetIds)].sort();
}

function requireVideoWorkflowText(value: string, key: string) {
  if (!value.trim()) throw new Error(`${key} is required.`);
  return value;
}

function videoCompositionKey(workflow: DurableVideoWorkflow) {
  return hash(
    Buffer.from(
      JSON.stringify({
        workflowId: workflow.id,
        clips: workflow.clipAssets.map(({ id, sha256 }) => ({ id, sha256 })),
        aigcLabelEnabled: workflow.aigcLabelEnabled,
        brandWatermarkText: workflow.brandWatermarkText,
      })
    )
  );
}

async function saveWorkflowCheckpoint(
  workflow: DurableVideoWorkflow,
  checkpoint: (workflow: DurableVideoWorkflow) => Promise<DurableVideoWorkflow>,
  guard: ((workflow: DurableVideoWorkflow) => Promise<void>) | undefined,
  clock: () => number
) {
  await guardVideoWorkflowRun(workflow, guard);
  workflow.updatedAt = new Date(clock()).toISOString();
  const saved = await checkpoint(structuredClone(workflow));
  workflow.revision = saved.revision;
  workflow.updatedAt = saved.updatedAt;
  workflow.status = saved.status;
}

async function guardVideoWorkflowRun(
  workflow: DurableVideoWorkflow,
  guard: ((workflow: DurableVideoWorkflow) => Promise<void>) | undefined
) {
  if (
    workflow.status === 'cancel_requested' ||
    workflow.status === 'cancelled'
  ) {
    throw new VideoWorkflowCancellationError(
      'Video workflow cancellation was requested.'
    );
  }
  await guard?.(structuredClone(workflow));
}

/** Bridge for the existing synchronous copy command; wiring is intentionally outside this module. */
export class ModelSupplyCopyProvider {
  constructor(private readonly service: ModelSupplyApplicationService) {}

  async generate(input: Omit<ModelSupplySubmission, 'operation'>) {
    const result = await this.service.submit({
      ...input,
      operation: 'copy.generate',
    });
    if (result.status !== 'completed' || !result.copyCandidates) {
      throw new Error(
        `Copy generation is ${result.status}; no candidates are available.`
      );
    }
    return result.copyCandidates;
  }
}

export * from './adapters.js';
export * from './activation-probe-executor.js';
export * from './ai-sdk-runner.js';
export * from './catalog.js';
export * from './composed-video-workflow.js';
export * from './composition-runtime.js';
export * from './copy-provider-bridge.js';
export * from './duration-estimate.js';
export * from './ffmpeg-composition-port.js';
export * from './foundation-ledger.js';
export * from './foundation-module.js';
export * from './filesystem-asset-storage.js';
export * from './media-generation-workflow.js';
export * from './media-tool-paths.js';
export * from './postgres-repository.js';
export * from './reference-asset-resolver.js';
export * from './runtime-config.js';
export * from './tuzi-media-adapter.js';
export * from './volcengine-tts-adapter.js';
export * from './volcengine-tts-lifecycle.js';
export * from './volcengine-tts-node-socket.js';
export * from './volcengine-tts-protocol.js';
