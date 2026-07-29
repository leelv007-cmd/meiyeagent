import type {
  BoundedExecutionSnapshot,
  ContentPackage,
  ContentPackageRevisionDelivery,
  CreativeRecommendationDecisionTrace,
  NoteStyleCandidates,
  QuestionCard,
  StructuredDecisionInput,
} from '@meiye/contracts';

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
import type { HarnessWorkflowInput } from './task-admission.js';
import type {
  ResolvedSkillInstruction,
  SkillInvocationReceipt,
  SkillStage,
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
  merchantTaskSummary,
} from './merchant-delivery-language.js';
import type { RecipeFactSatisfaction } from './fact-satisfaction.js';

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
}

export interface HarnessMediaSelectionResult {
  asset: NonNullable<ContentPackage['generated']['ownedAssets']>[number];
  childRun: ContentPackage['generated']['childRuns'][number];
  kind: MediaBrief['kind'];
  measuredDurationSeconds?: number;
  trace: DecisionTraceFragment;
}

export interface HarnessNoteBrief {
  kind: 'image_text_note';
  candidates: NoteStyleCandidates;
}

export interface HarnessNoteSelectionResult {
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

export interface HarnessStagePorts {
  resolveStageSkills?(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    stage: SkillStage;
    userSelectedSkillRefs?: readonly string[];
    skillRevisionRefs?: readonly string[];
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
  assessFacts?(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    declaration: IntentDeclaration;
    context: HarnessContextSnapshot;
  }): Promise<RecipeFactSatisfaction | null>;
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
  }): Promise<
    HarnessSelectionResult | BoundedExecutionSuspension<unknown>
  >;
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

export interface HarnessMediaStagePorts extends HarnessStagePorts {
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
}

export interface HarnessNoteStagePorts extends HarnessStagePorts {
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
    state: 'success' | 'suspended';
    message: string;
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
  ): Promise<
    | StructuredDecisionInput
    | {
        command: StructuredDecisionInput;
        resolutionSource: 'decision' | 'core_timeout';
      }
    | {
        cancelled: true;
        merchantMessage: string;
        resolutionSource: 'core_hold_expired';
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
  }): Promise<HarnessWorkflowInput>;
  recordTrace(input: {
    id: string;
    taskId: string;
    stage:
      | 'intent_naming'
      | 'context_injection'
      | 'brief_compilation'
      | 'execution_selection'
      | 'assembly_delivery';
    payload: unknown;
  }): Promise<void>;
}

export class HarnessSnapshotDecisionError extends Error {
  readonly code = 'HARNESS_SNAPSHOT_DECISION_REQUIRES_RESUBMISSION';
  readonly status = 409;

  constructor() {
    super('A semantic decision requires a new Composer submission and execution snapshot.');
    this.name = 'HarnessSnapshotDecisionError';
  }
}

const SKILL_RESOLUTION_STEP = 'skill:resolve:intent';
const SKILL_STAGES: readonly SkillStage[] = [
  'intent_naming',
  'context_injection',
  'brief_compilation',
  'execution_selection',
  'assembly_delivery',
];

interface FrozenSkillStageResolution {
  skillRevisionRefs: string[];
  skillContentHashes: string[];
  skillReceiptIds: string[];
}

type FrozenSkillStageResolutions = Record<
  SkillStage,
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
  SkillStage,
  {
    instructions: ResolvedSkillInstruction[];
    receipts: SkillInvocationReceipt[];
  }
>;

async function resolveWorkflowStageSkills(
  workflowId: string,
  request: HarnessWorkflowInput,
  ports: HarnessStagePorts,
  runtime: HarnessWorkflowRuntime,
) : Promise<ResolvedSkillStages> {
  const frozen = await runtime.runStep(
    SKILL_RESOLUTION_STEP,
    async () => {
      const stageSkillResolutions = emptyFrozenSkillStages();
      for (const stage of SKILL_STAGES) {
        const resolved =
          (await ports.resolveStageSkills?.({
            workflowId,
            request,
            stage,
          })) ?? { instructions: [], receipts: [] };
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
    !samePromptRevisionRefs(
      frozenPromptRevisionRefs,
      currentPromptRevisionRefs,
    )
  ) {
    throw new Error('已冻结的 Prompt 版本或内容哈希不一致。');
  }
  const stageSkillResolutions = normalizeFrozenSkillStages(frozen);
  const resolvedStages = emptyResolvedSkillStages();
  for (const stage of SKILL_STAGES) {
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
    skillReceiptIds: resolved.receipts.map(
      ({ invocationId }) => invocationId,
    ),
  };
}

function normalizeFrozenSkillStages(input: unknown): FrozenSkillStageResolutions {
  const stages = emptyFrozenSkillStages();
  if (!isRecord(input)) return stages;
  if (isRecord(input.stageSkillResolutions)) {
    for (const stage of SKILL_STAGES) {
      const resolution = input.stageSkillResolutions[stage];
      if (isFrozenSkillStageResolution(resolution)) {
        stages[stage] = resolution;
      }
    }
    return stages;
  }
  if (isFrozenSkillStageResolution(input)) {
    stages.intent_naming = input;
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

function isFrozenSkillStageResolution(
  input: unknown,
): input is FrozenSkillStageResolution {
  return (
    isRecord(input) &&
    isStringArray(input.skillRevisionRefs) &&
    isStringArray(input.skillContentHashes) &&
    isStringArray(input.skillReceiptIds)
  );
}

function isStringArray(input: unknown): input is string[] {
  return Array.isArray(input) && input.every((value) => typeof value === 'string');
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function sameOrderedValues(
  left: readonly string[],
  right: readonly string[],
) {
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
        (reference.source === 'langfuse' ||
          reference.source === 'builtin') &&
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
    resolutionSource: 'core_hold_expired';
  };

  constructor(merchantMessage: string) {
    super(merchantMessage);
    this.name = 'HarnessWorkflowCancellation';
    this.result = {
      delivery: null,
      merchantMessage,
      outcome: 'cancelled',
      resolutionSource: 'core_hold_expired',
    };
  }
}

export async function runHarnessWorkflow(
  workflowId: string,
  request: HarnessWorkflowInput,
  ports: HarnessStagePorts,
  runtime: HarnessWorkflowRuntime,
) {
  // D-118: every output lens dispatches inside the shared five-stage Harness;
  // lightweight copy/image execution may degrade stages but never bypass them.
  if (request.executionSnapshot?.lens === 'image_text_note') {
    return runNoteHarnessWorkflow(
      workflowId,
      request,
      requireNoteStagePorts(ports),
      runtime,
    );
  }
  if (request.executionSnapshot?.lens === 'image' || request.executionSnapshot?.lens === 'video') {
    return runMediaHarnessWorkflow(
      workflowId,
      request,
      requireMediaStagePorts(ports),
      runtime,
    );
  }
  let eventSequence = 0;
  const reportProgress = (
    event: Omit<Parameters<HarnessWorkflowRuntime['progress']>[0], 'sequence'>,
  ) => runtime.progress({ ...event, sequence: eventSequence++ });
  const executeSelection = async (
    effectIdempotencyKey: string,
    input: Parameters<
      NonNullable<HarnessStagePorts['executeAndSelectBounded']>
    >[0],
  ) => {
    const firstTokenSequence = eventSequence;
    const executed = await runtime.runStep(
      effectIdempotencyKey,
      async () => {
        let tokenCount = 0;
        const selection = await (
          input.request.boundedExecution?.maxIterations !== 'unset' &&
          ports.executeAndSelectBounded
            ? ports.executeAndSelectBounded.bind(ports)
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
        return { selection, tokenCount };
      },
    );
    eventSequence += executed.tokenCount;
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
      );
      throw error;
    }
  };
  let activeRequest = request;
  const executeSelectionToCompletion = async (
    effectIdempotencyKey: string,
    initialInput: Parameters<typeof executeSelection>[1],
  ): Promise<HarnessSelectionResult> => {
    let input = initialInput;
    let outcome = await executeSelectionWithPermissionHold(
      effectIdempotencyKey,
      input,
    );
    let continuation = 0;
    while (isBoundedExecutionSuspension(outcome)) {
      await reportProgress({
        stage: 'execution_selection',
        state: 'suspended',
        message: `已保留当前最好结果；${outcome.unmetExplanation}。还可以继续。`,
      });
      await trace(
        runtime,
        workflowId,
        'execution_selection',
        {
          boundedExecution: outcome.snapshot,
          currentBest: outcome.currentBest,
          unmetExplanation: outcome.unmetExplanation,
          resumable: true,
        },
        `bounded-${outcome.snapshot.triggeredLimit}-${outcome.snapshot.consumption.iterations}`,
      );
      const command = await awaitResolvedDecision(
        runtime,
        boundedExecutionQuestion(workflowId, activeRequest, outcome),
      );
      if (!runtime.resumeBoundedExecution) {
        throw new BoundedExecutionResumeError(
          'A server-side raised-limit continuation resolver is required.',
        );
      }
      activeRequest = await runtime.resumeBoundedExecution({
        workflowId,
        request: activeRequest,
        suspension: outcome,
        command,
      });
      continuation += 1;
      input = {
        ...input,
        request: activeRequest,
        boundedResume: outcome,
      };
      outcome = await executeSelectionWithPermissionHold(
        `${effectIdempotencyKey}:bounded-resume:${continuation}`,
        input,
      );
    }
    return outcome;
  };
  const stageSkills = await resolveWorkflowStageSkills(
    workflowId,
    request,
    ports,
    runtime,
  );
  const intentSkills = stageSkills.intent_naming;
  const intent = await runtime.runStep(
    harnessEffectKey(
      workflowId,
      1,
      skillEffectUnit('intent', intentSkills.instructions),
      '0',
    ),
    () =>
      ports.nameIntent({
        workflowId,
        request,
        ...(intentSkills.instructions.length > 0
          ? { skillInstructions: intentSkills.instructions }
          : {}),
      }),
  );
  const routed = await resolveIntentRoute({
    workflowId,
    request,
    intent,
    ports,
    runtime,
    reportProgress,
    skills: intentSkills,
  });
  activeRequest = routed.request;
  await trace(runtime, workflowId, 'intent_naming', {
    // Replay fallback only for durable workflows enqueued before creationMode existed.
    entryMode: request.creationMode ?? 'customized',
    declaration: routed.declaration,
    questionId: intent.blockingQuestion?.questionId ?? null,
    ...(request.prompts?.intentNaming
      ? { prompt: promptTraceReference(request.prompts.intentNaming) }
      : {}),
    ...(intent.metrics ? { metrics: intent.metrics } : {}),
    ...(intentSkills.instructions.length > 0
      ? {
          skillRevisionRefs: intentSkills.instructions.map(
            (skill) => skill.skillRevisionRef,
          ),
          skillContentHashes: intentSkills.instructions.map(
            (skill) => skill.contentHash,
          ),
          skillReceiptIds: intentSkills.receipts.map(
            (receipt) => receipt.invocationId,
          ),
        }
      : {}),
  });
  await reportProgress({
    stage: 'intent_naming',
    state: 'success',
    message: merchantRouteMessage(routed.declaration, routed.notice),
  });

  const contextSkills = stageSkills.context_injection;
  let bundle = await runtime.runStep(
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
  await trace(runtime, workflowId, 'context_injection', {
    bundleId: bundle.bundle.bundleId,
    revision: bundle.bundle.revision,
    hash: bundle.bundle.hash,
    sourceRevisions: recommendationSourceRevisions(bundle),
    ...skillTraceLineage(contextSkills),
  }, `r${bundle.bundle.revision}`);
  await reportProgress({
    stage: 'context_injection',
    state: 'success',
    message: merchantContextMessage(activeRequest),
  });
  let factGate = await resolveFactSatisfaction({
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

  const briefSkills = stageSkills.brief_compilation;
  let compiledBrief = await runtime.runStep(
    harnessEffectKey(
      workflowId,
      3,
      skillEffectUnit('copy', briefSkills.instructions),
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
  let {
    brief,
    metrics: briefMetrics,
    degraded: briefDegraded,
  } = unpackBrief(compiledBrief);
  await trace(runtime, workflowId, 'brief_compilation', {
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
  }, `r${bundle.bundle.revision}`);
  await reportProgress({
    stage: 'brief_compilation',
    state: 'success',
    message: briefDegraded
      ? merchantBriefFallbackNotice()
      : merchantProgressMessage('brief_compilation'),
  });

  const executionSkills = stageSkills.execution_selection;
  let selection: HarnessSelectionResult =
    await executeSelectionToCompletion(
      harnessEffectKey(
        workflowId,
        4,
        skillEffectUnit('copy', executionSkills.instructions),
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
    message: merchantProgressMessage('execution_selection'),
  });

  const fenced = await runtime.runStep(
    harnessEffectKey(
      workflowId,
      2,
      'fence',
      `r${bundle.bundle.revision}`,
    ),
    () =>
      ports.fenceContext({
        workflowId,
        request: activeRequest,
        declaration: routed.declaration,
        context: bundle,
      }),
  );
  if (fenced.bundle.hash !== bundle.bundle.hash) {
    bundle = fenced;
    await trace(runtime, workflowId, 'context_injection', {
      bundleId: bundle.bundle.bundleId,
      revision: bundle.bundle.revision,
      hash: bundle.bundle.hash,
      sourceRevisions: recommendationSourceRevisions(bundle),
      recompiled: true,
      ...skillTraceLineage(contextSkills),
    }, `r${bundle.bundle.revision}`);
    await reportProgress({
      stage: 'context_injection',
      state: 'success',
      message: '资料有更新，已同步到本次创作',
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
    ({ brief, metrics: briefMetrics, degraded: briefDegraded } =
      unpackBrief(compiledBrief));
    await trace(runtime, workflowId, 'brief_compilation', {
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
    }, `r${bundle.bundle.revision}`);
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

  const assemblySkills = stageSkills.assembly_delivery;
  const delivery = await runtime.runStep(
    harnessEffectKey(
      workflowId,
      5,
      skillEffectUnit('package', assemblySkills.instructions),
      '0',
    ),
    () =>
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
  );
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
    recommendation,
    trace: selection.trace,
  };
}

async function runNoteHarnessWorkflow(
  workflowId: string,
  request: HarnessWorkflowInput,
  ports: HarnessNoteStagePorts,
  runtime: HarnessWorkflowRuntime,
) {
  let eventSequence = 0;
  const reportProgress = (
    event: Omit<Parameters<HarnessWorkflowRuntime['progress']>[0], 'sequence'>,
  ) => runtime.progress({ ...event, sequence: eventSequence++ });
  const stageSkills = await resolveWorkflowStageSkills(
    workflowId,
    request,
    ports,
    runtime,
  );
  const intentSkills = stageSkills.intent_naming;
  const intent = await runtime.runStep(
    harnessEffectKey(
      workflowId,
      1,
      skillEffectUnit('intent', intentSkills.instructions),
      '0',
    ),
    () =>
      ports.nameIntent({
        workflowId,
        request,
        ...(intentSkills.instructions.length > 0
          ? { skillInstructions: intentSkills.instructions }
          : {}),
      }),
  );
  if (intent.declaration.deliveryLayer !== 'finished_media') {
    throw new HarnessMediaScopeError(
      'An image-text note must resolve to the finished_media delivery layer.',
    );
  }
  const routed = await resolveIntentRoute({
    workflowId,
    request,
    intent,
    ports,
    runtime,
    reportProgress,
    skills: intentSkills,
  });
  let activeRequest = routed.request;
  await trace(runtime, workflowId, 'intent_naming', {
    executionRoot: mediaExecutionRoot(activeRequest),
    declaration: routed.declaration,
    questionId: intent.blockingQuestion?.questionId ?? null,
  });
  await reportProgress({
    stage: 'intent_naming',
    state: 'success',
    message: merchantRouteMessage(routed.declaration),
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
  await trace(runtime, workflowId, 'context_injection', {
    executionRoot: mediaExecutionRoot(activeRequest),
    bundleId: context.bundle.bundleId,
    revision: context.bundle.revision,
    hash: context.bundle.hash,
    sourceRevisions: recommendationSourceRevisions(context),
    ...skillTraceLineage(contextSkills),
  }, `r${context.bundle.revision}`);
  await reportProgress({
    stage: 'context_injection',
    state: 'success',
    message: merchantContextMessage(activeRequest),
  });

  let factGate = await resolveFactSatisfaction({
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

  const briefSkills = stageSkills.brief_compilation;
  let brief = await runtime.runStep(
    harnessEffectKey(
      workflowId,
      3,
      skillEffectUnit('image_text_note', briefSkills.instructions),
      '0',
    ),
    () =>
      ports.compileNoteBrief({
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
      }),
  );
  await trace(runtime, workflowId, 'brief_compilation', {
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
  }, `r${context.bundle.revision}`);
  await reportProgress({
    stage: 'brief_compilation',
    state: 'suspended',
    message: merchantNoteProgressMessage('styles_ready'),
  });
  let selectedStyleId = noteStyleIdFromDecision(
    brief,
    await awaitResolvedDecision(
      runtime,
      noteStyleQuestion(workflowId, request, brief),
    ),
  );
  await reportProgress({
    stage: 'brief_compilation',
    state: 'success',
    message: merchantNoteProgressMessage('style_selected'),
  });

  const fenced = await runtime.runStep(
    harnessEffectKey(workflowId, 2, 'fence', `r${context.bundle.revision}`),
    () =>
      ports.fenceContext({
        workflowId,
        request: activeRequest,
        declaration: routed.declaration,
        context,
      }),
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
      () =>
        ports.compileNoteBrief({
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
        }),
    );
    if (
      !brief.candidates.candidates.some(
        ({ styleId }) => styleId === selectedStyleId,
      )
    ) {
      throw new HarnessMediaScopeError(merchantNoteStyleUnavailable());
    }
    await trace(runtime, workflowId, 'context_injection', {
      executionRoot: mediaExecutionRoot(activeRequest),
      bundleId: context.bundle.bundleId,
      revision: context.bundle.revision,
      hash: context.bundle.hash,
      recompiled: true,
      ...skillTraceLineage(contextSkills),
    }, `r${context.bundle.revision}`);
  }

  const executionSkills = stageSkills.execution_selection;
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
  };
  const selection = await runSelectionStage(
    runtime,
    workflowId,
    'image_text_note',
    executionSkills.instructions,
    noteSelectionInput,
    (input) => ports.executeNoteAndSelect(input),
  );
  await trace(runtime, workflowId, 'execution_selection', {
    executionRoot: mediaExecutionRoot(activeRequest),
    ...selection.trace,
    auditSignals: selection.auditSignals,
    ...skillTraceLineage(executionSkills),
  }, `r${context.bundle.revision}`);
  await reportProgress({
    stage: 'execution_selection',
    state: 'success',
    message: selection.partial
      ? merchantPartialFailure({
          completed: '可用页面已经生成',
          failed: `第 ${selection.partial.unresolvedPageIds.join('、')} 页的一致性复核仍未通过`,
          nextStep: '先查看已生成页面，再单独重新生成标记页面',
        })
      : merchantNoteProgressMessage('consistency_checked'),
  });

  const assemblySkills = stageSkills.assembly_delivery;
  const delivery = await runtime.runStep(
    harnessEffectKey(
      workflowId,
      5,
      skillEffectUnit('package', assemblySkills.instructions),
      '0',
    ),
    () =>
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
  );
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
  const partialReport = selection.partial
    ? merchantPartialDeliveryReport({
        message: merchantNotePartialConsistency(
          selection.partial.unresolvedPageIds.length,
        ),
        nextStep:
          '可以先用已经对好的页面发布，或者让我把没对上的那几页重做一次。',
      })
    : undefined;
  return {
    ...(partialReport ? { merchantReport: partialReport } : {}),
    billingReceipt: {
      trustedUsage: {
        kind: 'product_units' as const,
        units: [
          {
            resource: 'copy' as const,
            quantity: brief.candidates.candidates.length,
          },
          {
            resource: 'image' as const,
            quantity: selection.version.plan.pages.length,
          },
        ],
        evidenceRef: `note-plan-pages:${selection.version.plan.pages
          .map(({ id, revision }) => `${id}@${revision}`)
          .join(',')}`,
      },
    },
    delivery,
    deliveryLayer: routed.declaration.deliveryLayer,
    recommendation,
    trace: selection.trace,
  };
}

async function runMediaHarnessWorkflow(
  workflowId: string,
  request: HarnessWorkflowInput,
  ports: HarnessMediaStagePorts,
  runtime: HarnessWorkflowRuntime,
) {
  const kind = mediaKind(request);
  let eventSequence = 0;
  const reportProgress = (
    event: Omit<Parameters<HarnessWorkflowRuntime['progress']>[0], 'sequence'>,
  ) => runtime.progress({ ...event, sequence: eventSequence++ });
  let activeRequest = request;
  const stageSkills = await resolveWorkflowStageSkills(
    workflowId,
    request,
    ports,
    runtime,
  );
  const intentSkills = stageSkills.intent_naming;
  const intent = await runtime.runStep(
    harnessEffectKey(
      workflowId,
      1,
      skillEffectUnit('intent', intentSkills.instructions),
      '0',
    ),
    () =>
      ports.nameIntent({
        workflowId,
        request,
        ...(intentSkills.instructions.length > 0
          ? { skillInstructions: intentSkills.instructions }
          : {}),
      }),
  );
  if (intent.declaration.deliveryLayer !== 'finished_media') {
    throw new HarnessMediaScopeError(
      'A media submission must resolve to the finished_media delivery layer.',
    );
  }
  const routed = await resolveIntentRoute({
    workflowId,
    request,
    intent,
    ports,
    runtime,
    reportProgress,
    skills: intentSkills,
  });
  activeRequest = routed.request;
  await trace(runtime, workflowId, 'intent_naming', {
    executionRoot: mediaExecutionRoot(request),
    // Replay fallback only for durable workflows enqueued before creationMode existed.
    entryMode: request.creationMode ?? 'customized',
    declaration: routed.declaration,
    questionId: intent.blockingQuestion?.questionId ?? null,
    ...(request.prompts?.intentNaming
      ? { prompt: promptTraceReference(request.prompts.intentNaming) }
      : {}),
    ...(intent.metrics ? { metrics: intent.metrics } : {}),
    ...(intentSkills.instructions.length > 0
      ? {
          skillRevisionRefs: intentSkills.instructions.map(
            (skill) => skill.skillRevisionRef,
          ),
          skillContentHashes: intentSkills.instructions.map(
            (skill) => skill.contentHash,
          ),
          skillReceiptIds: intentSkills.receipts.map(
            (receipt) => receipt.invocationId,
          ),
        }
      : {}),
  });
  await reportProgress({
    stage: 'intent_naming',
    state: 'success',
    message: merchantRouteMessage(routed.declaration, routed.notice),
  });

  const contextSkills = stageSkills.context_injection;
  let bundle = await runtime.runStep(
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
  await trace(runtime, workflowId, 'context_injection', {
    executionRoot: mediaExecutionRoot(request),
    bundleId: bundle.bundle.bundleId,
    revision: bundle.bundle.revision,
    hash: bundle.bundle.hash,
    sourceRevisions: recommendationSourceRevisions(bundle),
    ...skillTraceLineage(contextSkills),
  }, `r${bundle.bundle.revision}`);
  await reportProgress({
    stage: 'context_injection',
    state: 'success',
    message: merchantContextMessage(activeRequest),
  });

  let factGate = await resolveFactSatisfaction({
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

  const briefSkills = stageSkills.brief_compilation;
  let compiledBrief = await runtime.runStep(
    harnessEffectKey(
      workflowId,
      3,
      skillEffectUnit(kind, briefSkills.instructions),
      '0',
    ),
    () =>
      ports.compileMediaBrief({
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
  let { brief, metrics: briefMetrics } = unpackMediaBrief(compiledBrief);
  await trace(runtime, workflowId, 'brief_compilation', {
    executionRoot: mediaExecutionRoot(request),
    ...mediaBriefTrace(brief),
    ...(request.prompts?.briefCompilation
      ? { prompt: promptTraceReference(request.prompts.briefCompilation) }
      : {}),
    ...(briefMetrics ? { metrics: briefMetrics } : {}),
    ...skillTraceLineage(briefSkills),
  }, `r${bundle.bundle.revision}`);
  await reportProgress({
    stage: 'brief_compilation',
    state: 'success',
    message: merchantProgressMessage('brief_compilation'),
  });

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
  let selection = await runSelectionStage(
    runtime,
    workflowId,
    kind,
    executionSkills.instructions,
    mediaSelectionInput,
    (input) => ports.executeMediaAndSelect(input),
  );
  await trace(runtime, workflowId, 'execution_selection', {
    executionRoot: mediaExecutionRoot(request),
    ...selection.trace,
    ...skillTraceLineage(executionSkills),
  }, `r${bundle.bundle.revision}`);
  await reportProgress({
    stage: 'execution_selection',
    state: 'success',
    message: mediaSelectionMessage(brief.kind),
  });

  const fenced = await runtime.runStep(
    harnessEffectKey(workflowId, 2, 'fence', `r${bundle.bundle.revision}`),
    () =>
      ports.fenceContext({
        workflowId,
        request: activeRequest,
        declaration: routed.declaration,
        context: bundle,
      }),
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
    await trace(runtime, workflowId, 'context_injection', {
      executionRoot: mediaExecutionRoot(request),
      bundleId: bundle.bundle.bundleId,
      revision: bundle.bundle.revision,
      hash: bundle.bundle.hash,
      sourceRevisions: recommendationSourceRevisions(bundle),
      recompiled: true,
      ...skillTraceLineage(contextSkills),
    }, `r${bundle.bundle.revision}`);
    await reportProgress({
      stage: 'context_injection',
      state: 'success',
      message: '资料有更新，已同步到本次创作',
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
      () =>
        ports.compileMediaBrief({
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
    ({ brief, metrics: briefMetrics } = unpackMediaBrief(compiledBrief));
    await trace(runtime, workflowId, 'brief_compilation', {
      executionRoot: mediaExecutionRoot(request),
      ...mediaBriefTrace(brief),
      recompiled: true,
      ...(request.prompts?.briefCompilation
        ? { prompt: promptTraceReference(request.prompts.briefCompilation) }
        : {}),
      ...(briefMetrics ? { metrics: briefMetrics } : {}),
      ...skillTraceLineage(briefSkills),
    }, `r${bundle.bundle.revision}`);
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
    };
    selection = await runSelectionStage(
      runtime,
      workflowId,
      `${kind}-r${bundle.bundle.revision}`,
      executionSkills.instructions,
      recompiledMediaSelectionInput,
      (input) => ports.executeMediaAndSelect(input),
    );
    await trace(runtime, workflowId, 'execution_selection', {
      executionRoot: mediaExecutionRoot(request),
      ...selection.trace,
      ...skillTraceLineage(executionSkills),
    }, `r${bundle.bundle.revision}`);
    await reportProgress({
      stage: 'execution_selection',
      state: 'success',
      message: `已按最新资料${mediaSelectionMessage(brief.kind)}`,
    });
  }

  const assemblySkills = stageSkills.assembly_delivery;
  const delivery = await runtime.runStep(
    harnessEffectKey(
      workflowId,
      5,
      skillEffectUnit('package', assemblySkills.instructions),
      '0',
    ),
    () =>
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
  );
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

  return {
    delivery,
    deliveryLayer: routed.declaration.deliveryLayer,
    recommendation,
    trace: selection.trace,
    ...(brief.kind === 'video'
      ? {
          billingReceipt: {
            trustedUsage: {
              kind: 'media_duration' as const,
              actualSeconds: requireMeasuredVideoDuration(selection),
              evidenceRef: `owned-asset:${selection.asset.id}`,
            },
          },
        }
      : {}),
  };
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

function requireNoteStagePorts(ports: HarnessStagePorts): HarnessNoteStagePorts {
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
): QuestionCard {
  return {
    questionId: `${workflowId}:execution-selection:bounded`,
    workflowId,
    workflowRevision: request.workflowRevision,
    question:
      `已保留当前最好结果；${suspension.unmetExplanation}。` +
      '提高本次任务上限后可以继续。',
    options: [
      {
        id: 'continue',
        label: '提高上限后继续',
        description: '具体上限由服务端策略决定，不接受前台传入数值。',
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

function noteStyleIdFromDecision(
  brief: HarnessNoteBrief,
  decision: StructuredDecisionInput,
) {
  const selected = brief.candidates.candidates.find(
    (candidate) =>
      candidate.styleId === decision.decision.value ||
      candidate.styleName === decision.decision.value,
  );
  if (!selected) {
    throw new HarnessMediaScopeError(
      'The selected image-text note style is unavailable.',
    );
  }
  return selected.styleId;
}

function requireMediaStagePorts(ports: HarnessStagePorts): HarnessMediaStagePorts {
  if (
    !('compileMediaBrief' in ports) ||
    !('executeMediaAndSelect' in ports) ||
    !('assembleMediaAndDeliver' in ports)
  ) {
    throw new HarnessMediaScopeError('Media Harness stages are not configured.');
  }
  return ports as HarnessMediaStagePorts;
}

function mediaKind(request: HarnessWorkflowInput): MediaBrief['kind'] {
  const lens = request.executionSnapshot?.lens;
  if (lens === 'image' || lens === 'video') return lens;
  throw new HarnessMediaScopeError('Media Harness request lacks an image or video snapshot.');
}

function unpackMediaBrief(input: MediaBrief | MeasuredMediaBrief) {
  return 'brief' in input
    ? input
    : { brief: input, metrics: undefined };
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

function requireMeasuredVideoDuration(
  selection: HarnessMediaSelectionResult,
) {
  const duration = selection.measuredDurationSeconds;
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
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
    platforms: request.executionSnapshot ? [request.executionSnapshot.platform.id] : [],
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
  return 'brief' in input
    ? input
    : { brief: input };
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
    ...request,
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
    decisionReferences: [
      ...(request.decisionReferences ?? []),
      {
        id: `decision:${command.questionId}:${command.idempotencyKey}`,
        field: command.patch.field,
        value,
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
  ports: HarnessStagePorts;
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
  const resolved = await input.runtime.awaitDecision(assessment.question);
  if ('cancelled' in resolved) {
    throw new HarnessWorkflowCancellation(resolved.merchantMessage);
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
  const context = await input.runtime.runStep(
    harnessEffectKey(
      input.workflowId,
      2,
      'fact-decision-fence',
      `r${input.context.bundle.revision}`,
    ),
    () =>
      input.ports.fenceContext({
        workflowId: input.workflowId,
        request,
        declaration: input.declaration,
        context: input.context,
      }),
  );
  await input.reportProgress({
    stage: 'context_injection',
    state: 'success',
    message: '已收到，继续为你生成。',
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
  intent: Awaited<ReturnType<HarnessStagePorts['nameIntent']>>;
  ports: HarnessStagePorts;
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
      notice:
        hasConfirmedMaterials
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
  );
  if ('cancelled' in resolved) {
    throw new HarnessWorkflowCancellation(resolved.merchantMessage);
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
        resolutionSource === 'core_timeout' ? 'policy' : 'decision',
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
) {
  const resolved = await runtime.awaitDecision(question);
  if ('cancelled' in resolved) {
    throw new HarnessWorkflowCancellation(resolved.merchantMessage);
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
) {
  return runtime.recordTrace({
    id: `trace-${workflowId}-${stage}${discriminator ? `-${discriminator}` : ''}`,
    taskId: workflowId,
    stage,
    payload,
  });
}

async function runSelectionStage<Input extends { runStep?: HarnessEffectRunner }, Output>(
  runtime: HarnessWorkflowRuntime,
  workflowId: string,
  unit: string,
  skills: readonly ResolvedSkillInstruction[],
  input: Input,
  operation: (input: Input) => Promise<Output>,
) {
  if (runtime.awaitSignal) return operation(input);
  return runtime.runStep(
    harnessEffectKey(
      workflowId,
      4,
      skillEffectUnit(unit, skills),
      'selection',
    ),
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
