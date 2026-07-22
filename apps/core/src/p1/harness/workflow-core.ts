import type {
  ContentPackageRevisionDelivery,
  CreativeRecommendationDecisionTrace,
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
import { promptTraceReference } from './langfuse-prompts.js';
import type { HarnessPolicyInput } from './policy-gates.js';

type CopyBrief = Extract<ExecutionBrief, { kind: 'copy' }>;

interface MeasuredCopyBrief {
  brief: CopyBrief;
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

export interface HarnessContextSnapshot {
  bundle: BriefContextBundle;
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
  nameIntent(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
  }): Promise<{
    declaration: IntentDeclaration;
    blockingQuestion: QuestionCard | null;
    metrics?: StructuredNodeMetricsSnapshot;
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
  awaitDecision(question: QuestionCard): Promise<StructuredDecisionInput>;
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

export async function runHarnessWorkflow(
  workflowId: string,
  request: HarnessWorkflowInput,
  ports: HarnessStagePorts,
  runtime: HarnessWorkflowRuntime,
) {
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
  const intent = await runtime.runStep(
    harnessEffectKey(workflowId, 1, 'intent', '0'),
    () => ports.nameIntent({ workflowId, request }),
  );
  if (intent.blockingQuestion) {
    await reportProgress({
      stage: 'intent_naming',
      state: 'suspended',
      message: intent.blockingQuestion.question,
    });
    const decision = await runtime.awaitDecision(intent.blockingQuestion);
    activeRequest = applyCurrentTaskDecision(request, decision);
  }
  await trace(runtime, workflowId, 'intent_naming', {
    declaration: intent.declaration,
    questionId: intent.blockingQuestion?.questionId ?? null,
    ...(request.prompts?.intentNaming
      ? { prompt: promptTraceReference(request.prompts.intentNaming) }
      : {}),
    ...(intent.metrics ? { metrics: intent.metrics } : {}),
  });
  await reportProgress({
    stage: 'intent_naming',
    state: 'success',
    message: '已确认这次的创作方向',
  });

  let bundle = await runtime.runStep(
    harnessEffectKey(workflowId, 2, 'context', '0'),
    () =>
      ports.injectContext({
        workflowId,
        request: activeRequest,
        declaration: intent.declaration,
      }),
  );
  await trace(runtime, workflowId, 'context_injection', {
    bundleId: bundle.bundle.bundleId,
    revision: bundle.bundle.revision,
    hash: bundle.bundle.hash,
    sourceRevisions: bundle.bundle.sourceRevisions,
  }, `r${bundle.bundle.revision}`);
  await reportProgress({
    stage: 'context_injection',
    state: 'success',
    message: '已整理本次创作资料',
  });

  let compiledBrief = await runtime.runStep(
    harnessEffectKey(workflowId, 3, 'copy', '0'),
    () =>
      ports.compileBrief({
        workflowId,
        request: activeRequest,
        declaration: intent.declaration,
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
    message: '已整理本次创作要求',
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
    message: '已选出本次推荐文案',
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
        declaration: intent.declaration,
        context: bundle,
      }),
  );
  if (fenced.bundle.hash !== bundle.bundle.hash) {
    bundle = fenced;
    await trace(runtime, workflowId, 'context_injection', {
      bundleId: bundle.bundle.bundleId,
      revision: bundle.bundle.revision,
      hash: bundle.bundle.hash,
      sourceRevisions: bundle.bundle.sourceRevisions,
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
          declaration: intent.declaration,
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
        declaration: intent.declaration,
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
    message: `已生成第 ${delivery.revision} 版，等待你采用`,
  });

  return {
    delivery,
    deliveryLayer: intent.declaration.deliveryLayer,
    recommendation,
    trace: selection.trace,
  };
}

function unpackBrief(input: CopyBrief | MeasuredCopyBrief) {
  return 'brief' in input
    ? input
    : { brief: input, metrics: undefined };
}

function applyCurrentTaskDecision(
  request: HarnessWorkflowInput,
  command: StructuredDecisionInput,
): HarnessWorkflowInput {
  if (command.decision.state === 'ignored') return request;
  if (request.executionSnapshot) {
    throw new HarnessSnapshotDecisionError();
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
