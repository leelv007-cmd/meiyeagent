import { createHash, randomUUID } from 'node:crypto';
import {
  MODEL_CAPABILITY_VOCABULARY_VERSION,
  type ModelCapabilityProfile,
  type GeneratedCopyCandidateContent,
  type GeneratedPlatformVariants,
  type HealthOverlayPort,
  type VideoCompositionEvidence,
} from '@meiye/contracts';
import { toJSONSchema, type ZodType } from 'zod';
import { recordedH264Video } from './recorded-media-adapters.js';
import type { AiStreamingRunner } from './ai-sdk-runner.js';
import type {
  ReferenceAssetResolverPort,
  ResolvedReferenceAsset,
} from './reference-asset-resolver.js';
import {
  ExecutionAttemptBudgetExceeded,
  parseRecoveredStructuredExecutionContinuation,
  parseRecoveredStructuredExecutionRequestFingerprint,
  structuredExecutionRequestFingerprint,
  type StructuredExecutionContinuation,
} from './execution-attempt-budget.js';
import {
  ownedAssetRegistrationLifecycle,
  type OwnedAssetRegistrationFailureStage,
} from './owned-asset-registration-lifecycle.js';
import { withServerDerivedReferenceDataClass } from './reference-asset-dispatch-guard.js';

const EXECUTION_ATTEMPT_BUDGET_SUSPENSION_CODE =
  'EXECUTION_ATTEMPT_BUDGET_SUSPENDED_BEFORE_PROVIDER';

// S2a: behavior-preserving extracts (re-export for existing import paths)
export {
  MODEL_MODALITIES,
  type ModelModality,
  MODEL_OPERATIONS,
  type ModelOperation,
  type DataClass,
  CANVAS_GENERATION_PARAMETER_NAMES,
  type CanvasGenerationParameterName,
  CANVAS_GENERATION_INPUT_ASSET_ROLES,
  type CanvasGenerationInputAssetRole,
  type CanvasGenerationInputAsset,
  type CanvasGenerationInputNodeBinding,
  type AdvancedCanvasGenerationOrigin,
  type AdvancedCanvasGenerationOriginRef,
  type CanvasGenerationCapability,
  type DeploymentStatus,
  type Acceptance,
  QUALITY_NORTH_STAR_MIN_SAMPLE_SIZE,
  type CatalogModel,
  type ModelDeployment,
  type RuntimeDeploymentCapability,
  AUDIO_ASSET_FORMATS,
  OWNED_ASSET_CONTENT_TYPES,
  type OwnedAsset,
  type CustodyOwnedAssetContentType,
  type PersistedCustodyOwnedAsset,
} from './supply-contracts.js';
export {
  assertModelSupplyPromptBinding,
  LANGUAGE_MODEL_PROMPT_KEY_BY_OPERATION,
  LANGUAGE_MODEL_PROMPT_NAME_BY_OPERATION,
  type RequestedSelection,
  type LanguageModelOperation,
  type ModelSupplyPromptBinding,
  type ModelSupplyPromptAuditPort,
  type ModelSupplyPromptFallbackAuditEvent,
  type ModelSupplyPromptReference,
  type ModelSupplyPromptResolver,
  type ModelSupplySubmission,
  type RouteSimulationFailureScenario,
  type RouteCandidateExclusionReason,
  type RouteCandidateCostEstimate,
  type RouteCandidateEvaluation,
  type ModelSupplyRouteSimulationInput,
  type ModelSupplyRouteSimulation,
  type RouteSnapshot,
  type ProviderAttempt,
} from './route-contracts.js';
export {
  type ProductUsage,
  type ProviderCost,
  type CancelledMediaProviderTerminalReconciliation,
  type CopyCandidate,
  copyCandidateBodiesAreDistinct,
  type ModelSupplyResult,
  type DurableMediaGenerationJobView,
  type CancelledMediaProviderTerminalOutcome,
  type DurableMediaGenerationRuntimePort,
  type ModelSupplyResultSink,
  type ModelSupplyLedgerCheckpointInput,
  type ModelSupplyLedgerPort,
} from './ledger-contracts.js';
export {
  type AdapterRuntimeConfig,
  type ProviderExecutionRequest,
  type ProviderExecutionResponse,
  type ProviderExecutionPort,
  type ProviderRuntimeBinding,
  type StructuredObjectExecutor,
  type MediaProviderEffectRequest,
  type MediaProviderSubmissionReceipt,
  type MediaProviderLifecyclePort,
  type MediaProviderHealthState,
  type MediaProviderHealthReport,
  type MediaProviderDrainMode,
  type MediaProviderReceiptStore,
  StructuredObjectGenerationError,
  type StructuredObjectMeasurement,
} from './provider-lifecycle.js';
export {
  deploymentAllowsDataClass,
  planModelSupplyCandidates,
} from './route-planning.js';

import {
  QUALITY_NORTH_STAR_MIN_SAMPLE_SIZE,
  type Acceptance,
  type CatalogModel,
  type CustodyOwnedAssetContentType,
  type DataClass,
  type ModelDeployment,
  type ModelOperation,
  type OwnedAsset,
  type PersistedCustodyOwnedAsset,
  type RuntimeDeploymentCapability,
} from './supply-contracts.js';
import type {
  LanguageModelOperation,
  ModelSupplyPromptAuditPort,
  ModelSupplyPromptResolver,
  ModelSupplyRouteSimulation,
  ModelSupplyRouteSimulationInput,
  ModelSupplySubmission,
  ProviderAttempt,
  RequestedSelection,
  RouteCandidateCostEstimate,
  RouteCandidateEvaluation,
  RouteSnapshot,
} from './route-contracts.js';
import {
  assertModelSupplyPromptBinding,
  LANGUAGE_MODEL_PROMPT_KEY_BY_OPERATION,
  LANGUAGE_MODEL_PROMPT_NAME_BY_OPERATION,
  promptFallbackAuditId,
} from './route-contracts.js';
import {
  copyCandidateBodiesAreDistinct,
  type CancelledMediaProviderTerminalReconciliation,
  type CopyCandidate,
  type DurableMediaGenerationRuntimePort,
  type ModelSupplyLedgerCheckpointInput,
  type ModelSupplyLedgerPort,
  type ModelSupplyResult,
  type ModelSupplyResultSink,
  type ProductUsage,
  type ProviderCost,
} from './ledger-contracts.js';
import {
  type ProviderExecutionPort,
  type ProviderExecutionRequest,
  type ProviderExecutionResponse,
  type ProviderRuntimeBinding,
  type StructuredObjectExecutor,
  StructuredObjectGenerationError,
} from './provider-lifecycle.js';
import {
  deploymentAllowsDataClass,
  planModelSupplyCandidates,
} from './route-planning.js';
import {
  healthOverlayIsolationTargetId,
  isHealthOverlayBlocking,
  MemoryHealthOverlayPort,
} from '../supply-registry/health-overlay.js';
import {
  constrainDeploymentsToCapability,
  type CapabilityHotAssemblyPort,
} from '../supply-registry/hot-assembly.js';
import {
  collectHealthExcludedDeploymentIds,
  explainPlanDecision,
  planModelSupplyCandidatesWithDataPolicy,
  type DeploymentDataPolicyBinding,
} from '../supply-registry/supply-control-plane.js';
import type { RoutePolicyPayload } from '../supply-registry/route-policy.js';
import type { RankingCandidateInput } from '../supply-registry/three-layer-ranking.js';
import type { RouteDecisionExplanation } from '../supply-registry/route-explanation.js';

export interface ModelSupplyPlanningControlPlaneState {
  routePolicy?: RoutePolicyPayload | null;
  routePolicyRevisionId?: string | null;
  healthOverlay?: HealthOverlayPort;
  dataPolicyByDeploymentId?: ReadonlyMap<
    string,
    DeploymentDataPolicyBinding
  >;
  rankingInputsByDeploymentId?: ReadonlyMap<string, RankingCandidateInput>;
}

/** Durable planning state shared by simulation and real task submission. */
export interface ModelSupplyPlanningControlPlanePort {
  readPlanningState(input: {
    workspaceId: string;
    catalogRevisionId: string;
    operation: ModelOperation;
    qualityTier: 'quality' | 'balanced' | 'auto';
    deploymentIds: readonly string[];
    routePolicyRevisionId?: string;
  }): Promise<ModelSupplyPlanningControlPlaneState>;
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

function canvasGenerationResultInputs(submission: ModelSupplySubmission) {
  if (submission.origin?.kind !== 'advanced_canvas') return {};
  return {
    inputAssets: structuredClone(submission.input?.inputAssets ?? []),
    ...(submission.originRef
      ? { originRef: structuredClone(submission.originRef) }
      : {}),
    ...(submission.lineage
      ? {
          inputNodeBindings: structuredClone(
            submission.lineage.inputNodeBindings,
          ),
        }
      : {}),
  };
}

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

  async persistVideoCover(input: {
    bytes: Uint8Array;
    compositionKey: string;
    workflowId: string;
    workspaceId: string;
  }) {
    const receipt = await this.persistOwnedAsset({
      bytes: input.bytes,
      contentType: 'image/jpeg',
      workspaceId: input.workspaceId,
    });
    return { ...receipt, contentType: 'image/jpeg' as const };
  }

  async persistRecordedComposedVideo(input: {
    bytes: Uint8Array;
    compositionEvidence: NonNullable<OwnedAsset['compositionEvidence']>;
    compositionKey: string;
    technicalValidation: NonNullable<OwnedAsset['technicalValidation']>;
    workflowId: string;
    workspaceId: string;
  }): Promise<OwnedAsset> {
    const sha256 = hash(input.bytes);
    const objectKey = `${input.workspaceId}/composed/${sha256}.mp4`;
    this.objects.set(objectKey, Uint8Array.from(input.bytes));
    return {
      id: `composition-${hash(input.compositionKey).slice(0, 24)}`,
      objectKey,
      sha256,
      sizeBytes: input.bytes.byteLength,
      contentType: 'video/mp4',
      compositionEvidence: structuredClone(input.compositionEvidence),
      technicalValidation: structuredClone(input.technicalValidation),
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
  const frozenRouteSnapshot = submission.frozenRouteSnapshot
    ? structuredClone(submission.frozenRouteSnapshot)
    : undefined;
  if (frozenRouteSnapshot) {
    delete frozenRouteSnapshot.credentialAccountId;
    delete frozenRouteSnapshot.supplyPoolId;
    delete frozenRouteSnapshot.entitlementPolicyRevision;
    delete frozenRouteSnapshot.appliedAllocationIds;
  }
  return JSON.stringify({
    ...submission,
    dataClass: [...submission.dataClass].sort(),
    ...(frozenRouteSnapshot ? { frozenRouteSnapshot } : {}),
  });
}

export function modelSupplyJobId(submission: ModelSupplySubmission) {
  return modelSupplyJobIdForKey(
    submission.workspaceId,
    submission.idempotencyKey
  );
}

function isLanguageModelOperation(
  operation: ModelOperation,
): operation is LanguageModelOperation {
  return (
    operation === 'copy.generate' ||
    operation === 'copy.adapt' ||
    operation === 'text.respond'
  );
}

function assertPromptBinding(
  operation: LanguageModelOperation,
  binding: NonNullable<ModelSupplySubmission['promptBinding']>,
) {
  const expectedName = LANGUAGE_MODEL_PROMPT_NAME_BY_OPERATION[operation];
  assertModelSupplyPromptBinding(binding, expectedName);
}

function canonicalPromptBinding(
  binding: NonNullable<ModelSupplySubmission['promptBinding']>,
) {
  return JSON.stringify(binding);
}

function promptReferenceFromBinding(
  binding: NonNullable<ModelSupplySubmission['promptBinding']>,
) {
  return {
    name: binding.name,
    version: binding.version,
    contentHash: binding.contentHash,
    label: binding.label,
    source: binding.source,
    isFallback: binding.isFallback,
    ...(binding.fallbackReason
      ? { fallbackReason: binding.fallbackReason }
      : {}),
  };
}

/** Preserve the shared planning explanation while replacing its branch with observed facts. */
export function applyActualRouteDecisionExplanation(
  result: ModelSupplyResult,
): ModelSupplyResult {
  const explanation = result.snapshot.decisionExplanation;
  if (!explanation) return result;
  const attempts = result.attempts.length > 0
    ? result.attempts
    : [result.attempt];
  const primaryDeploymentId = attempts[0]?.deploymentId;
  const fallbackDeploymentId =
    attempts.length > 1 ? result.attempt.deploymentId : undefined;
  const acceptance = result.attempt.acceptance;
  let decision: RouteDecisionExplanation['acceptanceBranch']['decision'];
  let reason: string;
  if (result.status === 'completed') {
    decision = fallbackDeploymentId ? 'safe_auto_fallback' : 'complete';
    reason = fallbackDeploymentId
      ? 'provider_completed_after_safe_auto_fallback'
      : 'provider_completed';
  } else if (
    acceptance === 'accepted' ||
    acceptance === 'acceptance_unknown'
  ) {
    decision = 'query_reconcile_manual';
    reason =
      acceptance === 'accepted'
        ? 'provider_accepted_without_completed_delivery'
        : 'provider_acceptance_unknown';
  } else {
    const hadAuthorizedFallback =
      result.snapshot.fallbackConsent === true &&
      (result.snapshot.allowedCandidates?.length ?? 0) > 1;
    decision = hadAuthorizedFallback
      ? 'no_safe_fallback_candidate'
      : 'fallback_not_authorized';
    reason = hadAuthorizedFallback
      ? 'all_authorized_candidates_rejected_before_accept'
      : 'provider_rejected_before_accept_without_authorized_fallback';
  }
  result.snapshot.decisionExplanation = {
    ...structuredClone(explanation),
    surface: 'task_audit',
    acceptanceBranch: {
      acceptance,
      decision,
      reason,
      ...(primaryDeploymentId ? { primaryDeploymentId } : {}),
      ...(fallbackDeploymentId ? { fallbackDeploymentId } : {}),
    },
  };
  return result;
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
      const variants = ['真实门店版', '避坑清单版', '行动指引版'].slice(
        0,
        request.submission.copyCandidateCount ?? 1,
      );
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
  /** G4: durable health overlay replaces process-local cooldown map. */
  private readonly healthOverlay: MemoryHealthOverlayPort;
  private readonly events: Array<{
    gateway: 'bifrost' | 'litellm';
    workspaceHash: string;
    deploymentId: string;
    outcome: 'completed' | Acceptance | 'cooldown';
  }> = [];

  constructor(
    readonly gateway: 'bifrost' | 'litellm',
    private readonly clock: () => number = Date.now,
    healthOverlay?: MemoryHealthOverlayPort,
  ) {
    super(`recorded-${gateway}`);
    this.healthOverlay =
      healthOverlay ?? new MemoryHealthOverlayPort(this.clock);
  }

  override async execute(
    request: ProviderExecutionRequest
  ): Promise<ProviderExecutionResponse> {
    const isolationKey = healthOverlayIsolationTargetId({
      workspaceId: request.submission.workspaceId,
      deploymentId: request.deployment.id,
      credentialVersion: request.deployment.credentialVersion,
    });
    const overlay = await this.healthOverlay.get('deployment', isolationKey);
    if (isHealthOverlayBlocking(overlay?.state)) {
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
      // I reports facts; G owns overlay. accepted/unknown → hard_failure cooldown.
      await this.healthOverlay.reportFact({
        targetKind: 'deployment',
        targetId: isolationKey,
        kind:
          result.acceptance === 'acceptance_unknown'
            ? 'acceptance_unknown'
            : 'accepted_failure',
        reason: result.acceptance,
        source: `gateway_poc:${this.gateway}`,
      });
    } else if (result.kind === 'completed') {
      await this.healthOverlay.reportFact({
        targetKind: 'deployment',
        targetId: isolationKey,
        kind: 'success',
        reason: 'completed',
        source: `gateway_poc:${this.gateway}`,
      });
    }
    return result;
  }

  safeExecutionEvents() {
    return structuredClone(this.events);
  }

  clearWorkspaceCooldown(workspaceId: string) {
    this.healthOverlay.clearWorkspacePrefix(workspaceId);
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

interface SubmissionPlanningDecision {
  candidates: Array<{ model: CatalogModel; deployment: ModelDeployment }>;
  routePolicyRevisionId?: string;
  dataPolicyRevisionIdByDeploymentId: ReadonlyMap<string, string>;
  runtimeExclusionReasons: string[];
  decisionExplanation?: RouteDecisionExplanation;
  maxAttempts?: number;
  fallbackAuthorized?: boolean;
}

export type ModelSupplyProviderAdmissionDecision =
  | {
      status: 'admitted';
      leaseId: string;
      supplyPoolId: string;
      entitlementPolicyRevision: string;
      appliedAllocationIds: string[];
    }
  | {
      status: 'rejected';
      errorCode: string;
      message: string;
    };

/** Product/supply entitlement and capacity gate immediately before provider I/O. */
export interface ModelSupplyProviderAdmissionPort {
  admit(input: {
    submission: ModelSupplySubmission;
    jobId: string;
    attemptId: string;
    snapshot: RouteSnapshot;
    model: CatalogModel;
    deployment: ModelDeployment;
    lifecycleLease?: boolean;
  }): Promise<ModelSupplyProviderAdmissionDecision>;
  renew?(leaseId: string): Promise<boolean>;
  reacquire?(leaseId: string): Promise<boolean>;
  release(leaseId: string): Promise<void>;
}

export class ModelSupplyProviderAdmissionError extends Error {
  readonly name = 'ModelSupplyProviderAdmissionError';

  constructor(
    readonly errorCode: string,
    message: string,
  ) {
    super(message);
  }
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
  private readonly capabilityHotAssembly?: CapabilityHotAssemblyPort;
  private readonly planningControlPlane?: ModelSupplyPlanningControlPlanePort;
  private readonly submissionGate?: {
    blocksNewSubmission(): Promise<boolean>;
  };
  private readonly providerAdmission?: ModelSupplyProviderAdmissionPort;
  private readonly promptResolver?: ModelSupplyPromptResolver;
  private readonly promptAudits?: ModelSupplyPromptAuditPort;
  private readonly inferFixtureMediaCapabilityProfiles: boolean;
  private readonly preparedPromptBindings = new Map<
    string,
    ModelSupplySubmission['promptBinding']
  >();

  constructor(options: {
    models: CatalogModel[];
    deployments: ModelDeployment[];
    execution: ProviderExecutionPort;
    resultSink?: ModelSupplyResultSink;
    ledger?: ModelSupplyLedgerPort;
    catalogRevisionId?: string;
    runtimeCapabilities?: RuntimeDeploymentCapability[];
    capabilityHotAssembly?: CapabilityHotAssemblyPort;
    planningControlPlane?: ModelSupplyPlanningControlPlanePort;
    assetStorage?: ModelAssetStoragePort;
    referenceAssets?: ReferenceAssetResolverPort;
    submissionGate?: { blocksNewSubmission(): Promise<boolean> };
    providerAdmission?: ModelSupplyProviderAdmissionPort;
    promptResolver?: ModelSupplyPromptResolver;
    promptAudits?: ModelSupplyPromptAuditPort;
    inferFixtureMediaCapabilityProfiles?: boolean;
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
    this.capabilityHotAssembly = options.capabilityHotAssembly;
    this.planningControlPlane = options.planningControlPlane;
    this.deployments = this.constrainRuntimeDeployments(options.deployments);
    this.catalogRevisionId = options.catalogRevisionId ?? 'recorded-runtime';
    this.execution = options.execution;
    this.resultSink = options.resultSink;
    this.ledger = options.ledger;
    this.assetStorage = options.assetStorage ?? new MemoryModelAssetStorage();
    this.referenceAssets = options.referenceAssets;
    this.submissionGate = options.submissionGate;
    this.providerAdmission = options.providerAdmission;
    this.promptResolver = options.promptResolver;
    this.promptAudits = options.promptAudits;
    this.inferFixtureMediaCapabilityProfiles =
      options.inferFixtureMediaCapabilityProfiles ?? false;
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

  async constrainRuntimeDeploymentsForRequest<T extends ModelDeployment>(
    deployments: T[],
  ): Promise<T[]> {
    if (!this.capabilityHotAssembly) {
      return this.constrainRuntimeDeployments(deployments);
    }
    return Promise.all(
      deployments.map(async (deployment) => {
        const stored = structuredClone(deployment);
        if (
          stored.status !== 'active' ||
          (await this.capabilityHotAssembly!.supportsDeployment(stored))
        ) {
          return stored;
        }
        return {
          ...stored,
          status: 'inactive',
          unavailableReason: 'deployment_unavailable',
        } as T;
      }),
    );
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

  async assertRuntimeCatalogCompatibleForRequest(
    deployments: ModelDeployment[],
  ): Promise<void> {
    if (!this.capabilityHotAssembly) {
      this.assertRuntimeCatalogCompatible(deployments);
      return;
    }
    await this.capabilityHotAssembly.assertCompatible(deployments);
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
      deployments: this.capabilityHotAssembly
        ? structuredClone(deployments)
        : this.constrainRuntimeDeployments(deployments),
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

  async freezeFixedRouteForExecution(input: {
    workspaceId: string;
    operation: ModelOperation;
    catalogModelId: string;
    deploymentId?: string;
    dataClass: DataClass[];
    promptRevision?: string;
  }): Promise<RouteSnapshot> {
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
    const storedCatalog = this.workspaceCatalogs.get(input.workspaceId) ?? {
      revisionId: this.catalogRevisionId,
      modelById: this.modelById,
      deployments: this.deployments,
    };
    const capabilityRevision =
      await this.capabilityHotAssembly?.getEffectiveRevision();
    if (this.capabilityHotAssembly && !capabilityRevision) {
      throw new Error(
        'No published capability revision can be frozen for this workflow.',
      );
    }
    const catalog = {
      ...storedCatalog,
      deployments: capabilityRevision
        ? constrainDeploymentsToCapability(
            capabilityRevision.entries,
            storedCatalog.deployments,
          )
        : await this.constrainRuntimeDeploymentsForRequest(
            storedCatalog.deployments,
          ),
    };
    const planning = await this.planSubmissionCandidates(submission, catalog);
    const selected = input.deploymentId
      ? planning.candidates.find(
          (candidate) => candidate.deployment.id === input.deploymentId,
        )
      : planning.candidates[0];
    if (!selected) {
      throw new Error(
        'No compliant deployment can be frozen under the published route and data policy.',
      );
    }
    const snapshot = this.snapshotFor(
      submission,
      input.deploymentId ? [selected] : planning.candidates,
      selected,
      catalog.revisionId,
      undefined,
      planning,
    );
    if (capabilityRevision) {
      snapshot.capabilityRevisionId = capabilityRevision.revisionId;
    }
    return snapshot;
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
      return this.mediaRuntime.submit(
        await withServerDerivedReferenceDataClass(
          submission,
          this.referenceAssets,
        ),
      );
    }
    return this.executeSubmission(
      await this.prepareSubmission(submission),
      this.execution,
    );
  }

  async submitWithProviderEffectKey(
    submission: ModelSupplySubmission,
    effectIdempotencyKey: string,
  ): Promise<ModelSupplyResult> {
    if (
      this.mediaRuntime &&
      !submission.operation.startsWith('copy.') &&
      submission.operation !== 'text.respond'
    ) {
      throw new Error('Canvas text outbox accepts only language generation.');
    }
    return this.executeSubmission(
      await this.prepareSubmission(submission),
      this.execution,
      {
      effectIdempotencyKey,
      },
    );
  }

  async executeCanvasTextStream(
    submission: ModelSupplySubmission,
    runner: AiStreamingRunner | undefined,
    input: {
      abortSignal?: AbortSignal;
      effectIdempotencyKey: string;
      onDelta(delta: string): Promise<void> | void;
    },
  ): Promise<ModelSupplyResult> {
    if (
      submission.operation !== 'text.respond' ||
      submission.selection.mode !== 'fixed' ||
      !submission.selection.catalogModelId
    ) {
      throw new Error('Canvas text streaming requires one fixed text model.');
    }
    return this.executeSubmission(
      await this.prepareSubmission(submission),
      {
        execute: async (request): Promise<ProviderExecutionResponse> => {
          const unavailable = (message: string, errorCode: string) => ({
            kind: 'failure' as const,
            acceptance: 'rejected_before_accept' as const,
            errorCode,
            retryable: false,
            message,
            providerCost: {
              amount: 0,
              currency: (request.deployment.region === 'domestic'
                ? 'CNY'
                : 'USD') as 'CNY' | 'USD',
              usage: {},
            },
          });
          if (
            this.submissionGate &&
            (await this.submissionGate.blocksNewSubmission())
          ) {
            return unavailable('模型执行已停用。', 'MODEL_EXECUTION_DISABLED');
          }
          if (!runner?.startCanvasTextStream) {
            return unavailable(
              'Canvas text streaming is unavailable for the selected runner.',
              'CANVAS_TEXT_STREAM_UNAVAILABLE',
            );
          }
          if (!runner.supportsCatalogModel(request.model.id)) {
            return unavailable(
              `Streaming runner is not bound to ${request.model.id}.`,
              'CANVAS_TEXT_STREAM_MODEL_UNAVAILABLE',
            );
          }

          let providerOutputStarted = false;
          let completion: ReturnType<
            NonNullable<AiStreamingRunner['startCanvasTextStream']>
          >['result'] | undefined;
          try {
            const started = runner.startCanvasTextStream(
              {
                catalogModelId: request.model.id,
                prompt: request.submission.prompt,
                instructions: request.submission.promptBinding?.content,
                referenceAssets:
                  request.resolvedInputAssets
                    ?.filter((asset) => asset.role === 'reference_image') ??
                  request.resolvedReferenceAssets,
              },
              input.abortSignal,
            );
            completion = started.result;
            for await (const delta of started.deltas) {
              if (!delta) continue;
              providerOutputStarted = true;
              await input.onDelta(delta);
            }
            const generated = await completion;
            return {
              kind: 'completed' as const,
              providerTaskRef: generated.providerTaskRef,
              text: generated.text,
              providerCost: runner.providerCost(generated.usage),
            };
          } catch (error) {
            await completion?.catch(() => undefined);
            const statusCode =
              error &&
              typeof error === 'object' &&
              'statusCode' in error &&
              typeof error.statusCode === 'number'
                ? error.statusCode
                : undefined;
            const aborted =
              input.abortSignal?.aborted ||
              (error instanceof DOMException && error.name === 'AbortError');
            return {
              kind: 'failure' as const,
              acceptance:
                aborted || providerOutputStarted
                  ? 'acceptance_unknown'
                  : statusCode !== undefined && statusCode < 500
                    ? 'rejected_before_accept'
                    : 'acceptance_unknown',
              errorCode: aborted
                ? 'CANVAS_TEXT_STREAM_INTERRUPTED'
                : 'CANVAS_TEXT_STREAM_FAILED',
              retryable: false,
              message: `Canvas text AI SDK stream failed: ${
                error instanceof Error ? error.name : 'unknown'
              }`,
              providerCost: {
                amount: 0,
                currency: (request.deployment.region === 'domestic'
                  ? 'CNY'
                  : 'USD') as 'CNY' | 'USD',
                usage: {},
              },
            };
          }
        },
      },
      {
        deferResultPersistence: true,
        effectIdempotencyKey: input.effectIdempotencyKey,
      },
    );
  }

  async prepareSubmission(
    submission: ModelSupplySubmission,
  ): Promise<ModelSupplySubmission> {
    if (
      !isLanguageModelOperation(submission.operation)
    ) {
      return submission;
    }
    const key = `${submission.workspaceId}:${submission.idempotencyKey}`;
    const prepared = this.preparedPromptBindings.get(key);
    if (prepared) {
      assertPromptBinding(submission.operation, prepared);
      if (
        submission.promptBinding &&
        canonicalPromptBinding(submission.promptBinding) !==
          canonicalPromptBinding(prepared)
      ) {
        throw new Error('Idempotency key conflicts with a different prompt binding.');
      }
      const frozenSubmission = {
        ...submission,
        promptBinding: structuredClone(prepared),
      };
      await this.recordPromptFallback(frozenSubmission);
      return frozenSubmission;
    }
    const promptBinding =
      submission.promptBinding ??
      (await this.promptResolver?.resolve({
        operation: submission.operation,
        workspaceId: submission.workspaceId,
      }));
    if (!promptBinding) return submission;
    assertPromptBinding(submission.operation, promptBinding);
    const frozen = structuredClone(promptBinding);
    this.preparedPromptBindings.set(key, frozen);
    const frozenSubmission = {
      ...submission,
      promptBinding: structuredClone(frozen),
    };
    await this.recordPromptFallback(frozenSubmission);
    return frozenSubmission;
  }

  private async recordPromptFallback(submission: ModelSupplySubmission) {
    if (
      !this.promptAudits ||
      !isLanguageModelOperation(submission.operation) ||
      !submission.promptBinding?.isFallback
    ) {
      return;
    }
    const promptKey =
      LANGUAGE_MODEL_PROMPT_KEY_BY_OPERATION[submission.operation];
    const workflowId = submission.idempotencyKey;
    const prompt = promptReferenceFromBinding(submission.promptBinding);
    await this.promptAudits.appendPromptAudit({
      workspaceId: submission.workspaceId,
      id: promptFallbackAuditId({
        workspaceId: submission.workspaceId,
        idempotencyKey: submission.idempotencyKey,
        promptKey,
        prompt,
      }),
      workflowId,
      stage: 'prompt_resolution',
      eventType: 'langfuse_prompt_fallback',
      payload: {
        promptKey,
        prompt,
        operation: submission.operation,
      },
    });
  }

  executeStructuredObject<Output>(
    submission: ModelSupplySubmission,
    input: {
      instructions: string;
      onPartialOutput?: (partial: unknown) => Promise<void> | void;
      prompt: string;
      schema: ZodType<Output>;
      schemaName: string;
      abortSignal?: AbortSignal;
    },
    executor: StructuredObjectExecutor,
  ) {
    if (submission.operation !== 'text.respond') {
      throw new Error('Structured node execution requires text.respond.');
    }
    const structuredRequestFingerprint =
      structuredExecutionRequestFingerprint({
        actorId: submission.actorId,
        dataClass: submission.dataClass,
        instructions: input.instructions,
        operation: submission.operation,
        prompt: input.prompt,
        schema: toJSONSchema(input.schema),
        schemaName: input.schemaName,
        schemaRevision: submission.promptRevision ?? '',
        selection: submission.selection,
        streaming: Boolean(input.onPartialOutput),
        workspaceId: submission.workspaceId,
      });
    return this.executeSubmission(submission, {
      execute: async (request) => {
        if (
          this.submissionGate &&
          (await this.submissionGate.blocksNewSubmission())
        ) {
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
        if (!executor.supportsCatalogModel(request.model.id, request)) {
          return {
            kind: 'failure',
            acceptance: 'rejected_before_accept',
            message: `Structured runner is not bound to ${request.model.id}.`,
            providerCost: {
              amount: 0,
              currency:
                request.deployment.region === 'domestic' ? 'CNY' : 'USD',
              usage: {},
            },
          };
        }
        try {
          const generated = await executor.generate({
            ...input,
            providerRequest: request,
            structuredRequestFingerprint,
            ...(request.structuredContinuation
              ? {
                  structuredContinuation:
                    request.structuredContinuation,
                }
              : {}),
          });
          return {
            kind: 'completed',
            providerTaskRef: generated.providerTaskRef,
            structuredOutput: generated.output,
            ...(generated.measurement
              ? { structuredMeasurement: generated.measurement }
              : {}),
            structuredCumulativeUsage: generated.usage,
            providerCost:
              generated.providerCost ??
              executor.providerCost(
                generated.providerUsage ?? generated.usage,
                request,
              ),
          };
        } catch (error) {
          if (error instanceof ExecutionAttemptBudgetExceeded) {
            throw new ExecutionAttemptBudgetExceeded(
              error.maxAttempts,
              error.consumedAttempts,
              error.completedAttemptsInRun,
              error.structuredContinuation,
              error.structuredContinuation
                ? executor.providerCost(
                    error.structuredContinuation.usage,
                    request,
                  )
                : error.observedProviderCost,
            );
          }
          if (error instanceof StructuredObjectGenerationError) {
            return {
              kind: 'failure',
              acceptance: error.acceptance,
              errorCode: 'STRUCTURED_SCHEMA_REPAIR_FAILED',
              retryable: false,
              message: error.message,
              structuredMeasurement: error.measurement,
              structuredCumulativeUsage: error.usage,
              providerCost: executor.providerCost(
                error.providerUsage ?? error.usage,
                request,
              ),
            };
          }
          return {
            kind: 'failure',
            acceptance: structuredExecutionAcceptance(error),
            message: `Structured model execution failed: ${
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
      },
    }, {
      structuredRequestFingerprint,
    });
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
    const storedCatalog = this.workspaceCatalogs.get(submission.workspaceId) ?? {
      revisionId: this.catalogRevisionId,
      modelById: this.modelById,
      deployments: this.deployments,
    };
    const catalog = {
      ...storedCatalog,
      deployments: await this.constrainRuntimeDeploymentsForRequest(
        storedCatalog.deployments,
      ),
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
    if (
      submission.operation === 'copy.generate' &&
      (!response.copyCandidates ||
        response.copyCandidates.length === 0 ||
        response.platformVariants ||
        response.text !== undefined)
    ) {
      throw new Error(
        'Quality probe copy.generate must return copy candidates.',
      );
    }
    if (
      submission.operation === 'copy.adapt' &&
      (!response.platformVariants ||
        Object.keys(response.platformVariants).length === 0 ||
        response.copyCandidates ||
        response.text !== undefined)
    ) {
      throw new Error(
        'Quality probe copy.adapt must return platform variants.',
      );
    }
    if (
      submission.operation === 'text.respond' &&
      (!response.text?.trim() ||
        response.copyCandidates ||
        response.platformVariants)
    ) {
      throw new Error(
        'Quality probe text.respond must return one plain text response.',
      );
    }
    if (
      !response.copyCandidates &&
      !response.platformVariants &&
      !response.text
    ) {
      throw new Error('Quality probe provider returned no language output.');
    }
    return {
      ...(submission.operation === 'copy.generate'
        ? { copyCandidates: structuredClone(response.copyCandidates!) }
        : submission.operation === 'copy.adapt'
          ? { platformVariants: structuredClone(response.platformVariants!) }
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
    execution: ProviderExecutionPort,
    options: {
      continueAfterRecoveredCheckpoint?: boolean;
      useFrozenMediaCandidateSequence?: boolean;
      attemptEffectGuardsCheckpoint?: boolean;
      effectIdempotencyKey?: string;
      reconcileProviderReceipt?: boolean;
    } = {},
  ) {
    if (
      submission.operation.startsWith('copy.') ||
      submission.operation === 'text.respond'
    ) {
      throw new Error(
        'Durable media execution cannot submit language generation.',
      );
    }
    return this.executeSubmission(submission, execution, {
      providerEffectAlreadyGuarded: true,
      ...options,
    });
  }

  previewMediaSubmission(submission: ModelSupplySubmission): ModelSupplyResult {
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
    const candidates = this.resolveCandidates(submission, catalog);
    const selected = candidates[0];
    if (!selected) {
      throw new Error('No active deployment satisfies this media request.');
    }
    return this.mediaPreviewResult(
      submission,
      catalog.revisionId,
      candidates,
      selected,
    );
  }

  async prepareMediaSubmission(
    submission: ModelSupplySubmission,
  ): Promise<ModelSupplyResult> {
    if (
      submission.operation.startsWith('copy.') ||
      submission.operation === 'text.respond' ||
      submission.selection.mode !== 'fixed'
    ) {
      throw new Error('Durable media generation requires a fixed media model.');
    }
    let catalog: {
      revisionId: string;
      modelById: Map<string, CatalogModel>;
      deployments: ModelDeployment[];
    };
    if (submission.frozenRouteSnapshot) {
      catalog = {
        revisionId: submission.frozenRouteSnapshot.catalogRevisionId,
        modelById: new Map(),
        deployments: [],
      };
    } else {
      const storedCatalog =
        this.workspaceCatalogs.get(submission.workspaceId) ?? {
          revisionId: this.catalogRevisionId,
          modelById: this.modelById,
          deployments: this.deployments,
        };
      catalog = {
        ...storedCatalog,
        deployments: await this.constrainRuntimeDeploymentsForRequest(
          storedCatalog.deployments,
        ),
      };
    }
    const planning = await this.planSubmissionCandidates(submission, catalog);
    const fallbackConsented = submission.selection.fallbackConsent === true;
    const attemptLimit =
      planning.fallbackAuthorized === true && fallbackConsented
        ? Math.max(1, planning.maxAttempts ?? 1)
        : 1;
    const candidates = planning.candidates.slice(0, attemptLimit);
    const selected = candidates[0];
    if (!selected) {
      throw new Error(
        'No compliant deployment satisfies the published route and data policy.',
      );
    }
    return this.mediaPreviewResult(
      submission,
      catalog.revisionId,
      candidates,
      selected,
      planning,
    );
  }

  private mediaPreviewResult(
    submission: ModelSupplySubmission,
    catalogRevisionId: string,
    candidates: Array<{ model: CatalogModel; deployment: ModelDeployment }>,
    selected: { model: CatalogModel; deployment: ModelDeployment },
    planning?: SubmissionPlanningDecision,
  ): ModelSupplyResult {
    const jobId = modelSupplyJobId(submission);
    const snapshot = this.snapshotFor(
      submission,
      candidates,
      selected,
      catalogRevisionId,
      undefined,
      planning,
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
      ...canvasGenerationResultInputs(submission),
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
      ...canvasGenerationResultInputs(submission),
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

  async mediaProviderRequestForExecution(
    submission: ModelSupplySubmission,
  ): Promise<ProviderExecutionRequest> {
    const request = this.mediaProviderRequest(submission);
    const catalog = this.workspaceCatalogs.get(submission.workspaceId) ?? {
      revisionId: this.catalogRevisionId,
      modelById: this.modelById,
      deployments: this.deployments,
    };
    const candidates = this.resolveCandidates(submission, catalog);
    const selected = candidates.find(
      (candidate) => candidate.deployment.id === request.deployment.id,
    );
    if (!selected) {
      throw new Error('No active deployment satisfies this media request.');
    }
    const snapshot =
      submission.frozenRouteSnapshot ??
      this.snapshotFor(
        submission,
        candidates,
        selected,
        catalog.revisionId,
      );
    // F-G-02: frozen credential account requires frozen version — no silent head.
    if (
      submission.frozenRouteSnapshot?.credentialAccountId &&
      !submission.frozenRouteSnapshot.credentialVersion
    ) {
      throw new Error(
        'Frozen RouteSnapshot has credentialAccountId without credentialVersion; refusing head assembly.',
      );
    }
    const runtimeBinding = await this.runtimeBindingFor(
      request.deployment,
      snapshot,
      {
        useFrozenCredentialVersion: Boolean(
          submission.frozenRouteSnapshot,
        ),
      },
    );
    if (
      submission.frozenRouteSnapshot &&
      snapshot.credentialAccountId
    ) {
      submission.frozenRouteSnapshot.credentialAccountId =
        snapshot.credentialAccountId;
      submission.frozenRouteSnapshot.credentialVersion =
        snapshot.credentialVersion;
    }
    return {
      ...request,
      ...(runtimeBinding ? { runtimeBinding } : {}),
      attemptId: modelAttemptId(
        request.jobId,
        snapshot.allowedCandidates?.find(
          (candidate) => candidate.deploymentId === request.deployment.id,
        )?.fallbackRank ?? 1,
        request.deployment.id,
      ),
      attemptOrdinal:
        snapshot.allowedCandidates?.find(
          (candidate) => candidate.deploymentId === request.deployment.id,
        )?.fallbackRank ?? 1,
      routeSnapshot: structuredClone(snapshot),
    };
  }

  async executeMediaProviderEffect<T>(input: {
    submission: ModelSupplySubmission;
    effectIdempotencyKey: string;
    stage: 'submit' | 'recover' | 'poll' | 'download' | 'cancel' | 'late_poll' | 'late_download';
    attemptId?: string;
    attemptOrdinal?: number;
    routeSnapshot?: RouteSnapshot;
    model?: CatalogModel;
    deployment?: ModelDeployment;
    previousAttempts?: ProviderAttempt[];
    previousProviderCosts?: ProviderCost[];
    execute(): Promise<T>;
  }): Promise<T> {
    const preview = this.previewMediaSubmission(input.submission);
    const request = this.mediaProviderRequest(input.submission);
    const snapshot = structuredClone(input.routeSnapshot ?? preview.snapshot);
    const attemptId = input.attemptId ?? preview.attempt.id;
    const attemptOrdinal = input.attemptOrdinal ?? 1;
    const model = input.model ?? request.model;
    const deployment = input.deployment ?? request.deployment;
    const leaseId = `capacity:${attemptId}`;
    const channelId =
      deployment.executionChannelId ?? deployment.id;
    let acquiredChannelSubmission = false;
    if (input.stage === 'submit' && this.capabilityHotAssembly) {
      const channelAdmission =
        await this.capabilityHotAssembly.acquireChannelSubmission(
          channelId,
          attemptId,
        );
      if (!channelAdmission.admitted) {
        throw new ModelSupplyProviderAdmissionError(
          channelAdmission.errorCode ?? 'channel_not_accepting',
          channelAdmission.message ??
            `Channel ${channelId} is not accepting new submissions.`,
        );
      }
      acquiredChannelSubmission = channelAdmission.newlyAcquired;
    }
    const releaseChannelOnTerminal = async (result: T): Promise<T> => {
      if (!this.capabilityHotAssembly) return result;
      const acceptance =
        result && typeof result === 'object'
          ? Reflect.get(result, 'acceptance')
          : undefined;
      const status =
        result && typeof result === 'object'
          ? Reflect.get(result, 'status')
          : undefined;
      const reachedTerminal =
        ((input.stage === 'submit' || input.stage === 'recover') &&
          acceptance === 'rejected_before_accept') ||
        ((input.stage === 'poll' || input.stage === 'late_poll') &&
          (status === 'completed' || status === 'failed')) ||
        (input.stage === 'cancel' && status !== 'pending') ||
        input.stage === 'download' ||
        input.stage === 'late_download';
      if (reachedTerminal) {
        await this.capabilityHotAssembly.releaseChannelSubmission(
          channelId,
          attemptId,
        );
      }
      return result;
    };
    if (!this.providerAdmission) {
      if (input.stage === 'submit') {
        const checkpointInput: ModelSupplyLedgerCheckpointInput = {
          submission: input.submission,
          jobId: preview.jobId,
          attemptId,
          ordinal: attemptOrdinal,
          snapshot,
          model,
          deployment,
          previousAttempts: structuredClone(input.previousAttempts ?? []),
          previousProviderCosts: structuredClone(
            input.previousProviderCosts ?? [],
          ),
        };
        try {
          await this.ledger?.freezeAttempt?.(checkpointInput);
          await this.ledger?.checkpointAttempt(checkpointInput);
        } catch (error) {
          if (acquiredChannelSubmission) {
            await this.capabilityHotAssembly?.releaseChannelSubmission(
              channelId,
              attemptId,
            );
          }
          throw error;
        }
      }
      return releaseChannelOnTerminal(await input.execute());
    }
    if (input.stage === 'late_poll' || input.stage === 'late_download') {
      return releaseChannelOnTerminal(await input.execute());
    }
    if (
      input.stage === 'poll' ||
      input.stage === 'download' ||
      input.stage === 'cancel'
    ) {
      await this.ensureActiveProviderLease(leaseId);
      const result = await input.execute();
      const status =
        result && typeof result === 'object'
          ? Reflect.get(result, 'status')
          : undefined;
      const reachedTerminal =
        input.stage === 'download' ||
        (input.stage === 'poll' && status === 'failed') ||
        (input.stage === 'cancel' && status !== 'pending');
      if (reachedTerminal) {
        await Promise.all([
          this.providerAdmission.release(leaseId),
          releaseChannelOnTerminal(result),
        ]);
        return result;
      }
      return releaseChannelOnTerminal(result);
    }

    if (input.stage === 'recover') {
      await this.ensureActiveProviderLease(leaseId);
      return releaseChannelOnTerminal(await input.execute());
    }
    const admission = await this.providerAdmission.admit({
      submission: input.submission,
      jobId: preview.jobId,
      attemptId,
      snapshot,
      model,
      deployment,
      lifecycleLease: true,
    });
    if (admission.status === 'rejected') {
      if (acquiredChannelSubmission) {
        await this.capabilityHotAssembly?.releaseChannelSubmission(
          channelId,
          attemptId,
        );
      }
      throw new ModelSupplyProviderAdmissionError(
        admission.errorCode,
        admission.message,
      );
    }
    snapshot.supplyPoolId = admission.supplyPoolId;
    snapshot.entitlementPolicyRevision =
      admission.entitlementPolicyRevision;
    snapshot.appliedAllocationIds = [...admission.appliedAllocationIds];
    if (input.submission.frozenRouteSnapshot) {
      input.submission.frozenRouteSnapshot.supplyPoolId =
        admission.supplyPoolId;
      input.submission.frozenRouteSnapshot.entitlementPolicyRevision =
        admission.entitlementPolicyRevision;
      input.submission.frozenRouteSnapshot.appliedAllocationIds = [
        ...admission.appliedAllocationIds,
      ];
    }

    try {
      const checkpointInput: ModelSupplyLedgerCheckpointInput = {
        submission: input.submission,
        jobId: preview.jobId,
        attemptId,
        ordinal: attemptOrdinal,
        snapshot,
        model,
        deployment,
        previousAttempts: structuredClone(input.previousAttempts ?? []),
        previousProviderCosts: structuredClone(
          input.previousProviderCosts ?? [],
        ),
      };
      await this.freezeAdmittedAttempt(checkpointInput);
      await this.ledger?.checkpointAttempt(checkpointInput);
    } catch (error) {
      await Promise.all([
        this.providerAdmission.release(admission.leaseId),
        acquiredChannelSubmission
          ? this.capabilityHotAssembly?.releaseChannelSubmission(
              channelId,
              attemptId,
            )
          : undefined,
      ]);
      throw error;
    }

    const result = await input.execute();
    const acceptance =
      result && typeof result === 'object'
        ? Reflect.get(result, 'acceptance')
        : undefined;
    if (acceptance === 'rejected_before_accept') {
      try {
        await Promise.all([
          this.providerAdmission.release(admission.leaseId),
          releaseChannelOnTerminal(result),
        ]);
      } catch (error) {
        return result;
      }
      return result;
    }
    return releaseChannelOnTerminal(result);
  }

  private async ensureActiveProviderLease(leaseId: string): Promise<void> {
    if (!this.providerAdmission?.renew) return;
    if (await this.providerAdmission.renew(leaseId)) return;
    if (await this.providerAdmission.reacquire?.(leaseId)) return;
    throw new ModelSupplyProviderAdmissionError(
      'CAPACITY_LEASE_EXPIRED',
      `Capacity lease ${leaseId} expired and could not be readmitted through the fair queue.`,
    );
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

  /**
   * A failed transaction leaves a durable, replayable cleanup record. The
   * object is not deleted inline because the transaction outcome is uncertain.
   */
  private async settleResultWithOwnedAssetRegistration(input: {
    evidence: string;
    persistResult?: boolean;
    result: ModelSupplyResult;
    submission: ModelSupplySubmission;
  }) {
    const lifecycle = ownedAssetRegistrationLifecycle(this.assetStorage);
    let failureStage: OwnedAssetRegistrationFailureStage = this.ledger
      ? 'ledger_settlement'
      : 'result_persistence';
    try {
      await this.ledger?.settleAttempt({
        submission: input.submission,
        result: input.result,
        evidence: input.evidence,
      });
      if (input.persistResult === false) return;
      failureStage = 'result_persistence';
      await this.resultSink?.saveResult(input.submission.workspaceId, input.result);
    } catch (error) {
      if (lifecycle && input.result.asset) {
        try {
          await lifecycle.recordOwnedAssetRegistrationFailure({
            asset: input.result.asset,
            error,
            failureStage,
            workspaceId: input.submission.workspaceId,
          });
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            'Owned asset registration failed and its cleanup record could not be persisted.',
          );
        }
      }
      throw error;
    }
  }

  private async executeSubmission(
    inputSubmission: ModelSupplySubmission,
    execution: ProviderExecutionPort,
    options: {
      providerEffectAlreadyGuarded?: boolean;
      continueAfterRecoveredCheckpoint?: boolean;
      useFrozenMediaCandidateSequence?: boolean;
      attemptEffectGuardsCheckpoint?: boolean;
      deferResultPersistence?: boolean;
      effectIdempotencyKey?: string;
      reconcileProviderReceipt?: boolean;
      structuredRequestFingerprint?: string;
    } = {},
  ): Promise<ModelSupplyResult> {
    const submission = await withServerDerivedReferenceDataClass(
      inputSubmission,
      this.referenceAssets,
    );
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
    if (existing && !options.reconcileProviderReceipt) {
      if (existing.canonical !== payload)
        throw new Error('Idempotency key conflicts with a different payload.');
      return existing.result;
    }

    const catalog = submission.frozenRouteSnapshot
      ? {
          revisionId: submission.frozenRouteSnapshot.catalogRevisionId,
          modelById: new Map<string, CatalogModel>(),
          deployments: [],
        }
      : await (async () => {
          const storedCatalog =
            this.workspaceCatalogs.get(submission.workspaceId) ?? {
              revisionId: this.catalogRevisionId,
              modelById: this.modelById,
              deployments: this.deployments,
            };
          return {
            ...storedCatalog,
            deployments: await this.constrainRuntimeDeploymentsForRequest(
              storedCatalog.deployments,
            ),
          };
        })();
    const planning =
      options.useFrozenMediaCandidateSequence &&
      submission.frozenRouteSnapshot
        ? this.frozenMediaPlanningDecision(submission, catalog)
        : await this.planSubmissionCandidates(submission, catalog);
    const fallbackConsented =
      submission.frozenRouteSnapshot?.fallbackConsent ??
      submission.selection.fallbackConsent ??
      submission.selection.mode === 'auto';
    const planningAttemptLimit =
      planning.maxAttempts === undefined
        ? undefined
        : Math.max(
            1,
            planning.fallbackAuthorized === false || !fallbackConsented
              ? 1
              : planning.maxAttempts,
          );
    const candidates = planning.candidates.slice(
      0,
      planningAttemptLimit ??
        (submission.selection.mode === 'auto'
          ? 2
          : planning.candidates.length),
    );
    if (
      candidates.length === 0 &&
      this.planningControlPlane &&
      !submission.frozenRouteSnapshot
    ) {
      throw new Error(
        'No compliant deployment satisfies the published route and data policy.',
      );
    }
    if (candidates.length === 0)
      throw new Error(
        'No active deployment satisfies the requested data class and operation.'
      );
    let lastFailure: ModelSupplyResult | undefined;
    const jobId = modelSupplyJobId(submission);
    const attemptChain: ProviderAttempt[] = [];
    const providerCostChain: ProviderCost[] = [];
    if (
      this.capabilityHotAssembly &&
      submission.frozenRouteSnapshot &&
      !submission.frozenRouteSnapshot.capabilityRevisionId
    ) {
      throw new Error(
        'Frozen RouteSnapshot requires a capability revision; refusing current-head assembly.',
      );
    }
    const capabilityRevisionId = this.capabilityHotAssembly
      ? (submission.frozenRouteSnapshot?.capabilityRevisionId ??
        (await this.capabilityHotAssembly.getEffectiveRevisionId()) ??
        undefined)
      : undefined;

    for (const [candidateIndex, candidate] of candidates.entries()) {
      const frozenCandidate = submission.frozenRouteSnapshot?.allowedCandidates?.find(
        (entry) => entry.deploymentId === candidate.deployment.id,
      );
      const attemptSubmission =
        options.useFrozenMediaCandidateSequence && frozenCandidate
          ? this.submissionForFrozenMediaCandidate(
              submission,
              frozenCandidate,
              candidateIndex + 1,
            )
          : submission;
      const snapshot = this.snapshotFor(
        attemptSubmission,
        candidates,
        candidate,
        catalog.revisionId,
        lastFailure ? 'auto_fallback_before_accept' : undefined,
        planning,
      );
      const fallbackAuthorized =
        snapshot.fallbackAuthorized ??
        attemptSubmission.selection.mode === 'auto';
      if (capabilityRevisionId) {
        snapshot.capabilityRevisionId = capabilityRevisionId;
      }
      const attemptId = modelAttemptId(
        jobId,
        candidateIndex + 1,
        candidate.deployment.id
      );
      const checkpointInput: ModelSupplyLedgerCheckpointInput = {
        submission: attemptSubmission,
        jobId,
        attemptId,
        ordinal: candidateIndex + 1,
        snapshot,
        model: candidate.model,
        deployment: candidate.deployment,
        previousAttempts: structuredClone(attemptChain),
        previousProviderCosts: structuredClone(providerCostChain),
      };
      if (
        attemptSubmission.frozenRouteSnapshot?.credentialAccountId &&
        !attemptSubmission.frozenRouteSnapshot.credentialVersion
      ) {
        throw new Error(
          'Frozen RouteSnapshot has credentialAccountId without credentialVersion; refusing head assembly.',
        );
      }
      const runtimeBinding = await this.runtimeBindingFor(
        candidate.deployment,
        snapshot,
        {
          useFrozenCredentialVersion: Boolean(
            attemptSubmission.frozenRouteSnapshot,
          ),
        },
      );
      let admission: ModelSupplyProviderAdmissionDecision | undefined;
      let admissionError: unknown;
      if (!options.providerEffectAlreadyGuarded && this.providerAdmission) {
        try {
          admission = await this.providerAdmission.admit({
            submission: attemptSubmission,
            jobId,
            attemptId,
            snapshot,
            model: candidate.model,
            deployment: candidate.deployment,
          });
          if (admission.status === 'admitted') {
            snapshot.supplyPoolId = admission.supplyPoolId;
            snapshot.entitlementPolicyRevision =
              admission.entitlementPolicyRevision;
            snapshot.appliedAllocationIds = [
              ...admission.appliedAllocationIds,
            ];
            await this.freezeAdmittedAttempt(checkpointInput);
          }
        } catch (error) {
          admissionError = error;
        }
      } else if (
        !options.providerEffectAlreadyGuarded &&
        this.ledger?.freezeAttempt
      ) {
        await this.ledger.freezeAttempt(checkpointInput);
      }

      let checkpoint:
        | Awaited<ReturnType<ModelSupplyLedgerPort['checkpointAttempt']>>
        | undefined;
      let structuredContinuation: StructuredExecutionContinuation | undefined;
      if (!options.attemptEffectGuardsCheckpoint) {
        try {
          checkpoint = await this.ledger?.checkpointAttempt(checkpointInput);
        } catch (error) {
          if (admission?.status === 'admitted') {
            await this.providerAdmission?.release(admission.leaseId);
          }
          throw error;
        }
      }
      const recoveredBudgetSuspension =
        checkpoint?.recoveredResult?.status === 'unknown' &&
        checkpoint.recoveredResult.failureCode ===
          EXECUTION_ATTEMPT_BUDGET_SUSPENSION_CODE &&
        checkpoint.recoveredResult.attempt.acceptance ===
          'acceptance_unknown'
          ? checkpoint.recoveredResult
          : undefined;
      if (
        recoveredBudgetSuspension &&
        options.structuredRequestFingerprint !== undefined
      ) {
        try {
          const recoveredRequestFingerprint =
            parseRecoveredStructuredExecutionRequestFingerprint(
              recoveredBudgetSuspension.attemptBudgetRequestFingerprint,
            );
          if (
            recoveredRequestFingerprint !==
            options.structuredRequestFingerprint
          ) {
            throw new TypeError(
              recoveredBudgetSuspension.structuredContinuation !== undefined
                ? 'Recovered structured execution request fingerprint does not match.'
                : 'Recovered attempt-budget request fingerprint does not match.',
            );
          }
        } catch (error) {
          if (admission?.status === 'admitted') {
            await this.providerAdmission?.release(admission.leaseId);
          }
          throw error;
        }
      }
      if (
        recoveredBudgetSuspension &&
        recoveredBudgetSuspension.attempt.id === attemptId
      ) {
        providerCostChain.splice(
          0,
          providerCostChain.length,
          ...structuredClone(recoveredBudgetSuspension.providerCosts),
        );
        if (recoveredBudgetSuspension.structuredContinuation !== undefined) {
          try {
            structuredContinuation =
              parseRecoveredStructuredExecutionContinuation(
                recoveredBudgetSuspension.structuredContinuation,
              );
            if (
              structuredContinuation.requestFingerprint !==
              options.structuredRequestFingerprint
            ) {
              throw new TypeError(
                'Recovered structured execution request fingerprint does not match.',
              );
            }
          } catch (error) {
            if (admission?.status === 'admitted') {
              await this.providerAdmission?.release(admission.leaseId);
            }
            throw error;
          }
        }
      } else if (recoveredBudgetSuspension) {
        const recoveredAttemptIndex =
          recoveredBudgetSuspension.attempts.findIndex(
            (attempt) => attempt.id === attemptId,
          );
        const recoveredAttempt =
          recoveredBudgetSuspension.attempts[recoveredAttemptIndex];
        if (
          recoveredAttempt &&
          recoveredAttemptIndex >= 0 &&
          recoveredAttempt.acceptance === 'rejected_before_accept' &&
          snapshot.fallbackConsent === true &&
          fallbackAuthorized &&
          candidateIndex < candidates.length - 1
        ) {
          if (admission?.status === 'admitted') {
            await this.providerAdmission?.release(admission.leaseId);
          }
          const recoveredAttempts = recoveredBudgetSuspension.attempts.slice(
            0,
            recoveredAttemptIndex + 1,
          );
          const recoveredProviderCosts =
            recoveredBudgetSuspension.providerCosts.slice(
              0,
              recoveredAttemptIndex + 1,
            );
          attemptChain.splice(
            0,
            attemptChain.length,
            ...structuredClone(recoveredAttempts),
          );
          providerCostChain.splice(
            0,
            providerCostChain.length,
            ...structuredClone(recoveredProviderCosts),
          );
          for (const attempt of recoveredAttempts) {
            if (
              !this.storedAttempts.some((stored) => stored.id === attempt.id)
            ) {
              this.storedAttempts.push(structuredClone(attempt));
            }
          }
          lastFailure = recoveredBudgetSuspension;
          continue;
        }
      }
      if (
        checkpoint?.recoveredResult &&
        !options.continueAfterRecoveredCheckpoint &&
        !(
          recoveredBudgetSuspension &&
          recoveredBudgetSuspension.attempt.id === attemptId
        )
      ) {
        if (admission?.status === 'admitted') {
          await this.providerAdmission?.release(admission.leaseId);
        }
        const recovered = {
          ...checkpoint.recoveredResult,
          ...canvasGenerationResultInputs(attemptSubmission),
        };
        for (const attempt of recovered.attempts) {
          if (!this.storedAttempts.some((stored) => stored.id === attempt.id)) {
            this.storedAttempts.push(structuredClone(attempt));
          }
        }
        if (
          recovered.status === 'failed' &&
          recovered.attempt.acceptance === 'rejected_before_accept' &&
          recovered.snapshot.fallbackConsent === true &&
          fallbackAuthorized &&
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
        const audited = applyActualRouteDecisionExplanation(recovered);
        if (!options.deferResultPersistence) {
          await this.resultSink?.saveResult(submission.workspaceId, audited);
        }
        this.idempotency.set(key, { canonical: payload, result: audited });
        return audited;
      }

      let response: ProviderExecutionResponse;
      let providerInvoked = false;
      try {
        if (admissionError) {
          if (admission?.status === 'admitted') {
            await this.providerAdmission?.release(admission.leaseId);
            admission = undefined;
          }
          throw admissionError;
        }
        if (admission?.status === 'rejected') {
          response = {
            kind: 'failure',
            acceptance: 'rejected_before_accept',
            errorCode: admission.errorCode,
            retryable: true,
            message: admission.message,
            providerCost: {
              amount: 0,
              currency:
                candidate.deployment.region === 'domestic' ? 'CNY' : 'USD',
              usage: {},
            },
          };
        } else {
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
              const resolved = resolutions as ResolvedReferenceAsset[];
              resolvedReferenceAssets = resolved;
              const roleByAssetId = new Map(
                submission.input?.inputAssets?.map((asset) => [
                  asset.assetId,
                  asset.role,
                ]) ?? [],
              );
              providerInvoked = true;
              const executeCandidate = () =>
                execution.execute({
                    jobId,
                    model: candidate.model,
                    deployment: candidate.deployment,
                    submission: attemptSubmission,
                    ...(runtimeBinding ? { runtimeBinding } : {}),
                    attemptId,
                    attemptOrdinal: candidateIndex + 1,
                    routeSnapshot: snapshot,
                    previousAttempts: structuredClone(attemptChain),
                    previousProviderCosts: structuredClone(providerCostChain),
                    ...(structuredContinuation
                      ? { structuredContinuation }
                      : {}),
                    ...(options.effectIdempotencyKey
                      ? {
                          effectIdempotencyKey:
                            candidateIndex === 0
                              ? options.effectIdempotencyKey
                              : `${options.effectIdempotencyKey}:attempt:${candidateIndex + 1}:${candidate.deployment.id}`,
                        }
                      : {}),
                    resolvedReferenceAssets: resolved,
                    resolvedInputAssets: resolved.map(
                      (asset) => ({
                        ...asset,
                        role:
                          roleByAssetId.get(asset.assetId) ?? 'reference_image',
                      }),
                    ),
                  });
              response = options.providerEffectAlreadyGuarded
                ? await executeCandidate()
                : await this.executeOnAdmittedChannel({
                    deployment: candidate.deployment,
                    inFlightId: attemptId,
                    execute: executeCandidate,
                  });
            }
          }
        } else {
          providerInvoked = true;
          const executeCandidate = () =>
            execution.execute({
                jobId,
                model: candidate.model,
                deployment: candidate.deployment,
                submission: attemptSubmission,
                ...(runtimeBinding ? { runtimeBinding } : {}),
                attemptId,
                attemptOrdinal: candidateIndex + 1,
                routeSnapshot: snapshot,
                previousAttempts: structuredClone(attemptChain),
                previousProviderCosts: structuredClone(providerCostChain),
                ...(structuredContinuation
                  ? { structuredContinuation }
                  : {}),
                ...(options.effectIdempotencyKey
                  ? {
                      effectIdempotencyKey:
                        candidateIndex === 0
                          ? options.effectIdempotencyKey
                          : `${options.effectIdempotencyKey}:attempt:${candidateIndex + 1}:${candidate.deployment.id}`,
                    }
                  : {}),
              });
          response = options.providerEffectAlreadyGuarded
            ? await executeCandidate()
            : await this.executeOnAdmittedChannel({
                deployment: candidate.deployment,
                inFlightId: attemptId,
                execute: executeCandidate,
              });
        }
          } finally {
            if (admission) {
              try {
                await this.providerAdmission?.release(admission.leaseId);
              } catch (error) {
                if (!providerInvoked) throw error;
              }
            }
          }
        }
      } catch (error) {
        if (error instanceof ExecutionAttemptBudgetExceeded) {
          if (recoveredBudgetSuspension?.attempt.id === attemptId) {
            throw error;
          }
          const attempt: ProviderAttempt = {
            id: attemptId,
            jobId,
            catalogModelId: candidate.model.id,
            deploymentId: candidate.deployment.id,
            acceptance: 'acceptance_unknown',
            status: 'unknown',
            createdAt: now(),
          };
          const providerCost: ProviderCost = {
            id: `provider-cost-${hash(
              `${attemptId}:budget-suspended:${
                error.observedProviderCost ? 'observed' : 'estimated'
              }`,
            ).slice(0, 24)}`,
            status: error.observedProviderCost ? 'observed' : 'estimated',
            ...(error.observedProviderCost ?? {
              amount: 0,
              currency:
                candidate.deployment.region === 'domestic' ? 'CNY' : 'USD',
              usage: {},
            }),
          };
          await this.ledger?.settleAttempt({
            submission: attemptSubmission,
            result: {
              jobId,
              operation: attemptSubmission.operation,
              ...canvasGenerationResultInputs(attemptSubmission),
              status: 'unknown',
              failureCode: EXECUTION_ATTEMPT_BUDGET_SUSPENSION_CODE,
              ...(attemptSubmission.origin
                ? { origin: structuredClone(attemptSubmission.origin) }
                : {}),
              snapshot,
              attempt,
              attempts: [...attemptChain, attempt],
              usage: {
                id: `model-usage-${hash(jobId).slice(0, 28)}`,
                status: 'reserved',
                quantity: productUsageQuantity,
              },
              providerCost,
              providerCosts: [...providerCostChain, providerCost],
              ...(options.structuredRequestFingerprint
                ? {
                    attemptBudgetRequestFingerprint:
                      options.structuredRequestFingerprint,
                  }
                : {}),
              ...(error.structuredContinuation
                ? {
                    structuredCumulativeUsage:
                      error.structuredContinuation.usage,
                  }
                : {}),
              ...(error.structuredContinuation
                ? {
                    structuredContinuation:
                      error.structuredContinuation,
                  }
                : {}),
            },
            evidence: 'execution_attempt_budget_exhausted_before_provider',
          });
          throw error;
        }
        const attempt: ProviderAttempt = {
          id: attemptId,
          jobId,
          catalogModelId: candidate.model.id,
          deploymentId: candidate.deployment.id,
          acceptance: providerInvoked
            ? 'acceptance_unknown'
            : 'rejected_before_accept',
          status: providerInvoked ? 'unknown' : 'failed',
          createdAt: now(),
        };
        attemptChain.push(attempt);
        this.storedAttempts.push(attempt);
        const usage: ProductUsage = {
          id: `model-usage-${hash(jobId).slice(0, 28)}`,
          status: providerInvoked ? 'reserved' : 'refunded',
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
          operation: attemptSubmission.operation,
          ...canvasGenerationResultInputs(attemptSubmission),
          status: providerInvoked ? 'unknown' : 'failed',
          ...(attemptSubmission.origin
            ? { origin: structuredClone(attemptSubmission.origin) }
            : {}),
          snapshot,
          attempt,
          attempts: [...attemptChain],
          usage,
          providerCost,
          providerCosts: [...providerCostChain],
        };
        applyActualRouteDecisionExplanation(unknown);
        await this.ledger?.settleAttempt({
          submission: attemptSubmission,
          result: unknown,
          evidence:
            (providerInvoked ? 'provider' : 'pre_provider') +
            `_exception:${error instanceof Error ? error.name : 'unknown'}`,
        });
        if (!options.deferResultPersistence) {
          await this.resultSink?.saveResult(submission.workspaceId, unknown);
        }
        this.idempotency.set(key, { canonical: payload, result: unknown });
        return unknown;
      }
      if (
        response.kind === 'completed' &&
        attemptSubmission.operation === 'text.respond' &&
        !response.text?.trim() &&
        response.structuredOutput === undefined
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
            : response.errorCode === 'EMPTY_TEXT_DELIVERABLE' ||
                response.errorCode === 'STRUCTURED_SCHEMA_REPAIR_FAILED'
              ? 'failed'
            : response.acceptance === 'rejected_before_accept'
              ? 'failed'
              : 'unknown',
        createdAt: now(),
      };
      this.storedAttempts.push(attempt);
      attemptChain.push(attempt);
      const isCopyOperation =
        attemptSubmission.operation.startsWith('copy.') ||
        attemptSubmission.operation === 'text.respond';
      const usage: ProductUsage = {
        id: `model-usage-${hash(jobId).slice(0, 28)}`,
        status:
          response.kind === 'completed'
            ? 'committed'
            : response.errorCode === 'EMPTY_TEXT_DELIVERABLE' ||
                response.errorCode === 'STRUCTURED_SCHEMA_REPAIR_FAILED'
              ? 'refunded'
              // Td-2: a partial copy-provider interrupt (acceptance_unknown
              // after partial output) refunds the reservation; other modalities
              // stay reserved until provider terminal reconciliation.
            : response.acceptance === 'acceptance_unknown' && isCopyOperation
              ? 'refunded'
            : response.acceptance === 'acceptance_unknown' ||
                response.acceptance === 'accepted'
              ? 'reserved'
              : response.acceptance === 'rejected_before_accept' &&
                  snapshot.fallbackConsent === true &&
                  fallbackAuthorized &&
                  candidateIndex < candidates.length - 1
                ? 'reserved'
                : 'refunded',
        quantity: productUsageQuantity,
      };
      const providerCostObserved =
        response.kind === 'completed' ||
        response.errorCode === 'STRUCTURED_SCHEMA_REPAIR_FAILED';
      const providerCost: ProviderCost = {
        id: `provider-cost-${hash(
          `${attemptId}:${providerCostObserved ? 'observed' : 'estimated'}`
        ).slice(0, 24)}`,
        status: providerCostObserved ? 'observed' : 'estimated',
        ...response.providerCost,
      };
      providerCostChain.push(providerCost);

      if (response.kind === 'failure') {
        const failed: ModelSupplyResult = {
          jobId,
          operation: attemptSubmission.operation,
          ...canvasGenerationResultInputs(attemptSubmission),
          status: attempt.status === 'unknown' ? 'unknown' : 'failed',
          ...(attemptSubmission.origin
            ? { origin: structuredClone(attemptSubmission.origin) }
            : {}),
          ...(response.errorCode ? { failureCode: response.errorCode } : {}),
          ...(response.structuredMeasurement
            ? { structuredMeasurement: response.structuredMeasurement }
            : {}),
          ...(response.structuredCumulativeUsage
            ? {
                structuredCumulativeUsage:
                  response.structuredCumulativeUsage,
              }
            : {}),
			...(response.retryable === true ? { retryable: true } : {}),
          snapshot,
          attempt,
          attempts: [...attemptChain],
          usage,
          providerCost,
          providerCosts: [...providerCostChain],
        };
        const willFallback =
          response.acceptance === 'rejected_before_accept' &&
          snapshot.fallbackConsent === true &&
          fallbackAuthorized &&
          candidateIndex < candidates.length - 1;
        if (!willFallback) {
          applyActualRouteDecisionExplanation(failed);
        }
        await this.ledger?.settleAttempt({
          submission: attemptSubmission,
          result: failed,
          evidence: response.errorCode
            ? `provider_response:${response.errorCode}`
            : 'provider_response',
        });
        if (!willFallback) {
          if (!options.deferResultPersistence) {
            await this.resultSink?.saveResult(submission.workspaceId, failed);
          }
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
              workspaceId: attemptSubmission.workspaceId,
              bytes: response.assetBytes,
              contentType: response.contentType,
              ...(response.providerTaskRef
                ? { sourceTaskRef: response.providerTaskRef }
                : {}),
            })
          : undefined;
      const result: ModelSupplyResult = {
        jobId,
        operation: attemptSubmission.operation,
        ...canvasGenerationResultInputs(attemptSubmission),
        status: 'completed',
        ...(attemptSubmission.origin
          ? { origin: structuredClone(attemptSubmission.origin) }
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
        ...(response.structuredOutput !== undefined
          ? { structuredOutput: structuredClone(response.structuredOutput) }
          : {}),
        ...(response.structuredMeasurement
          ? { structuredMeasurement: response.structuredMeasurement }
          : {}),
        ...(response.structuredCumulativeUsage
          ? {
              structuredCumulativeUsage:
                response.structuredCumulativeUsage,
            }
          : {}),
        usage,
        providerCost,
        providerCosts: [...providerCostChain],
      };
      applyActualRouteDecisionExplanation(result);
      await this.settleResultWithOwnedAssetRegistration({
        submission: attemptSubmission,
        result,
        evidence: 'provider_response',
        persistResult: !options.deferResultPersistence,
      });
      this.idempotency.set(key, { canonical: payload, result });
      return result;
    }

    if (lastFailure) {
      const failed = applyActualRouteDecisionExplanation({
        ...lastFailure,
        attempts: [...attemptChain],
        providerCosts: [...providerCostChain],
      });
      if (!options.deferResultPersistence) {
        await this.resultSink?.saveResult(submission.workspaceId, failed);
      }
      return failed;
    }
    throw new Error('No candidate produced an execution result.');
  }

  private async freezeAdmittedAttempt(
    input: ModelSupplyLedgerCheckpointInput,
  ): Promise<void> {
    if (!this.ledger?.freezeAttempt) {
      throw new Error(
        'Provider admission requires a durable SupplyRequestFreeze ledger.',
      );
    }
    const frozen = await this.ledger.freezeAttempt(input);
    if (frozen === null || frozen === undefined) {
      throw new Error(
        'Provider admission did not persist a SupplyRequestFreeze.',
      );
    }
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
    const audited = applyActualRouteDecisionExplanation(result);
    await this.settleResultWithOwnedAssetRegistration({
      submission,
      result: audited,
      evidence,
    });
    this.idempotency.set(
      `${submission.workspaceId}:${submission.idempotencyKey}`,
      { canonical: canonical(submission), result: structuredClone(audited) }
    );
    return structuredClone(audited);
  }

  /**
   * Persists a provider terminal fact that arrived after Product cancellation.
   * The cancelled attempt and refunded Product Usage remain terminal; only the
   * append-only provider cost/usage and isolated asset evidence advance.
   */
  /**
   * Td-2: refund/compensate product usage when outer video compose fails
   * after a child generation job already committed quantity.
   */
  async compensateOuterVideoUsage(input: {
    workspaceId: string;
    actorId: string;
    jobId: string;
    reason: string;
    correlationId?: string;
  }) {
    if (!this.ledger?.compensateCommittedUsage) return null;
    return this.ledger.compensateCommittedUsage({
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      jobId: input.jobId,
      reason: input.reason,
      ...(input.correlationId
        ? { correlationId: input.correlationId }
        : {}),
    });
  }

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
    const result = applyActualRouteDecisionExplanation({
      ...structuredClone(cancelled),
      providerCost: structuredClone(reconciliation.providerCost),
      providerCosts,
      cancelledProviderTerminal: structuredClone(reconciliation),
    });
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

  private async planSubmissionCandidates(
    submission: ModelSupplySubmission,
    catalog: {
      revisionId: string;
      modelById: Map<string, CatalogModel>;
      deployments: ModelDeployment[];
    },
  ): Promise<SubmissionPlanningDecision> {
    const planningCatalog =
      submission.referenceAssetRegionBoundary === 'domestic'
        ? {
            ...catalog,
            deployments: catalog.deployments.filter(
              (deployment) => deployment.region === 'domestic',
            ),
          }
        : catalog;
    if (!this.planningControlPlane || submission.frozenRouteSnapshot) {
      return {
        candidates: this.resolveCandidates(submission, planningCatalog),
        dataPolicyRevisionIdByDeploymentId: new Map(),
        runtimeExclusionReasons: [],
      };
    }

    const qualityTier =
      submission.selection.mode === 'auto'
        ? (submission.selection.profile ?? 'quality')
        : ('quality' as const);
    const state = await this.planningControlPlane.readPlanningState({
      workspaceId: submission.workspaceId,
      catalogRevisionId: planningCatalog.revisionId,
      operation: submission.operation,
      qualityTier,
      deploymentIds: planningCatalog.deployments.map(
        (deployment) => deployment.id,
      ),
    });
    const healthExcludedDeploymentIds = state.healthOverlay
      ? await collectHealthExcludedDeploymentIds({
          overlay: state.healthOverlay,
          deploymentIds: planningCatalog.deployments.map(
            (deployment) => deployment.id,
          ),
        })
      : [];
    const planResult = planModelSupplyCandidatesWithDataPolicy({
      catalog: planningCatalog,
      operation: submission.operation,
      selection: submission.selection,
      dataClass: submission.dataClass,
      healthExcludedDeploymentIds,
      routePolicy: state.routePolicy,
      dataPolicyByDeploymentId: state.dataPolicyByDeploymentId,
      rankingInputsByDeploymentId: state.rankingInputsByDeploymentId,
    });
    const primaryDeploymentId = planResult.plan.candidates[0]?.deployment.id;
    const decisionExplanation = explainPlanDecision({
      surface: 'task_audit',
      planResult,
      requestedDataClasses: submission.dataClass,
      liveExclusions: healthExcludedDeploymentIds.map((deploymentId) => ({
        deploymentId,
        reasons: ['health_overlay_blocking'],
      })),
      acceptanceBranch: {
        acceptance: 'not_attempted',
        decision: primaryDeploymentId ? 'complete' : 'awaiting_selection',
        reason: primaryDeploymentId
          ? 'planned_execution'
          : 'no_compliant_candidate',
        ...(primaryDeploymentId ? { primaryDeploymentId } : {}),
      },
      costEvidenceSourceByDeploymentId: new Map(
        [...(state.rankingInputsByDeploymentId?.entries() ?? [])].map(
          ([deploymentId, ranking]) => [
            deploymentId,
            ranking.cost.source === 'recorded_placeholder'
              ? 'recorded_estimate'
              : ranking.cost.source,
          ],
        ),
      ),
    });

    return {
      candidates: planResult.plan.candidates,
      ...(state.routePolicyRevisionId
        ? { routePolicyRevisionId: state.routePolicyRevisionId }
        : {}),
      dataPolicyRevisionIdByDeploymentId: new Map(
        [...(state.dataPolicyByDeploymentId?.entries() ?? [])].map(
          ([deploymentId, binding]) => [
            deploymentId,
            binding.dataPolicyRevisionId,
          ],
        ),
      ),
      runtimeExclusionReasons: healthExcludedDeploymentIds.map(
        (deploymentId) => `${deploymentId}:health_overlay_blocking`,
      ),
      decisionExplanation,
      ...(state.routePolicy?.maxAttempts !== undefined
        ? { maxAttempts: state.routePolicy.maxAttempts }
        : {}),
      ...(state.routePolicy?.fallbackAuthorized !== undefined
        ? { fallbackAuthorized: state.routePolicy.fallbackAuthorized }
        : {}),
    };
  }

  private submissionForFrozenMediaCandidate(
    submission: ModelSupplySubmission,
    candidate: NonNullable<RouteSnapshot['allowedCandidates']>[number],
    ordinal: number,
  ): ModelSupplySubmission {
    const frozen = structuredClone(submission.frozenRouteSnapshot);
    if (!frozen) {
      throw new Error('Media fallback requires a frozen RouteSnapshot.');
    }
    frozen.id = ordinal === 1
      ? frozen.id
      : `model-route-${hash(`${frozen.id}:${ordinal}:${candidate.deploymentId}`).slice(0, 28)}`;
    frozen.deploymentId = candidate.deploymentId;
    frozen.actualCatalogModelId = candidate.catalogModelId;
    frozen.providerProfileId = candidate.providerProfileId ?? undefined;
    frozen.executionChannelId = candidate.executionChannelId ?? undefined;
    frozen.providerModel = candidate.providerModel ?? undefined;
    frozen.endpointRevision = candidate.endpointRevision ?? undefined;
    frozen.apiCounterparty = candidate.apiCounterparty ?? undefined;
    frozen.credentialOwner = candidate.credentialOwner ?? undefined;
    frozen.deploymentLifecycleRevision =
      candidate.deploymentLifecycleRevision ?? undefined;
    frozen.dataPolicyRevisionId = candidate.dataPolicyRevisionId ?? undefined;
    frozen.credentialMode = candidate.credentialMode;
    frozen.credentialVersion = candidate.credentialVersion;
    // F-S2-01: update deployment-level policyRevision only; keep request-level
    // routePolicyRevisionId unchanged so adapter/ledger resolve consistently.
    frozen.policyRevision = candidate.policyRevision;
    frozen.priceRevision = candidate.priceRevision;
    frozen.reason = ordinal > 1
      ? 'auto_fallback_before_accept'
      : frozen.reason;
    delete frozen.credentialAccountId;
    delete frozen.supplyPoolId;
    delete frozen.entitlementPolicyRevision;
    delete frozen.appliedAllocationIds;
    return {
      ...structuredClone(submission),
      frozenRouteSnapshot: frozen,
    };
  }

  private frozenMediaPlanningDecision(
    submission: ModelSupplySubmission,
    catalog: {
      revisionId: string;
      modelById: Map<string, CatalogModel>;
      deployments: ModelDeployment[];
    },
  ): SubmissionPlanningDecision {
    const frozen = submission.frozenRouteSnapshot;
    if (!frozen?.allowedCandidates?.length) {
      throw new Error('Media fallback requires a complete frozen candidate sequence.');
    }
    const ordered = [...frozen.allowedCandidates].sort(
      (left, right) => left.fallbackRank - right.fallbackRank,
    );
    const primary = ordered.find(
      (candidate) => candidate.deploymentId === frozen.deploymentId,
    );
    if (!primary) {
      throw new Error('Frozen RouteSnapshot is missing its primary candidate.');
    }
    const fallbackAuthorized =
      frozen.fallbackAuthorized === true && frozen.fallbackConsent === true;
    const attemptLimit = Math.max(1, frozen.maxAttempts ?? 1);
    const safe = [
      primary,
      ...(fallbackAuthorized
        ? ordered.filter(
            (candidate) =>
              candidate.deploymentId !== primary.deploymentId &&
              candidate.catalogModelId === primary.catalogModelId &&
              Boolean(primary.executionChannelId) &&
              Boolean(candidate.executionChannelId) &&
              candidate.executionChannelId !== primary.executionChannelId &&
              Boolean(primary.accountIdentity) &&
              Boolean(candidate.accountIdentity) &&
              candidate.accountIdentity !== primary.accountIdentity &&
              Boolean(primary.endpointFingerprint) &&
              Boolean(candidate.endpointFingerprint) &&
              candidate.endpointFingerprint !== primary.endpointFingerprint,
          )
        : []),
    ].slice(0, attemptLimit);
    const candidates = safe.map((candidate, index) => {
      const scoped = this.submissionForFrozenMediaCandidate(
        submission,
        candidate,
        index + 1,
      );
      const resolved = this.resolveCandidates(scoped, catalog)[0];
      if (!resolved) {
        throw new Error(
          `Frozen media candidate ${candidate.deploymentId} is not executable.`,
        );
      }
      return resolved;
    });
    return {
      candidates,
      routePolicyRevisionId: frozen.routePolicyRevisionId,
      dataPolicyRevisionIdByDeploymentId: new Map(
        safe.flatMap((candidate) =>
          candidate.dataPolicyRevisionId
            ? [[candidate.deploymentId, candidate.dataPolicyRevisionId] as const]
            : [],
        ),
      ),
      runtimeExclusionReasons: [...(frozen.runtimeExclusionReasons ?? [])],
      ...(frozen.decisionExplanation
        ? { decisionExplanation: structuredClone(frozen.decisionExplanation) }
        : {}),
      maxAttempts: attemptLimit,
      fallbackAuthorized,
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
        ...(frozenCandidate.accountIdentity
          ? { accountIdentity: frozenCandidate.accountIdentity }
          : {}),
        ...(frozenCandidate.endpointFingerprint
          ? { endpointFingerprint: frozenCandidate.endpointFingerprint }
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
        ...(frozenCandidate.capabilityProfile
          ? {
              capabilityProfile: structuredClone(
                frozenCandidate.capabilityProfile,
              ),
            }
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
      if (
        !deploymentAllowsDataClass(
          deployment,
          submission.dataClass
        )
      ) {
        throw new Error(
          'Frozen RouteSnapshot violates the deployment data-class policy.'
        );
      }
      if (
        submission.referenceAssetRegionBoundary === 'domestic' &&
        deployment.region !== 'domestic'
      ) {
        throw new Error(
          'Frozen RouteSnapshot violates the reference asset region boundary.',
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
    fallback?: RouteSnapshot['reason'],
    planning?: SubmissionPlanningDecision,
  ): RouteSnapshot {
    const promptReference = submission.promptBinding
      ? promptReferenceFromBinding(submission.promptBinding)
      : undefined;
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
      const frozen = structuredClone(submission.frozenRouteSnapshot);
      if (
        frozen.promptReference &&
        (!promptReference ||
          JSON.stringify(frozen.promptReference) !==
            JSON.stringify(promptReference))
      ) {
        throw new Error(
          'Execution prompt conflicts with the frozen RouteSnapshot.',
        );
      }
      if (promptReference) frozen.promptReference = promptReference;
      return frozen;
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
        planning?.routePolicyRevisionId ??
        selected.deployment.policyRevision ??
        'recorded-policy-v1',
      ...(planning?.routePolicyRevisionId
        ? { routePolicyRevisionId: planning.routePolicyRevisionId }
        : {}),
      ...(planning?.dataPolicyRevisionIdByDeploymentId.get(
        selected.deployment.id,
      )
        ? {
            dataPolicyRevisionId:
              planning.dataPolicyRevisionIdByDeploymentId.get(
                selected.deployment.id,
              )!,
          }
        : {}),
      ...(planning?.runtimeExclusionReasons.length
        ? {
            runtimeExclusionReasons: [
              ...planning.runtimeExclusionReasons,
            ],
          }
        : {}),
      ...(planning?.decisionExplanation
        ? {
            decisionExplanation: structuredClone(
              planning.decisionExplanation,
            ),
          }
        : {}),
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
      ...(planning?.maxAttempts !== undefined
        ? { maxAttempts: planning.maxAttempts }
        : {}),
      ...(planning?.fallbackAuthorized !== undefined
        ? { fallbackAuthorized: planning.fallbackAuthorized }
        : {}),
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
        accountIdentity: deployment.accountIdentity ?? null,
        endpointFingerprint: deployment.endpointFingerprint ?? null,
        deploymentLifecycleRevision: deployment.lifecycleRevision ?? null,
        dataPolicyRevisionId:
          planning?.dataPolicyRevisionIdByDeploymentId.get(deployment.id) ??
          null,
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
        ...(!deployment.unitPrice ? { pricingStatus: 'unknown' as const } : {}),
        currency:
          deployment.unitPrice?.currency ??
          (deployment.region === 'domestic' ? 'CNY' : 'USD'),
        unit: deployment.unitPrice?.unit ?? 'request',
        fallbackRank: index + 1,
        ...(deployment.activationEvidence
          ? { activationStatus: deployment.activationEvidence.status }
          : {}),
        capabilityProfile: this.routeCapabilityProfile(model, deployment),
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
      ...(promptReference ? { promptReference } : {}),
      ...(submission.exampleSetRevision
        ? { exampleSetRevision: submission.exampleSetRevision }
        : {}),
      createdAt: now(),
    };
  }

  private routeCapabilityProfile(
    model: CatalogModel,
    deployment: ModelDeployment,
  ): ModelCapabilityProfile | null {
    if (deployment.capabilityProfile) {
      return structuredClone(deployment.capabilityProfile);
    }
    if (!this.inferFixtureMediaCapabilityProfiles) return null;
    const mime =
      model.modality === 'image'
        ? 'image/*'
        : model.modality === 'video'
          ? 'video/*'
          : model.modality === 'audio'
            ? 'audio/*'
            : null;
    if (!mime) return null;
    return {
      vocabularyVersion: MODEL_CAPABILITY_VOCABULARY_VERSION,
      protocolCapabilities: {},
      modalities: [
        {
          mime,
          supported: true,
          basis: 'inferred',
          evidenceRef: `catalog-model:${model.id}:modality:${mime}`,
        },
      ],
      businessTags: [],
      modalityCapabilities: [],
    };
  }

  private async runtimeBindingFor(
    deployment: ModelDeployment,
    snapshot: RouteSnapshot,
    options: { useFrozenCredentialVersion: boolean },
  ): Promise<ProviderRuntimeBinding | undefined> {
    if (!this.capabilityHotAssembly) return undefined;
    // F-G-02: when freeze is requested, credentialVersion is mandatory.
    if (options.useFrozenCredentialVersion && !snapshot.credentialVersion) {
      throw new Error(
        `Runtime binding for ${deployment.id} requires frozen credentialVersion; refusing silent head.`,
      );
    }
    const binding = await this.capabilityHotAssembly.assembleForRequest({
      deploymentId: deployment.id,
      ...(snapshot.capabilityRevisionId
        ? { frozenCapabilityRevisionId: snapshot.capabilityRevisionId }
        : {}),
      ...(options.useFrozenCredentialVersion && snapshot.credentialVersion
        ? { frozenCredentialVersion: snapshot.credentialVersion }
        : {}),
      requiredScope:
        deployment.credentialMode === 'byok_strict' ||
        deployment.credentialOwner === 'workspace_byok'
          ? 'workspace_byok'
          : 'platform',
    });
    if (binding.deploymentId !== deployment.id) {
      throw new Error(
        `Runtime binding deployment ${binding.deploymentId} does not match ${deployment.id}.`,
      );
    }
    if (options.useFrozenCredentialVersion) {
      const resolvedCredentialVersion =
        binding.credential?.version ?? binding.entry.credentialVersion;
      if (
        resolvedCredentialVersion !== snapshot.credentialVersion
      ) {
        throw new Error(
          `Runtime credential version ${resolvedCredentialVersion ?? 'unbound'} does not match frozen ${snapshot.credentialVersion}.`,
        );
      }
      if (
        snapshot.credentialAccountId &&
        binding.entry.credentialAccountId !== snapshot.credentialAccountId
      ) {
        throw new Error(
          `Runtime credential account ${binding.entry.credentialAccountId ?? 'unbound'} does not match frozen ${snapshot.credentialAccountId}.`,
        );
      }
      return binding;
    }
    if (binding.entry.credentialAccountId) {
      snapshot.credentialAccountId = binding.entry.credentialAccountId;
    }
    if (binding.credential) {
      snapshot.credentialVersion = binding.credential.version;
    }
    return binding;
  }

  private async executeOnAdmittedChannel(input: {
    deployment: ModelDeployment;
    inFlightId: string;
    execute(): Promise<ProviderExecutionResponse>;
  }): Promise<ProviderExecutionResponse> {
    if (!this.capabilityHotAssembly) return input.execute();
    const channelId =
      input.deployment.executionChannelId ?? input.deployment.id;
    const admission =
      await this.capabilityHotAssembly.acquireChannelSubmission(
        channelId,
        input.inFlightId,
      );
    if (!admission.admitted) {
      return {
        kind: 'failure',
        acceptance: 'rejected_before_accept',
        errorCode: admission.errorCode,
        retryable: true,
        message:
          admission.message ??
          `Channel ${channelId} is not accepting new submissions.`,
        providerCost: {
          amount: 0,
          currency:
            input.deployment.region === 'domestic' ? 'CNY' : 'USD',
          usage: {},
        },
      };
    }
    const response = await input.execute();
    if (
      response.kind === 'completed' ||
      response.acceptance === 'rejected_before_accept'
    ) {
      await this.capabilityHotAssembly.releaseChannelSubmission(
        channelId,
        input.inFlightId,
      );
    }
    return response;
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

function structuredExecutionAcceptance(error: unknown): Acceptance {
  if (
    error &&
    typeof error === 'object' &&
    'acceptance' in error &&
    (error.acceptance === 'rejected_before_accept' ||
      error.acceptance === 'accepted' ||
      error.acceptance === 'acceptance_unknown')
  ) {
    return error.acceptance;
  }
  const statusCode =
    error &&
    typeof error === 'object' &&
    'statusCode' in error &&
    typeof error.statusCode === 'number'
      ? error.statusCode
      : undefined;
  return statusCode !== undefined && statusCode < 500
    ? 'rejected_before_accept'
    : 'acceptance_unknown';
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

interface TimedSubtitle {
  startSeconds: number;
  endSeconds: number;
  text: string;
}

export interface VideoCompositionPort {
  compose(input: {
    workspaceId: string;
    workflowId: string;
    compositionKey: string;
    clips: OwnedAsset[];
    aigcLabelEnabled: boolean;
    brandWatermarkText?: string;
    storyboardRevision?: string;
    subtitles?: TimedSubtitle[];
  }): Promise<OwnedAsset>;
}

export class RecordedVideoCompositionPort implements VideoCompositionPort {
  constructor(
    private readonly storage: {
      persistRecordedComposedVideo?(input: {
        bytes: Uint8Array;
        compositionEvidence: NonNullable<OwnedAsset['compositionEvidence']>;
        compositionKey: string;
        technicalValidation: NonNullable<OwnedAsset['technicalValidation']>;
        workflowId: string;
        workspaceId: string;
      }): Promise<OwnedAsset>;
      persistVideoCover?(input: {
        bytes: Uint8Array;
        compositionKey: string;
        workflowId: string;
        workspaceId: string;
      }): Promise<{ id: string; objectKey: string; sha256: string; sizeBytes: number; contentType: 'image/jpeg' }>;
    } = new MemoryModelAssetStorage(),
  ) {}

  async compose(input: {
    workspaceId: string;
    workflowId: string;
    compositionKey: string;
    clips: OwnedAsset[];
    aigcLabelEnabled: boolean;
    brandWatermarkText?: string;
    storyboardRevision?: string;
    subtitles?: TimedSubtitle[];
  }): Promise<OwnedAsset> {
    const durationSeconds =
      input.subtitles?.at(-1)?.endSeconds ?? input.clips.length * 15;
    const bytes = await recordedH264Video({ durationSeconds });
    const sha256 = hash(bytes);
    const cover = await this.storage?.persistVideoCover?.({
      bytes: Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=', 'base64'),
      compositionKey: input.compositionKey,
      workflowId: input.workflowId,
      workspaceId: input.workspaceId,
    });
    const compositionEvidence: NonNullable<
      OwnedAsset['compositionEvidence']
    > = {
      aigc: {
        requested: input.aigcLabelEnabled,
        visibleLabel: {
          actual: input.aigcLabelEnabled,
          validated: true,
          ...(input.aigcLabelEnabled ? { value: '内容由 AI 生成' } : {}),
        },
        implicitMetadata: {
          actual: input.aigcLabelEnabled,
          validated: true,
          ...(input.aigcLabelEnabled
            ? {
                contentId: input.workflowId,
                contentType: 'ai_generated',
                serviceCode: 'recorded-compose-v1',
                serviceProvider: 'recorded-video-composition',
              }
            : {}),
        },
        validationMethod: 'recorded_synthetic',
      },
      brandWatermark: {
        actual: Boolean(input.brandWatermarkText),
        requested: Boolean(input.brandWatermarkText),
        validated: true,
        validationMethod: 'recorded_synthetic',
        ...(input.brandWatermarkText ? { text: input.brandWatermarkText } : {}),
      },
      rendererRevision: 'recorded-video-composition-v1',
      clipCount: input.clips.length,
      sourceAssetIds: input.clips.map((clip) => clip.id),
      outputSha256: sha256,
      outputSizeBytes: bytes.byteLength,
      durationSeconds,
      ...(cover ? { delivery: {
        compositionRevision: input.compositionKey,
        storyboardRevision: input.storyboardRevision ?? 'legacy-recorded-storyboard',
        workflowId: input.workflowId,
        outputVideoSha256: sha256,
        cover: { ...cover, validationMethod: 'recorded_synthetic' as const },
        subtitles: {
          durationSeconds,
          format: 'srt' as const,
          text: serializeRecordedSrt(input.subtitles ?? [{ text: 'Recorded composition', startSeconds: 0, endSeconds: input.clips.length * 15 }]),
          validationMethod: 'recorded_synthetic' as const,
        },
      }} : {}),
    };
    const technicalValidation: NonNullable<
      OwnedAsset['technicalValidation']
    > = {
      playable: true,
      codec: 'h264',
      durationSeconds,
      width: 320,
      height: 568,
      hashVerified: true,
      evidenceKind: 'recorded_synthetic',
    };
    const recorded: OwnedAsset = {
      id: `composition-${hash(Buffer.from(input.compositionKey)).slice(0, 24)}`,
      objectKey: `${input.workspaceId}/composed/${input.workflowId}-${sha256}.mp4`,
      sha256,
      sizeBytes: bytes.byteLength,
      contentType: 'video/mp4',
      compositionEvidence,
      technicalValidation,
    };
    return this.storage?.persistRecordedComposedVideo
      ? this.storage.persistRecordedComposedVideo({
          bytes,
          compositionEvidence,
          compositionKey: input.compositionKey,
          technicalValidation,
          workflowId: input.workflowId,
          workspaceId: input.workspaceId,
        })
      : recorded;
  }
}

function serializeRecordedSrt(
  subtitles: TimedSubtitle[],
) {
  const time = (seconds: number) =>
    new Date(Math.round(seconds * 1000))
      .toISOString()
      .slice(11, 23)
      .replace('.', ',');
  return subtitles
    .map(
      (item, index) =>
        `${index + 1}\n${time(item.startSeconds)} --> ${time(item.endSeconds)}\n${item.text}\n`,
    )
    .join('\n');
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

export class VersionedHumanCalibratedVideoQualityScorer implements VideoQualityScoringPort {
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
      },
    };
  }
}

/**
 * E2E-only scorer for the recorded media runtime. Its ordered scores represent
 * the checked-in fixture evaluation set; production never selects this scorer.
 */
export class RecordedFixtureVideoQualityScorer implements VideoQualityScoringPort {
  private readonly fallback = new VersionedHumanCalibratedVideoQualityScorer();

  async score(input: Parameters<VideoQualityScoringPort['score']>[0]) {
    if (
      !input.asset.sourceTaskRef?.startsWith('recorded-task-')
    ) {
      return this.fallback.score(input);
    }
    return {
      score: 0.8 - input.candidateIndex * 0.02,
      dimensions: {
        humanAnatomy: 0.82 - input.candidateIndex * 0.02,
        sourceConsistency: 0.8 - input.candidateIndex * 0.02,
        crossShotContinuity: 0.79 - input.candidateIndex * 0.02,
        subtitleOcclusion: 0.78 - input.candidateIndex * 0.02,
        publishRisk: 0.76 - input.candidateIndex * 0.02,
      },
      publishWarnings: ['recorded_fixture_requires_live_provider_review'],
      scorerRevision: 'recorded-fixture-video-quality-v1',
      calibration: 'recorded_human_fixture' as const,
      calibrationEvidence: {
        datasetRevision: 'recorded-e2e-video-quality-v1',
        sampleId: `recorded-candidate-${input.candidateIndex + 1}`,
        raterCount: 4,
        annotatedAt: '2026-07-20T00:00:00.000Z',
        assetFingerprint: input.asset.sha256.slice(0, 16),
        priorAssetFingerprints: input.priorSelectedAssets.map((asset) =>
          asset.sha256.slice(0, 16)
        ),
        peerCandidateFingerprints: input.peerCandidateAssets.map((asset) =>
          asset.sha256.slice(0, 16)
        ),
      },
    };
  }
}

// Pure video-workflow contract types (S1 / #87) — re-export for back-compat.
// Runtime store/runner implementations remain below.
// WT-E / #102: generic Task/Job/Asset records are authority; VideoWorkflow is derived.
export type {
  CreateVideoWorkflowInput,
  DurableVideoCandidate,
  DurableVideoShot,
  DurableVideoWorkflow,
  DurableVideoWorkflowSaveOptions,
  DurableVideoWorkflowStore,
  EditVideoWorkflowInput,
  SelectVideoCandidateInput,
  VideoExecutionContract,
  VideoWorkflowShotInput,
} from './video-workflow-contract.js';
export {
  VideoWorkflowCancellationError,
  VideoWorkflowConcurrencyError,
} from './video-workflow-contract.js';
export type {
  CanonicalVideoAssets,
  AsyncCanonicalVideoRunStore,
  CanonicalVideoJob,
  CanonicalVideoRun,
  CanonicalVideoRunStatus,
  CanonicalVideoRunStore,
  CanonicalVideoTask,
  VideoWorkflowCanonicalCommandPort,
} from './video-workflow-canonical.js';
export {
  InMemoryCanonicalVideoRunStore,
  VideoWorkflowCanonicalCommands,
  VideoWorkflowProjectionReadFacade,
  VideoWorkflowProjectionReadonlyError,
} from './video-workflow-canonical.js';
export {
  assertPublicProjectionIsSanitized,
  isSameDurableVideoWorkflow,
  liftDurableToCanonical,
  projectDurableVideoWorkflow,
  projectVideoWorkflowPublic,
} from './video-workflow-projection.js';
import type {
  CreateVideoWorkflowInput,
  DurableVideoCandidate,
  DurableVideoShot,
  DurableVideoWorkflow,
  DurableVideoWorkflowSaveOptions,
  DurableVideoWorkflowStore,
  EditVideoWorkflowInput,
  SelectVideoCandidateInput,
  VideoExecutionContract,
  VideoWorkflowShotInput,
} from './video-workflow-contract.js';
import {
  VideoWorkflowCancellationError,
  VideoWorkflowConcurrencyError,
} from './video-workflow-contract.js';
import {
  VideoWorkflowCanonicalCommands,
  type CanonicalVideoRunStore,
} from './video-workflow-canonical.js';

/**
 * @deprecated Adapter only — sole write authority is CanonicalVideoRunStore.
 * Prefer VideoWorkflowCanonicalCommandPort for new call sites.
 * save/claimRun/requestCancel delegate to canonical commands then project.
 */
export class InMemoryDurableVideoWorkflowStore implements DurableVideoWorkflowStore {
  private readonly commands: VideoWorkflowCanonicalCommands;

  constructor(canonical?: CanonicalVideoRunStore) {
    this.commands = new VideoWorkflowCanonicalCommands(canonical);
  }

  /** Underlying canonical write authority (for tests / projection facades). */
  get canonicalStore(): CanonicalVideoRunStore {
    return this.commands.store;
  }

  /** Canonical command port shared with this adapter instance. */
  get canonicalCommands(): VideoWorkflowCanonicalCommands {
    return this.commands;
  }

  get(id: string) {
    return this.commands.get(id);
  }

  list(workspaceId: string, actorId: string) {
    return this.commands.list(workspaceId, actorId);
  }

  findLatest(workspaceId: string, actorId: string, workId?: string) {
    return this.commands.findLatest(workspaceId, actorId, workId);
  }

  /** Import a legacy durable row into canonical (migration dual-read seed). */
  restore(workflow: DurableVideoWorkflow) {
    return this.commands.restoreFromLegacy(
      normalizeStoredVideoWorkflow(workflow)
    );
  }

  /**
   * @deprecated Prefer VideoWorkflowCanonicalCommands.checkpoint / createDraft.
   * Accepts a durable projection as a patch applied onto canonical truth.
   */
  save(
    workflow: DurableVideoWorkflow,
    options: DurableVideoWorkflowSaveOptions = {}
  ) {
    return this.commands.checkpoint(
      normalizeStoredVideoWorkflow(workflow),
      options
    );
  }

  claimRun(id: string, workspaceId: string, leaseToken: string) {
    return this.commands.claimRun(id, workspaceId, leaseToken);
  }

  requestCancel(id: string, workspaceId: string, requestedAt: string) {
    return this.commands.requestCancel(id, workspaceId, requestedAt);
  }

  edit(input: EditVideoWorkflowInput, editedAt: string) {
    return this.commands.edit(input, () => Date.parse(editedAt));
  }

  assertRunnable(
    id: string,
    workspaceId: string,
    revision: number,
    leaseToken: string
  ) {
    this.commands.assertRunnable(id, workspaceId, revision, leaseToken);
  }
}

/** Thin, restart-safe business runner. A pg-boss JobPort can call it repeatedly. */
export class ContentWorkflowRunner {
  constructor(
    private readonly models: ModelSupplyApplicationService,
    private readonly composer: VideoCompositionPort = new RecordedVideoCompositionPort(),
    private readonly workflows: DurableVideoWorkflowStore = new InMemoryDurableVideoWorkflowStore(),
    private readonly qualityScorer: VideoQualityScoringPort = new VersionedHumanCalibratedVideoQualityScorer(),
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
      ...(input.billingTaskId
        ? {
            billingTaskId: requireVideoWorkflowText(
              input.billingTaskId,
              'billingTaskId',
            ),
          }
        : {}),
      ...(input.billingQuoteRevision
        ? {
            billingQuoteRevision: requireVideoWorkflowText(
              input.billingQuoteRevision,
              'billingQuoteRevision',
            ),
          }
        : {}),
      ...(input.approvalReceiptId
        ? {
            approvalReceiptId: requireVideoWorkflowText(
              input.approvalReceiptId,
              'approvalReceiptId',
            ),
          }
        : {}),
      ...(sourceWorkflow ? { derivedFromWorkflowId: sourceWorkflow.id } : {}),
      ...(input.deliveryMode ? { deliveryMode: input.deliveryMode } : {}),
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
      ...(input.executionContract
        ? { executionContract: normalizeVideoExecutionContract(input) }
        : {}),
      shots: normalizeVideoShots(input.shots, input.executionContract),
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

  editVideoWorkflow(input: EditVideoWorkflowInput) {
    if (!this.workflows.edit) {
      throw new Error('Canonical video editing is not configured.');
    }
    return this.workflows.edit(
      input,
      new Date(this.clock()).toISOString(),
    );
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
          input: videoShotSubmissionInput(workflow, shot),
          productUsageQuantity:
            shotIndex === 0 && candidateIndex === 0 ? 1 : 0,
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
          input: videoShotSubmissionInput(workflow, shot),
          productUsageQuantity:
            shotIndex === 0 && candidateIndex === 0 ? 1 : 0,
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
    }

    for (const candidate of shot.candidates) {
      if (!candidate.asset) {
        return failDurableVideoWorkflow(
          workflow,
          'MISSING_VIDEO_CANDIDATE_ASSET',
          input,
          clock
        );
      }
      if (!candidate.quality) {
        await guardVideoWorkflowRun(workflow, input.guard);
        const assessment = await input.qualityScorer.score({
          workflowId: workflow.id,
          workspaceId: workflow.workspaceId,
          storyboardRevision: workflow.storyboardRevision,
          shotId: shot.id,
          prompt: shot.prompt,
          candidateIndex: candidate.index,
          asset: structuredClone(candidate.asset),
          priorSelectedAssets: structuredClone(workflow.clipAssets),
          peerCandidateAssets: shot.candidates.flatMap((peer) =>
            peer.asset && peer.index !== candidate.index
              ? [structuredClone(peer.asset)]
              : []
          ),
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
      if (!allHumanCalibrated || !topScoreIsUnique) {
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
    const subtitles = videoWorkflowSubtitles(workflow);
    await guardVideoWorkflowRun(workflow, input.guard);
    let composedAsset: OwnedAsset;
    composedAsset = await input.composer.compose({
      workspaceId: workflow.workspaceId,
      workflowId: workflow.id,
      compositionKey,
      clips: workflow.clipAssets,
      aigcLabelEnabled: workflow.aigcLabelEnabled,
      ...(workflow.brandWatermarkText
        ? { brandWatermarkText: workflow.brandWatermarkText }
        : {}),
      storyboardRevision: workflow.storyboardRevision,
      subtitles,
    });
    if (!hasValidComposedVideoTechnicalEvidence(composedAsset)) {
      return failDurableVideoWorkflow(
        workflow,
        'VIDEO_ASSET_TECHNICAL_VALIDATION_FAILED',
        input,
        clock
      );
    }
    if (!hasValidComposedVideoProvenance(composedAsset, workflow)) {
      return failDurableVideoWorkflow(
        workflow,
        'VIDEO_ASSET_PROVENANCE_VALIDATION_FAILED',
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
    'checkpoint' | 'guard' | 'models'
  >,
  clock: () => number
) {
  workflow.status = 'failed';
  workflow.failureCode = failureCode;
  workflow.composedAsset = undefined;
  // Td-2: first shot/first candidate holds productUsageQuantity=1; when outer
  // compose/label/validation fails after that child committed, restore allowance.
  await refundOuterVideoUsageAfterFailure(workflow, input.models, failureCode);
  await saveWorkflowCheckpoint(workflow, input.checkpoint, input.guard, clock);
  return structuredClone(workflow);
}

async function refundOuterVideoUsageAfterFailure(
  workflow: DurableVideoWorkflow,
  models: ModelSupplyApplicationService,
  failureCode: string
) {
  const primary = workflow.shots[0]?.candidates.find(
    (candidate) =>
      candidate.index === 0 &&
      (candidate.status === 'generated' || candidate.status === 'completed')
  );
  const jobId = primary?.attempt.jobId;
  if (!jobId) return;
  await models.compensateOuterVideoUsage({
    workspaceId: workflow.workspaceId,
    actorId: workflow.actorId,
    jobId,
    reason: `outer_video_failed:${failureCode}`,
    correlationId: `video-workflow:${workflow.id}`,
  });
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

function hasValidComposedVideoProvenance(
  asset: OwnedAsset,
  workflow: DurableVideoWorkflow
) {
  const evidence = asset.compositionEvidence;
  const delivery = evidence?.delivery;
  const expectedDuration = workflow.executionContract?.durationSeconds;
  if (
    !evidence ||
    !delivery ||
    evidence.outputSha256 !== asset.sha256 ||
    evidence.outputSizeBytes !== asset.sizeBytes ||
    delivery.outputVideoSha256 !== asset.sha256 ||
    delivery.workflowId !== workflow.id ||
    delivery.storyboardRevision !== workflow.storyboardRevision ||
    delivery.compositionRevision !== videoCompositionKey(workflow) ||
    !Number.isFinite(evidence.durationSeconds) ||
    evidence.durationSeconds !== delivery.subtitles.durationSeconds ||
    (expectedDuration !== undefined &&
      evidence.durationSeconds !== expectedDuration) ||
    delivery.subtitles.text.trim().length === 0 ||
    delivery.cover.contentType !== 'image/jpeg' ||
    delivery.cover.id.trim().length === 0 ||
    !delivery.cover.objectKey.startsWith(`${workflow.workspaceId}/`) ||
    delivery.cover.objectKey.includes('://') ||
    delivery.cover.objectKey
      .split('/')
      .some((segment) => !segment || segment === '.' || segment === '..') ||
    !/^[a-f0-9]{64}$/u.test(delivery.cover.sha256) ||
    !Number.isSafeInteger(delivery.cover.sizeBytes) ||
    delivery.cover.sizeBytes < 1 ||
    evidence.clipCount !== workflow.clipAssets.length ||
    JSON.stringify(evidence.sourceAssetIds) !==
      JSON.stringify(workflow.clipAssets.map((clip) => clip.id)) ||
    evidence.aigc.requested !== workflow.aigcLabelEnabled ||
    evidence.brandWatermark.requested !== Boolean(workflow.brandWatermarkText)
  ) {
    return false;
  }
  if (
    workflow.aigcLabelEnabled
      ? !evidence.aigc.visibleLabel.actual ||
        !evidence.aigc.visibleLabel.validated ||
        !evidence.aigc.implicitMetadata.actual ||
        !evidence.aigc.implicitMetadata.validated
      : evidence.aigc.visibleLabel.actual ||
        evidence.aigc.implicitMetadata.actual
  ) {
    return false;
  }
  return workflow.brandWatermarkText
    ? evidence.brandWatermark.actual &&
        evidence.brandWatermark.validated &&
        evidence.brandWatermark.text === workflow.brandWatermarkText
    : !evidence.brandWatermark.actual;
}

function normalizeVideoShots(
  shots: CreateVideoWorkflowInput['shots'],
  executionContract?: VideoExecutionContract
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
            ...(shot.durationSeconds === undefined
              ? {}
              : { durationSeconds: shot.durationSeconds }),
            ...(shot.height === undefined ? {} : { height: shot.height }),
            ...(shot.width === undefined ? {} : { width: shot.width }),
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
    if (executionContract) {
      if (
        !Number.isInteger(normalized.durationSeconds) ||
        (normalized.durationSeconds ?? 0) < 1 ||
        !Number.isInteger(normalized.width) ||
        (normalized.width ?? 0) < 1 ||
        !Number.isInteger(normalized.height) ||
        (normalized.height ?? 0) < 1
      ) {
        throw new Error(
          'Every contracted video shot requires positive integer duration, width, and height.'
        );
      }
      const divisor = greatestCommonDivisor(
        normalized.width!,
        normalized.height!
      );
      if (
        `${normalized.width! / divisor}:${normalized.height! / divisor}` !==
        executionContract.aspectRatio
      ) {
        throw new Error(
          'Every video shot must match the frozen contract aspect ratio.'
        );
      }
    }
    return { ...normalized, candidates: [] };
  });
  if (
    new Set(normalizedShots.map((shot) => shot.id)).size !==
    normalizedShots.length
  ) {
    throw new Error('Video shot ids must be unique within a workflow.');
  }
  if (
    executionContract &&
    normalizedShots.reduce(
      (total, shot) => total + (shot.durationSeconds ?? 0),
      0
    ) !== executionContract.durationSeconds
  ) {
    throw new Error(
      'Video shot durations must sum to the frozen contract duration.'
    );
  }
  return normalizedShots;
}

function normalizeVideoExecutionContract(
  input: CreateVideoWorkflowInput
): VideoExecutionContract {
  const contract = structuredClone(input.executionContract!);
  if (
    contract.operation !== 'video.generate' ||
    !['1:1', '3:4', '9:16'].includes(contract.aspectRatio) ||
    !Number.isInteger(contract.durationSeconds) ||
    contract.durationSeconds < 1 ||
    contract.catalogModelId !== input.catalogModelId ||
    contract.aigcLabelEnabled !== (input.aigcLabelEnabled === true) ||
    JSON.stringify(normalizeDataClass(contract.dataClass)) !==
      JSON.stringify(normalizeDataClass(input.dataClass))
  ) {
    throw new Error(
      'Video workflow fields must match a valid frozen execution contract.'
    );
  }
  return contract;
}

function videoShotSubmissionInput(
  workflow: DurableVideoWorkflow,
  shot: DurableVideoShot
): NonNullable<ModelSupplySubmission['input']> {
  return {
    ...(workflow.referenceAssetIds?.length
      ? { referenceAssetIds: [...workflow.referenceAssetIds] }
      : {}),
    ...(shot.durationSeconds === undefined
      ? {}
      : { durationSeconds: shot.durationSeconds }),
    ...(shot.height === undefined ? {} : { height: shot.height }),
    ...(shot.width === undefined ? {} : { width: shot.width }),
  };
}

function greatestCommonDivisor(left: number, right: number): number {
  return right === 0 ? left : greatestCommonDivisor(right, left % right);
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
      ))
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
    billingTaskId: input.billingTaskId,
    billingQuoteRevision: input.billingQuoteRevision,
    approvalReceiptId: input.approvalReceiptId,
    derivedFromWorkflowId: input.derivedFromWorkflowId,
    deliveryMode: input.deliveryMode,
    dataClass: normalizeDataClass(input.dataClass),
    aigcLabelEnabled: input.aigcLabelEnabled === true,
    brandWatermarkText: input.brandWatermarkText?.trim() || undefined,
    storyboardRevision: input.storyboardRevision,
    catalogModelId: input.catalogModelId,
    referenceAssetIds: normalizeReferenceAssetIds(input.referenceAssetIds),
    executionContract: input.executionContract
      ? normalizeVideoExecutionContract(input)
      : undefined,
    shots: normalizeVideoShots(input.shots, input.executionContract).map(
      ({ candidates: _candidates, ...shot }) => shot
    ),
  };
  const stored = {
    workspaceId: existing.workspaceId,
    actorId: existing.actorId,
    workId: existing.workId,
    billingTaskId: existing.billingTaskId,
    billingQuoteRevision: existing.billingQuoteRevision,
    approvalReceiptId: existing.approvalReceiptId,
    derivedFromWorkflowId: existing.derivedFromWorkflowId,
    deliveryMode: existing.deliveryMode,
    dataClass: existing.dataClass,
    aigcLabelEnabled: existing.aigcLabelEnabled,
    brandWatermarkText: existing.brandWatermarkText,
    storyboardRevision: existing.storyboardRevision,
    catalogModelId: existing.catalogModelId,
    referenceAssetIds: normalizeReferenceAssetIds(existing.referenceAssetIds),
    executionContract: existing.executionContract,
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

function videoWorkflowSubtitles(workflow: DurableVideoWorkflow) {
  const frozenTotal = workflow.executionContract?.durationSeconds;
  const explicitTotal = workflow.shots.reduce(
    (sum, shot) => sum + (shot.durationSeconds ?? 0),
    0,
  );
  const total =
    frozenTotal ?? (explicitTotal > 0 ? explicitTotal : workflow.shots.length * 15);
  if (workflow.subtitleText?.trim()) {
    return [{ text: workflow.subtitleText.trim(), startSeconds: 0, endSeconds: total }];
  }
  let cursor = 0;
  return workflow.shots.map((shot, index) => {
    const startSeconds = cursor;
    const remaining = total - cursor;
    const remainingShots = workflow.shots.length - index;
    cursor += shot.durationSeconds ?? remaining / remainingShots;
    return { text: shot.prompt, startSeconds, endSeconds: cursor };
  });
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
export * from './asset-storage-from-env.js';
export * from './ai-sdk-runner.js';
export * from './audio-activation-gate.js';
export * from './catalog.js';
export * from './copy-provider-bridge.js';
export * from './duration-estimate.js';
export * from './foundation-ledger.js';
export * from './foundation-module.js';
export * from './filesystem-asset-storage.js';
export * from './media-generation-workflow.js';
export * from './media-tools.js';
export * from './media-tool-paths.js';
export * from './postgres-repository.js';
export * from './reference-asset-resolver.js';
export * from './runtime-config.js';
export * from './runtime-assembly.js';
export * from './s3-asset-storage.js';
export * from './tuzi-media-adapter.js';
export * from './volcengine-tts-adapter.js';
export * from './volcengine-tts-lifecycle.js';
export * from './volcengine-tts-node-socket.js';
export * from './volcengine-tts-protocol.js';
export * from './video-regeneration.js';
export * from './video-regeneration-foundation.js';
export * from './video-regeneration-postgres.js';
export * from './video-regeneration-runtime.js';
export * from './video-workflow-canonical-postgres.js';
export * from './video-workflow-canonical.js';
export * from './video-asset-validation.js';
