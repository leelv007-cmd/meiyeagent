import type {
  ContentPackage,
  ContentPackageRevisionDelivery,
  CreativeRecommendationDecisionTrace,
  NoteStyleCandidates,
  QuestionCard,
  StructuredDecisionInput,
} from '@meiye/contracts';

import type { DecisionTraceFragment } from './execution-selection.js';
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
} from '../skills/types.js';
import { promptTraceReference } from './langfuse-prompts.js';
import type { HarnessPolicyInput } from './policy-gates.js';
import {
  merchantConfirmedMaterialsContinuationNotice,
  merchantGenericModeNotice,
  merchantIdentityVoiceNotice,
  merchantNeutralIndustryContinuationNotice,
  merchantNoteProgressMessage,
  merchantNoteStyleUnavailable,
  merchantNoteStyleQuestion,
  merchantProgressMessage,
  merchantTaskSummary,
} from './merchant-delivery-language.js';

type CopyBrief = Extract<ExecutionBrief, { kind: 'copy' }>;
type MediaBrief = Exclude<ExecutionBrief, { kind: 'copy' }>;

interface MeasuredCopyBrief {
  brief: CopyBrief;
  metrics: StructuredNodeMetricsSnapshot;
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
}

export interface HarnessMediaSelectionResult {
  asset: NonNullable<ContentPackage['generated']['ownedAssets']>[number];
  childRun: ContentPackage['generated']['childRuns'][number];
  kind: MediaBrief['kind'];
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
  selectedStyleId: string;
  trace: DecisionTraceFragment;
  version: NonNullable<ContentPackage['versions'][number]['note']>;
}

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
    stage: 'intent_naming';
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
  }): Promise<HarnessContextSnapshot>;
  fenceContext(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    declaration: IntentDeclaration;
    context: HarnessContextSnapshot;
  }): Promise<HarnessContextSnapshot>;
  compileBrief(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    declaration: IntentDeclaration;
    context: HarnessContextSnapshot;
  }): Promise<CopyBrief | MeasuredCopyBrief>;
  executeAndSelect(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    brief: CopyBrief;
    context: HarnessContextSnapshot;
    onToken?: (token: {
      candidateId: string;
      channel: 'copy.title' | 'copy.body' | 'copy.cta';
      delta: string;
    }) => Promise<void> | void;
  }): Promise<HarnessSelectionResult>;
  assembleAndDeliver(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    declaration: IntentDeclaration;
    context: HarnessContextSnapshot;
    brief: CopyBrief;
    selection: HarnessSelectionResult;
  }): Promise<ContentPackageRevisionDelivery>;
}

export interface HarnessMediaStagePorts extends HarnessStagePorts {
  compileMediaBrief(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    declaration: IntentDeclaration;
    context: HarnessContextSnapshot;
  }): Promise<MediaBrief | MeasuredMediaBrief>;
  executeMediaAndSelect(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    brief: MediaBrief;
    context: HarnessContextSnapshot;
  }): Promise<HarnessMediaSelectionResult>;
  assembleMediaAndDeliver(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    declaration: IntentDeclaration;
    context: HarnessContextSnapshot;
    brief: MediaBrief;
    selection: HarnessMediaSelectionResult;
  }): Promise<ContentPackageRevisionDelivery>;
}

export interface HarnessNoteStagePorts extends HarnessStagePorts {
  compileNoteBrief(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    declaration: IntentDeclaration;
    context: HarnessContextSnapshot;
  }): Promise<HarnessNoteBrief>;
  executeNoteAndSelect(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    brief: HarnessNoteBrief;
    context: HarnessContextSnapshot;
    selectedStyleId: string;
  }): Promise<HarnessNoteSelectionResult>;
  assembleNoteAndDeliver(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    declaration: IntentDeclaration;
    context: HarnessContextSnapshot;
    brief: HarnessNoteBrief;
    selection: HarnessNoteSelectionResult;
  }): Promise<ContentPackageRevisionDelivery>;
}

export interface HarnessWorkflowRuntime {
  runStep<Output>(
    effectIdempotencyKey: string,
    operation: () => Promise<Output>,
  ): Promise<Output>;
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

const INTENT_SKILL_RESOLUTION_STEP = 'skill:resolve:intent';

async function resolveIntentStageSkills(
  workflowId: string,
  request: HarnessWorkflowInput,
  ports: HarnessStagePorts,
  runtime: HarnessWorkflowRuntime,
) {
  const frozen = await runtime.runStep(
    INTENT_SKILL_RESOLUTION_STEP,
    async () => {
      const resolved =
        (await ports.resolveStageSkills?.({
          workflowId,
          request,
          stage: 'intent_naming',
        })) ?? { instructions: [], receipts: [] };
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
    },
  );
  if (frozen.skillRevisionRefs.length === 0) {
    return { instructions: [], receipts: [] };
  }
  if (!ports.resolveStageSkills) {
    throw new Error('Skill 解析端口不可用，无法恢复已冻结的 Skill。');
  }
  const resolved = await ports.resolveStageSkills({
    workflowId,
    request,
    stage: 'intent_naming',
    skillRevisionRefs: frozen.skillRevisionRefs,
  });
  const current = {
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
  if (
    !sameOrderedValues(current.skillRevisionRefs, frozen.skillRevisionRefs) ||
    !sameOrderedValues(
      current.skillContentHashes,
      frozen.skillContentHashes,
    ) ||
    !sameOrderedValues(current.skillReceiptIds, frozen.skillReceiptIds)
  ) {
    throw new Error('已冻结的 Skill 版本、内容哈希或回执不一致。');
  }
  return resolved;
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
    input: Parameters<HarnessStagePorts['executeAndSelect']>[0],
  ) => {
    const firstTokenSequence = eventSequence;
    const executed = await runtime.runStep(
      effectIdempotencyKey,
      async () => {
        let tokenCount = 0;
        const selection = await ports.executeAndSelect({
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
  let activeRequest = request;
  const intentSkills = await resolveIntentStageSkills(
    workflowId,
    request,
    ports,
    runtime,
  );
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

  let bundle = await runtime.runStep(
    harnessEffectKey(workflowId, 2, 'context', '0'),
    () =>
      ports.injectContext({
        workflowId,
        request: activeRequest,
        declaration: routed.declaration,
      }),
  );
  await trace(runtime, workflowId, 'context_injection', {
    bundleId: bundle.bundle.bundleId,
    revision: bundle.bundle.revision,
    hash: bundle.bundle.hash,
    sourceRevisions: recommendationSourceRevisions(bundle),
  }, `r${bundle.bundle.revision}`);
  await reportProgress({
    stage: 'context_injection',
    state: 'success',
    message: merchantContextMessage(activeRequest),
  });

  let compiledBrief = await runtime.runStep(
    harnessEffectKey(workflowId, 3, 'copy', '0'),
    () =>
      ports.compileBrief({
        workflowId,
        request: activeRequest,
        declaration: routed.declaration,
        context: bundle,
      }),
  );
  let { brief, metrics: briefMetrics } = unpackBrief(compiledBrief);
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
  }, `r${bundle.bundle.revision}`);
  await reportProgress({
    stage: 'brief_compilation',
    state: 'success',
    message: merchantProgressMessage('brief_compilation'),
  });

  let selection = await executeSelection(
    harnessEffectKey(workflowId, 4, 'copy', 'selection'),
    {
      workflowId,
      request: activeRequest,
      brief,
      context: bundle,
    },
  );
  await trace(
    runtime,
    workflowId,
    'execution_selection',
    selection.trace,
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
        `copy-r${bundle.bundle.revision}`,
        '0',
      ),
      () =>
        ports.compileBrief({
          workflowId,
          request: activeRequest,
          declaration: routed.declaration,
          context: bundle,
        }),
    );
    ({ brief, metrics: briefMetrics } = unpackBrief(compiledBrief));
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
    }, `r${bundle.bundle.revision}`);
    selection = await executeSelection(
      harnessEffectKey(
        workflowId,
        4,
        `copy-r${bundle.bundle.revision}`,
        'selection',
      ),
      {
        workflowId,
        request: activeRequest,
        brief,
        context: bundle,
      },
    );
    await trace(
      runtime,
      workflowId,
      'execution_selection',
      selection.trace,
      `r${bundle.bundle.revision}`,
    );
    await reportProgress({
      stage: 'execution_selection',
      state: 'success',
      message: '已按最新资料更新推荐文案',
    });
  }

  const delivery = await runtime.runStep(
    harnessEffectKey(workflowId, 5, 'package', '0'),
    () =>
      ports.assembleAndDeliver({
        workflowId,
        request: activeRequest,
        declaration: routed.declaration,
        context: bundle,
        brief,
        selection,
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
  const intentSkills = await resolveIntentStageSkills(
    workflowId,
    request,
    ports,
    runtime,
  );
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

  let context = await runtime.runStep(
    harnessEffectKey(workflowId, 2, 'context', '0'),
    () =>
      ports.injectContext({
        workflowId,
        request: activeRequest,
        declaration: routed.declaration,
      }),
  );
  await trace(runtime, workflowId, 'context_injection', {
    executionRoot: mediaExecutionRoot(activeRequest),
    bundleId: context.bundle.bundleId,
    revision: context.bundle.revision,
    hash: context.bundle.hash,
    sourceRevisions: recommendationSourceRevisions(context),
  }, `r${context.bundle.revision}`);
  await reportProgress({
    stage: 'context_injection',
    state: 'success',
    message: merchantContextMessage(activeRequest),
  });

  let brief = await runtime.runStep(
    harnessEffectKey(workflowId, 3, 'image_text_note', '0'),
    () =>
      ports.compileNoteBrief({
        workflowId,
        request: activeRequest,
        declaration: routed.declaration,
        context,
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
    brief = await runtime.runStep(
      harnessEffectKey(
        workflowId,
        3,
        `image_text_note-r${context.bundle.revision}`,
        '0',
      ),
      () =>
        ports.compileNoteBrief({
          workflowId,
          request: activeRequest,
          declaration: routed.declaration,
          context,
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
    }, `r${context.bundle.revision}`);
  }

  const selection = await runtime.runStep(
    harnessEffectKey(workflowId, 4, 'image_text_note', 'selection'),
    () =>
      ports.executeNoteAndSelect({
        workflowId,
        request: activeRequest,
        brief,
        context,
        selectedStyleId,
      }),
  );
  await trace(runtime, workflowId, 'execution_selection', {
    executionRoot: mediaExecutionRoot(activeRequest),
    ...selection.trace,
    auditSignals: selection.auditSignals,
  }, `r${context.bundle.revision}`);
  await reportProgress({
    stage: 'execution_selection',
    state: 'success',
    message: merchantNoteProgressMessage('consistency_checked'),
  });

  const delivery = await runtime.runStep(
    harnessEffectKey(workflowId, 5, 'package', '0'),
    () =>
      ports.assembleNoteAndDeliver({
        workflowId,
        request: activeRequest,
        declaration: routed.declaration,
        context,
        brief,
        selection,
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
  return {
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
  const intentSkills = await resolveIntentStageSkills(
    workflowId,
    request,
    ports,
    runtime,
  );
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

  let bundle = await runtime.runStep(
    harnessEffectKey(workflowId, 2, 'context', '0'),
    () =>
      ports.injectContext({
        workflowId,
        request: activeRequest,
        declaration: routed.declaration,
      }),
  );
  await trace(runtime, workflowId, 'context_injection', {
    executionRoot: mediaExecutionRoot(request),
    bundleId: bundle.bundle.bundleId,
    revision: bundle.bundle.revision,
    hash: bundle.bundle.hash,
    sourceRevisions: recommendationSourceRevisions(bundle),
  }, `r${bundle.bundle.revision}`);
  await reportProgress({
    stage: 'context_injection',
    state: 'success',
    message: merchantContextMessage(activeRequest),
  });

  let compiledBrief = await runtime.runStep(
    harnessEffectKey(workflowId, 3, kind, '0'),
    () =>
      ports.compileMediaBrief({
        workflowId,
        request: activeRequest,
        declaration: routed.declaration,
        context: bundle,
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
  }, `r${bundle.bundle.revision}`);
  await reportProgress({
    stage: 'brief_compilation',
    state: 'success',
    message: merchantProgressMessage('brief_compilation'),
  });

  let selection = await runtime.runStep(
    harnessEffectKey(workflowId, 4, kind, 'selection'),
    () =>
      ports.executeMediaAndSelect({
        workflowId,
        request: activeRequest,
        brief,
        context: bundle,
      }),
  );
  await trace(runtime, workflowId, 'execution_selection', {
    executionRoot: mediaExecutionRoot(request),
    ...selection.trace,
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
    await trace(runtime, workflowId, 'context_injection', {
      executionRoot: mediaExecutionRoot(request),
      bundleId: bundle.bundle.bundleId,
      revision: bundle.bundle.revision,
      hash: bundle.bundle.hash,
      sourceRevisions: recommendationSourceRevisions(bundle),
      recompiled: true,
    }, `r${bundle.bundle.revision}`);
    await reportProgress({
      stage: 'context_injection',
      state: 'success',
      message: '资料有更新，已同步到本次创作',
    });
    compiledBrief = await runtime.runStep(
      harnessEffectKey(workflowId, 3, `${kind}-r${bundle.bundle.revision}`, '0'),
      () =>
        ports.compileMediaBrief({
          workflowId,
          request: activeRequest,
          declaration: routed.declaration,
          context: bundle,
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
    }, `r${bundle.bundle.revision}`);
    selection = await runtime.runStep(
      harnessEffectKey(workflowId, 4, `${kind}-r${bundle.bundle.revision}`, 'selection'),
      () =>
        ports.executeMediaAndSelect({
          workflowId,
          request: activeRequest,
          brief,
          context: bundle,
        }),
    );
    await trace(runtime, workflowId, 'execution_selection', {
      executionRoot: mediaExecutionRoot(request),
      ...selection.trace,
    }, `r${bundle.bundle.revision}`);
    await reportProgress({
      stage: 'execution_selection',
      state: 'success',
      message: `已按最新资料${mediaSelectionMessage(brief.kind)}`,
    });
  }

  const delivery = await runtime.runStep(
    harnessEffectKey(workflowId, 5, 'package', '0'),
    () =>
      ports.assembleMediaAndDeliver({
        workflowId,
        request: activeRequest,
        declaration: routed.declaration,
        context: bundle,
        brief,
        selection,
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
              actualSeconds: requireMeasuredVideoDuration(selection.asset),
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

  constructor(message: string) {
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
  asset: HarnessMediaSelectionResult['asset'],
) {
  const duration = asset.compositionEvidence?.durationSeconds;
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

function unpackBrief(input: CopyBrief | MeasuredCopyBrief) {
  return 'brief' in input
    ? input
    : { brief: input, metrics: undefined };
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
    return {
      declaration: policyContinuationDeclaration(input.intent.declaration),
      request: input.request,
      notice:
        (gapGrounding?.activeConfirmedFactCount ?? 0) > 0
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
