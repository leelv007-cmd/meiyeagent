import {
  BOUNDED_EXECUTION_LIMITS,
  type BoundedExecutionSnapshot,
  HARNESS_STAGES,
  questionCardSchema,
  type HarnessStage,
  type ContentPackage,
  type ContentPackageRevisionDelivery,
  type ExecutionUnit,
  type MerchantReport,
  type CreativeRecommendationDecisionTrace,
  type HarnessExperienceBasis,
  type NoteStyleCandidates,
  type QuestionCard,
  type StructuredDecisionInput,
  type ExecutionPlanSnapshot,
  type PlanConfirmationDecision,
} from '@meiye/contracts';
import { projectHarnessExperienceBasis } from './experience-basis.js';

import {
  HarnessSelectionError,
  isNonSelfCorrectableSelectionError,
  type DecisionTraceFragment,
} from './execution-selection.js';
import {
  BoundedExecutionResumeError,
  isBoundedExecutionSuspension,
  type BoundedExecutionSuspension,
} from './bounded-execution-controller.js';
import type {
  BriefContextBundle,
  IntentDeclaration,
  ExecutionBrief,
  StructuredNodeMetricsSnapshot,
} from './structured-nodes.js';
import type {
  HarnessExecutionAssemblyStep,
  HarnessSkillManifestSnapshot,
  HarnessWorkflowInput,
} from './task-admission.js';
import type { StyleAnalysisResult } from './xhs-style-analysis.js';
import { HarnessExecutionFencePauseError } from './context-fence.js';
import {
  emitVideoScenesArtifactProgress,
  nonBlockingArtifactEmitter,
  type ArtifactProgressEmitterPort,
} from './artifact-progress-emitter.js';
import {
  sceneRegenerationEffectSuffix,
  videoFailedSceneLabels,
  videoSceneBillableUnits,
  videoSceneDeliveredUsable,
  videoUnresolvedSceneIndexes,
  type VideoSceneExecutionResult,
} from './video-scene-execution.js';
import type {
  ResolvedSkillInstruction,
  SkillInvocationReceipt,
} from '../skills/types.js';
import { promptTraceReference } from './langfuse-prompts.js';
import type { HarnessPolicyInput } from './policy-gates.js';
import {
  merchantConfirmedMaterialsContinuationNotice,
  merchantGenericModeNotice,
  merchantIdentityVoiceNotice,
  merchantNeutralIndustryContinuationNotice,
  merchantNoteProgressMessage,
  merchantNotePartialConsistency,
  merchantNoteStyleUnavailable,
  merchantNoteStyleQuestion,
  merchantBriefFallbackNotice,
  merchantPartialFailure,
  merchantPartialDeliveryReport,
  merchantProgressMessage,
  merchantStyleAnalysisProgress,
  merchantTaskSummary,
  merchantVideoPartialScenes,
} from './merchant-delivery-language.js';
import type { RecipeFactSatisfaction } from './fact-satisfaction.js';
import { mediaBoundedCurrentBestSchema } from './media-bounded-execution.js';
import {
  isMakeSnapshotConsumePath,
  materializeCopyBriefFromSnapshot,
  materializeIntentFromSnapshot,
  materializeMediaBriefFromSnapshot,
  materializeNoteBriefFromSnapshot,
  resolveMakeSnapshotConsume,
  snapshotConsumeTracePayload,
  validateContextBundleAgainstSnapshot,
} from './make-snapshot-consume.js';
import {
  confirmPaidGenerationExecution,
  type ConfirmPaidGenerationExecutionInput,
  type PaidGenerationNoteOutline,
} from './paid-generation-confirmation.js';
import type { CreateExecutionConfirmationAuthorityInput } from '../agent-session/execution-confirmation-authority.js';
import type { SnapshotLiveFacts } from './execution-plan-admission.js';
import { createNotePageProgressReporter } from './note-page-execution-frame.js';
import type {
  NotePagePlanLike,
  NotePageProgressFrameEvent,
  NotePageProgressReporter,
} from './note-page-execution-frame.js';
import type { MakeSteeringBoundaryPort } from './make-steering-boundary.js';
import type {
  CreateExecutionConfirmationInput,
  CreateExecutionConfirmationResult,
} from '../agent-session/execution-confirmation-service.js';
import {
  assertCompiledCarrierPlanCompatible,
  type CompiledPrimitiveHandlers,
  type CompiledPrimitiveId,
  compiledStepKey,
  executeCompiledCarrierPlan,
  resolveCompiledCarrierExecution,
} from './compiled-carrier-executor.js';
import type { ContentCarrierKind } from './carrier-unit-recipes.js';
import { attachStageTaxonomy } from './five-stage-trace-taxonomy.js';
import type { StageTaxonomyPayload } from './five-stage-trace-taxonomy.js';
import { projectLegacyShadowObservation } from './legacy-shadow-observation-emitter.js';

export {
  confirmPaidGenerationExecution,
  triggersPaidMediaExecution,
} from './paid-generation-confirmation.js';
export {
  notePageOrderLabel,
  createNotePageProgressReporter,
} from './note-page-execution-frame.js';

type CopyBrief = Extract<ExecutionBrief, { kind: 'copy' }>;
type MediaBrief = Exclude<ExecutionBrief, { kind: 'copy' }>;

interface MeasuredCopyBrief {
  brief: CopyBrief;
  metrics: StructuredNodeMetricsSnapshot;
  degraded?: boolean;
}

interface MeasuredMediaBrief {
  brief: MediaBrief;
  metrics: StructuredNodeMetricsSnapshot;
}

export interface HarnessSelectionResult {
  candidates: Array<{
    body: string;
    candidateId: string;
    conversionHook: string;
    score: number;
    title: string;
  }>;
  winner: {
    candidateId: string;
    title: string;
    body: string;
    conversionHook: string;
  };
  trace: DecisionTraceFragment;
  boundedExecution?: BoundedExecutionSnapshot;
  /** Server-only exact auxiliary effect selected after the mutable-context fence. */
  merchantExecutionEffectKey?: string;
}

export interface HarnessMediaSelectionResult {
  asset: NonNullable<ContentPackage['generated']['ownedAssets']>[number];
  boundedCurrentBest?: unknown;
  boundedExecution?: BoundedExecutionSnapshot;
  childRun: ContentPackage['generated']['childRuns'][number];
  kind: MediaBrief['kind'];
  measuredDurationSeconds?: number;
  /**
   * V31-36: per-scene execution outcomes for video (absent on image).
   * Core is the sole authority — UI must not infer failure from missing files.
   */
  sceneResults?: VideoSceneExecutionResult[];
  trace: DecisionTraceFragment;
  /** Server-only exact auxiliary effect selected after the mutable-context fence. */
  merchantExecutionEffectKey?: string;
}

export type { VideoSceneExecutionResult };

export interface HarnessNoteBrief {
  kind: 'image_text_note';
  candidates: NoteStyleCandidates;
  styleAnalysis?: StyleAnalysisResult;
}

export interface HarnessNoteSelectionResult {
  enhancementJudge?:
    | { status: 'configured' }
    | {
        status: 'unconfigured';
        reason: 'self_correction_judge_unconfigured';
      };
  auditSignals: Array<{
    eventType:
      | 'note_consistency_evaluated'
      | 'note_page_regenerated'
      | 'note_style_selected';
    payload: Record<string, unknown>;
  }>;
  childRuns: ContentPackage['generated']['childRuns'];
  ownedAssets: NonNullable<ContentPackage['generated']['ownedAssets']>;
  partial?: {
    unresolvedPageIds: string[];
    reason: 'consistency_remained_incomplete' | 'second_evaluation_failed';
  };
  selectedStyleId: string;
  trace: DecisionTraceFragment;
  version: NonNullable<ContentPackage['versions'][number]['note']>;
}

export type HarnessEffectRunner = <Output>(
  effectIdempotencyKey: string,
  operation: () => Promise<Output>,
) => Promise<Output>;

export interface HarnessContextSnapshot {
  bundle: BriefContextBundle;
  factsRevision?: number;
  activeFactReferences?: Array<{ key: string; sourceRef: string }>;
  activeFacts?: Array<{
    key: string;
    value: unknown;
    sourceRef: string;
    effectiveFrom: string;
    expiresAt: string | null;
  }>;
  policyReferences: Pick<
    HarnessPolicyInput,
    'sourceRefs' | 'rightsRefs' | 'identityRefs'
  >;
}

export interface HarnessSharedStagePorts {
  recordObservabilityEvent?(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    idempotencyKey: string;
    event:
      | {
          eventType: 'bounded_execution.suspended';
          payload: {
            snapshot: BoundedExecutionSnapshot;
            currentBest: unknown;
            unmetExplanation: string;
            resumable: true;
          };
        }
      | {
          eventType: 'bounded_execution.resumed';
          payload: {
            previousSnapshot: BoundedExecutionSnapshot;
            snapshot: BoundedExecutionSnapshot;
            decisionId: string;
          };
        }
      | {
          eventType: 'note_page_regenerated';
          payload: unknown;
        };
    promptKey?: 'copyCandidate' | 'noteTextBlock';
  }): Promise<void>;
  recordExecutionAssemblyStep?(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    step: Extract<
      HarnessExecutionAssemblyStep,
      'execution_check' | 'event_persistence'
    >;
  }): Promise<void>;
  getExecutionConfirmationDecision?: (
    workspaceId: string,
    requestId: string,
  ) => Promise<PlanConfirmationDecision | null>;
  admitExecutionPlanSnapshot?: (input: {
    workflowId: string;
    workspaceId: string;
    snapshot: ExecutionPlanSnapshot;
    live?: SnapshotLiveFacts;
  }) => Promise<ExecutionPlanSnapshot>;
  resolveExecutionPlanLiveFacts?: (input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    snapshot: ExecutionPlanSnapshot;
  }) => Promise<SnapshotLiveFacts | undefined>;
  refreshExecutionPlanLiveBindings?: ConfirmPaidGenerationExecutionInput['refreshExecutionPlanLiveBindings'];
	createRepricedPaidExecutionSuccessor?: ConfirmPaidGenerationExecutionInput['createRepricedPaidExecutionSuccessor'];
  createExecutionConfirmationRequest?: (
    input: CreateExecutionConfirmationAuthorityInput,
  ) => Promise<CreateExecutionConfirmationResult>;
  putExecutionConfirmationAuthority?: ConfirmPaidGenerationExecutionInput['putExecutionConfirmationAuthority'];
  resolveStageSkills?(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    stage: HarnessStage;
    userSelectedSkillRefs?: readonly string[];
    skillRevisionRefs?: readonly string[];
    skillManifestSnapshots?: readonly HarnessSkillManifestSnapshot[];
  }): Promise<{
    instructions: ResolvedSkillInstruction[];
    receipts: SkillInvocationReceipt[];
  }>;
  nameIntent(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    round?: number;
    skillInstructions?: readonly ResolvedSkillInstruction[];
  }): Promise<{
    declaration: IntentDeclaration;
    blockingQuestion: QuestionCard | null;
    metrics?: StructuredNodeMetricsSnapshot;
    fallbackUsed?: boolean;
    gapGrounding?: {
      activeConfirmedFactCount: number;
      answerableConfirmedFactCount: number;
    };
  }>;
  injectContext(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    declaration: IntentDeclaration;
    skillInstructions?: readonly ResolvedSkillInstruction[];
  }): Promise<HarnessContextSnapshot>;
  fenceContext(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    declaration: IntentDeclaration;
    context: HarnessContextSnapshot;
  }): Promise<HarnessContextSnapshot>;
  /** Records an explicit merchant acknowledgement for one exact live-facts diff. */
  acknowledgeContextFence?(input: {
    workflowId: string;
    diff: import('./execution-plan-admission.js').SnapshotStaleDiff;
  }): Promise<void> | void;
  assessFacts?(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    declaration: IntentDeclaration;
    context: HarnessContextSnapshot;
  }): Promise<RecipeFactSatisfaction | null>;
}

export interface HarnessCopyStagePorts {
  compileBrief(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    declaration: IntentDeclaration;
    context: HarnessContextSnapshot;
    allowedFactRefs?: readonly string[];
    skillInstructions?: readonly ResolvedSkillInstruction[];
  }): Promise<CopyBrief | MeasuredCopyBrief>;
  executeAndSelect(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    brief: CopyBrief;
    context: HarnessContextSnapshot;
    skillInstructions?: readonly ResolvedSkillInstruction[];
    onToken?: (token: {
      candidateId: string;
      channel: 'copy.title' | 'copy.body' | 'copy.cta';
      delta: string;
    }) => Promise<void> | void;
  }): Promise<HarnessSelectionResult>;
  executeAndSelectBounded?(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    brief: CopyBrief;
    context: HarnessContextSnapshot;
    skillInstructions?: readonly ResolvedSkillInstruction[];
    onToken?: (token: {
      candidateId: string;
      channel: 'copy.title' | 'copy.body' | 'copy.cta';
      delta: string;
    }) => Promise<void> | void;
    boundedResume?: BoundedExecutionSuspension<unknown>;
  }): Promise<HarnessSelectionResult | BoundedExecutionSuspension<unknown>>;
  assembleAndDeliver(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    declaration: IntentDeclaration;
    context: HarnessContextSnapshot;
    allowedFactRefs?: readonly string[];
    brief: CopyBrief;
    selection: HarnessSelectionResult;
    skillInstructions?: readonly ResolvedSkillInstruction[];
  }): Promise<ContentPackageRevisionDelivery>;
}

export interface HarnessStagePorts
  extends HarnessSharedStagePorts, HarnessCopyStagePorts {}

export interface HarnessMediaExecutionStagePorts {
  compileMediaBrief(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    declaration: IntentDeclaration;
    context: HarnessContextSnapshot;
    allowedFactRefs?: readonly string[];
    skillInstructions?: readonly ResolvedSkillInstruction[];
  }): Promise<MediaBrief | MeasuredMediaBrief>;
  executeMediaAndSelect(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    brief: MediaBrief;
    context: HarnessContextSnapshot;
    skillInstructions?: readonly ResolvedSkillInstruction[];
    awaitSignal?: HarnessSignalReceiver;
    runStep?: HarnessEffectRunner;
  }): Promise<HarnessMediaSelectionResult>;
  executeMediaAndSelectBounded?(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    brief: MediaBrief;
    context: HarnessContextSnapshot;
    skillInstructions?: readonly ResolvedSkillInstruction[];
    awaitSignal?: HarnessSignalReceiver;
    runStep?: HarnessEffectRunner;
    boundedResume?: BoundedExecutionSuspension<unknown>;
    boundedCheckpoint?: unknown;
  }): Promise<
    HarnessMediaSelectionResult | BoundedExecutionSuspension<unknown>
  >;
  assembleMediaAndDeliver(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    declaration: IntentDeclaration;
    context: HarnessContextSnapshot;
    allowedFactRefs?: readonly string[];
    brief: MediaBrief;
    selection: HarnessMediaSelectionResult;
    skillInstructions?: readonly ResolvedSkillInstruction[];
  }): Promise<ContentPackageRevisionDelivery>;
  /**
   * Optional V31-15 producer: video scene progress emits artifact.revised via
   * projector. Absent in fixture tests; production assembly wires
   * AgentSemanticEventProjector (same emitter instance as the note path —
   * media/note share the harness stage ports object).
   */
  artifactProgressEmitter?: ArtifactProgressEmitterPort;
}

export interface HarnessMediaStagePorts
  extends HarnessSharedStagePorts, HarnessMediaExecutionStagePorts {}

export interface HarnessNoteExecutionStagePorts {
  compileNoteBrief(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    declaration: IntentDeclaration;
    context: HarnessContextSnapshot;
    allowedFactRefs?: readonly string[];
    skillInstructions?: readonly ResolvedSkillInstruction[];
  }): Promise<HarnessNoteBrief>;
  executeNoteAndSelect(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    brief: HarnessNoteBrief;
    context: HarnessContextSnapshot;
    selectedStyleId: string;
    skillInstructions?: readonly ResolvedSkillInstruction[];
    awaitSignal?: HarnessSignalReceiver;
    runStep?: HarnessEffectRunner;
    onPageProgress?: (event: {
      pageId: string;
	  sourcePageId?: string;
	  sourcePageOrder?: number;
      state: 'running' | 'success';
    }) => Promise<void> | void;
  }): Promise<HarnessNoteSelectionResult>;
  assembleNoteAndDeliver(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    declaration: IntentDeclaration;
    context: HarnessContextSnapshot;
    allowedFactRefs?: readonly string[];
    brief: HarnessNoteBrief;
    selection: HarnessNoteSelectionResult;
    skillInstructions?: readonly ResolvedSkillInstruction[];
  }): Promise<ContentPackageRevisionDelivery>;
  /**
   * Optional V31-15 producer: page progress emits artifact.revised via projector.
   * Absent in fixture tests; production assembly wires AgentSemanticEventProjector.
   */
  artifactProgressEmitter?: import('./artifact-progress-emitter.js').ArtifactProgressEmitterPort;
  /**
   * Optional V31-16: dual-queue Make steering drain at page-unit boundaries.
   * Absent ⇒ zero steering behavior (fixture tests). Production wires SteeringService.
   */
  makeSteeringBoundary?: import('./make-steering-boundary.js').MakeSteeringBoundaryPort;
}

export interface HarnessNoteStagePorts
  extends HarnessSharedStagePorts, HarnessNoteExecutionStagePorts {}

export interface HarnessStageCollaborators {
  shared: HarnessSharedStagePorts;
  copy: HarnessCopyStagePorts;
  media: HarnessMediaExecutionStagePorts;
  note: HarnessNoteExecutionStagePorts;
}

export type HarnessSignalReceiver = (
  topic: string,
  options: { timeoutSeconds: number },
) => Promise<unknown | null>;

export function harnessMediaJobTopic(jobId: string) {
  return `harness-media-job:${jobId}`;
}

export interface HarnessWorkflowRuntime {
  runStep<Output>(
    effectIdempotencyKey: string,
    operation: () => Promise<Output>,
  ): Promise<Output>;
  finalizeMerchantExecution?(input: {
    quoteRevision: string;
    sourceEffectKey: string;
    taskId: string;
    workspaceId: string;
  }): Promise<void>;
  /**
   * Receive a cross-carrier signal in the DBOS workflow, never in a step.
   * Non-DBOS runtimes omit this hook and retain the synchronous test path.
   */
  awaitSignal?: HarnessSignalReceiver;
  progress(event: {
    sequence: number;
    stage:
      | 'intent_naming'
      | 'context_injection'
      | 'brief_compilation'
      | 'execution_selection'
      | 'assembly_delivery';
    state: 'running' | 'success' | 'suspended';
    message: string;
    experienceBasis?: HarnessExperienceBasis;
    /** Per-page note image progress (L1-2). */
    pageId?: string;
    /** Outline projection for running-phase timeline (L1-3). */
    notePlanPreview?: {
      styleId: string;
      styleName: string;
      themeAnchor: string;
      pages: Array<{
        pageId: string;
        order: number;
        pageRole:
          | 'cover'
          | 'pain_scene'
          | 'solution_show'
          | 'work_case'
          | 'price_offer'
          | 'cta_guide';
        title: string;
        body: string;
      }>;
    };
  }): Promise<void>;
  token(event: {
    sequence: number;
    candidateId: string;
    channel: 'copy.title' | 'copy.body' | 'copy.cta';
    delta: string;
  }): Promise<void>;
  hasRegisteredPendingQuestion?(question: QuestionCard): Promise<boolean>;
  awaitDecision(
    question: QuestionCard,
    stage: HarnessStage,
  ): Promise<
    | StructuredDecisionInput
    | {
        command: StructuredDecisionInput;
        resolutionSource: 'decision' | 'core_timeout' | 'system_default';
      }
    | {
        cancelled: true;
        merchantMessage: string;
        resolutionSource: 'core_hold_expired' | 'reservation_released';
      }
  >;
  /**
   * Creates the immutable successor submission used after a semantic answer.
   * Runtimes that cannot persist a new execution snapshot must leave this
   * undefined so the existing snapshot-mutation guard remains fail-closed.
   */
  resubmitSemanticDecision?(input: {
    workflowId: string;
    request: HarnessWorkflowInput & {
      executionSnapshot: NonNullable<HarnessWorkflowInput['executionSnapshot']>;
    };
    command: StructuredDecisionInput;
  }): Promise<HarnessWorkflowInput>;
  resumeBoundedExecution?(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    suspension: BoundedExecutionSuspension<unknown>;
    command: StructuredDecisionInput;
    authorization: BoundedExecutionContinuationAuthorization;
  }): Promise<HarnessWorkflowInput>;
  inspectBoundedExecutionContinuation?(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    suspension: BoundedExecutionSuspension<unknown>;
  }): Promise<BoundedExecutionContinuationCapability>;
  recordTrace(
    input: {
    id: string;
    taskId: string;
    stage:
      | 'intent_naming'
      | 'context_injection'
      | 'brief_compilation'
      | 'execution_selection'
      | 'assembly_delivery';
    payload: unknown;
    },
    afterPersist?: () => Promise<void>,
  ): Promise<void>;
}

async function finalizeSelectedMerchantExecution(input: {
  request: HarnessWorkflowInput;
  runtime: HarnessWorkflowRuntime;
  selectionEffectKey?: string;
  workflowId: string;
}) {
  const snapshot = input.request.executionSnapshot;
  if (!input.selectionEffectKey) {
    if (
      input.request.executionAssembly &&
      input.request.usageReservation &&
      snapshot &&
      snapshot.lens !== 'image_text_note'
    ) {
      throw new Error(
        'Production merchant delivery requires its selected provider effect.',
      );
    }
    return;
  }
  if (!snapshot || !input.request.usageReservation) {
    throw new Error(
      'Selected merchant execution requires its reserved billing snapshot.',
    );
  }
  if (!input.runtime.finalizeMerchantExecution) {
    throw new Error(
      'Selected merchant execution finalization is unavailable before delivery.',
    );
  }
  await input.runtime.runStep(
    harnessEffectKey(input.workflowId, 4, 'merchant-primary', '0'),
    () =>
      input.runtime.finalizeMerchantExecution!({
        quoteRevision: snapshot.quote.revision,
        sourceEffectKey: input.selectionEffectKey!,
        taskId: snapshot.task.id,
        workspaceId: snapshot.workspaceId,
      }),
  );
}

export type BoundedExecutionContinuationCapability =
  | { kind: 'available' }
  | {
      kind: 'unavailable';
      reason: 'hard_cap' | 'unset' | 'config_unavailable';
    };

const boundedExecutionContinuationAuthorization = Symbol(
  'boundedExecutionContinuationAuthorization',
);

export type BoundedExecutionContinuationAuthorization = {
  kind: 'explicit_bounded_continue';
  questionId: string;
  workflowRevision: number;
  field: string;
  value: string;
  readonly [boundedExecutionContinuationAuthorization]: true;
};

export function assertBoundedExecutionContinuationAuthorization(input: {
  authorization: BoundedExecutionContinuationAuthorization;
  command: StructuredDecisionInput;
}) {
  const { authorization, command } = input;
  if (
    !authorization ||
    authorization[boundedExecutionContinuationAuthorization] !== true ||
    authorization.questionId !== command.questionId ||
    authorization.workflowRevision !== command.workflowRevision ||
    authorization.field !== command.patch.field ||
    authorization.value !== command.patch.value ||
    command.decision.state !== 'accepted' ||
    command.decision.value !== authorization.value
  ) {
    throw new BoundedExecutionResumeError(
      'Bounded execution continuation requires the explicit workflow authorization seam.',
    );
  }
}

export class HarnessSnapshotDecisionError extends Error {
  readonly code = 'HARNESS_SNAPSHOT_DECISION_REQUIRES_RESUBMISSION';
  readonly status = 409;

  constructor() {
    super(
      'A semantic decision requires a new Composer submission and execution snapshot.',
    );
    this.name = 'HarnessSnapshotDecisionError';
  }
}

const SKILL_RESOLUTION_STEP = 'skill:resolve:intent';
interface FrozenSkillStageResolution {
  skillRevisionRefs: string[];
  skillContentHashes: string[];
  skillCapabilityRequirements?: string[][];
  skillReceiptIds: string[];
}

type FrozenSkillStageResolutions = Record<
  HarnessStage,
  FrozenSkillStageResolution
>;

interface FrozenPromptRevisionReference {
  key: string;
  name: string;
  version: string;
  contentHash: string;
  label: string;
  source: 'langfuse' | 'builtin';
  isFallback: boolean;
  fallbackReason?: string;
}

type ResolvedSkillStages = Record<
  HarnessStage,
  {
    instructions: ResolvedSkillInstruction[];
    receipts: SkillInvocationReceipt[];
  }
>;

async function resolveWorkflowStageSkills(
  workflowId: string,
  request: HarnessWorkflowInput,
  ports: HarnessSharedStagePorts,
  runtime: HarnessWorkflowRuntime,
) : Promise<ResolvedSkillStages> {
  const frozen = await runtime.runStep(
    SKILL_RESOLUTION_STEP,
    async () => {
      const stageSkillResolutions = emptyFrozenSkillStages();
      for (const stage of HARNESS_STAGES) {
        const admitted =
          request.executionAssembly?.skillStages[stage] ?? null;
        const resolved =
          admitted && admitted.length === 0
            ? { instructions: [], receipts: [] }
            : (await ports.resolveStageSkills?.({
                workflowId,
                request,
                stage,
                ...(admitted
                  ? {
                      skillRevisionRefs: admitted.map(
                        (skill) => skill.skillRevisionRef,
                      ),
                      skillManifestSnapshots: admitted,
                    }
                  : {}),
              })) ?? { instructions: [], receipts: [] };
        if (admitted) {
          assertAdmittedSkillManifests(admitted, resolved.instructions);
        }
        stageSkillResolutions[stage] = freezeSkillResolution(resolved);
      }
      return {
        ...stageSkillResolutions.intent_naming,
        promptRevisionRefs: freezePromptRevisionRefs(
          request.promptRevisionRefs,
        ),
        stageSkillResolutions,
      };
    },
  );
  const frozenPromptRevisionRefs = readFrozenPromptRevisionRefs(frozen);
  const currentPromptRevisionRefs = freezePromptRevisionRefs(
    request.promptRevisionRefs,
  );
  if (
    !samePromptRevisionRefs(frozenPromptRevisionRefs, currentPromptRevisionRefs)
  ) {
    throw new Error('已冻结的 Prompt 版本或内容哈希不一致。');
  }
  const stageSkillResolutions = normalizeFrozenSkillStages(frozen);
  const resolvedStages = emptyResolvedSkillStages();
  for (const stage of HARNESS_STAGES) {
    const stageFrozen = stageSkillResolutions[stage];
    if (stageFrozen.skillRevisionRefs.length === 0) continue;
    if (!ports.resolveStageSkills) {
      throw new Error('Skill 解析端口不可用，无法恢复已冻结的 Skill。');
    }
    const resolved = await ports.resolveStageSkills({
      workflowId,
      request,
      stage,
      skillRevisionRefs: stageFrozen.skillRevisionRefs,
      ...(request.executionAssembly
        ? {
            skillManifestSnapshots:
              request.executionAssembly.skillStages[stage],
          }
        : {}),
    });
    const current = freezeSkillResolution(resolved);
    if (
      !sameOrderedValues(
        current.skillRevisionRefs,
        stageFrozen.skillRevisionRefs,
      ) ||
      !sameOrderedValues(
        current.skillContentHashes,
        stageFrozen.skillContentHashes,
      ) ||
      (stageFrozen.skillCapabilityRequirements !== undefined &&
        !sameOrderedNestedValues(
          current.skillCapabilityRequirements ?? [],
          stageFrozen.skillCapabilityRequirements,
        )) ||
      !sameOrderedValues(current.skillReceiptIds, stageFrozen.skillReceiptIds)
    ) {
      throw new Error('已冻结的 Skill 版本、内容哈希或回执不一致。');
    }
    resolvedStages[stage] = resolved;
  }
  return resolvedStages;
}

function freezeSkillResolution(resolved: {
  instructions: readonly ResolvedSkillInstruction[];
  receipts: readonly SkillInvocationReceipt[];
}): FrozenSkillStageResolution {
  return {
    skillRevisionRefs: resolved.instructions.map(
      ({ skillRevisionRef }) => skillRevisionRef,
    ),
    skillContentHashes: resolved.instructions.map(
      ({ contentHash }) => contentHash,
    ),
    skillCapabilityRequirements: resolved.instructions.map(
      ({ requiredModelCapabilities }) => [...requiredModelCapabilities],
    ),
    skillReceiptIds: resolved.receipts.map(({ invocationId }) => invocationId),
  };
}

function normalizeFrozenSkillStages(
  input: unknown,
): FrozenSkillStageResolutions {
  const stages = emptyFrozenSkillStages();
  if (!isRecord(input)) return stages;
  if (isRecord(input.stageSkillResolutions)) {
    for (const stage of HARNESS_STAGES) {
      const resolution = input.stageSkillResolutions[stage];
      if (isFrozenSkillStageResolution(resolution)) {
        stages[stage] = normalizeFrozenSkillStageResolution(resolution);
      }
    }
    return stages;
  }
  if (isFrozenSkillStageResolution(input)) {
    stages.intent_naming = normalizeFrozenSkillStageResolution(input);
  }
  return stages;
}

function emptyFrozenSkillStages(): FrozenSkillStageResolutions {
  return {
    intent_naming: emptyFrozenSkillStage(),
    context_injection: emptyFrozenSkillStage(),
    brief_compilation: emptyFrozenSkillStage(),
    execution_selection: emptyFrozenSkillStage(),
    assembly_delivery: emptyFrozenSkillStage(),
  };
}

function emptyFrozenSkillStage(): FrozenSkillStageResolution {
  return {
    skillRevisionRefs: [],
    skillContentHashes: [],
    skillCapabilityRequirements: [],
    skillReceiptIds: [],
  };
}

function emptyResolvedSkillStages(): ResolvedSkillStages {
  return {
    intent_naming: emptyResolvedSkillStage(),
    context_injection: emptyResolvedSkillStage(),
    brief_compilation: emptyResolvedSkillStage(),
    execution_selection: emptyResolvedSkillStage(),
    assembly_delivery: emptyResolvedSkillStage(),
  };
}

function emptyResolvedSkillStage() {
  return { instructions: [], receipts: [] };
}

function isFrozenSkillStageResolution(input: unknown): input is Omit<
  FrozenSkillStageResolution,
  'skillCapabilityRequirements'
> & {
  skillCapabilityRequirements?: string[][];
} {
  return (
    isRecord(input) &&
    isStringArray(input.skillRevisionRefs) &&
    isStringArray(input.skillContentHashes) &&
    (input.skillCapabilityRequirements === undefined ||
      isStringArrayArray(input.skillCapabilityRequirements)) &&
    isStringArray(input.skillReceiptIds)
  );
}

function normalizeFrozenSkillStageResolution(
  input: FrozenSkillStageResolution,
): FrozenSkillStageResolution {
  return {
    skillRevisionRefs: [...input.skillRevisionRefs],
    skillContentHashes: [...input.skillContentHashes],
    ...(input.skillCapabilityRequirements
      ? {
          skillCapabilityRequirements: input.skillCapabilityRequirements.map(
            (requirements) => [...requirements],
          ),
        }
      : {}),
    skillReceiptIds: [...input.skillReceiptIds],
  };
}

function assertAdmittedSkillManifests(
  admitted: readonly {
    skillRevisionRef: string;
    contentHash: string;
    requiredModelCapabilities: string[];
  }[],
  resolved: readonly ResolvedSkillInstruction[],
) {
  if (
    !sameOrderedValues(
      admitted.map((skill) => skill.skillRevisionRef),
      resolved.map((skill) => skill.skillRevisionRef),
    ) ||
    !sameOrderedValues(
      admitted.map((skill) => skill.contentHash),
      resolved.map((skill) => skill.contentHash),
    ) ||
    !sameOrderedNestedValues(
      admitted.map((skill) => skill.requiredModelCapabilities),
      resolved.map((skill) => skill.requiredModelCapabilities),
    )
  ) {
    throw new Error(
      'Task admission Skill manifest does not match the executable Skill selection.',
    );
  }
}

function sameOrderedNestedValues(
  left: readonly (readonly string[])[],
  right: readonly (readonly string[])[],
) {
  return (
    left.length === right.length &&
    left.every((value, index) => sameOrderedValues(value, right[index] ?? []))
  );
}

function isStringArrayArray(value: unknown): value is string[][] {
  return Array.isArray(value) && value.every(isStringArray);
}

function isStringArray(input: unknown): input is string[] {
  return (
    Array.isArray(input) && input.every((value) => typeof value === 'string')
  );
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function sameOrderedValues(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function freezePromptRevisionRefs(
  input: HarnessWorkflowInput['promptRevisionRefs'],
): FrozenPromptRevisionReference[] {
  return Object.entries(input ?? {})
    .flatMap(([key, reference]) =>
      reference
        ? [
            {
              key,
              name: reference.name,
              version: reference.version,
              contentHash: reference.contentHash,
              label: reference.label,
              source: reference.source,
              isFallback: reference.isFallback,
              ...(reference.fallbackReason
                ? { fallbackReason: reference.fallbackReason }
                : {}),
            },
          ]
        : [],
    )
    .sort((left, right) => left.key.localeCompare(right.key));
}

function readFrozenPromptRevisionRefs(
  frozen: unknown,
): FrozenPromptRevisionReference[] {
  if (!isRecord(frozen) || !('promptRevisionRefs' in frozen)) return [];
  if (!isFrozenPromptRevisionRefs(frozen.promptRevisionRefs)) {
    throw new Error('已冻结的 Prompt 版本或内容哈希不一致。');
  }
  return frozen.promptRevisionRefs;
}

function isFrozenPromptRevisionRefs(
  input: unknown,
): input is FrozenPromptRevisionReference[] {
  return (
    Array.isArray(input) &&
    input.every(
      (reference) =>
        isRecord(reference) &&
        typeof reference.key === 'string' &&
        typeof reference.name === 'string' &&
        typeof reference.version === 'string' &&
        typeof reference.contentHash === 'string' &&
        typeof reference.label === 'string' &&
        (reference.source === 'langfuse' || reference.source === 'builtin') &&
        typeof reference.isFallback === 'boolean' &&
        (reference.fallbackReason === undefined ||
          typeof reference.fallbackReason === 'string'),
    )
  );
}

function samePromptRevisionRefs(
  left: readonly FrozenPromptRevisionReference[],
  right: readonly FrozenPromptRevisionReference[],
) {
  return (
    left.length === right.length &&
    left.every((reference, index) => {
      const current = right[index];
      return (
        current !== undefined &&
        reference.key === current.key &&
        reference.name === current.name &&
        reference.version === current.version &&
        reference.contentHash === current.contentHash &&
        reference.label === current.label &&
        reference.source === current.source &&
        reference.isFallback === current.isFallback &&
        reference.fallbackReason === current.fallbackReason
      );
    })
  );
}

function skillTraceLineage(input: {
  instructions: readonly ResolvedSkillInstruction[];
  receipts: readonly SkillInvocationReceipt[];
}) {
  if (input.instructions.length === 0) return {};
  return {
    skillRevisionRefs: input.instructions.map(
      ({ skillRevisionRef }) => skillRevisionRef,
    ),
    skillContentHashes: input.instructions.map(
      ({ contentHash }) => contentHash,
    ),
    skillReceiptIds: input.receipts.map(({ invocationId }) => invocationId),
  };
}

export class HarnessWorkflowCancellation extends Error {
  readonly result: {
    delivery: null;
    merchantMessage: string;
    outcome: 'cancelled';
    resolutionSource: 'decision' | 'core_hold_expired' | 'reservation_released';
  };

  constructor(
    merchantMessage: string,
    resolutionSource:
      | 'decision'
      | 'core_hold_expired'
      | 'reservation_released' = 'core_hold_expired',
  ) {
    super(merchantMessage);
    this.name = 'HarnessWorkflowCancellation';
    this.result = {
      delivery: null,
      merchantMessage,
      outcome: 'cancelled',
      resolutionSource,
    };
  }
}

type HarnessProgressReporter = (
  event: Omit<Parameters<HarnessWorkflowRuntime['progress']>[0], 'sequence'>,
) => Promise<void>;

interface HarnessLensStageDescriptor {
  kind: 'copy' | 'media' | 'note';
  includeEntryTrace: boolean;
  includeExecutionRoot: boolean;
  routeNotice: boolean;
  scopeError?: string;
  useActiveRequestForExecutionRoot: boolean;
}

const COPY_STAGE_DESCRIPTOR = {
  kind: 'copy',
  includeEntryTrace: true,
  includeExecutionRoot: false,
  routeNotice: true,
  useActiveRequestForExecutionRoot: false,
} as const satisfies HarnessLensStageDescriptor;
const MEDIA_STAGE_DESCRIPTOR = {
  kind: 'media',
  includeEntryTrace: true,
  includeExecutionRoot: true,
  routeNotice: true,
  scopeError:
    'A media submission must resolve to the finished_media delivery layer.',
  useActiveRequestForExecutionRoot: false,
} as const satisfies HarnessLensStageDescriptor;
const NOTE_STAGE_DESCRIPTOR = {
  kind: 'note',
  includeEntryTrace: false,
  includeExecutionRoot: true,
  routeNotice: false,
  scopeError:
    'An image-text note must resolve to the finished_media delivery layer.',
  useActiveRequestForExecutionRoot: true,
} as const satisfies HarnessLensStageDescriptor;

const HARNESS_LENS_STAGE_DESCRIPTORS = {
  copy: COPY_STAGE_DESCRIPTOR,
  image: MEDIA_STAGE_DESCRIPTOR,
  video: MEDIA_STAGE_DESCRIPTOR,
  image_text_note: NOTE_STAGE_DESCRIPTOR,
} as const;

export interface HarnessStageExecutionInput {
  descriptor: HarnessLensStageDescriptor;
  ports: HarnessStagePorts | HarnessMediaStagePorts | HarnessNoteStagePorts;
  prelude: Awaited<ReturnType<typeof runWorkflowPrelude>>;
  progress: { sequence: number };
  reportProgress: HarnessProgressReporter;
  request: HarnessWorkflowInput;
  onActiveRequest?: (request: HarnessWorkflowInput) => void;
  runtime: HarnessWorkflowRuntime;
  workflowId: string;
}

/** Shape every carrier's terminal record unit returns. */
type CarrierRecordResultBase = {
  delivery: ContentPackageRevisionDelivery;
  deliveryLayer: IntentDeclaration['deliveryLayer'];
  experienceBasis: HarnessExperienceBasis;
  recommendation: {
    recommendedCandidateId: string;
    decisionTrace: CreativeRecommendationDecisionTrace;
  };
  trace: DecisionTraceFragment;
};
type CopyHarnessWorkflowResult = CarrierRecordResultBase & {
  billingReceipt?: undefined;
  merchantReport?: undefined;
};
type MediaHarnessWorkflowResult = CarrierRecordResultBase & {
  /** V31-36: video scene partial delivery report (same shape as note partial). */
  merchantReport?: MerchantReport;
  billingReceipt?: {
    trustedUsage: {
      kind: 'media_duration';
      actualSeconds: number;
      evidenceRef: string;
    };
    /**
     * V31-36: billable/total scene units. `deliveredUnits` = billable count
     * (usable delivered + called-but-unusable); not-called failures are omitted.
     */
    partialDelivery?: {
      totalUnits: number;
      deliveredUnits: number;
    };
  };
};
type NoteHarnessWorkflowResult = CarrierRecordResultBase & {
  merchantReport?: MerchantReport;
  billingReceipt: {
    trustedUsage: {
      kind: 'product_units';
      units: Array<{ resource: 'copy' | 'image'; quantity: number }>;
      evidenceRef: string;
    };
  };
};
export type HarnessWorkflowResult =
  | CopyHarnessWorkflowResult
  | MediaHarnessWorkflowResult
  | NoteHarnessWorkflowResult;

/**
 * One business step a carrier implements, addressed by the plan as
 * `primitive:role`. The unit is an *input*: steps read their declared
 * parameters from it, so editing a unit changes what executes.
 */
type CarrierStep = (input: {
  unit: ExecutionUnit;
  priorOutputs: ReadonlyMap<string, unknown>;
}) => Promise<unknown>;

type CarrierStepMachine = {
  carrier: ContentCarrierKind;
  steps: ReadonlyMap<string, CarrierStep>;
};

async function runWorkflowPrelude(input: {
  descriptor: HarnessLensStageDescriptor;
  ports: HarnessSharedStagePorts;
  reportProgress: HarnessProgressReporter;
  request: HarnessWorkflowInput;
  runtime: HarnessWorkflowRuntime;
  workflowId: string;
}) {
  const { descriptor, ports, reportProgress, request, runtime, workflowId } =
    input;
  const stageSkills = await resolveWorkflowStageSkills(
    workflowId,
    request,
    ports,
    runtime,
  );
  const intentSkills = stageSkills.intent_naming;
  const snapshotConsume = resolveMakeSnapshotConsume({ request });
  // V31-14: snapshot path demotes intent LLM to validator materialization.
  const intent = await runtime.runStep(
    harnessEffectKey(
      workflowId,
      1,
      skillEffectUnit('intent', intentSkills.instructions),
      '0',
    ),
    async () => {
      if (isMakeSnapshotConsumePath(snapshotConsume)) {
        return materializeIntentFromSnapshot({
          snapshot: snapshotConsume.snapshot,
          request,
        });
      }
      return ports.nameIntent({
        workflowId,
        request,
        ...(intentSkills.instructions.length > 0
          ? { skillInstructions: intentSkills.instructions }
          : {}),
      });
    },
  );
  if (
    descriptor.scopeError &&
    intent.declaration.deliveryLayer !== 'finished_media'
  ) {
    throw new HarnessMediaScopeError(descriptor.scopeError);
  }
  const routed = isMakeSnapshotConsumePath(snapshotConsume)
    ? {
        request,
        declaration: intent.declaration,
        notice: undefined as string | undefined,
      }
    : await resolveIntentRoute({
        workflowId,
        request,
        intent,
        ports,
        runtime,
        reportProgress,
        skills: intentSkills,
      });
  let activeRequest = routed.request;
  const executionRootRequest = descriptor.useActiveRequestForExecutionRoot
    ? activeRequest
    : request;
  await trace(runtime, workflowId, 'intent_naming', {
    ...(descriptor.includeExecutionRoot
      ? { executionRoot: mediaExecutionRoot(executionRootRequest) }
      : {}),
    ...(descriptor.includeEntryTrace
      ? { entryMode: request.creationMode ?? 'customized' }
      : {}),
    declaration: routed.declaration,
    questionId: intent.blockingQuestion?.questionId ?? null,
    ...(descriptor.includeEntryTrace && request.prompts?.intentNaming
      ? { prompt: promptTraceReference(request.prompts.intentNaming) }
      : {}),
    ...(descriptor.includeEntryTrace &&
    'metrics' in intent &&
    intent.metrics
      ? { metrics: intent.metrics }
      : {}),
    ...(descriptor.includeEntryTrace && intentSkills.instructions.length > 0
      ? skillTraceLineage(intentSkills)
      : {}),
    ...(isMakeSnapshotConsumePath(snapshotConsume)
      ? snapshotConsumeTracePayload({
          snapshotHash: snapshotConsume.snapshot.snapshotHash,
          approvalBasis: snapshotConsume.snapshot.approvalBasis,
          stage: 'intent_naming',
          llmInvoked: false,
        })
      : { makeConsume: 'legacy_llm', llmInvoked: true }),
  });
  await reportProgress({
    stage: 'intent_naming',
    state: 'success',
    message: merchantRouteMessage(
      routed.declaration,
      descriptor.routeNotice &&
        routed.notice !== undefined &&
        (routed.notice === 'confirmed_materials' ||
          routed.notice === 'neutral_fallback')
        ? routed.notice
        : undefined,
    ),
  });

  const contextSkills = stageSkills.context_injection;
  let context = await runtime.runStep(
    harnessEffectKey(
      workflowId,
      2,
      skillEffectUnit('context', contextSkills.instructions),
      '0',
    ),
    () =>
      ports.injectContext({
        workflowId,
        request: activeRequest,
        declaration: routed.declaration,
        ...(contextSkills.instructions.length > 0
          ? { skillInstructions: contextSkills.instructions }
          : {}),
      }),
  );
  await reportProgress({
    stage: 'context_injection',
    state: 'success',
    message: merchantContextMessage(activeRequest),
    experienceBasis: projectHarnessExperienceBasis(context.bundle),
  });
  if (isMakeSnapshotConsumePath(snapshotConsume)) {
    validateContextBundleAgainstSnapshot({
      snapshot: snapshotConsume.snapshot,
      bundle: context.bundle,
    });
  }
  const factGate = await resolveFactSatisfaction({
    workflowId,
    request: activeRequest,
    declaration: routed.declaration,
    context,
    ports,
    runtime,
    reportProgress,
  });
  activeRequest = factGate.request;
  context = factGate.context;
  // V31-13: the legacy projection is evidence attached to the existing
  // context span, never a sixth durable Harness stage. It is emitted after the
  // fact gate so the deterministic refs match the completed legacy input.
  const legacyShadowObservation = projectLegacyShadowObservation({
    request,
    factRefs: factGate.allowedFactRefs ?? [],
    context,
  });
  await trace(
    runtime,
    workflowId,
    'context_injection',
    {
      ...(descriptor.includeExecutionRoot
        ? { executionRoot: mediaExecutionRoot(executionRootRequest) }
        : {}),
      bundleId: context.bundle.bundleId,
      revision: context.bundle.revision,
      hash: context.bundle.hash,
      sourceRevisions: recommendationSourceRevisions(context),
      ...skillTraceLineage(contextSkills),
      ...(legacyShadowObservation ? { legacyShadowObservation } : {}),
    },
    `r${context.bundle.revision}`,
  );
  return {
    activeRequest,
    context,
    contextSkills,
    factGate,
    intent,
    routed,
    stageSkills,
    snapshotConsume,
  };
}

export type RunHarnessWorkflowOptions = {
  /** Carries an admitted successor authority to terminal billing settlement. */
  onActiveRequest?: (request: HarnessWorkflowInput) => void;
};

/**
 * Runtime → executor path tag for D-036 taxonomy traces (V31-25).
 * WeakMap keeps concurrent workflows isolated without changing runtime surface.
 */
const executorPathByRuntime = new WeakMap<
  HarnessWorkflowRuntime,
  StageTaxonomyPayload['executorPath']
>();

export async function runHarnessWorkflow(
  workflowId: string,
  request: HarnessWorkflowInput,
  stagePorts:
    | HarnessStagePorts
    | HarnessMediaStagePorts
    | HarnessNoteStagePorts
    | HarnessStageCollaborators,
  runtime: HarnessWorkflowRuntime,
  options: RunHarnessWorkflowOptions = {},
): Promise<HarnessWorkflowResult> {
  if (request.executionPlanSnapshot) {
    assertCompiledCarrierPlanCompatible(
      resolveCompiledCarrierExecution({
        lens: request.executionSnapshot?.lens,
        frozenExecutionPlan: request.executionPlanSnapshot.executionPlan,
      }),
    );
  }
  let activeRequest = request;
  const collaborators = stageCollaborators(
    stagePorts,
    activeRequest.executionSnapshot?.lens,
  );
  const descriptor =
    HARNESS_LENS_STAGE_DESCRIPTORS[activeRequest.executionSnapshot?.lens ?? 'copy'];
  // D-118: every output lens dispatches inside the shared five-stage Harness;
  // lightweight copy/image execution may degrade stages but never bypass them.
  const ports = stagePortView(stagePorts, collaborators, descriptor.kind);
  const progress = { sequence: 0 };
  const reportProgress = (
    event: Omit<Parameters<HarnessWorkflowRuntime['progress']>[0], 'sequence'>,
  ) => runtime.progress({ ...event, sequence: progress.sequence++ });
  // Tag path before prelude traces so D-036 taxonomy is consistent for all stages.
  executorPathByRuntime.set(runtime, 'compiled_plan_executor');
  if (activeRequest.pendingExecutionPlanSnapshot) {
    activeRequest = await confirmPaidExecutionThroughGate({
      workflowId,
      request: activeRequest,
      runtime,
      ports,
      reportProgress,
      ...(options.onActiveRequest
        ? { onActiveRequest: options.onActiveRequest }
        : {}),
    });
    options.onActiveRequest?.(activeRequest);
  }
  const prelude = await runWorkflowPrelude({
    descriptor,
    ports,
    reportProgress,
    request: activeRequest,
    runtime,
    workflowId,
  });
  // V31-25 §22.4 step 3: single CompiledExecutionPlan → executor entry.
  // The terminal record primitive owns carrier-specific delivery semantics;
  // no carrier program or legacy runner exists beside this executor.
  const programInput: HarnessStageExecutionInput = {
    descriptor,
    ports,
    prelude,
    progress,
    reportProgress,
    request,
    ...(options.onActiveRequest
      ? { onActiveRequest: options.onActiveRequest }
      : {}),
    runtime,
    workflowId,
  };
  // V31-25 P0-A: the plan directs execution. Each unit is dispatched to the
  // business step its declared `primitive:role` names, in plan order, with the
  // unit itself passed in — so removing, repeating or reparameterising a unit
  // changes what runs. There is no positional generator agreement here.
  const machine = createCarrierStepMachine(programInput);
  const dispatch =
    (primitive: CompiledPrimitiveId): CarrierStep =>
    async ({ unit, priorOutputs }) => {
      if (unit.primitive !== primitive) {
        throw new Error(
          `Primitive handler ${primitive} received unit ${unit.unitId} bound to ${unit.primitive}.`,
        );
      }
      const key = compiledStepKey(unit);
      const step = machine.steps.get(key);
      if (!step) {
        throw new Error(
          `Carrier ${machine.carrier} has no business step bound for ${key} (unit ${unit.unitId}).`,
        );
      }
      return step({ unit, priorOutputs });
    };
  const primitiveHandlers: CompiledPrimitiveHandlers<HarnessStageExecutionInput> = {
    read_context: dispatch('read_context'),
    ask_merchant: dispatch('ask_merchant'),
    generate: dispatch('generate'),
    check: dispatch('check'),
    revise: dispatch('revise'),
    record: dispatch('record'),
  };
  const frozenExecutionPlan = request.executionPlanSnapshot?.executionPlan;
  const { result } = await executeCompiledCarrierPlan<
    HarnessStageExecutionInput,
    HarnessWorkflowResult
  >({
    context: {
      lens: request.executionSnapshot?.lens,
      frozenExecutionPlan,
    },
    programInput,
    primitiveHandlers,
    executionId: workflowId,
    effectStore: {
      run: (key, operation) => runtime.runStep(key, operation),
    },
    // A primitive is self-durable when its own body opens durable steps, since
    // the executor must not nest a DBOS step around it (D-038①): read_context
    // and generate open HITL waits and bounded continuations, record opens the
    // delivery commit, check opens the OCC fence and the policy gates.
    // revise opens none, so the executor owns its durable unit boundary and its
    // output is cached and replayed instead of the ports being re-invoked.
    selfDurablePrimitives: [
      'read_context',
      'ask_merchant',
      'generate',
      'check',
      'record',
    ],
    onResolved: (resolution) => {
      executorPathByRuntime.set(runtime, resolution.executorPath);
    },
  });
  return result;
}

function createCarrierStepMachine(
  input: HarnessStageExecutionInput,
): CarrierStepMachine {
  if (input.descriptor.kind === 'copy') {
    return createCopyCarrierStepMachine(input);
  }
  if (input.descriptor.kind === 'note') {
    return createNoteCarrierStepMachine(input);
  }
  return createMediaCarrierStepMachine(input);
}

type BoundedLoopSuspension = BoundedExecutionSuspension<unknown>;

/** The seven confirmation-gate collaborators every stage-port set exposes. */
type ConfirmationGatePorts = Pick<
  ConfirmPaidGenerationExecutionInput,
  | 'getExecutionConfirmationDecision'
  | 'admitExecutionPlanSnapshot'
  | 'resolveExecutionPlanLiveFacts'
  | 'refreshExecutionPlanLiveBindings'
  | 'createExecutionConfirmationRequest'
  | 'putExecutionConfirmationAuthority'
  | 'createRepricedPaidExecutionSuccessor'
>;

/**
 * The paid-generation confirmation gate is the single most safety-critical
 * seam in the Make harness — it decides whether a merchant is charged. Until
 * 2026-08-12 each carrier hand-assembled its 12-member argument bag at four
 * call sites, so a new carrier was one forgotten paste away from executing
 * paid units without confirmation. Call sites now hand over the ports and the
 * runtime whole; this wrapper owns the wiring once.
 *
 * Deferred (ticket-level, changes frozen-plan compatibility): making the gate
 * a plan-declared `check:paid_confirmation` unit so its presence is enforced
 * by assertCompiledCarrierPlanCompatible rather than by this wrapper's
 * call sites.
 */
function confirmPaidExecutionThroughGate(input: {
  workflowId: string;
  request: HarnessWorkflowInput;
  runtime: HarnessWorkflowRuntime;
  ports: ConfirmationGatePorts;
  reportProgress: ConfirmPaidGenerationExecutionInput['reportProgress'];
  onActiveRequest?: (request: HarnessWorkflowInput) => void;
  noteOutline?: PaidGenerationNoteOutline;
}): Promise<HarnessWorkflowInput> {
  const { ports, runtime } = input;
  return confirmPaidGenerationExecution({
    workflowId: input.workflowId,
    request: input.request,
    ...(input.onActiveRequest
      ? { onActiveRequest: input.onActiveRequest }
      : {}),
    reportProgress: input.reportProgress,
    ...(input.noteOutline ? { noteOutline: input.noteOutline } : {}),
    getExecutionConfirmationDecision: ports.getExecutionConfirmationDecision,
    admitExecutionPlanSnapshot: ports.admitExecutionPlanSnapshot,
    resolveExecutionPlanLiveFacts: ports.resolveExecutionPlanLiveFacts,
    refreshExecutionPlanLiveBindings: ports.refreshExecutionPlanLiveBindings,
    createRepricedPaidExecutionSuccessor:
      ports.createRepricedPaidExecutionSuccessor,
    createExecutionConfirmationRequest:
      ports.createExecutionConfirmationRequest,
    putExecutionConfirmationAuthority: ports.putExecutionConfirmationAuthority,
    awaitResolvedDecision: (question, stage) =>
      awaitResolvedDecision(runtime, question, stage),
    applyCurrentTaskDecision: (wfId, req, command) =>
      applyCurrentTaskDecision(wfId, req, command, runtime),
  });
}

/**
 * Terminal delivery effect shared by every carrier's record step: one durable
 * step (stage-5 'package' effect key) wrapping the carrier's assemble port and
 * the event_persistence assembly-step record. The effect-key discipline lives
 * here once instead of being transcribed per carrier.
 */
async function deliverAssembledPackage<TDelivery>(config: {
  workflowId: string;
  runtime: HarnessWorkflowRuntime;
  assemblyInstructions: readonly ResolvedSkillInstruction[];
  activeRequest: HarnessWorkflowInput;
  recordExecutionAssemblyStep?: (input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    step: 'execution_check' | 'event_persistence';
  }) => Promise<void>;
  assemble: () => Promise<TDelivery>;
}): Promise<TDelivery> {
  return config.runtime.runStep(
    harnessEffectKey(
      config.workflowId,
      5,
      skillEffectUnit('package', config.assemblyInstructions),
      '0',
    ),
    async () => {
      const delivered = await config.assemble();
      await config.recordExecutionAssemblyStep?.({
        workflowId: config.workflowId,
        request: config.activeRequest,
        step: 'event_persistence',
      });
      return delivered;
    },
  );
}

/**
 * Bounded-suspension continuation loop — the carrier-invariant implementation
 * shared by the copy and media step machines (the note carrier currently has
 * no bounded execution; whether it should is a product decision, not a
 * refactoring default — see the note machine's comment).
 *
 * Until 2026-08-12 this loop existed as two ~120-line transcriptions whose
 * guards and merchant strings had to be kept in sync by hand, and only the
 * copy transcription had test coverage. Everything that genuinely differs per
 * carrier — effect keys, trace payload extras, observability events, how a
 * continuation re-enters selection — comes in through the config.
 */
async function runBoundedSelectionLoop<
  TInput extends { request: HarnessWorkflowInput },
  TOutcome,
>(config: {
  workflowId: string;
  runtime: HarnessWorkflowRuntime;
  reportProgress: (
    event: Omit<Parameters<HarnessWorkflowRuntime['progress']>[0], 'sequence'>,
  ) => Promise<void> | void;
  getActiveRequest: () => HarnessWorkflowInput;
  setActiveRequest: (next: HarnessWorkflowInput) => void;
  initialInput: TInput;
  runInitial: (input: TInput) => Promise<TOutcome | BoundedLoopSuspension>;
  resume: (
    input: TInput,
    continuation: number,
    suspension: BoundedLoopSuspension,
    action: Awaited<ReturnType<typeof awaitBoundedExecutionAction>>,
  ) => Promise<TOutcome | BoundedLoopSuspension>;
  /** Carrier-specific trace payload additions (e.g. media executionRoot). */
  traceExtra: () => Record<string, unknown>;
  traceKey: (suspension: BoundedLoopSuspension, continuation: number) => string;
  suspendedObservability?: (
    suspension: BoundedLoopSuspension,
    continuation: number,
  ) => (() => Promise<void>) | undefined;
  /** Runs after the resumed request is installed (media's resumed event). */
  onResumeAuthorized?: (
    suspension: BoundedLoopSuspension,
    action: Awaited<ReturnType<typeof awaitBoundedExecutionAction>>,
  ) => Promise<void>;
}): Promise<{ outcome: TOutcome; input: TInput }> {
  const { workflowId, runtime } = config;
  let input = config.initialInput;
  let outcome = await config.runInitial(input);
  let continuation = 0;
  while (isBoundedExecutionSuspension(outcome)) {
    const suspension = outcome;
    const capability = await inspectBoundedExecutionContinuation({
      workflowId,
      request: config.getActiveRequest(),
      runtime,
      suspension,
    });
    await config.reportProgress({
      stage: 'execution_selection',
      state: 'suspended',
      message:
        capability.kind === 'available'
          ? `已保留当前最好结果；${suspension.unmetExplanation}。还可以继续。`
          : `已保留当前最好结果；${boundedContinuationUnavailableMessage(
              capability.reason,
            )}。`,
    });
    await trace(
      runtime,
      workflowId,
      'execution_selection',
      {
        ...config.traceExtra(),
        boundedExecution: suspension.snapshot,
        currentBest: suspension.currentBest,
        unmetExplanation: suspension.unmetExplanation,
        resumable: true,
      },
      config.traceKey(suspension, continuation),
      config.suspendedObservability?.(suspension, continuation),
    );
    const action = await awaitBoundedExecutionAction({
      capability,
      continuation,
      request: config.getActiveRequest(),
      runtime,
      stage: 'execution_selection',
      suspension,
      workflowId,
    });
    if (capability.kind === 'unavailable') {
      throw new HarnessWorkflowCancellation(
        `${boundedContinuationUnavailableMessage(capability.reason)}，本次任务已结束`,
        'decision',
      );
    }
    if (!runtime.resumeBoundedExecution) {
      throw new BoundedExecutionResumeError(
        'A server-side raised-limit continuation resolver is required.',
      );
    }
    const resumedRequest = await runtime.resumeBoundedExecution({
      workflowId,
      request: config.getActiveRequest(),
      suspension: outcome,
      command: action.command,
      authorization: action.authorization,
    });
    if (!resumedRequest.boundedExecution) {
      throw new BoundedExecutionResumeError(
        'A resumed execution requires the raised bounded snapshot.',
      );
    }
    config.setActiveRequest(resumedRequest);
    await config.onResumeAuthorized?.(suspension, action);
    continuation += 1;
    input = {
      ...input,
      request: resumedRequest,
      boundedResume: outcome,
    } as TInput;
    outcome = await config.resume(input, continuation, suspension, action);
  }
  return { outcome: outcome as TOutcome, input };
}

function createCopyCarrierStepMachine(
  input: HarnessStageExecutionInput,
): CarrierStepMachine {
  const {
    ports: stagePorts,
    prelude,
    progress,
    reportProgress,
    request,
    runtime,
    workflowId,
  } = input;
  const ports = stagePorts as HarnessStagePorts;
  const executeSelection = async (
    effectIdempotencyKey: string,
    input: Parameters<
      NonNullable<HarnessStagePorts['executeAndSelectBounded']>
    >[0],
    beforeSelection?: () => Promise<void>,
  ) => {
    const bounded = hasConfiguredBoundedExecution(
      input.request.boundedExecution,
    );
    if (bounded && !ports.executeAndSelectBounded) {
      throw new Error(
        'Configured bounded execution requires a bounded selection port.',
      );
    }
    const firstTokenSequence = progress.sequence;
    const executed = await runtime.runStep(effectIdempotencyKey, async () => {
        await beforeSelection?.();
        let tokenCount = 0;
        const selection = await (
          bounded
            ? ports.executeAndSelectBounded!.bind(ports)
            : ports.executeAndSelect.bind(ports)
        )({
          ...input,
          onToken: async (token) => {
            await runtime.token({
              ...token,
              sequence: firstTokenSequence + tokenCount,
            });
            tokenCount += 1;
          },
        });
        await ports.recordExecutionAssemblyStep?.({
          workflowId,
          request: input.request,
          step: 'execution_check',
        });
        return { selection, tokenCount };
    });
    progress.sequence += executed.tokenCount;
    return executed.selection;
  };
  const executeSelectionWithPermissionHold = async (
    ...args: Parameters<typeof executeSelection>
  ) => {
    try {
      return await executeSelection(...args);
    } catch (error) {
      if (!isNonSelfCorrectableSelectionError(error)) {
        throw error;
      }
      await reportProgress({
        stage: 'execution_selection',
        state: 'suspended',
        message:
          error.merchantMessage ??
          '当前候选触发权限硬门，请选择安全的后续处理方式。',
      });
      await awaitResolvedDecision(
        runtime,
        permissionSelectionQuestion(workflowId, args[1].request, error),
        'execution_selection',
      );
      throw error;
    }
  };
  const executeSelectionToCompletion = async (
    effectIdempotencyKey: string,
    initialInput: Parameters<typeof executeSelection>[1],
  ): Promise<HarnessSelectionResult> => {
    const { outcome } = await runBoundedSelectionLoop<
      Parameters<typeof executeSelection>[1],
      HarnessSelectionResult
    >({
      workflowId,
      runtime,
      reportProgress,
      getActiveRequest: () => activeRequest,
      setActiveRequest: (next) => {
        activeRequest = next;
      },
      initialInput,
      runInitial: (loopInput) =>
        executeSelectionWithPermissionHold(effectIdempotencyKey, loopInput),
      resume: (loopInput, continuation, suspension, action) =>
        executeSelectionWithPermissionHold(
          `${effectIdempotencyKey}:bounded-resume:${continuation}`,
          loopInput,
          ports.recordObservabilityEvent
            ? () => {
                const idempotencyKey = `bounded:${workflowId}:${action.command.idempotencyKey}:resumed`;
                return ports.recordObservabilityEvent!({
                  workflowId,
                  request: activeRequest,
                  idempotencyKey,
                  event: {
                    eventType: 'bounded_execution.resumed',
                    payload: {
                      previousSnapshot: suspension.snapshot,
                      snapshot: activeRequest.boundedExecution!,
                      decisionId: action.command.idempotencyKey,
                    },
                  },
                  promptKey: 'copyCandidate',
                });
              }
            : undefined,
        ),
      traceExtra: () => ({}),
      traceKey: (suspension, continuation) =>
        [
          'bounded',
          suspension.snapshot.triggeredLimit,
          suspension.snapshot.consumption.iterations,
          suspension.snapshot.consumption.costCents,
          suspension.snapshot.consumption.wallClockMs,
          suspension.snapshot.consumption.delegations,
          continuation,
        ].join('-'),
      suspendedObservability: ports.recordObservabilityEvent
        ? (suspension, continuation) => () => {
            const idempotencyKey = `bounded:${workflowId}:${continuation}:suspended`;
            return ports.recordObservabilityEvent!({
              workflowId,
              request: activeRequest,
              idempotencyKey,
              event: {
                eventType: 'bounded_execution.suspended',
                payload: {
                  snapshot: suspension.snapshot,
                  currentBest: suspension.currentBest,
                  unmetExplanation: suspension.unmetExplanation,
                  resumable: true,
                },
              },
              promptKey: 'copyCandidate',
            });
          }
        : undefined,
    });
    return outcome;
  };
  const { contextSkills, intent, routed, stageSkills } = prelude;
  let factGate = prelude.factGate;
  let activeRequest = prelude.activeRequest;
  let bundle = prelude.context;
  const briefSkills = stageSkills.brief_compilation;
  const snapshotConsume = prelude.snapshotConsume;
  let compiledBrief: CopyBrief | MeasuredCopyBrief;
  let brief!: ReturnType<typeof unpackBrief>['brief'];
  let briefMetrics: ReturnType<typeof unpackBrief>['metrics'];
  let briefDegraded: ReturnType<typeof unpackBrief>['degraded'];
  let selection!: HarnessSelectionResult;

  const readContextStep: CarrierStep = async () => bundle;

  const generateBriefStep: CarrierStep = async () => {
  compiledBrief = await runtime.runStep(
    harnessEffectKey(
      workflowId,
      3,
      skillEffectUnit('copy', briefSkills.instructions),
      '0',
    ),
    async () => {
      if (isMakeSnapshotConsumePath(snapshotConsume)) {
        return materializeCopyBriefFromSnapshot({
          snapshot: snapshotConsume.snapshot,
          declaration: routed.declaration,
          request: activeRequest,
        }).brief;
      }
      return ports.compileBrief({
        workflowId,
        request: activeRequest,
        declaration: routed.declaration,
        context: bundle,
        ...(factGate.allowedFactRefs
          ? { allowedFactRefs: factGate.allowedFactRefs }
          : {}),
        ...(briefSkills.instructions.length > 0
          ? { skillInstructions: briefSkills.instructions }
          : {}),
      });
    },
  );
  ({
    brief,
    metrics: briefMetrics,
    degraded: briefDegraded,
  } = unpackBrief(compiledBrief));
  await trace(
    runtime,
    workflowId,
    'brief_compilation',
    {
    kind: brief.kind,
    platform: brief.platform,
    factRefs: brief.factRefs,
    assetRefs: brief.assetRefs,
    identityRefs: brief.identityRefs,
    ...(request.prompts?.briefCompilation
      ? { prompt: promptTraceReference(request.prompts.briefCompilation) }
      : {}),
    ...(briefMetrics ? { metrics: briefMetrics } : {}),
    ...(briefDegraded ? { degraded: true } : {}),
    ...skillTraceLineage(briefSkills),
    ...(isMakeSnapshotConsumePath(snapshotConsume)
      ? snapshotConsumeTracePayload({
          snapshotHash: snapshotConsume.snapshot.snapshotHash,
          approvalBasis: snapshotConsume.snapshot.approvalBasis,
          stage: 'brief_compilation',
          llmInvoked: false,
        })
      : { makeConsume: 'legacy_llm', llmInvoked: true }),
    },
    `r${bundle.bundle.revision}`,
  );
  await reportProgress({
    stage: 'brief_compilation',
    state: 'success',
    message: briefDegraded
      ? merchantBriefFallbackNotice()
      : merchantProgressMessage('brief_compilation'),
  });

    return { brief, bundle };
  };

  const executionSkills = stageSkills.execution_selection;

  const generateSelectionStep: CarrierStep = async ({ unit }) => {
  activeRequest = await confirmPaidExecutionThroughGate({
    workflowId,
    request: activeRequest,
    runtime,
    ports,
    reportProgress,
    ...(input.onActiveRequest
      ? { onActiveRequest: input.onActiveRequest }
      : {}),
  });
  input.onActiveRequest?.(activeRequest);

  selection = await executeSelectionToCompletion(
      harnessEffectKey(
        workflowId,
        4,
        skillEffectUnit('copy', executionSkills.instructions),
        selectionEffectDiscriminator(unit),
      ),
      {
        workflowId,
        request: activeRequest,
        brief,
        context: bundle,
        ...(executionSkills.instructions.length > 0
          ? { skillInstructions: executionSkills.instructions }
          : {}),
      },
    );
  if (selection.boundedExecution) {
    activeRequest = {
      ...activeRequest,
      boundedExecution: selection.boundedExecution,
    };
  }
  await trace(
    runtime,
    workflowId,
    'execution_selection',
    {
      ...selection.trace,
      ...(selection.boundedExecution
        ? { boundedExecution: selection.boundedExecution }
        : {}),
      ...skillTraceLineage(executionSkills),
    },
    `r${bundle.bundle.revision}`,
  );
  await reportProgress({
    stage: 'execution_selection',
    state: 'success',
    message: merchantProgressMessage('execution_selection'),
  });

    return { selection, brief };
  };

  const checkGateStep: CarrierStep = async ({ unit }) => {
  const fenced = await runContextFenceStep(
    runtime,
    harnessEffectKey(workflowId, 2, 'fence', `r${bundle.bundle.revision}`),
    ports,
    {
      workflowId,
      request: activeRequest,
      declaration: routed.declaration,
      context: bundle,
    },
  );
  if (fenced.bundle.hash !== bundle.bundle.hash) {
    bundle = fenced;
    await trace(
      runtime,
      workflowId,
      'context_injection',
      {
      bundleId: bundle.bundle.bundleId,
      revision: bundle.bundle.revision,
      hash: bundle.bundle.hash,
      sourceRevisions: recommendationSourceRevisions(bundle),
      recompiled: true,
      ...skillTraceLineage(contextSkills),
      },
      `r${bundle.bundle.revision}`,
    );
    await reportProgress({
      stage: 'context_injection',
      state: 'success',
      message: '资料有更新，已同步到本次创作',
      experienceBasis: projectHarnessExperienceBasis(bundle.bundle),
    });
    factGate = await resolveFactSatisfaction({
      workflowId,
      request: activeRequest,
      declaration: routed.declaration,
      context: bundle,
      ports,
      runtime,
      reportProgress,
    });
    activeRequest = factGate.request;
    bundle = factGate.context;
    compiledBrief = await runtime.runStep(
      harnessEffectKey(
        workflowId,
        3,
        skillEffectUnit(
          `copy-r${bundle.bundle.revision}`,
          briefSkills.instructions,
        ),
        '0',
      ),
      () =>
        ports.compileBrief({
          workflowId,
          request: activeRequest,
          declaration: routed.declaration,
          context: bundle,
          ...(factGate.allowedFactRefs
            ? { allowedFactRefs: factGate.allowedFactRefs }
            : {}),
          ...(briefSkills.instructions.length > 0
            ? { skillInstructions: briefSkills.instructions }
            : {}),
        }),
    );
    ({
      brief,
      metrics: briefMetrics,
      degraded: briefDegraded,
    } = unpackBrief(compiledBrief));
    await trace(
      runtime,
      workflowId,
      'brief_compilation',
      {
      kind: brief.kind,
      platform: brief.platform,
      factRefs: brief.factRefs,
      assetRefs: brief.assetRefs,
      identityRefs: brief.identityRefs,
      recompiled: true,
      ...(request.prompts?.briefCompilation
        ? { prompt: promptTraceReference(request.prompts.briefCompilation) }
        : {}),
      ...(briefMetrics ? { metrics: briefMetrics } : {}),
      ...(briefDegraded ? { degraded: true } : {}),
      ...skillTraceLineage(briefSkills),
      },
      `r${bundle.bundle.revision}`,
    );
    selection = await executeSelectionToCompletion(
      harnessEffectKey(
        workflowId,
        4,
        skillEffectUnit(
          `copy-r${bundle.bundle.revision}`,
          executionSkills.instructions,
        ),
        'selection',
      ),
      {
        workflowId,
        request: activeRequest,
        brief,
        context: bundle,
        ...(executionSkills.instructions.length > 0
          ? { skillInstructions: executionSkills.instructions }
          : {}),
      },
    );
    if (selection.boundedExecution) {
      activeRequest = {
        ...activeRequest,
        boundedExecution: selection.boundedExecution,
      };
    }
    await trace(
      runtime,
      workflowId,
      'execution_selection',
      {
        ...selection.trace,
        ...(selection.boundedExecution
          ? { boundedExecution: selection.boundedExecution }
          : {}),
        ...skillTraceLineage(executionSkills),
      },
      `r${bundle.bundle.revision}`,
    );
    await reportProgress({
      stage: 'execution_selection',
      state: 'success',
      message: '已按最新资料更新推荐文案',
    });
  }

  await finalizeSelectedMerchantExecution({
    request: activeRequest,
    runtime,
    selectionEffectKey: selection.merchantExecutionEffectKey,
    workflowId,
  });

    return projectDeliveryReadiness({
      unit,
      selectedCandidateId: selection.winner.candidateId,
      producedCandidateId: selection.winner.candidateId,
      plannedTargets: [],
      producedTargets: [],
      partialTargets: [],
    });
  };

  const assemblySkills = stageSkills.assembly_delivery;

  const recordAssembleStep: CarrierStep = async ({ priorOutputs }) => {
  requireDeliveryReadiness(priorOutputs);
  const delivery = await deliverAssembledPackage({
    workflowId,
    runtime,
    assemblyInstructions: assemblySkills.instructions,
    activeRequest,
    ...(ports.recordExecutionAssemblyStep
      ? {
          recordExecutionAssemblyStep:
            ports.recordExecutionAssemblyStep.bind(ports),
        }
      : {}),
    assemble: () =>
      ports.assembleAndDeliver({
        workflowId,
        request: activeRequest,
        declaration: routed.declaration,
        context: bundle,
        allowedFactRefs: factGate.allowedFactRefs ?? [],
        brief,
        selection,
        ...(assemblySkills.instructions.length > 0
          ? { skillInstructions: assemblySkills.instructions }
          : {}),
      }),
  });
  const recommendation = {
    recommendedCandidateId: selection.winner.candidateId,
    decisionTrace: recommendationDecisionTrace(
      intent.declaration,
      brief,
      delivery,
    ),
  };
  await trace(runtime, workflowId, 'assembly_delivery', {
    delivery,
    recommendation,
    ...skillTraceLineage(assemblySkills),
  });
  await reportProgress({
    stage: 'assembly_delivery',
    state: 'success',
    message: merchantTaskSummary({
      revision: delivery.revision,
      strategyBasis: copyStrategyBasis(routed.declaration),
      versionPositioning: `这是本次适合${platformLabel(brief.platform)}的主推荐`,
      useSuggestion: '建议先核对内容和预约引导，确认后再发布',
    }),
  });

  return {
    delivery,
    deliveryLayer: routed.declaration.deliveryLayer,
    experienceBasis: projectHarnessExperienceBasis(bundle.bundle),
    recommendation,
    trace: selection.trace,
  } satisfies CopyHarnessWorkflowResult;
  };

  return {
    carrier: 'copy',
    steps: new Map<string, CarrierStep>([
      ['read_context:context', readContextStep],
      ['generate:brief', generateBriefStep],
      ['generate:selection', generateSelectionStep],
      ['check:gate', checkGateStep],
      ['record:assemble', recordAssembleStep],
    ]),
  };
}

/**
 * V31-15 production wiring for the note page artifact reporter.
 *
 * Extracted so there is exactly one place that maps a HarnessWorkflowInput onto
 * the reporter's artifact/steering context. Tests that hand-assemble the
 * reporter cannot prove this mapping: the subset-regeneration `pageIndex`
 * collapse survived a green suite precisely because the test built a reporter
 * whose `plan` was the frozen source plan while production passes the plan
 * compiled this run.
 *
 * Grep anchor: createNoteExecutionArtifactReporter.
 */
export function createNoteExecutionArtifactReporter(input: {
  /** Plan compiled by *this* run — subset runs execute the frozen source. */
  plan: NotePagePlanLike;
  request: HarnessWorkflowInput;
  workflowId: string;
  reportProgress: (event: NotePageProgressFrameEvent) => Promise<void>;
  artifactEmitter?: ArtifactProgressEmitterPort;
  makeSteeringBoundary?: MakeSteeringBoundaryPort;
  /**
   * Durable effect runner for the artifact revisions this run emits. Present in
   * the durable runtime; a fixture run leaves it out and keeps in-process
   * counters.
   */
  runtime?: Pick<HarnessWorkflowRuntime, 'runStep'>;
  now?: () => string;
}): NotePageProgressReporter {
  const { plan, request, workflowId } = input;
  const now = input.now ?? (() => new Date().toISOString());
  let artifactRevision = request.artifactLineage?.parentRevision ?? 0;
  // An unbound run publishes nothing. The Thread id is the only address an
  // artifact has: replay, SSE and the adjust lineage lookup all key on it, so a
  // synthesised `legacy-workflow:<id>` thread wrote revisions that no Thread
  // owns and no reader can reach, while looking like a working producer.
  const threadId = request.agentThreadId;
  return createNotePageProgressReporter({
    plan,
    reportProgress: input.reportProgress,
    ...(input.artifactEmitter && threadId
      ? {
          artifactEmitter: nonBlockingArtifactEmitter(
            input.artifactEmitter,
            (error) =>
              console.error(
                'Note page artifact revision was dropped; the client resyncs from the gap.',
                error,
              ),
          ),
          artifactContext: {
            workspaceId: request.workspaceId,
            workflowId,
            threadId,
            artifactId:
              request.artifactLineage?.artifactId ??
              `note:${request.packageId ?? workflowId}`,
            ...(request.artifactLineage
              ? {
                  parentRevision: request.artifactLineage.parentRevision,
                  targetSourceUnitIds: request.artifactLineage.targetUnitIds,
                }
              : {}),
            nextRevision: () => {
              artifactRevision += 1;
              return artifactRevision;
            },
            observeRevision: (revision) => {
              artifactRevision = Math.max(artifactRevision, revision);
            },
            ...(input.runtime
              ? {
                  runStep: (key, operation) =>
                    input.runtime!.runStep(
                      harnessEffectKey(
                        workflowId,
                        4,
                        'artifact-revision',
                        key,
                      ),
                      operation,
                    ),
                }
              : {}),
            now,
          },
        }
      : {}),
    ...(input.makeSteeringBoundary
      ? {
          makeSteeringBoundary: input.makeSteeringBoundary,
          steeringContext: {
            workspaceId: request.workspaceId,
            // Durable Make taskId === workflowId (task-admission identity).
            taskId: workflowId,
          },
        }
      : {}),
  });
}

/**
 * Note carrier. Deliberately-explicit status quo: unlike copy and media, the
 * note selection path does not enter `runBoundedSelectionLoop` — bounded
 * execution (suspend on limit / merchant continuation) is not wired for the
 * note carrier today. Whether it should be is a product decision
 * (V3.1 bounded-execution scope), not a refactoring default; when that
 * decision lands, the shared loop above is the single integration point.
 */
function createNoteCarrierStepMachine(
  input: HarnessStageExecutionInput,
): CarrierStepMachine {
  const {
    ports: stagePorts,
    prelude,
    reportProgress,
    request,
    runtime,
    workflowId,
  } = input;
  const ports = stagePorts as HarnessNoteStagePorts;
  const { contextSkills, routed, stageSkills } = prelude;
  let activeRequest = prelude.activeRequest;
  let context = prelude.context;
  let factGate = prelude.factGate;
  let brief!: HarnessNoteBrief;
  let selectedStyleId!: string;
  let selectedNoteCandidate!: HarnessNoteBrief['candidates']['candidates'][number];
  let activeNoteCandidate!: HarnessNoteBrief['candidates']['candidates'][number];
  let selection!: Awaited<
    ReturnType<HarnessNoteStagePorts['executeNoteAndSelect']>
  >;
  let noteRegenerationSignals: typeof selection.auditSignals = [];

  const briefSkills = stageSkills.brief_compilation;
  const snapshotConsume = prelude.snapshotConsume;
  const executionSkills = stageSkills.execution_selection;

  const readContextStep: CarrierStep = async () => context;

  const generateBriefStep: CarrierStep = async () => {
  if (
    activeRequest.executionSnapshot?.sources.assets.some(
      ({ role }) => role === 'style',
    )
  ) {
    await reportProgress({
      stage: 'brief_compilation',
      state: 'running',
      message: merchantStyleAnalysisProgress(),
    });
  }

  brief = await runtime.runStep(
    harnessEffectKey(
      workflowId,
      3,
      skillEffectUnit('image_text_note', briefSkills.instructions),
      '0',
    ),
    async () => {
      // V31-25: snapshot path materializes note brief without structured LLM.
      if (isMakeSnapshotConsumePath(snapshotConsume)) {
        return materializeNoteBriefFromSnapshot({
          snapshot: snapshotConsume.snapshot,
          declaration: routed.declaration,
          request: activeRequest,
        }).brief;
      }
      return ports.compileNoteBrief({
        workflowId,
        request: activeRequest,
        declaration: routed.declaration,
        context,
        ...(factGate.allowedFactRefs
          ? { allowedFactRefs: factGate.allowedFactRefs }
          : {}),
        ...(briefSkills.instructions.length > 0
          ? { skillInstructions: briefSkills.instructions }
          : {}),
      });
    },
  );
  await trace(
    runtime,
    workflowId,
    'brief_compilation',
    {
    executionRoot: mediaExecutionRoot(activeRequest),
    kind: brief.kind,
    themeAnchors: brief.candidates.candidates.map(
      ({ plan }) => plan.themeAnchor,
    ),
    styles: brief.candidates.candidates.map(({ styleId }) => styleId),
    pageRoles: brief.candidates.candidates[0]?.plan.pages.map(
      ({ pageRole }) => pageRole,
    ),
    ...skillTraceLineage(briefSkills),
    ...(isMakeSnapshotConsumePath(snapshotConsume)
      ? snapshotConsumeTracePayload({
          snapshotHash: snapshotConsume.snapshot.snapshotHash,
          approvalBasis: snapshotConsume.snapshot.approvalBasis,
          stage: 'brief_compilation',
          llmInvoked: false,
        })
      : { makeConsume: 'legacy_llm', llmInvoked: true }),
    },
    `r${context.bundle.revision}`,
  );
  await reportProgress({
    stage: 'brief_compilation',
    state: 'suspended',
    message: merchantNoteProgressMessage('styles_ready'),
  });
    return { brief, context };
  };

  const askStyleStep: CarrierStep = async () => {
  const frozenStyle = [...(activeRequest.decisionReferences ?? [])]
    .reverse()
    .find(({ field }) => field === 'note_style');
  if (frozenStyle) {
    selectedStyleId = noteStyleIdFromValue(brief, frozenStyle.value);
  } else {
    const styleDecision = await awaitResolvedDecision(
      runtime,
      noteStyleQuestion(workflowId, request, brief),
      'brief_compilation',
    );
    selectedStyleId = noteStyleIdFromDecision(brief, styleDecision);
    activeRequest = withForkDecisionReference(activeRequest, styleDecision);
  }
  const resolvedNoteCandidate = brief.candidates.candidates.find(
    ({ styleId }) => styleId === selectedStyleId,
  );
  if (!resolvedNoteCandidate) {
    throw new HarnessMediaScopeError(merchantNoteStyleUnavailable());
  }
  selectedNoteCandidate = resolvedNoteCandidate;
  const notePlanPreview = {
    styleId: selectedNoteCandidate.styleId,
    styleName: selectedNoteCandidate.styleName,
    themeAnchor: selectedNoteCandidate.plan.themeAnchor,
    pages: selectedNoteCandidate.plan.pages.map((page) => ({
      pageId: page.id,
      order: page.order,
      pageRole: page.pageRole,
      title: page.textBlock.title,
      body: page.textBlock.body,
    })),
  };
  await reportProgress({
    stage: 'brief_compilation',
    state: 'success',
    message: merchantNoteProgressMessage('style_selected'),
    notePlanPreview,
  });
    return { selectedStyleId, notePlanPreview };
  };

  const generatePagesStep: CarrierStep = async ({ unit }) => {
  const fenced = await runContextFenceStep(
    runtime,
    harnessEffectKey(workflowId, 2, 'fence', `r${context.bundle.revision}`),
    ports,
    {
      workflowId,
      request: activeRequest,
      declaration: routed.declaration,
      context,
    },
  );
  if (fenced.bundle.hash !== context.bundle.hash) {
    context = fenced;
    factGate = await resolveFactSatisfaction({
      workflowId,
      request: activeRequest,
      declaration: routed.declaration,
      context,
      ports,
      runtime,
      reportProgress,
    });
    activeRequest = factGate.request;
    context = factGate.context;
    brief = await runtime.runStep(
      harnessEffectKey(
        workflowId,
        3,
        skillEffectUnit(
          `image_text_note-r${context.bundle.revision}`,
          briefSkills.instructions,
        ),
        '0',
      ),
      async () => {
        if (isMakeSnapshotConsumePath(snapshotConsume)) {
          return materializeNoteBriefFromSnapshot({
            snapshot: snapshotConsume.snapshot,
            declaration: routed.declaration,
            request: activeRequest,
          }).brief;
        }
        return ports.compileNoteBrief({
          workflowId,
          request: activeRequest,
          declaration: routed.declaration,
          context,
          ...(factGate.allowedFactRefs
            ? { allowedFactRefs: factGate.allowedFactRefs }
            : {}),
          ...(briefSkills.instructions.length > 0
            ? { skillInstructions: briefSkills.instructions }
            : {}),
        });
      },
    );
    if (
      !brief.candidates.candidates.some(
        ({ styleId }) => styleId === selectedStyleId,
      )
    ) {
      throw new HarnessMediaScopeError(merchantNoteStyleUnavailable());
    }
    await trace(
      runtime,
      workflowId,
      'context_injection',
      {
      executionRoot: mediaExecutionRoot(activeRequest),
      bundleId: context.bundle.bundleId,
      revision: context.bundle.revision,
      hash: context.bundle.hash,
      recompiled: true,
      ...skillTraceLineage(contextSkills),
      },
      `r${context.bundle.revision}`,
    );
    await reportProgress({
      stage: 'context_injection',
      state: 'success',
      message: '资料有更新，已同步到本次创作',
      experienceBasis: projectHarnessExperienceBasis(context.bundle),
    });
  }

  activeNoteCandidate =
    brief.candidates.candidates.find(
      ({ styleId }) => styleId === selectedStyleId,
    ) ?? selectedNoteCandidate;

  // P1-05 / xhs-spec §3.3 / §8.2: plan.ready (style selected + brief fenced)
  // → interrupt execution_confirm before paid media selection. Pure copy units
  // still skip via triggersPaidMediaExecution (D-043).
  const noteOutlineSummary = {
    pageCount: activeNoteCandidate.plan.pages.length,
    pages: activeNoteCandidate.plan.pages.map((page) => ({
      order: page.order,
      title: page.textBlock.title,
    })),
  };
  activeRequest = await confirmPaidExecutionThroughGate({
    workflowId,
    request: activeRequest,
    runtime,
    ports,
    reportProgress,
    noteOutline: noteOutlineSummary,
    ...(input.onActiveRequest
      ? { onActiveRequest: input.onActiveRequest }
      : {}),
  });
  input.onActiveRequest?.(activeRequest);

  const executionSkills = stageSkills.execution_selection;
  let noteArtifactRevision = 0;
  const noteSelectionInput = {
    workflowId,
    request: activeRequest,
    brief,
    context,
    selectedStyleId,
    ...(executionSkills.instructions.length > 0
      ? { skillInstructions: executionSkills.instructions }
      : {}),
    ...(runtime.awaitSignal ? { awaitSignal: runtime.awaitSignal } : {}),
    ...(runtime.awaitSignal
      ? {
          runStep: durableSelectionEffectRunner(
            runtime,
            workflowId,
            'image_text_note',
            executionSkills.instructions,
          ),
        }
      : {}),
    // V31-14: page frame moved to note-page-execution-frame (symbol anchor).
    // V31-16: makeSteeringBoundary drains steer on each page success (follow_up on last).
    onPageProgress: createNoteExecutionArtifactReporter({
      plan: activeNoteCandidate.plan,
      request: activeRequest,
      workflowId,
      reportProgress,
      runtime,
      ...(ports.artifactProgressEmitter
        ? { artifactEmitter: ports.artifactProgressEmitter }
        : {}),
      ...(ports.makeSteeringBoundary
        ? { makeSteeringBoundary: ports.makeSteeringBoundary }
        : {}),
    }),
  };
  selection = await runSelectionStage(
    runtime,
    workflowId,
    `image_text_note${selectionEffectDiscriminatorSuffix(unit)}`,
    executionSkills.instructions,
    noteSelectionInput,
    async (stageInput) => {
      const selected = await ports.executeNoteAndSelect(stageInput);
      await ports.recordExecutionAssemblyStep?.({
        workflowId,
        request: stageInput.request,
        step: 'execution_check',
      });
      return selected;
    },
  );
  noteRegenerationSignals = selection.auditSignals.filter(
    (signal) => signal.eventType === 'note_page_regenerated',
  );
  await trace(
    runtime,
    workflowId,
    'execution_selection',
    {
      executionRoot: mediaExecutionRoot(activeRequest),
      ...selection.trace,
      auditSignals: selection.auditSignals,
      ...skillTraceLineage(executionSkills),
    },
    `r${context.bundle.revision}`,
  );
    return { selection, brief };
  };

  // check owns the note consistency verification the plan asks for, and its
  // rubric is a declared unit parameter. It deliberately performs no business
  // write: check is self-durable, so its body replays after a restart, and the
  // `execution_check` assembly-step record therefore stays inside the durable
  // selection step where the pre-convergence runner put it. Moving that write
  // here made it fire a second time on every restart.
  const checkConsistencyStep: CarrierStep = async ({ unit }) => {
    const readiness = projectDeliveryReadiness({
      unit,
      selectedCandidateId: selectedStyleId,
      producedCandidateId: selection.selectedStyleId,
      plannedTargets: activeNoteCandidate.plan.pages.map((page) => page.id),
      producedTargets: selection.version.plan.pages.map((page) => page.id),
      partialTargets: selection.partial?.unresolvedPageIds ?? [],
    });
    await reportProgress({
      stage: 'execution_selection',
      state: 'success',
      message: readiness.passed
        ? merchantNoteProgressMessage('consistency_checked')
        : merchantPartialFailure({
            completed: '可用页面已经生成',
            failed: `第 ${readiness.findings.join('、')} 页的一致性复核仍未通过`,
            nextStep: '先查看已生成页面，再单独重新生成标记页面',
          }),
    });
    return readiness;
  };

  // revise owns the page-regeneration observability the plan asks for. It is
  // skipped entirely when the plan omits the revise unit.
  const revisePagesStep: CarrierStep = async ({ priorOutputs }) => {
    const readiness = requireDeliveryReadiness(priorOutputs);
    if (noteRegenerationSignals.length === 0) {
      return { regeneratedPages: 0, unresolvedPages: readiness.findings };
    }
    if (!ports.recordObservabilityEvent) {
      throw new Error('Note regeneration requires canonical observability.');
    }
    for (const signal of noteRegenerationSignals) {
      const auditRef = signal.payload.auditRef;
      if (typeof auditRef !== 'string' || auditRef.trim().length === 0) {
        throw new Error(
          'Note regeneration observability requires an auditRef.',
        );
      }
      await ports.recordObservabilityEvent({
        workflowId,
        request: activeRequest,
        idempotencyKey: `note-regenerated:${workflowId}:${auditRef}`,
        event: {
          eventType: 'note_page_regenerated',
          payload: signal.payload,
        },
        ...(signal.payload.imagePoints === 0
          ? { promptKey: 'noteTextBlock' as const }
          : {}),
      });
    }
    return {
      regeneratedPages: noteRegenerationSignals.length,
      unresolvedPages: readiness.findings,
    };
  };

  const recordAssembleStep: CarrierStep = async ({ priorOutputs }) => {
  const readiness = requireDeliveryReadiness(priorOutputs);
  const assemblySkills = stageSkills.assembly_delivery;
  const delivery = await deliverAssembledPackage({
    workflowId,
    runtime,
    assemblyInstructions: assemblySkills.instructions,
    activeRequest,
    ...(ports.recordExecutionAssemblyStep
      ? {
          recordExecutionAssemblyStep:
            ports.recordExecutionAssemblyStep.bind(ports),
        }
      : {}),
    assemble: () =>
      ports.assembleNoteAndDeliver({
        workflowId,
        request: activeRequest,
        declaration: routed.declaration,
        context,
        allowedFactRefs: factGate.allowedFactRefs ?? [],
        brief,
        selection,
        ...(assemblySkills.instructions.length > 0
          ? { skillInstructions: assemblySkills.instructions }
          : {}),
      }),
  });
  const recommendation = {
    recommendedCandidateId: selection.selectedStyleId,
    decisionTrace: mediaRecommendationDecisionTrace(
      routed.declaration,
      brief,
      delivery,
      activeRequest,
    ),
  };
  await trace(runtime, workflowId, 'assembly_delivery', {
    executionRoot: mediaExecutionRoot(activeRequest),
    delivery,
    recommendation,
    ...skillTraceLineage(assemblySkills),
  });
  await reportProgress({
    stage: 'assembly_delivery',
    state: 'success',
    message: merchantTaskSummary({
      revision: delivery.revision,
      strategyBasis: '结合本次主题、页级角色与已确认资料',
      versionPositioning: '这是你选中的整套图文版本',
      useSuggestion: '建议逐页核对画面、文字和预约引导，确认后再发布',
    }),
  });
  const partialReport = readiness.passed
    ? undefined
    : merchantPartialDeliveryReport({
        message: merchantNotePartialConsistency(readiness.findings.length),
        nextStep:
          '可以先用已经对好的页面发布，或者让我把没对上的那几页重做一次。',
      });
  const pageRegeneration =
    activeRequest.executionSnapshot?.sources.pageRegeneration;
  const imageUsageQuantity = pageRegeneration
    ? pageRegeneration.targetAssetIds.length
    : Math.max(
        0,
        selection.version.plan.pages.length -
          (selection.partial?.unresolvedPageIds.length ?? 0),
      );
  /**
   * V31-16 partial delivery basis. The quote froze credits for every page, so a
   * run that lands 5 of 6 has to say so here or the merchant pays for the page
   * she never received. Page-regeneration runs quote exactly one page and are
   * never partial against the original plan: they quote exactly the pages
   * they target.
   */
  const partialDelivery =
    !pageRegeneration &&
    selection.partial &&
    selection.version.plan.pages.length > 0 &&
    imageUsageQuantity < selection.version.plan.pages.length
      ? {
          totalUnits: selection.version.plan.pages.length,
          deliveredUnits: imageUsageQuantity,
        }
      : undefined;
  const copyUsageQuantity = pageRegeneration
    ? 0
    : brief.candidates.candidates.length;
  return {
    ...(partialReport ? { merchantReport: partialReport } : {}),
    billingReceipt: {
      trustedUsage: {
        kind: 'product_units' as const,
        units: [
          ...(copyUsageQuantity > 0
            ? [
                {
                  resource: 'copy' as const,
                  quantity: copyUsageQuantity,
                },
              ]
            : []),
          {
            resource: 'image' as const,
            quantity: imageUsageQuantity,
          },
        ],
        evidenceRef: pageRegeneration
          ? `note-page-regeneration:${pageRegeneration.targetAssetIds.join(',')}`
          : `note-plan-pages:${selection.version.plan.pages
              .map(({ id, revision }) => `${id}@${revision}`)
              .join(',')}`,
      },
      ...(partialDelivery ? { partialDelivery } : {}),
    },
    delivery,
    deliveryLayer: routed.declaration.deliveryLayer,
    experienceBasis: projectHarnessExperienceBasis(context.bundle),
    recommendation,
    trace: selection.trace,
  } satisfies NoteHarnessWorkflowResult;
  };

  return {
    carrier: 'note',
    steps: new Map<string, CarrierStep>([
      ['read_context:context', readContextStep],
      ['generate:brief', generateBriefStep],
      ['ask_merchant:style_choice', askStyleStep],
      ['generate:pages', generatePagesStep],
      ['check:consistency', checkConsistencyStep],
      ['revise:page_regenerate', revisePagesStep],
      ['record:assemble', recordAssembleStep],
    ]),
  };
}

function createMediaCarrierStepMachine(
  input: HarnessStageExecutionInput,
): CarrierStepMachine {
  const {
    ports: stagePorts,
    prelude,
    reportProgress,
    request,
    runtime,
    workflowId,
  } = input;
  const ports = stagePorts as HarnessMediaStagePorts;
  const kind = mediaKind(request);
  const { contextSkills, routed, stageSkills } = prelude;
  let activeRequest = prelude.activeRequest;
  let bundle = prelude.context;
  let factGate = prelude.factGate;
  let compiledBrief: MediaBrief | MeasuredMediaBrief;
  let brief!: ReturnType<typeof unpackMediaBrief>['brief'];
  let briefMetrics: ReturnType<typeof unpackMediaBrief>['metrics'];
  let selection!: HarnessMediaSelectionResult;
  let boundedCheckpoint: unknown;
  const briefSkills = stageSkills.brief_compilation;
  const snapshotConsume = prelude.snapshotConsume;
  const executionSkills = stageSkills.execution_selection;
  // V31-15 / V31-36: video scene artifact producer. Scenes land running once
  // the storyboard is compiled; terminal emission uses per-scene Core results
  // (success / failed) so UI never invents failure from missing files.
  // Emitter absent in fixture tests (optional port); no-op otherwise.
	let videoArtifactRevision = activeRequest.artifactLineage?.parentRevision ?? 0;
	let videoReadyRevision: number | undefined = activeRequest.artifactLineage?.parentRevision;
  const emitVideoSceneProgress = async (
    source: MediaBrief,
    state: 'running' | 'success',
    sceneResults?: readonly VideoSceneExecutionResult[],
  ): Promise<void> => {
    // Same rule as the note producer: no Thread, no publication. A synthesised
    // thread id addresses nothing that replay or the adjust lineage lookup can
    // find.
    const threadId = activeRequest.agentThreadId;
    if (source.kind !== 'video' || !ports.artifactProgressEmitter || !threadId) {
      return;
    }
    const parentRevision = state === 'running' ? videoReadyRevision : undefined;
    if (parentRevision !== undefined) videoReadyRevision = undefined;
    const failedIndexes = new Set(
      sceneResults
        ? videoUnresolvedSceneIndexes(sceneResults)
        : [],
    );
    await emitVideoScenesArtifactProgress(
      nonBlockingArtifactEmitter(ports.artifactProgressEmitter, (error) =>
        console.error(
          'Video scene artifact revision was dropped; the client resyncs from the gap.',
          error,
        ),
      ),
      {
        workspaceId: activeRequest.workspaceId,
        workflowId,
        threadId,
		artifactId:
		  activeRequest.artifactLineage?.artifactId ??
		  `video:${activeRequest.packageId ?? workflowId}`,
        scenes: source.storyboard.map(({ index, description }) => {
          const sceneIndex = index - 1;
          const sceneFailed = failedIndexes.has(sceneIndex);
          return {
            sceneIndex,
            ...(state === 'running' ? { storyboard: description } : {}),
            ...(state === 'success' && sceneFailed
              ? { state: 'failed' as const }
              : {}),
          };
        }),
        state,
        nextRevision: () => {
          videoArtifactRevision += 1;
          return videoArtifactRevision;
        },
        occurredAt: new Date().toISOString(),
        ...(parentRevision !== undefined ? { parentRevision } : {}),
      },
    );
    if (state === 'success') videoReadyRevision = videoArtifactRevision;
  };
  const executeMediaSelectionToCompletion = async (
    unitId: string,
    initialInput: Parameters<
      NonNullable<HarnessMediaStagePorts['executeMediaAndSelectBounded']>
    >[0],
  ): Promise<HarnessMediaSelectionResult> => {
    const bounded = hasConfiguredBoundedExecution(
      initialInput.request.boundedExecution,
    );
    if (bounded && !ports.executeMediaAndSelectBounded) {
      throw new Error(
        'Configured bounded execution requires a bounded media selection port.',
      );
    }
    const { outcome } = await runBoundedSelectionLoop<
      typeof initialInput,
      Exclude<
        Awaited<
          ReturnType<NonNullable<HarnessMediaStagePorts['executeMediaAndSelectBounded']>>
        >,
        BoundedLoopSuspension
      >
    >({
      workflowId,
      runtime,
      reportProgress,
      getActiveRequest: () => activeRequest,
      setActiveRequest: (next) => {
        activeRequest = next;
      },
      initialInput,
      runInitial: (loopInput) =>
        runSelectionStage(
          runtime,
          workflowId,
          unitId,
          executionSkills.instructions,
          loopInput,
          async (selectionInput) =>
            (bounded
              ? ports.executeMediaAndSelectBounded!.bind(ports)
              : ports.executeMediaAndSelect.bind(ports))(selectionInput),
        ),
      resume: (loopInput, continuation) =>
        runSelectionStage(
          runtime,
          workflowId,
          `${unitId}-bounded-resume-${continuation}`,
          executionSkills.instructions,
          loopInput,
          async (selectionInput) =>
            ports.executeMediaAndSelectBounded!(selectionInput),
        ),
      traceExtra: () => ({
        executionRoot: mediaExecutionRoot(activeRequest),
        ...skillTraceLineage(executionSkills),
      }),
      traceKey: (suspension, continuation) =>
        [
          'media-bounded',
          suspension.snapshot.triggeredLimit,
          suspension.snapshot.consumption.iterations,
          suspension.snapshot.consumption.costCents,
          suspension.snapshot.consumption.wallClockMs,
          suspension.snapshot.consumption.delegations,
          continuation,
        ].join('-'),
      suspendedObservability: ports.recordObservabilityEvent
        ? (suspension, continuation) => () => {
            const idempotencyKey = `bounded:${workflowId}:${unitId}:${continuation}:suspended`;
            return ports.recordObservabilityEvent!({
              workflowId,
              request: activeRequest,
              idempotencyKey,
              event: {
                eventType: 'bounded_execution.suspended',
                payload: {
                  snapshot: suspension.snapshot,
                  currentBest: suspension.currentBest,
                  unmetExplanation: suspension.unmetExplanation,
                  resumable: true,
                },
              },
            });
          }
        : undefined,
      onResumeAuthorized: async (suspension, action) => {
        if (!ports.recordObservabilityEvent) return;
        const idempotencyKey = `bounded:${workflowId}:${action.command.idempotencyKey}:resumed`;
        await runtime.runStep(idempotencyKey, () =>
          ports.recordObservabilityEvent!({
            workflowId,
            request: activeRequest,
            idempotencyKey,
            event: {
              eventType: 'bounded_execution.resumed',
              payload: {
                previousSnapshot: suspension.snapshot,
                snapshot: activeRequest.boundedExecution!,
                decisionId: action.command.idempotencyKey,
              },
            },
          }),
        );
      },
    });
    if (bounded) {
      if (
        outcome.boundedExecution === undefined ||
        outcome.boundedCurrentBest === undefined
      ) {
        throw new Error(
          'Bounded media selection must return its cumulative snapshot and checkpoint.',
        );
      }
      mediaBoundedCurrentBestSchema.parse(outcome.boundedCurrentBest);
    }
    await ports.recordExecutionAssemblyStep?.({
      workflowId,
      request: input.request,
      step: 'execution_check',
    });
    return outcome;
  };

  const readContextStep: CarrierStep = async () => bundle;

  const generateBriefStep: CarrierStep = async () => {
  compiledBrief = await runtime.runStep(
    harnessEffectKey(
      workflowId,
      3,
      skillEffectUnit(kind, briefSkills.instructions),
      '0',
    ),
    async () => {
      // V31-25: snapshot path materializes media brief without structured LLM.
      if (isMakeSnapshotConsumePath(snapshotConsume)) {
        return materializeMediaBriefFromSnapshot({
          snapshot: snapshotConsume.snapshot,
          declaration: routed.declaration,
          request: activeRequest,
        }).brief;
      }
      return ports.compileMediaBrief({
        workflowId,
        request: activeRequest,
        declaration: routed.declaration,
        context: bundle,
        ...(factGate.allowedFactRefs
          ? { allowedFactRefs: factGate.allowedFactRefs }
          : {}),
        ...(briefSkills.instructions.length > 0
          ? { skillInstructions: briefSkills.instructions }
          : {}),
      });
    },
  );
  ({ brief, metrics: briefMetrics } = unpackMediaBrief(compiledBrief));
  await trace(
    runtime,
    workflowId,
    'brief_compilation',
    {
    executionRoot: mediaExecutionRoot(request),
    ...mediaBriefTrace(brief),
    ...(request.prompts?.briefCompilation
      ? { prompt: promptTraceReference(request.prompts.briefCompilation) }
      : {}),
    ...(briefMetrics ? { metrics: briefMetrics } : {}),
    ...skillTraceLineage(briefSkills),
    ...(isMakeSnapshotConsumePath(snapshotConsume)
      ? snapshotConsumeTracePayload({
          snapshotHash: snapshotConsume.snapshot.snapshotHash,
          approvalBasis: snapshotConsume.snapshot.approvalBasis,
          stage: 'brief_compilation',
          llmInvoked: false,
        })
      : { makeConsume: 'legacy_llm', llmInvoked: true }),
    },
    `r${bundle.bundle.revision}`,
  );
  await reportProgress({
    stage: 'brief_compilation',
    state: 'success',
    message: merchantProgressMessage('brief_compilation'),
  });
  await emitVideoSceneProgress(brief, 'running');

    return { brief, bundle };
  };

  const generateSelectionStep: CarrierStep = async ({ unit }) => {
  activeRequest = await confirmPaidExecutionThroughGate({
    workflowId,
    request: activeRequest,
    runtime,
    ports,
    reportProgress,
    ...(input.onActiveRequest
      ? { onActiveRequest: input.onActiveRequest }
      : {}),
  });
  input.onActiveRequest?.(activeRequest);
  const executionSkills = stageSkills.execution_selection;
  const mediaSelectionInput = {
    workflowId,
    request: activeRequest,
    brief,
    context: bundle,
    ...(executionSkills.instructions.length > 0
      ? { skillInstructions: executionSkills.instructions }
      : {}),
    ...(runtime.awaitSignal ? { awaitSignal: runtime.awaitSignal } : {}),
    ...(runtime.awaitSignal
      ? {
          runStep: durableSelectionEffectRunner(
            runtime,
            workflowId,
            kind,
            executionSkills.instructions,
          ),
        }
      : {}),
  };
  const sceneRetrySuffix = sceneRegenerationEffectSuffix(
    activeRequest.executionSnapshot?.sources.sceneRegeneration
      ?.targetSceneIndexes,
  );
  selection = await executeMediaSelectionToCompletion(
    `${kind}${selectionEffectDiscriminatorSuffix(unit)}${sceneRetrySuffix}`,
    mediaSelectionInput,
  );
  boundedCheckpoint = selection.boundedCurrentBest;
  if (selection.boundedExecution) {
    activeRequest = {
      ...activeRequest,
      boundedExecution: selection.boundedExecution,
    };
  }
  await trace(
    runtime,
    workflowId,
    'execution_selection',
    {
    executionRoot: mediaExecutionRoot(request),
    ...selection.trace,
    ...(selection.boundedExecution
      ? { boundedExecution: selection.boundedExecution }
      : {}),
    ...skillTraceLineage(executionSkills),
    },
    `r${bundle.bundle.revision}`,
  );
  const videoUnresolved = selection.sceneResults
    ? videoUnresolvedSceneIndexes(selection.sceneResults)
    : [];
  await reportProgress({
    stage: 'execution_selection',
    state: 'success',
    message:
      brief.kind === 'video' && videoUnresolved.length > 0
        ? merchantPartialFailure({
            completed: `已完成 ${videoSceneDeliveredUsable(selection.sceneResults!)} 个镜头`,
            failed: `第 ${videoFailedSceneLabels(selection.sceneResults!).join('、')} 个镜头没有做成`,
            nextStep: '先查看已完成的镜头，再单独重做没成的镜头',
          })
        : mediaSelectionMessage(brief.kind),
  });
  await emitVideoSceneProgress(brief, 'success', selection.sceneResults);

    return { selection, brief };
  };

  const checkGateStep: CarrierStep = async ({ unit }) => {
  const fenced = await runContextFenceStep(
    runtime,
    harnessEffectKey(workflowId, 2, 'fence', `r${bundle.bundle.revision}`),
    ports,
    {
      workflowId,
      request: activeRequest,
      declaration: routed.declaration,
      context: bundle,
    },
  );
  if (fenced.bundle.hash !== bundle.bundle.hash) {
    bundle = fenced;
    factGate = await resolveFactSatisfaction({
      workflowId,
      request: activeRequest,
      declaration: routed.declaration,
      context: bundle,
      ports,
      runtime,
      reportProgress,
    });
    activeRequest = factGate.request;
    bundle = factGate.context;
    await trace(
      runtime,
      workflowId,
      'context_injection',
      {
      executionRoot: mediaExecutionRoot(request),
      bundleId: bundle.bundle.bundleId,
      revision: bundle.bundle.revision,
      hash: bundle.bundle.hash,
      sourceRevisions: recommendationSourceRevisions(bundle),
      recompiled: true,
      ...skillTraceLineage(contextSkills),
      },
      `r${bundle.bundle.revision}`,
    );
    await reportProgress({
      stage: 'context_injection',
      state: 'success',
      message: '资料有更新，已同步到本次创作',
      experienceBasis: projectHarnessExperienceBasis(bundle.bundle),
    });
    compiledBrief = await runtime.runStep(
      harnessEffectKey(
        workflowId,
        3,
        skillEffectUnit(
          `${kind}-r${bundle.bundle.revision}`,
          briefSkills.instructions,
        ),
        '0',
      ),
      async () => {
        if (isMakeSnapshotConsumePath(snapshotConsume)) {
          return materializeMediaBriefFromSnapshot({
            snapshot: snapshotConsume.snapshot,
            declaration: routed.declaration,
            request: activeRequest,
          }).brief;
        }
        return ports.compileMediaBrief({
          workflowId,
          request: activeRequest,
          declaration: routed.declaration,
          context: bundle,
          ...(factGate.allowedFactRefs
            ? { allowedFactRefs: factGate.allowedFactRefs }
            : {}),
          ...(briefSkills.instructions.length > 0
            ? { skillInstructions: briefSkills.instructions }
            : {}),
        });
      },
    );
    ({ brief, metrics: briefMetrics } = unpackMediaBrief(compiledBrief));
    await emitVideoSceneProgress(brief, 'running');
    await trace(
      runtime,
      workflowId,
      'brief_compilation',
      {
      executionRoot: mediaExecutionRoot(request),
      ...mediaBriefTrace(brief),
      recompiled: true,
      ...(request.prompts?.briefCompilation
        ? { prompt: promptTraceReference(request.prompts.briefCompilation) }
        : {}),
      ...(briefMetrics ? { metrics: briefMetrics } : {}),
      ...skillTraceLineage(briefSkills),
      },
      `r${bundle.bundle.revision}`,
    );
    const recompiledMediaSelectionInput = {
      workflowId,
      request: activeRequest,
      brief,
      context: bundle,
      ...(executionSkills.instructions.length > 0
        ? { skillInstructions: executionSkills.instructions }
        : {}),
      ...(runtime.awaitSignal ? { awaitSignal: runtime.awaitSignal } : {}),
      ...(runtime.awaitSignal
        ? {
            runStep: durableSelectionEffectRunner(
              runtime,
              workflowId,
              `${kind}-r${bundle.bundle.revision}`,
              executionSkills.instructions,
            ),
          }
        : {}),
      ...(boundedCheckpoint !== undefined ? { boundedCheckpoint } : {}),
    };
    selection = await executeMediaSelectionToCompletion(
      `${kind}-r${bundle.bundle.revision}${sceneRegenerationEffectSuffix(
        activeRequest.executionSnapshot?.sources.sceneRegeneration
          ?.targetSceneIndexes,
      )}`,
      recompiledMediaSelectionInput,
    );
    if (selection.boundedExecution) {
      activeRequest = {
        ...activeRequest,
        boundedExecution: selection.boundedExecution,
      };
    }
    boundedCheckpoint = selection.boundedCurrentBest;
    await trace(
      runtime,
      workflowId,
      'execution_selection',
      {
      executionRoot: mediaExecutionRoot(request),
      ...selection.trace,
      ...(selection.boundedExecution
        ? { boundedExecution: selection.boundedExecution }
        : {}),
      ...skillTraceLineage(executionSkills),
      },
      `r${bundle.bundle.revision}`,
    );
    await reportProgress({
      stage: 'execution_selection',
      state: 'success',
      message: `已按最新资料${mediaSelectionMessage(brief.kind)}`,
    });
    await emitVideoSceneProgress(brief, 'success', selection.sceneResults);
  }

  await finalizeSelectedMerchantExecution({
    request: activeRequest,
    runtime,
    selectionEffectKey: selection.merchantExecutionEffectKey,
    workflowId,
  });

    const videoPartialTargets =
      brief.kind === 'video' && selection.sceneResults
        ? videoFailedSceneLabels(selection.sceneResults)
        : [];
    return projectDeliveryReadiness({
      unit,
      selectedCandidateId: selection.asset.id,
      producedCandidateId: selection.asset.id,
      plannedTargets: [],
      producedTargets: [],
      partialTargets: videoPartialTargets,
    });
  };

  const assemblySkills = stageSkills.assembly_delivery;

  const recordAssembleStep: CarrierStep = async ({ priorOutputs }) => {
  const readiness = requireDeliveryReadiness(priorOutputs);
  const delivery = await deliverAssembledPackage({
    workflowId,
    runtime,
    assemblyInstructions: assemblySkills.instructions,
    activeRequest,
    ...(ports.recordExecutionAssemblyStep
      ? {
          recordExecutionAssemblyStep:
            ports.recordExecutionAssemblyStep.bind(ports),
        }
      : {}),
    assemble: () =>
      ports.assembleMediaAndDeliver({
        workflowId,
        request: activeRequest,
        declaration: routed.declaration,
        context: bundle,
        allowedFactRefs: factGate.allowedFactRefs ?? [],
        brief,
        selection,
        ...(assemblySkills.instructions.length > 0
          ? { skillInstructions: assemblySkills.instructions }
          : {}),
      }),
  });
  const recommendation = {
    recommendedCandidateId: selection.asset.id,
    decisionTrace: mediaRecommendationDecisionTrace(
      routed.declaration,
      brief,
      delivery,
      activeRequest,
    ),
  };
  await trace(runtime, workflowId, 'assembly_delivery', {
    executionRoot: mediaExecutionRoot(request),
    delivery,
    recommendation,
    ...skillTraceLineage(assemblySkills),
  });
  await reportProgress({
    stage: 'assembly_delivery',
    state: 'success',
    message: merchantTaskSummary({
      revision: delivery.revision,
      strategyBasis: '结合本次创作目标与已确认的门店资料',
      versionPositioning:
        brief.kind === 'image'
          ? '这是本次可优先使用的主图片'
          : '这是本次可优先使用的主视频',
      useSuggestion: '建议先核对画面、文字和使用场景，确认后再发布',
    }),
  });

  // V31-36 video partial: merchant report + billable scene settlement.
  const sceneResults = selection.sceneResults;
  const sceneRegeneration =
    activeRequest.executionSnapshot?.sources.sceneRegeneration;
  const videoSceneCount =
    brief.kind === 'video' ? brief.storyboard.length : 0;
  const videoPartialReport =
    brief.kind === 'video' &&
    sceneResults &&
    !readiness.passed &&
    videoUnresolvedSceneIndexes(sceneResults).length > 0
      ? merchantPartialDeliveryReport({
          message: merchantVideoPartialScenes({
            deliveredUsable: videoSceneDeliveredUsable(sceneResults),
            failedSceneLabels: videoFailedSceneLabels(sceneResults),
          }),
          nextStep:
            '可以先用已经做成的镜头发布，或者让我只重做没成的那几个镜头。',
          category: 'media_generation',
        })
      : undefined;
  /**
   * Scene regeneration quotes exactly the target scenes — never partial
   * against the original full storyboard (mirrors note pageRegeneration).
   * Initial partial: billable = delivered + called_unusable; not_called refunds
   * when the frozen quote failureRefundsCredits switch allows (V31-16 path).
   */
  const videoPartialDelivery =
    brief.kind === 'video' &&
    !sceneRegeneration &&
    sceneResults &&
    videoSceneCount > 0 &&
    videoSceneBillableUnits(sceneResults) < videoSceneCount
      ? {
          totalUnits: videoSceneCount,
          deliveredUnits: videoSceneBillableUnits(sceneResults),
        }
      : undefined;

  return {
    delivery,
    deliveryLayer: routed.declaration.deliveryLayer,
    experienceBasis: projectHarnessExperienceBasis(bundle.bundle),
    recommendation,
    trace: selection.trace,
    ...(videoPartialReport ? { merchantReport: videoPartialReport } : {}),
    ...(brief.kind === 'video'
      ? {
          billingReceipt: {
            trustedUsage: {
              kind: 'media_duration' as const,
              actualSeconds: requireMeasuredVideoDuration(selection),
              evidenceRef: sceneRegeneration
                ? `video-scene-regeneration:${sceneRegeneration.targetSceneIndexes.join(',')}`
                : `owned-asset:${selection.asset.id}`,
            },
            ...(videoPartialDelivery
              ? { partialDelivery: videoPartialDelivery }
              : {}),
          },
        }
      : {}),
  } satisfies MediaHarnessWorkflowResult;
  };

  return {
    carrier: 'media',
    steps: new Map<string, CarrierStep>([
      ['read_context:context', readContextStep],
      ['generate:brief', generateBriefStep],
      ['generate:selection', generateSelectionStep],
      ['check:gate', checkGateStep],
      ['record:assemble', recordAssembleStep],
    ]),
  };
}


// ─── Plan-directed check helpers (V31-25 P0-A) ──────────────────────────────

/**
 * Output of a `check` unit. The rubric is declared by the plan unit, so the
 * merchant-visible consequence of a check is a function of the plan, not of a
 * hard-coded branch inside a carrier program.
 */
export type CarrierDeliveryReadiness = {
  readonly checkedBy: 'compiled_plan_check_unit';
  readonly rubric: string;
  readonly passed: boolean;
  readonly findings: readonly string[];
  readonly selectedCandidateId: string;
};

const CARRIER_CHECK_RUBRICS = [
  'copy_delivery_readiness',
  'media_delivery_readiness',
  'note_page_consistency',
  'note_selected_style',
] as const;

function declaredCheckRubric(unit: ExecutionUnit): string {
  const input = unit.input;
  const rubric =
    input && typeof input === 'object' && 'rubric' in input
      ? (input as { rubric?: unknown }).rubric
      : undefined;
  if (typeof rubric !== 'string' || rubric.trim().length === 0) {
    throw new Error(
      `Check unit ${unit.unitId} declares no rubric; the executor will not guess one.`,
    );
  }
  if (!(CARRIER_CHECK_RUBRICS as readonly string[]).includes(rubric)) {
    throw new Error(
      `Check unit ${unit.unitId} declares unknown rubric ${rubric}.`,
    );
  }
  return rubric;
}

/**
 * Evaluate the rubric the plan's check unit names. Findings are the reason a
 * delivery is reported as partial, so a different rubric on the same run
 * produces a different merchant-visible package report.
 */
export function projectDeliveryReadiness(input: {
  unit: ExecutionUnit;
  selectedCandidateId: string;
  producedCandidateId: string;
  plannedTargets: readonly string[];
  producedTargets: readonly string[];
  partialTargets: readonly string[];
}): CarrierDeliveryReadiness {
  const rubric = declaredCheckRubric(input.unit);
  const findings: string[] = [];
  if (rubric === 'note_page_consistency') {
    const produced = new Set(input.producedTargets);
    for (const planned of input.plannedTargets) {
      if (!produced.has(planned)) findings.push(planned);
    }
    for (const unresolved of input.partialTargets) {
      if (!findings.includes(unresolved)) findings.push(unresolved);
    }
  } else if (rubric === 'note_selected_style') {
    if (input.producedCandidateId !== input.selectedCandidateId) {
      findings.push(input.producedCandidateId);
    }
  } else {
    if (!input.selectedCandidateId.trim()) {
      findings.push('missing_selected_candidate');
    }
    findings.push(...input.partialTargets);
  }
  return {
    checkedBy: 'compiled_plan_check_unit',
    rubric,
    passed: findings.length === 0,
    findings,
    selectedCandidateId: input.selectedCandidateId,
  };
}

function isDeliveryReadiness(value: unknown): value is CarrierDeliveryReadiness {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { checkedBy?: unknown }).checkedBy === 'compiled_plan_check_unit'
  );
}

/**
 * record consumes the check output through the executor's durable
 * priorOutputs, so a plan that never ran a check cannot deliver.
 */
export function requireDeliveryReadiness(
  priorOutputs: ReadonlyMap<string, unknown>,
): CarrierDeliveryReadiness {
  for (const output of [...priorOutputs.values()].reverse()) {
    if (isDeliveryReadiness(output)) return output;
  }
  throw new Error(
    'record unit cannot deliver without a completed check unit output.',
  );
}

/** Per-deliverable expansion keeps effect keys distinct without moving the canonical key. */
function deliverableUnitDiscriminator(unit: ExecutionUnit): string | null {
  const input = unit.input;
  if (!input || typeof input !== 'object') return null;
  const record = input as { deliverableId?: unknown; deliverableIndex?: unknown };
  if (
    typeof record.deliverableId !== 'string' ||
    typeof record.deliverableIndex !== 'number'
  ) {
    return null;
  }
  return `${record.deliverableId}-${record.deliverableIndex}`;
}

function selectionEffectDiscriminator(unit: ExecutionUnit): string {
  const suffix = deliverableUnitDiscriminator(unit);
  return suffix ? `selection:${suffix}` : 'selection';
}

function selectionEffectDiscriminatorSuffix(unit: ExecutionUnit): string {
  const suffix = deliverableUnitDiscriminator(unit);
  return suffix ? `-${suffix}` : '';
}

export class HarnessMediaScopeError extends Error {
  readonly code = 'HARNESS_MEDIA_SCOPE_INVALID';
  readonly status = 409;

  constructor(readonly merchantMessage: string) {
    const message = merchantMessage;
    super(message);
    this.name = 'HarnessMediaScopeError';
  }
}

function stageCollaborators(
  ports:
    | HarnessStagePorts
    | HarnessMediaStagePorts
    | HarnessNoteStagePorts
    | HarnessStageCollaborators,
  lens: NonNullable<HarnessWorkflowInput['executionSnapshot']>['lens'] | undefined,
): HarnessStageCollaborators {
  if ('shared' in ports) return ports;
  return {
    shared: ports,
    copy: 'compileBrief' in ports ? ports : ({} as HarnessCopyStagePorts),
    media:
      lens === 'image' || lens === 'video'
        ? requireMediaStagePorts(ports)
        : ({} as HarnessMediaExecutionStagePorts),
    note:
      lens === 'image_text_note'
        ? requireNoteStagePorts(ports)
        : ({} as HarnessNoteExecutionStagePorts),
  };
}

function stagePortView(
  original:
    | HarnessStagePorts
    | HarnessMediaStagePorts
    | HarnessNoteStagePorts
    | HarnessStageCollaborators,
  collaborators: HarnessStageCollaborators,
  kind: 'copy' | 'media' | 'note',
): HarnessStagePorts | HarnessMediaStagePorts | HarnessNoteStagePorts {
  if (!('shared' in original)) return original;
  const implementation =
    kind === 'copy'
      ? collaborators.copy
      : kind === 'media'
        ? collaborators.media
        : collaborators.note;
  const owners = [implementation, collaborators.copy, collaborators.shared];
  return new Proxy({} as HarnessNoteStagePorts, {
    get(_target, property) {
      for (const owner of owners) {
        const value = Reflect.get(owner, property);
        if (value !== undefined) {
          return typeof value === 'function' ? value.bind(owner) : value;
        }
      }
    },
    has(_target, property) {
      return owners.some((owner) => property in owner);
    },
  });
}

function requireNoteStagePorts(
  ports: HarnessSharedStagePorts,
): HarnessNoteStagePorts {
  if (
    !('compileNoteBrief' in ports) ||
    !('executeNoteAndSelect' in ports) ||
    !('assembleNoteAndDeliver' in ports)
  ) {
    throw new HarnessMediaScopeError(
      'Image-text note Harness stages are not configured.',
    );
  }
  return ports as HarnessNoteStagePorts;
}

function noteStyleQuestion(
  workflowId: string,
  request: HarnessWorkflowInput,
  brief: HarnessNoteBrief,
): QuestionCard {
  const language = merchantNoteStyleQuestion();
  return {
    questionId: `${workflowId}:note-style`,
    workflowId,
    workflowRevision: request.workflowRevision,
    question: language.question,
    options: brief.candidates.candidates.map((candidate) => ({
      id: candidate.styleId,
      label: candidate.styleName,
      description: candidate.positioning,
    })),
    freeText: { enabled: false },
    response: {
      field: 'note_style',
      reason: language.responseReason,
    },
    unattended: 'hold',
    scope: 'current_task',
  };
}

function permissionSelectionQuestion(
  workflowId: string,
  request: HarnessWorkflowInput,
  error: HarnessSelectionError,
): QuestionCard {
  const alternatives =
    error.alternativePaths.length > 0
      ? error.alternativePaths
      : ['补充授权后重新发起'];
  return {
    questionId: `${workflowId}:execution-selection:permission`,
    workflowId,
    workflowRevision: request.workflowRevision,
    question:
      error.merchantMessage ??
      '当前候选触发权限硬门，请选择安全的后续处理方式。',
    options: alternatives.map((label, index) => ({
      id: `permission-alternative-${index + 1}`,
      label,
      description: '当前运行保持拦截，处理完成后可重新发起。',
    })),
    freeText: { enabled: false },
    response: {
      field: 'permission_resolution',
      reason: '选择当前权限硬门的安全后续路径',
    },
    unattended: 'hold',
    scope: 'current_task',
  };
}

function boundedExecutionQuestion(
  workflowId: string,
  request: HarnessWorkflowInput,
  suspension: BoundedExecutionSuspension<unknown>,
  continuation: number,
  attempt: number,
  capability: BoundedExecutionContinuationCapability,
): QuestionCard {
  const currentBest = boundedCurrentBestSummary(suspension.currentBest);
  const canContinue = capability.kind === 'available';
  return {
    questionId:
      `${workflowId}:execution-selection:bounded:` +
      `r${continuation + 1}:a${attempt + 1}`,
    workflowId,
    workflowRevision: request.workflowRevision,
    question: canContinue
        ? `已保留当前最好结果${currentBest}；${suspension.unmetExplanation}。` +
          '提高本次任务上限后可以继续。'
        : `已保留当前最好结果${currentBest}；` +
          `${boundedContinuationUnavailableMessage(capability.reason)}。`,
    options: [
      {
        id: canContinue ? 'continue' : 'stop',
        label: canContinue ? '提高上限后继续' : '结束本次任务',
        description: canContinue
          ? '具体上限由服务端策略决定，不接受前台传入数值。'
          : '当前最好结果会保留，不再产生新的资源消耗。',
      },
    ],
    freeText: { enabled: false },
    response: {
      field: 'bounded_execution_continuation',
      reason: '请求服务端为本次有界执行生成后继钉扎',
    },
    unattended: 'hold',
    scope: 'current_task',
  };
}

async function awaitBoundedExecutionAction(input: {
  capability: BoundedExecutionContinuationCapability;
  continuation: number;
  request: HarnessWorkflowInput;
  runtime: HarnessWorkflowRuntime;
  stage: HarnessStage;
  suspension: BoundedExecutionSuspension<unknown>;
  workflowId: string;
}) {
  for (let attempt = 0; ; attempt += 1) {
    const question = boundedExecutionQuestion(
      input.workflowId,
      input.request,
      input.suspension,
      input.continuation,
      attempt,
      input.capability,
    );
    const command = await awaitResolvedDecision(
      input.runtime,
      question,
      input.stage,
    );
    const expectedValue = question.options[0]?.label;
    if (
      expectedValue &&
      command.questionId === question.questionId &&
      command.workflowRevision === question.workflowRevision &&
      command.patch.field === question.response.field &&
      command.patch.value === expectedValue &&
      command.decision.state === 'accepted' &&
      command.decision.value === expectedValue
    ) {
      return {
        command,
        authorization: {
          kind: 'explicit_bounded_continue' as const,
          questionId: question.questionId,
          workflowRevision: question.workflowRevision,
          field: question.response.field,
          value: expectedValue,
          [boundedExecutionContinuationAuthorization]: true as const,
        },
      };
    }
  }
}

async function inspectBoundedExecutionContinuation(input: {
  request: HarnessWorkflowInput;
  runtime: HarnessWorkflowRuntime;
  suspension: BoundedExecutionSuspension<unknown>;
  workflowId: string;
}): Promise<BoundedExecutionContinuationCapability> {
  if (!input.runtime.inspectBoundedExecutionContinuation) {
    return { kind: 'unavailable', reason: 'config_unavailable' };
  }
  return input.runtime.inspectBoundedExecutionContinuation({
    workflowId: input.workflowId,
    request: input.request,
    suspension: input.suspension,
  });
}

function boundedContinuationUnavailableMessage(
  reason: Extract<
    BoundedExecutionContinuationCapability,
    { kind: 'unavailable' }
  >['reason'],
) {
  switch (reason) {
    case 'hard_cap':
      return '已达本次任务可提高的最高上限';
    case 'unset':
      return '本次任务没有可用的后续上限';
    case 'config_unavailable':
      return '暂时无法安全提高本次任务上限';
  }
}

function boundedCurrentBestSummary(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return '';
  }
  const candidate = 'candidate' in input ? input.candidate : null;
  if (
    candidate &&
    typeof candidate === 'object' &&
    !Array.isArray(candidate) &&
    'title' in candidate &&
    typeof candidate.title === 'string'
  ) {
    const title = candidate.title.replace(/\s+/gu, ' ').trim().slice(0, 120);
    return title.length > 0 ? `（当前最好版本：${title}）` : '';
  }
  const asset = 'asset' in input ? input.asset : null;
  if (
    asset &&
    typeof asset === 'object' &&
    !Array.isArray(asset) &&
    'id' in asset &&
    typeof asset.id === 'string'
  ) {
    const assetId = asset.id.replace(/\s+/gu, '').slice(0, 120);
    return assetId.length > 0 ? `（当前最好素材：${assetId}）` : '';
  }
  return '';
}

function hasConfiguredBoundedExecution(
  snapshot: BoundedExecutionSnapshot | undefined,
) {
  return (
    snapshot !== undefined &&
    BOUNDED_EXECUTION_LIMITS.some(
      (limit) => typeof snapshot[limit] === 'number',
    )
  );
}

function noteStyleIdFromDecision(
  brief: HarnessNoteBrief,
  decision: StructuredDecisionInput,
) {
  return noteStyleIdFromValue(brief, decision.decision.value);
}

function noteStyleIdFromValue(brief: HarnessNoteBrief, value: string) {
  const selected = brief.candidates.candidates.find(
    (candidate) => candidate.styleId === value || candidate.styleName === value,
  );
  if (!selected) {
    throw new HarnessMediaScopeError(
      'The selected image-text note style is unavailable.',
    );
  }
  return selected.styleId;
}

function requireMediaStagePorts(
  ports: HarnessSharedStagePorts,
): HarnessMediaStagePorts {
  if (
    !('compileMediaBrief' in ports) ||
    !('executeMediaAndSelect' in ports) ||
    !('assembleMediaAndDeliver' in ports)
  ) {
    throw new HarnessMediaScopeError(
      'Media Harness stages are not configured.',
    );
  }
  return ports as HarnessMediaStagePorts;
}

function mediaKind(request: HarnessWorkflowInput): MediaBrief['kind'] {
  const lens = request.executionSnapshot?.lens;
  if (lens === 'image' || lens === 'video') return lens;
  throw new HarnessMediaScopeError(
    'Media Harness request lacks an image or video snapshot.',
  );
}

function unpackMediaBrief(input: MediaBrief | MeasuredMediaBrief) {
  return 'brief' in input ? input : { brief: input, metrics: undefined };
}

function mediaBriefTrace(brief: MediaBrief) {
  if (brief.kind === 'image') {
    return {
      kind: brief.kind,
      referenceAssetIds: brief.referenceAssetIds,
      parameters: brief.parameters,
      constraints: brief.constraints,
    };
  }
  return {
    kind: brief.kind,
    referenceAssetIds: brief.referenceAssetIds,
    parameters: brief.parameters,
    storyboardCount: brief.storyboard.length,
    constraints: brief.constraints,
  };
}

function mediaSelectionMessage(kind: MediaBrief['kind']) {
  return kind === 'image' ? '已核验图片生成结果' : '已核验视频生成结果';
}

function merchantContextMessage(request: HarnessWorkflowInput) {
  const progress = merchantProgressMessage('context_injection');
  return request.executionSnapshot?.identity.id === 'official-neutral'
    ? `${progress}。${merchantIdentityVoiceNotice()}`
    : progress;
}

export function requireMeasuredVideoDuration(
  selection: HarnessMediaSelectionResult,
) {
  const duration = selection.measuredDurationSeconds;
  if (
    typeof duration !== 'number' ||
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    throw new HarnessMediaScopeError(
      'Delivered video lacks measured media duration evidence.',
    );
  }
  return duration;
}

const TASK_TYPE_LABELS: Record<IntentDeclaration['taskType'], string> = {
  daily_service_exposure: '日常项目曝光重点',
  traffic_opportunity: '当前流量机会',
  brand_personal_ip: '品牌与个人表达方向',
  promotion_groupbuy_conversion: '本次活动与转化重点',
  routine_marketing_materials: '常用宣发物料需求',
};

function copyStrategyBasis(declaration: IntentDeclaration) {
  return `结合${TASK_TYPE_LABELS[declaration.taskType]}和已确认的门店资料`;
}

function platformLabel(platform: CopyBrief['platform']) {
  return {
    douyin: '抖音',
    offline: '线下物料',
    video_account: '视频号',
    wechat_moments: '朋友圈',
    xiaohongshu: '小红书',
  }[platform];
}

function mediaRecommendationDecisionTrace(
  declaration: IntentDeclaration,
  brief: MediaBrief | HarnessNoteBrief,
  delivery: ContentPackageRevisionDelivery,
  request: HarnessWorkflowInput,
): CreativeRecommendationDecisionTrace {
  return {
    whyPost: declaration.taskType,
    expressionIdentity: 'media_execution_receipt',
    factReferences: [],
    platforms: request.executionSnapshot
      ? [request.executionSnapshot.platform.id]
      : [],
    customerAction: 'review_media',
    complianceStatus: 'owned_asset_verified',
    deliverables: [`${brief.kind}_revision:${delivery.revision}`],
  };
}

function mediaExecutionRoot(request: HarnessWorkflowInput) {
  const snapshot = request.executionSnapshot;
  return snapshot
    ? {
        creationSnapshotId: snapshot.id,
        modality: snapshot.lens,
        workId: snapshot.work.id,
      }
    : null;
}

function unpackBrief(input: CopyBrief | MeasuredCopyBrief): {
  brief: CopyBrief;
  metrics?: StructuredNodeMetricsSnapshot;
  degraded?: boolean;
} {
  return 'brief' in input ? input : { brief: input };
}

async function runContextFenceStep(
  runtime: HarnessWorkflowRuntime,
  effectIdempotencyKey: string,
  ports: Pick<HarnessSharedStagePorts, 'fenceContext'>,
  input: Parameters<HarnessSharedStagePorts['fenceContext']>[0],
) {
  try {
    return await runtime.runStep(effectIdempotencyKey, () =>
      ports.fenceContext(input),
    );
  } catch (error) {
    if (error instanceof HarnessExecutionFencePauseError) {
      throw new HarnessExecutionFencePauseError(
        error.merchantMessage,
        error.diff,
        input.request,
      );
    }
    throw error;
  }
}

async function applyCurrentTaskDecision(
  workflowId: string,
  request: HarnessWorkflowInput,
  command: StructuredDecisionInput,
  runtime: HarnessWorkflowRuntime,
): Promise<HarnessWorkflowInput> {
  if (command.decision.state === 'ignored') return request;
  if (request.executionSnapshot) {
    if (!runtime.resubmitSemanticDecision) {
      throw new HarnessSnapshotDecisionError();
    }
    return runtime.resubmitSemanticDecision({
      workflowId,
      request: {
        ...request,
        executionSnapshot: request.executionSnapshot,
      },
      command,
    });
  }
  const value = command.decision.value;
  return {
    ...withForkDecisionReference(request, command),
    intent: {
      ...request.intent,
      context: {
        ...request.intent.context,
        [command.patch.field]: value,
        sourceSummaries: [
          ...request.intent.context.sourceSummaries.slice(-11),
          `Merchant decision (${command.patch.field}): ${value}`,
        ],
      },
    },
  };
}

/**
 * Pins an in-plan fork answer (note style) onto the live request so a paused
 * continuation and every later stage read it back instead of asking again.
 * Unlike a semantic decision it never invalidates an admitted
 * ExecutionPlanSnapshot: the candidates it chooses between are already part of
 * the frozen plan, so the run continues instead of demanding a resubmission.
 */
function withForkDecisionReference(
  request: HarnessWorkflowInput,
  command: StructuredDecisionInput,
): HarnessWorkflowInput {
  if (command.decision.state === 'ignored') return request;
  return {
    ...request,
    decisionReferences: [
      ...(request.decisionReferences ?? []),
      {
        id: `decision:${command.questionId}:${command.idempotencyKey}`,
        field: command.patch.field,
        value: command.decision.value,
        revision: command.workflowRevision,
      },
    ],
  };
}

async function resolveFactSatisfaction(input: {
  workflowId: string;
  request: HarnessWorkflowInput;
  declaration: IntentDeclaration;
  context: HarnessContextSnapshot;
  ports: HarnessSharedStagePorts;
  runtime: HarnessWorkflowRuntime;
  reportProgress: (
    event: Omit<Parameters<HarnessWorkflowRuntime['progress']>[0], 'sequence'>,
  ) => Promise<void>;
}) {
  if (input.declaration.route === 'free') {
    return {
      request: input.request,
      context: input.context,
      allowedFactRefs: [],
    };
  }
  if (!input.ports.assessFacts) {
    return {
      request: input.request,
      context: input.context,
      allowedFactRefs: undefined,
    };
  }
  const assessment = await input.runtime.runStep(
    harnessEffectKey(
      input.workflowId,
      2,
      'fact-satisfaction',
      `r${input.context.bundle.revision}`,
    ),
    () =>
      input.ports.assessFacts!({
        workflowId: input.workflowId,
        request: input.request,
        declaration: input.declaration,
        context: input.context,
      }),
  );
  if (!assessment) {
    return {
      request: input.request,
      context: input.context,
      allowedFactRefs: undefined,
    };
  }
  await trace(
    input.runtime,
    input.workflowId,
    'context_injection',
    {
      factSatisfaction: {
        status: assessment.status,
        action: assessment.action,
        factRefs: assessment.factRefs,
        ...('missingFactTypes' in assessment
          ? { missingFactTypes: assessment.missingFactTypes }
          : {}),
      },
    },
    `facts-r${input.context.bundle.revision}`,
  );
  if (assessment.action === 'execute') {
    return {
      request: input.request,
      context: input.context,
      allowedFactRefs: assessment.factRefs,
    };
  }
  if (assessment.action === 'execute_with_notice') {
    await input.reportProgress({
      stage: 'context_injection',
      state: 'success',
      message: assessment.resultNotice,
    });
    return {
      request: input.request,
      context: input.context,
      allowedFactRefs: assessment.factRefs,
    };
  }
  if (assessment.action === 'conservative_guidance') {
    await input.reportProgress({
      stage: 'context_injection',
      state: 'success',
      message: assessment.guidance,
    });
    return {
      request: input.request,
      context: input.context,
      allowedFactRefs: assessment.factRefs,
    };
  }

  await input.reportProgress({
    stage: 'context_injection',
    state: 'suspended',
    message: assessment.question.question,
  });
  const resolved = await input.runtime.awaitDecision(
    assessment.question,
    'context_injection',
  );
  if ('cancelled' in resolved) {
    throw new HarnessWorkflowCancellation(
      resolved.merchantMessage,
      resolved.resolutionSource,
    );
  }
  const command = 'command' in resolved ? resolved.command : resolved;
  const request = await applyCurrentTaskDecision(
    input.workflowId,
    input.request,
    command,
    input.runtime,
  );
  if (command.decision.state === 'ignored') {
    return {
      request,
      context: input.context,
      allowedFactRefs: assessment.factRefs,
    };
  }
  const context = await runContextFenceStep(
    input.runtime,
    harnessEffectKey(
      input.workflowId,
      2,
      'fact-decision-fence',
      `r${input.context.bundle.revision}`,
    ),
    input.ports,
    {
      workflowId: input.workflowId,
      request,
      declaration: input.declaration,
      context: input.context,
    },
  );
  await input.reportProgress({
    stage: 'context_injection',
    state: 'success',
    message: '已收到，继续为你生成。',
    experienceBasis: projectHarnessExperienceBasis(context.bundle),
  });
  return {
    request,
    context,
    allowedFactRefs: assessment.factRefs,
  };
}

async function resolveIntentRoute(input: {
  workflowId: string;
  request: HarnessWorkflowInput;
  intent: Awaited<ReturnType<HarnessSharedStagePorts['nameIntent']>>;
  ports: HarnessSharedStagePorts;
  runtime: HarnessWorkflowRuntime;
  reportProgress: (
    event: Omit<Parameters<HarnessWorkflowRuntime['progress']>[0], 'sequence'>,
  ) => Promise<void>;
  skills: {
    instructions: ResolvedSkillInstruction[];
    receipts: SkillInvocationReceipt[];
  };
}) {
  if (!input.intent.blockingQuestion) {
    return {
      declaration: input.intent.declaration,
      request: input.request,
      notice: undefined,
    };
  }
  const pendingQuestionRegistered =
    (await input.runtime.hasRegisteredPendingQuestion?.(
      input.intent.blockingQuestion,
    )) ?? true;
  const gapGrounding = input.intent.gapGrounding;
  if (
    !pendingQuestionRegistered &&
    isUnansweredIndustryGap(
      input.request,
      input.intent.blockingQuestion,
      gapGrounding,
    )
  ) {
    const hasConfirmedMaterials =
      (gapGrounding?.activeConfirmedFactCount ?? 0) > 0;
    return {
      declaration: hasConfirmedMaterials
        ? policyContinuationDeclaration(input.intent.declaration)
        : freeRouteDeclaration(input.intent.declaration, 'policy'),
      request: input.request,
      notice: hasConfirmedMaterials
          ? ('confirmed_materials' as const)
          : ('neutral_fallback' as const),
    };
  }

  await input.reportProgress({
    stage: 'intent_naming',
    state: 'suspended',
    message: input.intent.blockingQuestion.question,
  });
  const resolved = await input.runtime.awaitDecision(
    input.intent.blockingQuestion,
    'intent_naming',
  );
  if ('cancelled' in resolved) {
    throw new HarnessWorkflowCancellation(
      resolved.merchantMessage,
      resolved.resolutionSource,
    );
  }
  const decision = 'command' in resolved ? resolved.command : resolved;
  const resolutionSource =
    'command' in resolved ? resolved.resolutionSource : 'decision';
  const activeRequest = await applyCurrentTaskDecision(
    input.workflowId,
    input.request,
    decision,
    input.runtime,
  );
  if (decision.decision.state === 'ignored') {
    return {
      declaration: freeRouteDeclaration(
        input.intent.declaration,
        resolutionSource === 'core_timeout' ||
          resolutionSource === 'system_default'
          ? 'policy'
          : 'decision',
      ),
      request: activeRequest,
      notice: undefined,
    };
  }
  await input.reportProgress({
    stage: 'intent_naming',
    state: 'success',
    message: '已收到，继续为你生成。',
  });

  const reassessed = await input.runtime.runStep(
    harnessEffectKey(
      input.workflowId,
      1,
      skillEffectUnit('intent', input.skills.instructions),
      '1',
    ),
    () =>
      input.ports.nameIntent({
        workflowId: input.workflowId,
        request: activeRequest,
        round: 1,
        ...(input.skills.instructions.length > 0
          ? { skillInstructions: input.skills.instructions }
          : {}),
      }),
  );
  if (
    reassessed.declaration.route === 'customized' &&
    reassessed.blockingQuestion === null
  ) {
    return {
      declaration: {
        ...reassessed.declaration,
        routingSource: 'decision' as const,
      },
      request: activeRequest,
      notice: undefined,
    };
  }
  return {
    declaration: freeRouteDeclaration(reassessed.declaration),
    request: activeRequest,
    notice: undefined,
  };
}

async function awaitResolvedDecision(
  runtime: HarnessWorkflowRuntime,
  question: QuestionCard,
  stage: HarnessStage,
) {
  const resolved = await runtime.awaitDecision(question, stage);
  if ('cancelled' in resolved) {
    throw new HarnessWorkflowCancellation(
      resolved.merchantMessage,
      resolved.resolutionSource,
    );
  }
  return 'command' in resolved ? resolved.command : resolved;
}

function policyContinuationDeclaration(
  declaration: IntentDeclaration,
): IntentDeclaration {
  return {
    ...declaration,
    route: 'customized',
    routingSource: 'policy',
    usedAssetCategories:
      declaration.usedAssetCategories.length > 0
        ? declaration.usedAssetCategories
        : ['store'],
  };
}

function freeRouteDeclaration(
  declaration: IntentDeclaration,
  routingSource: 'decision' | 'policy' = 'decision',
): IntentDeclaration {
  return {
    ...declaration,
    route: 'free',
    routingSource,
    usedAssetCategories: [],
  };
}

function isUnansweredIndustryGap(
  request: HarnessWorkflowInput,
  question: QuestionCard,
  grounding:
    | {
        activeConfirmedFactCount: number;
        answerableConfirmedFactCount: number;
      }
    | undefined,
) {
  return (
    request.creationMode === 'customized' &&
    question.response.field === 'industry_category' &&
    request.reuseSeed === undefined &&
    grounding?.answerableConfirmedFactCount === 0
  );
}

const ASSET_CATEGORY_LABELS: Record<
  IntentDeclaration['usedAssetCategories'][number],
  string
> = {
  store: '门店资料',
  product_service: '项目资料',
  promotion_activity: '活动资料',
  brand: '品牌表达',
  personal_ip: '个人风格',
  material: '参考素材',
  history_preference: '过往偏好',
  industry_category: '行业特点',
};

export function merchantRouteMessage(
  declaration: IntentDeclaration,
  notice?: 'confirmed_materials' | 'neutral_fallback',
) {
  if (notice === 'confirmed_materials') {
    return merchantConfirmedMaterialsContinuationNotice();
  }
  if (notice === 'neutral_fallback') {
    return merchantNeutralIndustryContinuationNotice();
  }
  if (declaration.route === 'free') {
    return merchantGenericModeNotice();
  }
  const labels = declaration.usedAssetCategories.map(
    (category) => ASSET_CATEGORY_LABELS[category],
  );
  return `这次会参考你的${labels.join('、')}，让内容更贴合本店。`;
}

function recommendationSourceRevisions(context: HarnessContextSnapshot) {
  return context.factsRevision === undefined
    ? context.bundle.sourceRevisions
    : {
        ...context.bundle.sourceRevisions,
        facts: context.factsRevision,
      };
}

function recommendationDecisionTrace(
  declaration: IntentDeclaration,
  brief: CopyBrief,
  delivery: ContentPackageRevisionDelivery,
): CreativeRecommendationDecisionTrace {
  return {
    whyPost: declaration.taskType,
    expressionIdentity:
      brief.identityRefs.join(',') || 'no_expression_identity_reference',
    factReferences: [...brief.factRefs],
    platforms: [brief.platform],
    customerAction: brief.cta,
    complianceStatus: 'seven_gates_passed',
    deliverables: [`copy_revision:${delivery.revision}`],
  };
}

function trace(
  runtime: HarnessWorkflowRuntime,
  workflowId: string,
  stage: Parameters<HarnessWorkflowRuntime['recordTrace']>[0]['stage'],
  payload: unknown,
  discriminator?: string,
  afterPersist?: () => Promise<void>,
) {
  // V31-25 / D-036: five stages demoted to trace taxonomy + six-primitive mounts.
  const executorPath =
    executorPathByRuntime.get(runtime) ?? 'compiled_plan_executor';
  return runtime.recordTrace(
    {
      id: `trace-${workflowId}-${stage}${discriminator ? `-${discriminator}` : ''}`,
      taskId: workflowId,
      stage,
      payload: attachStageTaxonomy(stage, payload, { executorPath }),
    },
    afterPersist,
  );
}

async function runSelectionStage<
  Input extends { runStep?: HarnessEffectRunner },
  Output,
>(
  runtime: HarnessWorkflowRuntime,
  workflowId: string,
  unit: string,
  skills: readonly ResolvedSkillInstruction[],
  input: Input,
  operation: (input: Input) => Promise<Output>,
) {
  if (runtime.awaitSignal) return operation(input);
  return runtime.runStep(
    harnessEffectKey(workflowId, 4, skillEffectUnit(unit, skills), 'selection'),
    () => operation(input),
  );
}

function durableSelectionEffectRunner(
  runtime: HarnessWorkflowRuntime,
  workflowId: string,
  unit: string,
  skills: readonly ResolvedSkillInstruction[],
): HarnessEffectRunner {
  return (effectIdempotencyKey, operation) =>
    runtime.runStep(
      harnessEffectKey(
        workflowId,
        4,
        skillEffectUnit(unit, skills),
        effectIdempotencyKey,
      ),
      operation,
    );
}

export function harnessEffectKey(
  workflowId: string,
  stage: 1 | 2 | 3 | 4 | 5,
  unit: string,
  candidate: string,
) {
  return `wf:${workflowId}:s${stage}:${unit}:${candidate}`;
}

export function skillEffectUnit(
  unit: string,
  skills: readonly Pick<ResolvedSkillInstruction, 'skillRevisionRef'>[],
) {
  if (skills.length === 0) return unit;
  return `${unit}:skills=${skills
    .map((skill) => encodeURIComponent(skill.skillRevisionRef))
    .join(',')}`;
}
