import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HarnessMediaScopeError,
  HarnessSnapshotDecisionError,
  HarnessWorkflowCancellation,
  runHarnessWorkflow,
  type HarnessMediaSelectionResult,
  type HarnessMediaStagePorts,
  type HarnessNoteBrief,
  type HarnessNoteStagePorts,
  type HarnessStagePorts,
  type HarnessWorkflowRuntime,
} from './workflow-core.js';
import { HarnessSelectionError } from './execution-selection.js';
import { normalizeHarnessTerminalFailure } from './terminal-failure.js';
import type { HarnessWorkflowInput } from './task-admission.js';
import { createCreationExecutionSnapshot } from '../execution-spine/creation-execution-snapshot.js';
import { buildSemanticDecisionResumption } from './semantic-decision-resumption.js';
import {
  HARNESS_LANGFUSE_PROMPT_NAMES,
  type HarnessFrozenPrompts,
} from './langfuse-prompts.js';
import {
  BoundedExecutionResumeError,
  resumeWithRaisedServerLimit,
} from './bounded-execution-controller.js';

test('five semantic stages run in order with stable effect keys and a delivery fence', async () => {
  const calls: string[] = [];
  const progress: Array<{ stage: string; state: string; message: string }> = [];
  const traces: Array<{ stage: string; payload: unknown }> = [];
  const runtime: HarnessWorkflowRuntime = {
    runStep: async (effectIdempotencyKey, operation) => {
      calls.push(effectIdempotencyKey);
      return operation();
    },
    progress: async (event) => {
      progress.push(event);
    },
    async token() {},
    async awaitDecision() {
      throw new Error('Unexpected decision wait.');
    },
    async recordTrace(input) {
      traces.push({ stage: input.stage, payload: input.payload });
    },
  };

  const result = await runHarnessWorkflow(
    'task-35',
    taskInput(),
    fixtureStages(),
    runtime
  );

  assert.deepEqual(calls, [
    'skill:resolve:intent',
    'wf:task-35:s1:intent:0',
    'wf:task-35:s2:context:0',
    'wf:task-35:s3:copy:0',
    'wf:task-35:s4:copy:selection',
    'wf:task-35:s2:fence:r1',
    'wf:task-35:s5:package:0',
  ]);
  assert.deepEqual(
    progress.map(({ stage, state }) => ({ stage, state })),
    [
      { stage: 'intent_naming', state: 'success' },
      { stage: 'context_injection', state: 'success' },
      { stage: 'brief_compilation', state: 'success' },
      { stage: 'execution_selection', state: 'success' },
      { stage: 'assembly_delivery', state: 'success' },
    ]
  );
  assert.deepEqual(
    progress.map(({ message }) => message),
    [
      '这次会参考你的活动资料，让内容更贴合本店。',
      '已整理本次可用的门店资料',
      '已把想法整理成创作要求',
      '已准备好本次主推荐',
      '第 3 版已经准备好。策略依据：结合本次活动与转化重点和已确认的门店资料。版本定位：这是本次适合小红书的主推荐。使用建议：建议先核对内容和预约引导，确认后再发布。',
    ]
  );
  for (const { message } of progress) {
    assert.doesNotMatch(
      message,
      /Harness|revision|candidate|workflow|direct mode|直接模式|排查与详情/iu
    );
  }
  assert.deepEqual(result.delivery, {
    packageId: 'package-1',
    versionId: 'version-3',
    revision: 3,
  });
  assert.equal(result.deliveryLayer, 'copy');
  assert.deepEqual(result.recommendation, {
    recommendedCandidateId: 'c01',
    decisionTrace: {
      whyPost: 'promotion_groupbuy_conversion',
      expressionIdentity: 'identity-1',
      factReferences: ['fact-1'],
      platforms: ['xiaohongshu'],
      customerAction: '私信预约',
      complianceStatus: 'seven_gates_passed',
      deliverables: ['copy_revision:3'],
    },
  });
  assert.deepEqual(traces.map(({ stage }) => stage), [
    'intent_naming',
    'context_injection',
    'brief_compilation',
    'execution_selection',
    'assembly_delivery',
  ]);
  assert.equal(
    (
      traces[1]?.payload as {
        sourceRevisions: { facts: number };
      }
    ).sourceRevisions.facts,
    7,
  );
});

test('selected Skill refs freeze and enter all five stage effects and traces without instruction text', async () => {
  const calls: string[] = [];
  const traces: Array<{ stage: string; payload: unknown }> = [];
  const runtime: HarnessWorkflowRuntime = {
    async runStep(effectIdempotencyKey, operation) {
      calls.push(effectIdempotencyKey);
      return operation();
    },
    async progress() {},
    async token() {},
    async awaitDecision() {
      throw new Error('Unexpected decision wait.');
    },
    async recordTrace(input) {
      traces.push({ stage: input.stage, payload: input.payload });
    },
  };
  const stages = fixtureStages();
  stages.resolveStageSkills = async (input) => ({
    instructions: [
      {
        contentHash: `hash-${input.stage}`,
        executionMode: 'prompt_materialized',
        instruction: 'private instruction must not enter trace',
        requiredModelCapabilities: [],
        skillRevisionRef: `skill.${input.stage}@2`,
      },
    ],
    receipts: [
      {
        childEffectIds: [],
        createdAt: '2026-07-26T00:00:00.000Z',
        inputFingerprint: 'fingerprint',
        invocationId: `skill-materialized:task-35:${input.stage}:skill.${input.stage}%402`,
        productUsageTaskId: 'task-35',
        skillRevisionRef: `skill.${input.stage}@2`,
        status: 'settled',
        taskId: 'task-35',
        totalCostCents: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        workspaceId: 'workspace-1',
      },
    ],
  });

  await runHarnessWorkflow('task-35', taskInput(), stages, runtime);

  assert.equal(
    calls[0],
    'skill:resolve:intent',
  );
  assert.equal(
    calls[1],
    'wf:task-35:s1:intent:skills=skill.intent_naming%402:0',
  );
  assert.equal(
    calls[2],
    'wf:task-35:s2:context:skills=skill.context_injection%402:0',
  );
  assert.equal(
    calls[3],
    'wf:task-35:s3:copy:skills=skill.brief_compilation%402:0',
  );
  assert.equal(
    calls[4],
    'wf:task-35:s4:copy:skills=skill.execution_selection%402:selection',
  );
  assert.equal(
    calls[6],
    'wf:task-35:s5:package:skills=skill.assembly_delivery%402:0',
  );
  for (const trace of traces) {
    const payload = trace.payload as {
      skillRevisionRefs?: string[];
      skillContentHashes?: string[];
      skillReceiptIds?: string[];
    };
    assert.deepEqual(payload.skillRevisionRefs, [`skill.${trace.stage}@2`]);
    assert.deepEqual(payload.skillContentHashes, [`hash-${trace.stage}`]);
    assert.deepEqual(payload.skillReceiptIds, [
      `skill-materialized:task-35:${trace.stage}:skill.${trace.stage}%402`,
    ]);
    assert.equal(JSON.stringify(trace.payload).includes('private instruction'), false);
  }
});

test('durable Skill resolution replays frozen refs after the active binding changes', async () => {
  let activeSkillRevision = 2;
  let activeResolutionCalls = 0;
  let frozenMaterializationCalls = 0;
  let providerEffects = 0;
  const effectKeys: string[] = [];
  const traces: Array<{ stage: string; payload: unknown }> = [];
  const outputs = new Map<string, unknown>();
  const runtime: HarnessWorkflowRuntime = {
    async runStep<Output>(effectIdempotencyKey: string, operation: () => Promise<Output>) {
      effectKeys.push(effectIdempotencyKey);
      if (outputs.has(effectIdempotencyKey)) {
        return outputs.get(effectIdempotencyKey) as Output;
      }
      const output = await operation();
      outputs.set(effectIdempotencyKey, output);
      return output;
    },
    async progress() {},
    async token() {},
    async awaitDecision() {
      throw new Error('Unexpected decision wait.');
    },
    async recordTrace(input) {
      traces.push({ stage: input.stage, payload: input.payload });
    },
  };
  const stages = fixtureStages();
  stages.resolveStageSkills = async (input) => {
    const revision = input.skillRevisionRefs
      ? Number(input.skillRevisionRefs[0]?.split('@')[1])
      : activeSkillRevision;
    if (input.skillRevisionRefs) {
      frozenMaterializationCalls += 1;
    } else {
      activeResolutionCalls += 1;
    }
    const skillRevisionRef = `skill.intent-one@${revision}`;
    return {
      instructions: [
        {
          contentHash: `hash-skill-${revision}`,
          executionMode: 'prompt_materialized',
          instruction: `private instruction ${revision}`,
          requiredModelCapabilities: [],
          skillRevisionRef,
        },
      ],
      receipts: [
        {
          childEffectIds: [],
          createdAt: '2026-07-26T00:00:00.000Z',
          inputFingerprint: `fingerprint-${revision}`,
          invocationId: `skill-materialized:task-35:intent_naming:${skillRevisionRef}`,
          productUsageTaskId: 'task-35',
          skillRevisionRef,
          status: 'settled',
          taskId: 'task-35',
          totalCostCents: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          workspaceId: 'workspace-1',
        },
      ],
    };
  };
  const nameIntent = stages.nameIntent;
  stages.nameIntent = async (input) => {
    providerEffects += 1;
    return nameIntent(input);
  };

  await runHarnessWorkflow('task-35', taskInput(), stages, runtime);
  activeSkillRevision = 1;
  await runHarnessWorkflow('task-35', taskInput(), stages, runtime);

  assert.equal(activeResolutionCalls, 5);
  assert.equal(frozenMaterializationCalls, 10);
  assert.equal(providerEffects, 1);
  const frozen = outputs.get('skill:resolve:intent') as {
    skillRevisionRefs: string[];
    stageSkillResolutions: Record<
      string,
      { skillRevisionRefs: string[] }
    >;
  };
  assert.deepEqual(frozen.skillRevisionRefs, ['skill.intent-one@2']);
  assert.deepEqual(
    Object.values(frozen.stageSkillResolutions).map(
      ({ skillRevisionRefs }) => skillRevisionRefs,
    ),
    [
      ['skill.intent-one@2'],
      ['skill.intent-one@2'],
      ['skill.intent-one@2'],
      ['skill.intent-one@2'],
      ['skill.intent-one@2'],
    ],
  );
  assert.equal(
    JSON.stringify(outputs.get('skill:resolve:intent')).includes(
      'private instruction',
    ),
    false,
  );
  assert.deepEqual(
    effectKeys.filter((key) => key.startsWith('wf:task-35:s1:')),
    [
      'wf:task-35:s1:intent:skills=skill.intent-one%402:0',
      'wf:task-35:s1:intent:skills=skill.intent-one%402:0',
    ],
  );
  const replayedIntentTrace = traces.filter(
    (trace) => trace.stage === 'intent_naming',
  ).at(-1)?.payload as { skillRevisionRefs?: string[] };
  assert.deepEqual(replayedIntentTrace.skillRevisionRefs, [
    'skill.intent-one@2',
  ]);
});

test('durable replay rejects prompt version or content-hash drift', async () => {
  const outputs = new Map<string, unknown>();
  const runtime: HarnessWorkflowRuntime = {
    async runStep<Output>(
      effectIdempotencyKey: string,
      operation: () => Promise<Output>,
    ) {
      if (outputs.has(effectIdempotencyKey)) {
        return outputs.get(effectIdempotencyKey) as Output;
      }
      const output = await operation();
      outputs.set(effectIdempotencyKey, output);
      return output;
    },
    async progress() {},
    async token() {},
    async awaitDecision() {
      throw new Error('Unexpected decision wait.');
    },
    async recordTrace() {},
  };
  const initial = {
    ...taskInput(),
    promptRevisionRefs: {
      intentNaming: {
        name: 'harness/intent-naming',
        version: '7',
        contentHash: 'a'.repeat(64),
        label: 'production',
        source: 'langfuse' as const,
        isFallback: false,
      },
    },
  };

  await runHarnessWorkflow(
    'task-prompt-drift',
    initial,
    fixtureStages(),
    runtime,
  );

  await assert.rejects(
    runHarnessWorkflow(
      'task-prompt-drift',
      {
        ...initial,
        promptRevisionRefs: {
          intentNaming: {
            ...initial.promptRevisionRefs.intentNaming,
            version: '8',
            contentHash: 'b'.repeat(64),
          },
        },
      },
      fixtureStages(),
      runtime,
    ),
    /已冻结的 Prompt 版本或内容哈希不一致/u,
  );
});

test('official-neutral execution reports a conversational identity reminder without blocking delivery', async () => {
  const request = snapshotTaskInput();
  request.executionSnapshot = {
    ...request.executionSnapshot!,
    identity: { id: 'official-neutral', revision: '1' },
  };
  const messages: string[] = [];

  const result = await runHarnessWorkflow(
    'task-neutral',
    request,
    fixtureStages(),
    {
      async runStep(_key, operation) {
        return operation();
      },
      async progress(event) {
        messages.push(event.message);
      },
      async token() {},
      async awaitDecision() {
        throw new Error(
          'Official-neutral creation must not wait for a decision.'
        );
      },
      async recordTrace() {},
    }
  );

  assert.deepEqual(result.delivery, {
    packageId: 'package-1',
    versionId: 'version-3',
    revision: 3,
  });
  assert.ok(
    messages.some((message) => message.includes('这次先用门店官方口吻生成'))
  );
});

test('image and video snapshots use the same five Harness stages with modality-stable effects', async () => {
  for (const kind of ['image', 'video'] as const) {
    const keys: string[] = [];
    const progress: string[] = [];
    const traces: Array<{ stage: string; payload: unknown }> = [];
    const result = await runHarnessWorkflow(
      `task-${kind}`,
      mediaTaskInput(kind),
      mediaStages(kind),
      {
        async runStep(key, operation) {
          keys.push(key);
          return operation();
        },
        async progress(event) {
          progress.push(`${event.stage}:${event.state}`);
        },
        async token() {},
        async awaitDecision() {
          throw new Error('Unexpected media decision wait.');
        },
        async recordTrace(input) {
          traces.push({ stage: input.stage, payload: input.payload });
        },
      }
    );

    assert.deepEqual(keys, [
      'skill:resolve:intent',
      `wf:task-${kind}:s1:intent:0`,
      `wf:task-${kind}:s2:context:0`,
      `wf:task-${kind}:s3:${kind}:0`,
      `wf:task-${kind}:s4:${kind}:selection`,
      `wf:task-${kind}:s2:fence:r1`,
      `wf:task-${kind}:s5:package:0`,
    ]);
    assert.deepEqual(progress, [
      'intent_naming:success',
      'context_injection:success',
      'brief_compilation:success',
      'execution_selection:success',
      'assembly_delivery:success',
    ]);
    assert.equal(result.deliveryLayer, 'finished_media');
    assert.equal(
      result.recommendation.recommendedCandidateId,
      `${kind}-asset-1`
    );
    if (kind === 'video') {
      assert.deepEqual(
        'billingReceipt' in result ? result.billingReceipt : undefined,
        {
          trustedUsage: {
            kind: 'media_duration',
            actualSeconds: 6,
            evidenceRef: 'owned-asset:video-asset-1',
          },
        },
      );
    } else {
      assert.equal('billingReceipt' in result, false);
    }
    assert.deepEqual(
      traces.map(({ stage }) => stage),
      [
        'intent_naming',
        'context_injection',
        'brief_compilation',
        'execution_selection',
        'assembly_delivery',
      ]
    );
    assert.match(
      JSON.stringify(traces[0]?.payload),
      new RegExp(`"modality":"${kind}"`, 'u')
    );
  }
});

test('configured media bounds fail closed when the bounded media port is unavailable', async () => {
  const request = mediaTaskInput('image');
  request.boundedExecution = boundedExecutionSnapshot(0, 1);
  const stages = mediaStages('image');
  let ordinarySelections = 0;
  stages.executeMediaAndSelect = async () => {
    ordinarySelections += 1;
    throw new Error('Configured bounds must not use ordinary media selection.');
  };

  await assert.rejects(
    runHarnessWorkflow('task-image-bounded-missing', request, stages, {
      async runStep(_key, operation) {
        return operation();
      },
      async progress() {},
      async token() {},
      async awaitDecision() {
        throw new Error('A missing bounded media port must fail before HITL.');
      },
      async recordTrace() {},
    }),
    /Configured bounded execution requires a bounded media selection port/u,
  );
  assert.equal(ordinarySelections, 0);
});

test('a bounded media port cannot deliver without its cumulative snapshot and strict checkpoint', async () => {
  const request = mediaTaskInput('image');
  request.boundedExecution = boundedExecutionSnapshot(0, 2);
  const stages = mediaStages('image');
  const ordinarySelection = stages.executeMediaAndSelect.bind(stages);
  stages.executeMediaAndSelectBounded = ordinarySelection;

  await assert.rejects(
    runHarnessWorkflow('task-image-bounded-bypass', request, stages, {
      async runStep(_key, operation) {
        return operation();
      },
      async progress() {},
      async token() {},
      async awaitDecision() {
        throw new Error('An incomplete bounded success must not enter HITL.');
      },
      async recordTrace() {},
    }),
    /must return its cumulative snapshot and checkpoint/u,
  );
});

test('media bounded suspension resumes from the same checkpoint and carries consumption to delivery', async () => {
  const request = mediaTaskInput('image');
  request.boundedExecution = boundedExecutionSnapshot(0, 1);
  const stages = mediaStages('image');
  const ordinarySelection = stages.executeMediaAndSelect.bind(stages);
  const observabilityEvents: Array<
    Parameters<NonNullable<HarnessStagePorts['recordObservabilityEvent']>>[0]
  > = [];
  let boundedCalls = 0;
  let deliveredSnapshot: HarnessWorkflowInput['boundedExecution'];
  const executionCheckCalls: number[] = [];
  stages.recordObservabilityEvent = async (event) => {
    observabilityEvents.push(event);
  };
  stages.recordExecutionAssemblyStep = async ({ step }) => {
    if (step === 'execution_check') {
      executionCheckCalls.push(boundedCalls);
    }
  };
  stages.executeMediaAndSelectBounded = async (input) => {
    boundedCalls += 1;
    if (!input.boundedResume) {
      return {
        state: 'suspended',
        snapshot: {
          ...input.request.boundedExecution!,
          consumption: {
            ...input.request.boundedExecution!.consumption,
            iterations: 1,
          },
          stopReason: 'limit_reached',
          triggeredLimit: 'maxIterations',
        },
        currentBest: mediaBoundedCheckpoint(1),
        unmetExplanation: '媒体生成已达到本轮上限',
        resumable: true,
      };
    }
    assert.equal(
      input.boundedResume.currentBest &&
        typeof input.boundedResume.currentBest === 'object' &&
        'attempts' in input.boundedResume.currentBest &&
        Array.isArray(input.boundedResume.currentBest.attempts)
        ? input.boundedResume.currentBest.attempts[0]?.jobId
        : undefined,
      'job-image-1',
    );
    const selection = await ordinarySelection(input);
    return {
      ...selection,
      boundedCurrentBest: input.boundedResume.currentBest,
      boundedExecution: input.request.boundedExecution,
    };
  };
  stages.assembleMediaAndDeliver = async (input) => {
    deliveredSnapshot = input.request.boundedExecution;
    return {
      packageId: 'package-1',
      versionId: 'image-version-1',
      revision: 3,
    };
  };
  const stepResults = new Map<string, Promise<unknown>>();
  const persistedTraceIds = new Set<string>();
  const runtime: HarnessWorkflowRuntime = {
    async runStep(key, operation) {
      const replayed = stepResults.get(key);
      if (replayed) {
        return replayed as ReturnType<typeof operation>;
      }
      const result = operation();
      stepResults.set(key, result);
      return result;
    },
    async progress() {},
    async token() {},
    async awaitDecision(question) {
      return {
        idempotencyKey: 'raise-image-bound-1',
        questionId: question.questionId,
        workflowRevision: question.workflowRevision,
        patch: {
          field: question.response.field,
          value: question.options[0]!.label,
          reason: question.response.reason,
        },
        decision: {
          state: 'accepted',
          value: question.options[0]!.label,
        },
      };
    },
    async resumeBoundedExecution(input) {
      return {
        ...input.request,
        boundedExecution: resumeWithRaisedServerLimit(
          input.suspension.snapshot,
          { limit: 'maxIterations', value: 2 },
        ),
      };
    },
    async recordTrace(trace, afterPersist) {
      if (persistedTraceIds.has(trace.id)) {
        return;
      }
      persistedTraceIds.add(trace.id);
      await afterPersist?.();
    },
  };

  const result = await runHarnessWorkflow(
    'task-image-bounded',
    request,
    stages,
    runtime,
  );
  await runHarnessWorkflow('task-image-bounded', request, stages, runtime);

  assert.equal(boundedCalls, 2);
  assert.deepEqual(executionCheckCalls, [2, 2]);
  assert.equal(deliveredSnapshot?.consumption.iterations, 1);
  assert.equal(deliveredSnapshot?.maxIterations, 2);
  assert.equal(result.delivery.packageId, 'package-1');
  assert.deepEqual(
    observabilityEvents.map(
      ({ workflowId, request: eventRequest, idempotencyKey, event, promptKey }) => ({
        workflowId,
        workspaceId: eventRequest.workspaceId,
        idempotencyKey,
        event,
        promptKey,
      }),
    ),
    [
      {
        workflowId: 'task-image-bounded',
        workspaceId: 'workspace-1',
        idempotencyKey: 'bounded:task-image-bounded:image:0:suspended',
        event: {
          eventType: 'bounded_execution.suspended',
          payload: {
            snapshot: {
              ...boundedExecutionSnapshot(1, 1),
              stopReason: 'limit_reached',
              triggeredLimit: 'maxIterations',
            },
            currentBest: mediaBoundedCheckpoint(1),
            unmetExplanation: '媒体生成已达到本轮上限',
            resumable: true,
          },
        },
        promptKey: undefined,
      },
      {
        workflowId: 'task-image-bounded',
        workspaceId: 'workspace-1',
        idempotencyKey:
          'bounded:task-image-bounded:raise-image-bound-1:resumed',
        event: {
          eventType: 'bounded_execution.resumed',
          payload: {
            previousSnapshot: {
              ...boundedExecutionSnapshot(1, 1),
              stopReason: 'limit_reached',
              triggeredLimit: 'maxIterations',
            },
            snapshot: boundedExecutionSnapshot(1, 2),
            decisionId: 'raise-image-bound-1',
          },
        },
        promptKey: undefined,
      },
    ],
  );
});

test('media bounded suspension without a canonical emitter does not claim event persistence', async () => {
  const request = mediaTaskInput('image');
  request.boundedExecution = boundedExecutionSnapshot(0, 1);
  const stages = mediaStages('image');
  const ordinarySelection = stages.executeMediaAndSelect.bind(stages);
  const boundedTraceCallbacks: boolean[] = [];
  stages.executeMediaAndSelectBounded = async (input) => {
    if (!input.boundedResume) {
      return {
        state: 'suspended',
        snapshot: {
          ...boundedExecutionSnapshot(1, 1),
          stopReason: 'limit_reached',
          triggeredLimit: 'maxIterations',
        },
        currentBest: mediaBoundedCheckpoint(1),
        unmetExplanation: '媒体生成已达到本轮上限',
        resumable: true,
      };
    }
    return {
      ...(await ordinarySelection(input)),
      boundedCurrentBest: input.boundedResume.currentBest,
      boundedExecution: input.request.boundedExecution,
    };
  };

  await runHarnessWorkflow('task-image-bounded-no-emitter', request, stages, {
    async runStep(_key, operation) {
      return operation();
    },
    async progress() {},
    async token() {},
    async awaitDecision(question) {
      return {
        idempotencyKey: 'raise-image-bound-no-emitter',
        questionId: question.questionId,
        workflowRevision: question.workflowRevision,
        patch: {
          field: question.response.field,
          value: question.options[0]!.label,
          reason: question.response.reason,
        },
        decision: {
          state: 'accepted',
          value: question.options[0]!.label,
        },
      };
    },
    async resumeBoundedExecution(input) {
      return {
        ...input.request,
        boundedExecution: resumeWithRaisedServerLimit(
          input.suspension.snapshot,
          { limit: 'maxIterations', value: 2 },
        ),
      };
    },
    async recordTrace(trace, afterPersist) {
      if (trace.id.includes('media-bounded')) {
        boundedTraceCallbacks.push(afterPersist !== undefined);
      }
      await afterPersist?.();
    },
  });

  assert.deepEqual(boundedTraceCallbacks, [false]);
});

test('media bounded suspension keys separate context-fence executions and replay without duplicates', async () => {
  const request = mediaTaskInput('image');
  request.boundedExecution = boundedExecutionSnapshot(0, 1);
  const stages = mediaStages('image');
  const ordinarySelection = stages.executeMediaAndSelect.bind(stages);
  const persistedEvents = new Map<
    string,
    Parameters<NonNullable<HarnessStagePorts['recordObservabilityEvent']>>[0]
  >();
  const emitterCalls: string[] = [];
  stages.recordObservabilityEvent = async (input) => {
    emitterCalls.push(input.idempotencyKey);
    const existing = persistedEvents.get(input.idempotencyKey);
    if (
      existing &&
      JSON.stringify(existing.event) !== JSON.stringify(input.event)
    ) {
      throw new Error(
        `Canonical observability idempotency conflict: ${input.idempotencyKey}`,
      );
    }
    persistedEvents.set(input.idempotencyKey, input);
  };
  stages.executeMediaAndSelectBounded = async (input) => {
    const revision = input.context.bundle.revision;
    if (!input.boundedResume) {
      return {
        state: 'suspended',
        snapshot: {
          ...input.request.boundedExecution!,
          consumption: {
            ...input.request.boundedExecution!.consumption,
            iterations: revision,
          },
          stopReason: 'limit_reached',
          triggeredLimit: 'maxIterations',
        },
        currentBest: mediaBoundedCheckpoint(revision),
        unmetExplanation: `媒体生成 revision ${revision} 已达到本轮上限`,
        resumable: true,
      };
    }
    return {
      ...(await ordinarySelection(input)),
      boundedCurrentBest: input.boundedResume.currentBest,
      boundedExecution: input.request.boundedExecution,
    };
  };
  stages.fenceContext = async (input) => ({
    ...input.context,
    bundle: {
      ...input.context.bundle,
      revision: 2,
      hash: 'b'.repeat(64),
      previousRevision: input.context.bundle.revision,
    },
  });
  const stepResults = new Map<string, Promise<unknown>>();
  const persistedTraceIds = new Set<string>();
  let decisionInvocation = 0;
  const runtime: HarnessWorkflowRuntime = {
    async runStep(key, operation) {
      const replayed = stepResults.get(key);
      if (replayed) {
        return replayed as ReturnType<typeof operation>;
      }
      const result = operation();
      stepResults.set(key, result);
      return result;
    },
    async progress() {},
    async token() {},
    async awaitDecision(question) {
      const round = (decisionInvocation % 2) + 1;
      decisionInvocation += 1;
      return {
        idempotencyKey: `raise-image-fence-${round}`,
        questionId: question.questionId,
        workflowRevision: question.workflowRevision,
        patch: {
          field: question.response.field,
          value: question.options[0]!.label,
          reason: question.response.reason,
        },
        decision: {
          state: 'accepted',
          value: question.options[0]!.label,
        },
      };
    },
    async resumeBoundedExecution(input) {
      return {
        ...input.request,
        boundedExecution: resumeWithRaisedServerLimit(
          input.suspension.snapshot,
          {
            limit: 'maxIterations',
            value:
              typeof input.suspension.snapshot.maxIterations === 'number'
                ? input.suspension.snapshot.maxIterations + 1
                : 1,
          },
        ),
      };
    },
    async recordTrace(trace, afterPersist) {
      if (persistedTraceIds.has(trace.id)) {
        return;
      }
      persistedTraceIds.add(trace.id);
      await afterPersist?.();
    },
  };

  await runHarnessWorkflow(
    'task-image-bounded-fence-events',
    request,
    stages,
    runtime,
  );
  await runHarnessWorkflow(
    'task-image-bounded-fence-events',
    request,
    stages,
    runtime,
  );

  assert.deepEqual(emitterCalls, [
    'bounded:task-image-bounded-fence-events:image:0:suspended',
    'bounded:task-image-bounded-fence-events:raise-image-fence-1:resumed',
    'bounded:task-image-bounded-fence-events:image-r2:0:suspended',
    'bounded:task-image-bounded-fence-events:raise-image-fence-2:resumed',
  ]);
  assert.deepEqual(
    [...persistedEvents.values()].map(
      ({ idempotencyKey, event }) => [
        idempotencyKey,
        event.eventType,
      ],
    ),
    [
      [
        'bounded:task-image-bounded-fence-events:image:0:suspended',
        'bounded_execution.suspended',
      ],
      [
        'bounded:task-image-bounded-fence-events:raise-image-fence-1:resumed',
        'bounded_execution.resumed',
      ],
      [
        'bounded:task-image-bounded-fence-events:image-r2:0:suspended',
        'bounded_execution.suspended',
      ],
      [
        'bounded:task-image-bounded-fence-events:raise-image-fence-2:resumed',
        'bounded_execution.resumed',
      ],
    ],
  );
});

test('media context fence keeps bounded consumption while recompiling the provider effect', async () => {
  const request = mediaTaskInput('image');
  request.boundedExecution = boundedExecutionSnapshot(0, 5);
  const stages = mediaStages('image');
  const ordinarySelection = stages.executeMediaAndSelect.bind(stages);
  let boundedCalls = 0;
  let deliveredIterations = -1;
  stages.executeMediaAndSelectBounded = async (input) => {
    boundedCalls += 1;
    assert.equal(
      input.request.boundedExecution?.consumption.iterations,
      boundedCalls - 1,
    );
    if (boundedCalls === 2) {
      assert.deepEqual(
        input.boundedCheckpoint &&
          typeof input.boundedCheckpoint === 'object' &&
          'countedProviderCostIds' in input.boundedCheckpoint
          ? input.boundedCheckpoint.countedProviderCostIds
          : undefined,
        ['cost-image-1'],
      );
    }
    const selection = await ordinarySelection(input);
    return {
      ...selection,
      boundedCurrentBest: mediaBoundedCheckpoint(boundedCalls),
      boundedExecution: {
        ...input.request.boundedExecution!,
        consumption: {
          ...input.request.boundedExecution!.consumption,
          iterations: boundedCalls,
        },
      },
    };
  };
  stages.fenceContext = async (input) => ({
    ...input.context,
    bundle: {
      ...input.context.bundle,
      revision: 2,
      hash: 'b'.repeat(64),
      previousRevision: input.context.bundle.revision,
    },
  });
  stages.assembleMediaAndDeliver = async (input) => {
    deliveredIterations =
      input.request.boundedExecution?.consumption.iterations ?? -1;
    return {
      packageId: 'package-1',
      versionId: 'image-version-fenced',
      revision: 3,
    };
  };

  await runHarnessWorkflow('task-image-bounded-fence', request, stages, {
    async runStep(_key, operation) {
      return operation();
    },
    async progress() {},
    async token() {},
    async awaitDecision() {
      throw new Error('A continuing media bound should not enter HITL.');
    },
    async recordTrace() {},
  });

  assert.equal(boundedCalls, 2);
  assert.equal(deliveredIterations, 2);
});

test('image-text note uses the fourth Harness fork and waits for style choice before page generation', async () => {
  const keys: string[] = [];
  const progress: string[] = [];
  const observabilityEvents: unknown[] = [];
  let executionSelectionTrace: Record<string, unknown> | undefined;
  const request = mediaTaskInput('image_text_note');
  const stages = noteStages();
  const executeNoteAndSelect = stages.executeNoteAndSelect.bind(stages);
  stages.executeNoteAndSelect = async (input) => {
    const selected = await executeNoteAndSelect(input);
    return {
      ...selected,
      auditSignals: [
        ...selected.auditSignals,
        {
          eventType: 'note_page_regenerated' as const,
          payload: {
            auditRef: 'note-text-rewrite-page-1',
            imagePoints: 0 as const,
            pageId: 'page-1',
            reason: 'Exact text mismatch.',
            side: 'text' as const,
            trigger: 'check_violation' as const,
          },
        },
      ],
    };
  };
  stages.recordObservabilityEvent = async (event) => {
    observabilityEvents.push(event);
  };
  const result = await runHarnessWorkflow(
    'task-image-text-note',
    request,
    stages,
    {
      async runStep(key, operation) {
        keys.push(key);
        return operation();
      },
      async progress(event) {
        progress.push(`${event.stage}:${event.state}`);
      },
      async token() {},
      async awaitDecision(question) {
        assert.equal(question.response.field, 'note_style');
        assert.equal(question.unattended, 'hold');
        assert.deepEqual(
          question.options.map(({ id }) => id),
          ['facts', 'story'],
        );
        return {
          idempotencyKey: 'choose-story',
          questionId: question.questionId,
          workflowRevision: question.workflowRevision,
          patch: {
            field: 'note_style',
            value: '故事版',
            reason: '选择图文方向',
          },
          decision: { state: 'accepted', value: '故事版' },
        };
      },
      async recordTrace(trace, afterPersist) {
        if (trace.stage === 'execution_selection') {
          executionSelectionTrace = trace.payload as Record<string, unknown>;
        }
        await afterPersist?.();
      },
    },
  );

  assert.deepEqual(keys, [
    'skill:resolve:intent',
    'wf:task-image-text-note:s1:intent:0',
    'wf:task-image-text-note:s2:context:0',
    'wf:task-image-text-note:s3:image_text_note:0',
    'wf:task-image-text-note:s2:fence:r1',
    'wf:task-image-text-note:s4:image_text_note:selection',
    'wf:task-image-text-note:s5:package:0',
  ]);
  assert.deepEqual(progress, [
    'intent_naming:success',
    'context_injection:success',
    'brief_compilation:suspended',
    'brief_compilation:success',
    'execution_selection:success',
    'assembly_delivery:success',
  ]);
  assert.equal(result.recommendation.recommendedCandidateId, 'story');
  assert.deepEqual(executionSelectionTrace?.auditSignals, [
    {
      eventType: 'note_consistency_evaluated',
      payload: {
        checkId: 'note-plan-consistency',
        status: 'passed',
        strategy: 'warn',
      },
    },
    {
      eventType: 'note_page_regenerated',
      payload: {
        auditRef: 'note-text-rewrite-page-1',
        imagePoints: 0,
        pageId: 'page-1',
        reason: 'Exact text mismatch.',
        side: 'text',
        trigger: 'check_violation',
      },
    },
  ]);
  assert.deepEqual(
    observabilityEvents.map((event) => {
      const value = event as {
        event: { eventType: string };
        idempotencyKey: string;
        promptKey?: string;
      };
      return [
        value.event.eventType,
        value.idempotencyKey,
        value.promptKey,
      ];
    }),
    [
      [
        'note_page_regenerated',
        'note-regenerated:task-image-text-note:note-text-rewrite-page-1',
        'noteTextBlock',
      ],
    ],
  );
  assert.deepEqual(result.billingReceipt, {
    trustedUsage: {
      kind: 'product_units',
      units: [
        { resource: 'copy', quantity: 2 },
        { resource: 'image', quantity: 2 },
      ],
      evidenceRef: 'note-plan-pages:page-1@1,page-2@1',
    },
  });
});

test('image-text note partial selection keeps merchantReport in the workflow result', async () => {
  const result = await runHarnessWorkflow(
    'task-image-text-note-partial',
    mediaTaskInput('image_text_note'),
    noteStages(true),
    {
      async runStep(_key, operation) {
        return operation();
      },
      async progress() {},
      async token() {},
      async awaitDecision(question) {
        return {
          idempotencyKey: 'choose-story-partial',
          questionId: question.questionId,
          workflowRevision: question.workflowRevision,
          patch: {
            field: 'note_style',
            value: '故事版',
            reason: '选择图文方向',
          },
          decision: { state: 'accepted', value: '故事版' },
        };
      },
      async recordTrace() {},
    },
  );

  const merchantReport =
    'merchantReport' in result ? result.merchantReport : undefined;
  assert.equal(merchantReport?.kind, 'partial');
  assert.equal(merchantReport?.category, 'consistency');
  assert.ok(merchantReport?.actions.includes('review_partial'));
});

test('DBOS note selection keeps durable effects under stable keys', async () => {
  const effectKeys: string[] = [];
  await runHarnessWorkflow(
    'task-image-text-note-durable',
    mediaTaskInput('image_text_note'),
    noteStages(false, async (input) => {
      assert.equal(typeof input.runStep, 'function');
      await input.runStep?.('note-plan', async () => undefined);
    }),
    {
      async runStep(key, operation) {
        effectKeys.push(key);
        return operation();
      },
      async awaitSignal() {
        return null;
      },
      async progress() {},
      async token() {},
      async awaitDecision(question) {
        return {
          idempotencyKey: 'choose-story-durable',
          questionId: question.questionId,
          workflowRevision: question.workflowRevision,
          patch: {
            field: 'note_style',
            value: '故事版',
            reason: '选择图文方向',
          },
          decision: { state: 'accepted', value: '故事版' },
        };
      },
      async recordTrace() {},
    },
  );

  assert.ok(
    effectKeys.includes(
      'wf:task-image-text-note-durable:s4:image_text_note:note-plan',
    ),
  );
});

test('image-text note refuses to replace a selected style after context recompile', async () => {
  const stages = noteStages();
  const originalBrief = noteBrief();
  let compileCount = 0;
  stages.compileNoteBrief = async () => {
    compileCount += 1;
    return compileCount === 1
      ? originalBrief
      : {
          ...originalBrief,
          candidates: {
            candidates: [originalBrief.candidates.candidates[0]!],
          },
        };
  };
  stages.fenceContext = async (input) => ({
    ...input.context,
    bundle: { ...input.context.bundle, hash: 'b'.repeat(64), revision: 2 },
  });
  stages.executeNoteAndSelect = async () => {
    throw new Error('A missing selected style must fail before execution.');
  };

  await assert.rejects(
    runHarnessWorkflow(
      'task-image-text-note-style-fence',
      mediaTaskInput('image_text_note'),
      stages,
      {
        async runStep(_key, operation) {
          return operation();
        },
        async progress() {},
        async token() {},
        async awaitDecision(question) {
          return {
            idempotencyKey: 'choose-story-before-recompile',
            questionId: question.questionId,
            workflowRevision: question.workflowRevision,
            patch: {
              field: 'note_style',
              value: '故事版',
              reason: '选择图文方向',
            },
            decision: { state: 'accepted', value: '故事版' },
          };
        },
        async recordTrace() {},
      },
    ),
    // The merchant sentence has to be on `merchantMessage`, not in the Error
    // message: `normalizeHarnessTerminalFailure` forwards only the former, so
    // copy written into the message never reaches the 申报卡 (P0-2).
    (error: unknown) => {
      assert.ok(error instanceof HarnessMediaScopeError);
      assert.match(
        error.merchantMessage ?? '',
        /你刚选的图文方向已不在当前配置中，请重新选择后再继续/u,
      );
      assert.match(
        normalizeHarnessTerminalFailure(error).merchantMessage as string,
        /你刚选的图文方向已不在当前配置中，请重新选择后再继续/u,
      );
      return true;
    },
  );
});

test('one blocking question suspends and resumes before context injection', async () => {
  const stages = fixtureStages();
  stages.nameIntent = async () => ({
    declaration: {
      normalizedIntent: '推广本店团购',
      taskType: 'promotion_groupbuy_conversion',
      deliveryLayer: 'copy',
      relevantAssetCategories: ['promotion_activity'],
      usedAssetCategories: [],
      route: 'guidance',
      routingSource: 'model',
      implicitConstraints: [],
    },
    blockingQuestion: {
      questionId: 'question-1',
      workflowId: 'task-35',
      workflowRevision: 4,
      question: '本次团购的当前价格是多少？',
      options: [],
      freeText: { enabled: true },
      response: {
        field: 'offer_price',
        reason: '补充当前任务所需的权威事实',
      },
      unattended: 'continue',
      scope: 'current_task',
    },
  });
  const order: string[] = [];
  let injectedRequest: HarnessWorkflowInput | undefined;
  const originalInjectContext = stages.injectContext;
  stages.injectContext = async (input) => {
    injectedRequest = input.request;
    return originalInjectContext(input);
  };
  const runtime: HarnessWorkflowRuntime = {
    async runStep(_key, operation) {
      return operation();
    },
    async progress(event) {
      order.push(`${event.stage}:${event.state}`);
    },
    async token() {},
    async awaitDecision(question) {
      order.push(`decision:${question.questionId}`);
      return {
        idempotencyKey: 'decision-1',
        questionId: question.questionId,
        workflowRevision: question.workflowRevision,
        patch: {
          field: 'intent',
          value: '当前团购价 398 元',
          reason: '补充当前任务信息',
        },
        decision: { state: 'accepted', value: '当前团购价 398 元' },
      };
    },
    async recordTrace(_trace, afterPersist) {
      await afterPersist?.();
    },
  };

  await runHarnessWorkflow('task-35', taskInput(), stages, runtime);

  assert.deepEqual(order.slice(0, 3), [
    'intent_naming:suspended',
    'decision:question-1',
    'intent_naming:success',
  ]);
  assert.equal(injectedRequest?.intent.context.intent, '当前团购价 398 元');
  assert.deepEqual(injectedRequest?.intent.context.sourceSummaries, [
    'Merchant decision (intent): 当前团购价 398 元',
  ]);
  assert.deepEqual(injectedRequest?.decisionReferences, [
    {
      id: 'decision:question-1:decision-1',
      field: 'intent',
      value: '当前团购价 398 元',
      revision: 4,
    },
  ]);
});

test('an unanswered industry gap keeps the customized route and uses confirmed materials', async () => {
  const stages = fixtureIndustryGapStages();
  const nameIntent = stages.nameIntent;
  stages.nameIntent = async (input) => ({
    ...(await nameIntent(input)),
    gapGrounding: {
      activeConfirmedFactCount: 2,
      answerableConfirmedFactCount: 0,
    },
  });
  let injectedDeclaration:
    | Awaited<ReturnType<HarnessStagePorts['nameIntent']>>['declaration']
    | undefined;
  const injectContext = stages.injectContext;
  stages.injectContext = async (input) => {
    injectedDeclaration = input.declaration;
    return injectContext(input);
  };
  const messages: string[] = [];

  await runHarnessWorkflow('task-copy', snapshotTaskInput(), stages, {
    async runStep(_key, operation) {
      return operation();
    },
    async hasRegisteredPendingQuestion() {
      return false;
    },
    async progress(event) {
      messages.push(event.message);
    },
    async token() {},
    async awaitDecision() {
      throw new Error('Day-0 industry gaps must not wait for a decision.');
    },
    async recordTrace() {},
  });

  assert.deepEqual(
    {
      route: injectedDeclaration?.route,
      routingSource: injectedDeclaration?.routingSource,
      usedAssetCategories: injectedDeclaration?.usedAssetCategories,
    },
    {
      route: 'customized',
      routingSource: 'policy',
      usedAssetCategories: ['store'],
    },
  );
  assert.equal(
    messages[0],
    '这次会参考你已确认的资料，直接继续生成。',
  );
  assert.doesNotMatch(messages[0] ?? '', /industry_category|intent|snapshot/iu);
});

test('an unanswered industry gap without confirmed materials uses a neutral fallback notice', async () => {
  const stages = fixtureIndustryGapStages();
  const nameIntent = stages.nameIntent;
  stages.nameIntent = async (input) => ({
    ...(await nameIntent(input)),
    gapGrounding: {
      activeConfirmedFactCount: 0,
      answerableConfirmedFactCount: 0,
    },
  });
  const messages: string[] = [];
  let injectedDeclaration:
    | Awaited<ReturnType<HarnessStagePorts['nameIntent']>>['declaration']
    | undefined;
  const injectContext = stages.injectContext;
  stages.injectContext = async (input) => {
    injectedDeclaration = input.declaration;
    return injectContext(input);
  };

  await runHarnessWorkflow('task-copy', snapshotTaskInput(), stages, {
    async runStep(_key, operation) {
      return operation();
    },
    async hasRegisteredPendingQuestion() {
      return false;
    },
    async progress(event) {
      messages.push(event.message);
    },
    async token() {},
    async awaitDecision() {
      throw new Error('An unanswered Day-0 gap must not register a decision.');
    },
    async recordTrace() {},
  });

  assert.equal(
    messages[0],
    '这次先按通用方式继续生成，不需要补充行业信息。',
  );
  assert.deepEqual(
    {
      route: injectedDeclaration?.route,
      routingSource: injectedDeclaration?.routingSource,
      usedAssetCategories: injectedDeclaration?.usedAssetCategories,
    },
    {
      route: 'free',
      routingSource: 'policy',
      usedAssetCategories: [],
    },
  );
});

test('a Day-0 generic route does not reopen a blocking Recipe fact question', async () => {
  const stages = fixtureIndustryGapStages();
  const nameIntent = stages.nameIntent;
  stages.nameIntent = async (input) => ({
    ...(await nameIntent(input)),
    gapGrounding: {
      activeConfirmedFactCount: 0,
      answerableConfirmedFactCount: 0,
    },
  });
  let factAssessments = 0;
  stages.assessFacts = async () => {
    factAssessments += 1;
    return {
      status: 'partial',
      action: 'ask_user',
      factRefs: [],
      missingFactTypes: ['other'],
      question: {
        questionId: 'task-copy:s2:missing-facts',
        workflowId: 'task-copy',
        workflowRevision: 1,
        question: '请确认本次创作要用的门店名称。',
        options: [],
        freeText: { enabled: true },
        response: {
          field: 'store_facts',
          reason: '补充当前任务所需的权威事实',
        },
        unattended: 'continue',
        scope: 'current_task',
      },
      ledgerIntake: {
        factTypes: ['other'],
        writePath: 'asset_intake.confirm_fact',
      },
    };
  };
  let allowedFactRefs: readonly string[] | undefined;
  const compileBrief = stages.compileBrief;
  stages.compileBrief = async (input) => {
    allowedFactRefs = input.allowedFactRefs;
    return compileBrief(input);
  };

  await runHarnessWorkflow('task-copy', snapshotTaskInput(), stages, {
    async runStep(_key, operation) {
      return operation();
    },
    async hasRegisteredPendingQuestion() {
      return false;
    },
    async progress() {},
    async token() {},
    async awaitDecision() {
      throw new Error('Day-0 generic creation must not wait for store facts.');
    },
    async recordTrace() {},
  });

  assert.equal(factAssessments, 0);
  assert.deepEqual(allowedFactRefs, []);
});

test('a skippable critical fact question continues with only authorized matched facts', async () => {
  const stages = fixtureStages();
  let allowedFactRefs: readonly string[] | undefined;
  stages.assessFacts = async () => ({
    status: 'partial',
    action: 'ask_user',
    factRefs: ['store_fact:service-1:1'],
    missingFactTypes: ['price'],
    question: {
      questionId: 'task-copy:s2:missing-facts',
      workflowId: 'task-copy',
      workflowRevision: 1,
      question: '请确认本次创作要用的价格。',
      options: [],
      freeText: { enabled: true },
      response: {
        field: 'store_facts',
        reason: '补充当前任务所需的权威事实',
      },
      unattended: 'continue',
      scope: 'current_task',
    },
    ledgerIntake: {
      factTypes: ['price'],
      writePath: 'asset_intake.confirm_fact',
    },
  });
  const compileBrief = stages.compileBrief;
  stages.compileBrief = async (input) => {
    allowedFactRefs = input.allowedFactRefs;
    return compileBrief(input);
  };
  const messages: string[] = [];

  await runHarnessWorkflow('task-copy', snapshotTaskInput(), stages, {
    async runStep(_key, operation) {
      return operation();
    },
    async progress(event) {
      messages.push(event.message);
    },
    async token() {},
    async awaitDecision(question) {
      assert.equal(question.unattended, 'continue');
      return {
        idempotencyKey: 'skip-missing-price',
        questionId: question.questionId,
        workflowRevision: question.workflowRevision,
        patch: {
          field: question.response.field,
          value: '本次先不补充',
          reason: question.response.reason,
        },
        decision: {
          state: 'ignored',
          value: '本次先不补充',
        },
      };
    },
    async recordTrace() {},
  });

  assert.deepEqual(allowedFactRefs, ['store_fact:service-1:1']);
  assert.ok(messages.includes('请确认本次创作要用的价格。'));
});

test('an existing pending industry question replays the original decision sequence', async () => {
  const stages = fixtureIndustryGapStages();
  const nameIntent = stages.nameIntent;
  stages.nameIntent = async (input) => ({
    ...(await nameIntent(input)),
    gapGrounding: {
      activeConfirmedFactCount: 1,
      answerableConfirmedFactCount: 0,
    },
  });
  const runSteps: string[] = [];
  const order: string[] = [];

  await runHarnessWorkflow('task-copy', snapshotTaskInput(), stages, {
    async runStep(key, operation) {
      runSteps.push(key);
      return operation();
    },
    async hasRegisteredPendingQuestion(question) {
      order.push(`pending-check:${question.questionId}`);
      return true;
    },
    async progress(event) {
      order.push(`${event.stage}:${event.state}`);
    },
    async token() {},
    async awaitDecision(question) {
      order.push(`decision:${question.questionId}`);
      return {
        idempotencyKey: 'ignore-replayed-industry-question',
        questionId: question.questionId,
        workflowRevision: question.workflowRevision,
        patch: {
          field: question.response.field,
          value: '这次先跳过',
          reason: question.response.reason,
        },
        decision: { state: 'ignored', value: '这次先跳过' },
      };
    },
    async recordTrace() {},
  });

  assert.deepEqual(order.slice(0, 3), [
    'pending-check:task-copy:s1:industry_category',
    'intent_naming:suspended',
    'decision:task-copy:s1:industry_category',
  ]);
  assert.deepEqual(runSteps, [
    'skill:resolve:intent',
    'wf:task-copy:s1:intent:0',
    'wf:task-copy:s2:context:0',
    'wf:task-copy:s3:copy:0',
    'wf:task-copy:s4:copy:selection',
    'wf:task-copy:s2:fence:r1',
    'wf:task-copy:s5:package:0',
  ]);
});

test('a runtime without a pending-question lookup fails closed to the decision path', async () => {
  const stages = fixtureIndustryGapStages();
  const nameIntent = stages.nameIntent;
  stages.nameIntent = async (input) => ({
    ...(await nameIntent(input)),
    gapGrounding: {
      activeConfirmedFactCount: 0,
      answerableConfirmedFactCount: 0,
    },
  });
  let awaitedQuestion = false;

  await runHarnessWorkflow('task-copy', snapshotTaskInput(), stages, {
    async runStep(_key, operation) {
      return operation();
    },
    async progress() {},
    async token() {},
    async awaitDecision(question) {
      awaitedQuestion = true;
      return {
        idempotencyKey: 'ignore-question-without-pending-lookup',
        questionId: question.questionId,
        workflowRevision: question.workflowRevision,
        patch: {
          field: question.response.field,
          value: '这次先跳过',
          reason: question.response.reason,
        },
        decision: { state: 'ignored', value: '这次先跳过' },
      };
    },
    async recordTrace() {},
  });

  assert.equal(awaitedQuestion, true);
});

test('a core timeout labels the generic route as policy, not merchant decision', async () => {
  const stages = fixtureIndustryGapStages();
  const nameIntent = stages.nameIntent;
  stages.nameIntent = async (input) => ({
    ...(await nameIntent(input)),
    gapGrounding: {
      activeConfirmedFactCount: 0,
      answerableConfirmedFactCount: 0,
    },
  });
  let routingSource: string | undefined;
  const injectContext = stages.injectContext;
  stages.injectContext = async (input) => {
    routingSource = input.declaration.routingSource;
    return injectContext(input);
  };

  await runHarnessWorkflow('task-copy', snapshotTaskInput(), stages, {
    async runStep(_key, operation) {
      return operation();
    },
    async progress() {},
    async token() {},
    async awaitDecision(question) {
      return {
        command: {
          idempotencyKey: 'server-persisted-timeout-event',
          questionId: question.questionId,
          workflowRevision: question.workflowRevision,
          patch: {
            field: question.response.field,
            value: '超时未作答，已按通用口径继续',
            reason: question.response.reason,
          },
          decision: {
            state: 'ignored',
            value: '超时未作答，已按通用口径继续',
          },
        },
        resolutionSource: 'core_timeout' as const,
      };
    },
    async recordTrace() {},
  });

  assert.equal(routingSource, 'policy');
});

test('a reuse request keeps an industry question reachable and resumes after its answer', async () => {
  const stages = fixtureIndustryGapStages();
  const nameIntent = stages.nameIntent;
  stages.nameIntent = async (input) => {
    const named = await nameIntent(input);
    if (input.round === 1) {
      return {
        ...named,
        declaration: {
          ...named.declaration,
          route: 'customized',
          routingSource: 'model',
          usedAssetCategories: ['store'],
        },
        blockingQuestion: null,
      };
    }
    return {
      ...named,
      gapGrounding: {
        activeConfirmedFactCount: 0,
        answerableConfirmedFactCount: 0,
      },
    };
  };
  const request: HarnessWorkflowInput = taskInput();
  request.reuseSeed = {
    assetId: 'series-a',
    assetRevision: 2,
    sourcePackageId: 'package-source',
    sourceVersionId: 'version-source',
    sourcePackageRevision: 4,
    assetRevisionId: 'series-a:2',
    fixedItemKeys: ['structure.opening'],
    variableSlotKeys: ['industry_category'],
  };
  let answeredField: string | undefined;

  await runHarnessWorkflow('task-copy', request, stages, {
    async runStep(_key, operation) {
      return operation();
    },
    async hasRegisteredPendingQuestion() {
      return false;
    },
    async progress() {},
    async token() {},
    async awaitDecision(question) {
      answeredField = question.response.field;
      return {
        idempotencyKey: 'answer-reuse-industry-question',
        questionId: question.questionId,
        workflowRevision: question.workflowRevision,
        patch: {
          field: question.response.field,
          value: '美甲',
          reason: question.response.reason,
        },
        decision: { state: 'accepted', value: '美甲' },
      };
    },
    async recordTrace() {},
  });

  assert.equal(answeredField, 'industry_category');
});

test('a snapshot-backed semantic answer resubmits the same task and work before continuing', async () => {
  const originalRequest = {
    ...snapshotTaskInput(),
    usageReservation: {
      id: 'usage-reservation-task-copy',
      units: [{ resource: 'copy' as const, quantity: 1 }],
    },
  };
  const originalSnapshot = structuredClone(originalRequest.executionSnapshot);
  const stages = fixtureStages();
  let intentRound = 0;
  let injectedRequest: HarnessWorkflowInput | undefined;
  stages.nameIntent = async ({ request }) => {
    intentRound += 1;
    return {
      declaration: {
        normalizedIntent: request.rawInput,
        taskType: 'daily_service_exposure',
        deliveryLayer: 'copy',
        relevantAssetCategories: ['industry_category'],
        usedAssetCategories: intentRound === 1 ? [] : ['industry_category'],
        route: intentRound === 1 ? 'guidance' : 'customized',
        routingSource: 'model',
        implicitConstraints: [],
      },
      blockingQuestion:
        intentRound === 1
          ? {
              questionId: 'task-copy:s1:industry_category',
              workflowId: 'task-copy',
              workflowRevision: 1,
              question: '这次内容主要属于哪一类美业服务？',
              options: [],
              freeText: { enabled: true },
              response: {
                field: 'industry_category',
                reason: '补充本次内容所属的美业服务类别',
              },
              scope: 'current_task',
            }
          : null,
    };
  };
  const injectContext = stages.injectContext;
  stages.injectContext = async (input) => {
    injectedRequest = input.request;
    return injectContext(input);
  };
  const progress: string[] = [];
  let resubmissions = 0;

  await runHarnessWorkflow('task-copy', originalRequest, stages, {
    async runStep(_key, operation) {
      return operation();
    },
    async progress(event) {
      progress.push(event.message);
    },
    async token() {},
    async awaitDecision(question) {
      return {
        idempotencyKey: 'decision-industry-1',
        questionId: question.questionId,
        workflowRevision: question.workflowRevision,
        patch: {
          field: question.response.field,
          value: '美甲',
          reason: question.response.reason,
        },
        decision: { state: 'accepted', value: '美甲' },
      };
    },
    async resubmitSemanticDecision(input) {
      resubmissions += 1;
      return buildSemanticDecisionResumption({
        request: input.request,
        command: input.command,
        createdAt: '2026-07-25T09:05:00.000Z',
      }).request;
    },
    async recordTrace() {},
  });

  assert.equal(resubmissions, 1);
  assert.equal(injectedRequest?.executionSnapshot?.task.id, 'task-copy');
  assert.equal(injectedRequest?.executionSnapshot?.work.id, 'work-copy');
  assert.equal(
    injectedRequest?.executionSnapshot?.contentPackage.id,
    'package-copy'
  );
  assert.notEqual(
    injectedRequest?.executionSnapshot?.id,
    originalRequest.executionSnapshot?.id
  );
  assert.deepEqual(injectedRequest?.executionSnapshot?.semanticDecision, {
    sourceSnapshotId: originalRequest.executionSnapshot?.id,
    reference: injectedRequest?.decisionReferences?.[0],
  });
  assert.equal(
    (injectedRequest?.intent.context as Record<string, unknown> | undefined)
      ?.industry_category,
    '美甲'
  );
  assert.deepEqual(originalRequest.executionSnapshot, originalSnapshot);
  assert.ok(progress.includes('已收到，继续为你生成。'));
});

test('an external publish snapshot waits for its frozen execution confirmation before selection', async () => {
  const base = snapshotTaskInput();
  const request: HarnessWorkflowInput = {
    ...base,
    executionSnapshot: {
      ...base.executionSnapshot!,
      distributionTarget: 'publish:xiaohongshu',
    },
  };
  const stages = fixtureStages();
  const executeAndSelect = stages.executeAndSelect!;
  const order: string[] = [];
  stages.executeAndSelect = async (input) => {
    order.push('selection');
    return executeAndSelect(input);
  };

  await runHarnessWorkflow('task-copy', request, stages, {
    async runStep(_key, operation) {
      return operation();
    },
    async progress() {},
    async token() {},
    async awaitDecision(question, stage) {
      order.push('confirmation');
      assert.equal(stage, 'execution_selection');
      assert.deepEqual(question.executionConfirmationAuthority, {
        kind: 'external_action',
        revision: 'execution-external-action/v1',
      });
      return {
        idempotencyKey: 'approve-external-execution',
        questionId: question.questionId,
        workflowRevision: question.workflowRevision,
        patch: {
          field: question.response.field,
          value: 'approved',
          reason: question.response.reason,
        },
        decision: { state: 'accepted', value: 'approved' },
      };
    },
    async recordTrace() {},
  });

  assert.deepEqual(order, ['confirmation', 'selection']);
});

test('semantic resubmission rejects a forged workspace before persistence', () => {
  const original = snapshotTaskInput();
  const request = {
    ...original,
    executionSnapshot: original.executionSnapshot!,
    workspaceId: 'workspace-forged',
    usageReservation: {
      id: 'usage-reservation-forged',
      units: [{ resource: 'copy' as const, quantity: 1 }],
    },
  };

  assert.throws(
    () =>
      buildSemanticDecisionResumption({
        request,
        command: {
          idempotencyKey: 'decision-forged-workspace',
          questionId: 'task-copy:s1:industry_category',
          workflowRevision: 1,
          patch: {
            field: 'industry_category',
            value: '美甲',
            reason: '补充本次内容所属的美业服务类别',
          },
          decision: { state: 'accepted', value: '美甲' },
        },
        createdAt: '2026-07-25T09:05:00.000Z',
      }),
    /workspace does not match its durable snapshot/u,
  );
});

test('directly applying a semantic answer to an existing snapshot remains forbidden', async () => {
  const stages = fixtureStages();
  stages.nameIntent = async () => ({
    declaration: {
      normalizedIntent: '给门店写一条日常内容',
      taskType: 'daily_service_exposure',
      deliveryLayer: 'copy',
      relevantAssetCategories: ['industry_category'],
      usedAssetCategories: [],
      route: 'guidance',
      routingSource: 'model',
      implicitConstraints: [],
    },
    blockingQuestion: {
      questionId: 'task-copy:s1:industry_category',
      workflowId: 'task-copy',
      workflowRevision: 1,
      question: '这次内容主要属于哪一类美业服务？',
      options: [],
      freeText: { enabled: true },
      response: {
        field: 'industry_category',
        reason: '补充本次内容所属的美业服务类别',
      },
      unattended: 'continue',
      scope: 'current_task',
    },
  });

  await assert.rejects(
    runHarnessWorkflow('task-copy', snapshotTaskInput(), stages, {
      async runStep(_key, operation) {
        return operation();
      },
      async progress() {},
      async token() {},
      async awaitDecision(question) {
        return {
          idempotencyKey: 'decision-industry-1',
          questionId: question.questionId,
          workflowRevision: question.workflowRevision,
          patch: {
            field: question.response.field,
            value: '美甲',
            reason: question.response.reason,
          },
          decision: { state: 'accepted', value: '美甲' },
        };
      },
      async recordTrace() {},
    }),
    HarnessSnapshotDecisionError
  );
});

test('intent routing golden cases cover every D-111 quadrant twice', async () => {
  const cases = [
    {
      id: 'useful-store',
      intent: '按本店已确认的护理项目写朋友圈',
      initial: 'customized',
      decision: null,
      final: 'customized',
    },
    {
      id: 'useful-ip',
      intent: '用已确认的老板娘口吻介绍开店初心',
      initial: 'customized',
      decision: null,
      final: 'customized',
    },
    {
      id: 'no-gain-promotion',
      intent: '给新团购写一条推广文案',
      initial: 'guidance',
      decision: 'accepted',
      final: 'free',
    },
    {
      id: 'no-gain-product',
      intent: '介绍一个还没录入资料的新项目',
      initial: 'guidance',
      decision: 'accepted',
      final: 'free',
    },
    {
      id: 'completed-promotion',
      intent: '补齐团购项目和价格后生成文案',
      initial: 'guidance',
      decision: 'accepted',
      final: 'customized',
    },
    {
      id: 'completed-ip',
      intent: '补齐主理人口吻后写开店故事',
      initial: 'guidance',
      decision: 'accepted',
      final: 'customized',
    },
    {
      id: 'skipped-product',
      intent: '先跳过新品资料直接生成',
      initial: 'guidance',
      decision: 'ignored',
      final: 'free',
    },
    {
      id: 'skipped-industry',
      intent: '先跳过行业信息直接生成',
      initial: 'guidance',
      decision: 'ignored',
      final: 'free',
    },
  ] as const;

  for (const golden of cases) {
    const stages = fixtureStages();
    let round = 0;
    const initialDeclarations: string[] = [];
    stages.nameIntent = async () => {
      round += 1;
      const route =
        round === 1
          ? golden.initial
          : golden.id.startsWith('completed-')
            ? 'customized'
            : 'guidance';
      initialDeclarations.push(route);
      return {
        declaration: {
          normalizedIntent: golden.intent,
          taskType:
            golden.intent.includes('口吻') || golden.intent.includes('开店')
              ? 'brand_personal_ip'
              : 'promotion_groupbuy_conversion',
          deliveryLayer: 'copy',
          relevantAssetCategories: ['promotion_activity'],
          usedAssetCategories:
            route === 'customized' ? ['promotion_activity'] : [],
          route,
          routingSource: 'model',
          implicitConstraints: [],
        },
        blockingQuestion:
          route === 'guidance'
            ? {
                questionId: `question-${golden.id}`,
                workflowId: `task-${golden.id}`,
                workflowRevision: 4,
                question: '方便补充这次最关键的项目资料吗？',
                options: [],
                freeText: { enabled: true },
                response: {
                  field: 'project_details',
                  reason: '让这次内容更贴合你的实际情况',
                },
                scope: 'current_task',
              }
            : null,
      };
    };
    let finalRoute: string | undefined;
    const messages: string[] = [];
    await runHarnessWorkflow(
      `task-${golden.id}`,
      {
        ...taskInput(),
        rawInput: golden.intent,
        intent: {
          ...taskInput().intent,
          context: { ...taskInput().intent.context, intent: golden.intent },
        },
      },
      stages,
      {
        async runStep(_key, operation) {
          return operation();
        },
        async progress(event) {
          messages.push(event.message);
        },
        async token() {},
        async awaitDecision(question) {
          assert.notEqual(golden.decision, null);
          return {
            idempotencyKey: `decision-${golden.id}`,
            questionId: question.questionId,
            workflowRevision: question.workflowRevision,
            patch: {
              field: question.response.field,
              value: '本店当前资料',
              reason: question.response.reason,
            },
            decision: {
              state: golden.decision ?? 'ignored',
              value: '本店当前资料',
            },
          };
        },
        async recordTrace(trace) {
          if (trace.stage === 'intent_naming') {
            finalRoute = (trace.payload as { declaration: { route: string } })
              .declaration.route;
          }
        },
      }
    );
    assert.equal(initialDeclarations[0], golden.initial, golden.id);
    assert.equal(finalRoute, golden.final, golden.id);
    const notice = messages.find(
      (message) =>
        message.includes('更贴合本店') || message.includes('通用模式')
    );
    assert.ok(notice, golden.id);
    assert.doesNotMatch(notice, /route|schema|asset|id|fallback/iu);
  }
});

test('fallback prompt version and hash enter stage traces without prompt content', async () => {
  const traces: Array<{ stage: string; payload: unknown }> = [];
  const request = {
    ...taskInput(),
    prompts: fallbackPromptBundle(),
  };

  await runHarnessWorkflow('task-prompt-fallback', request, fixtureStages(), {
    async runStep(_key, operation) {
      return operation();
    },
    async progress() {},
    async token() {},
    async awaitDecision() {
      throw new Error('Unexpected decision wait.');
    },
    async recordTrace(input) {
      traces.push({ stage: input.stage, payload: input.payload });
    },
  });

  const promptTraces = traces.filter(({ stage }) =>
    ['intent_naming', 'brief_compilation'].includes(stage)
  );
  for (const trace of promptTraces) {
    const prompt = (trace.payload as { prompt: Record<string, unknown> })
      .prompt;
    assert.deepEqual(prompt, {
      name:
        trace.stage === 'intent_naming'
          ? 'harness/intent-naming'
          : 'harness/brief-copy',
      version: 'builtin-v1',
      contentHash: 'f'.repeat(64),
      label: 'production',
      source: 'builtin',
      isFallback: true,
      fallbackReason: 'http_503',
    });
    assert.equal('content' in prompt, false);
  }
});

test('source revision fence recompiles brief and selection with new effect keys', async () => {
  const stages = fixtureStages();
  let executions = 0;
  stages.fenceContext = async (input) => ({
    ...input.context,
    bundle: {
      ...input.context.bundle,
      revision: 2,
      previousRevision: 1,
      hash: 'b'.repeat(64),
      sourceRevisions: {
        ...input.context.bundle.sourceRevisions,
        facts: 3,
      },
    },
  });
  stages.executeAndSelect = async () => {
    executions += 1;
    const candidateId = executions === 1 ? 'c01' : 'c02';
    return {
      candidates: [
        {
          candidateId,
          title: `候选 ${candidateId}`,
          body: '正文',
          conversionHook: '私信预约',
          score: 90,
        },
      ],
      winner: {
        candidateId,
        title: `候选 ${candidateId}`,
        body: '正文',
        conversionHook: '私信预约',
      },
      trace: {
        stage: 'execution_selection',
        winnerCandidateId: candidateId,
        candidateScores: [],
        blockedCandidates: [],
        rubricVersion: 'copy-quality-v1',
        rubricHash: 'rubric-hash',
      },
    };
  };
  let deliveredCandidateId = '';
  stages.assembleAndDeliver = async (input) => {
    deliveredCandidateId = input.selection.winner.candidateId;
    return { packageId: 'package-1', versionId: 'version-3', revision: 3 };
  };
  const keys: string[] = [];
  const traceIds: string[] = [];
  const progressMessages: string[] = [];

  await runHarnessWorkflow('task-35', taskInput(), stages, {
    async runStep(key, operation) {
      keys.push(key);
      return operation();
    },
    async progress(event) {
      progressMessages.push(event.message);
    },
    async token() {},
    async awaitDecision() {
      throw new Error('Unexpected decision wait.');
    },
    async recordTrace(input) {
      traceIds.push(input.id);
    },
  });

  assert.equal(deliveredCandidateId, 'c02');
  assert.ok(keys.includes('wf:task-35:s3:copy-r2:0'));
  assert.ok(keys.includes('wf:task-35:s4:copy-r2:selection'));
  assert.ok(traceIds.includes('trace-task-35-execution_selection-r1'));
  assert.ok(traceIds.includes('trace-task-35-execution_selection-r2'));
  assert.ok(progressMessages.includes('资料有更新，已同步到本次创作'));
  assert.ok(progressMessages.includes('已按最新资料更新推荐文案'));
  for (const message of progressMessages) {
    assert.doesNotMatch(
      message,
      /Harness|revision|candidate|workflow|direct mode|直接模式|排查与详情/iu
    );
  }
});

test('permission hard-block after a context fence uses the same held QuestionCard path', async () => {
  const stages = fixtureStages();
  const firstSelection = stages.executeAndSelect.bind(stages);
  const selectionError = new HarnessSelectionError(
    ['external_action_approval'],
    '更新后的候选需要外部动作授权',
    [],
    ['先完成授权'],
  );
  let executions = 0;
  let decisions = 0;
  let deliveries = 0;
  stages.fenceContext = async (input) => ({
    ...input.context,
    bundle: {
      ...input.context.bundle,
      revision: 2,
      previousRevision: 1,
      hash: 'b'.repeat(64),
    },
  });
  stages.executeAndSelect = async (input) => {
    executions += 1;
    if (executions === 2) throw selectionError;
    return firstSelection(input);
  };
  stages.assembleAndDeliver = async () => {
    deliveries += 1;
    throw new Error('Permission-blocked re-selection must not deliver.');
  };

  await assert.rejects(
    runHarnessWorkflow('task-35', taskInput(), stages, {
      async runStep(_key, operation) {
        return operation();
      },
      async progress() {},
      async token() {},
      async awaitDecision(question) {
        decisions += 1;
        assert.equal(
          question.questionId,
          'task-35:execution-selection:permission',
        );
        return {
          idempotencyKey: 'permission-after-fence-1',
          questionId: question.questionId,
          workflowRevision: question.workflowRevision,
          patch: {
            field: question.response.field,
            value: question.options[0]!.label,
            reason: question.response.reason,
          },
          decision: {
            state: 'accepted',
            value: question.options[0]!.label,
          },
        };
      },
      async recordTrace() {},
    }),
    (error: unknown) => {
      assert.equal(error, selectionError);
      return true;
    },
  );

  assert.equal(executions, 2);
  assert.equal(decisions, 1);
  assert.equal(deliveries, 0);
});

test('permission selection hard-block waits on a held QuestionCard and never delivers', async () => {
  const stages = fixtureStages();
  const selectionError = new HarnessSelectionError(
    ['subject_asset_rights'],
    '素材授权已撤回',
    [],
    ['换安全素材', '匿名化', '请求授权', '放弃该表达'],
  );
  let executionCount = 0;
  let deliveryCount = 0;
  let decisionCount = 0;
  const progress: string[] = [];
  stages.executeAndSelect = async () => {
    executionCount += 1;
    throw selectionError;
  };
  stages.assembleAndDeliver = async () => {
    deliveryCount += 1;
    throw new Error('Permission-blocked selection must not reach delivery.');
  };

  await assert.rejects(
    runHarnessWorkflow('task-35', taskInput(), stages, {
      async runStep(_key, operation) {
        return operation();
      },
      async progress(event) {
        progress.push(`${event.stage}:${event.state}`);
      },
      async token() {},
      async awaitDecision(question) {
        decisionCount += 1;
        assert.equal(question.questionId, 'task-35:execution-selection:permission');
        assert.equal(question.workflowId, 'task-35');
        assert.equal(question.workflowRevision, 4);
        assert.equal(question.question, selectionError.merchantMessage);
        assert.equal(question.unattended, 'hold');
        assert.equal(question.scope, 'current_task');
        assert.equal(question.freeText.enabled, false);
        assert.deepEqual(
          question.options.map(({ label }) => label),
          selectionError.alternativePaths,
        );
        return {
          idempotencyKey: 'permission-decision-1',
          questionId: question.questionId,
          workflowRevision: question.workflowRevision,
          patch: {
            field: question.response.field,
            value: question.options[2]!.label,
            reason: question.response.reason,
          },
          decision: {
            state: 'accepted',
            value: question.options[2]!.label,
          },
        };
      },
      async recordTrace() {},
    }),
    (error: unknown) => {
      assert.equal(error, selectionError);
      return true;
    },
  );

  assert.equal(executionCount, 1);
  assert.equal(decisionCount, 1);
  assert.equal(deliveryCount, 0);
  assert.deepEqual(progress, [
    'intent_naming:success',
    'context_injection:success',
    'brief_compilation:success',
    'execution_selection:suspended',
  ]);
});

test('permission selection cancellation uses the existing workflow cancellation', async () => {
  const stages = fixtureStages();
  stages.executeAndSelect = async () => {
    throw new HarnessSelectionError(
      ['external_action_approval'],
      '需要先完成外部授权',
      [],
      ['先完成授权'],
    );
  };
  let deliveryCount = 0;
  stages.assembleAndDeliver = async () => {
    deliveryCount += 1;
    throw new Error('Cancelled selection must not reach delivery.');
  };

  await assert.rejects(
    runHarnessWorkflow('task-35', taskInput(), stages, {
      async runStep(_key, operation) {
        return operation();
      },
      async progress() {},
      async token() {},
      async awaitDecision() {
        return {
          cancelled: true,
          merchantMessage: '等待授权已取消',
          resolutionSource: 'core_hold_expired',
        };
      },
      async recordTrace() {},
    }),
    (error: unknown) => {
      assert.ok(error instanceof HarnessWorkflowCancellation);
      assert.equal(error.message, '等待授权已取消');
      return true;
    },
  );
  assert.equal(deliveryCount, 0);
});

test('bounded selection suspends outside the durable step with a current-best continuation card', async () => {
  const request: HarnessWorkflowInput = {
    ...taskInput(),
    boundedExecution: {
      schemaVersion: 'bounded-execution-snapshot/v1',
      maxIterations: 1,
      maxCostCents: 'unset',
      maxWallClockMs: 'unset',
      maxDelegations: 'unset',
      requiredLimits: ['maxIterations'],
      consumption: {
        iterations: 0,
        costCents: 0,
        wallClockMs: 0,
        delegations: 0,
      },
      stopReason: null,
      triggeredLimit: null,
    },
  };
  const stages = fixtureStages();
  let insideStep = false;
  let decisions = 0;
  let deliveries = 0;
  const traces: unknown[] = [];
  stages.executeAndSelectBounded = async () => ({
    state: 'suspended',
    snapshot: {
      ...request.boundedExecution!,
      consumption: {
        ...request.boundedExecution!.consumption,
        iterations: 1,
      },
      stopReason: 'limit_reached',
      triggeredLimit: 'maxIterations',
    },
    currentBest: {
      candidate: { candidateId: 'c01', title: '当前最好版本' },
      deliverable: false,
    },
    unmetExplanation: '关键事实表达仍需一次修正',
    resumable: true,
  });
  stages.assembleAndDeliver = async () => {
    deliveries += 1;
    throw new Error('A bounded suspension must not reach delivery.');
  };

  await assert.rejects(
    runHarnessWorkflow('task-35', request, stages, {
      async runStep(_key, operation) {
        insideStep = true;
        try {
          return await operation();
        } finally {
          insideStep = false;
        }
      },
      async progress() {},
      async token() {},
      async awaitDecision(question) {
        assert.equal(insideStep, false);
        decisions += 1;
        assert.equal(
          question.questionId,
          'task-35:execution-selection:bounded',
        );
        assert.match(question.question, /当前最好结果/u);
        assert.match(question.question, /当前最好版本/u);
        assert.match(question.question, /还可以继续|可以继续/u);
        return {
          idempotencyKey: 'bounded-continuation-1',
          questionId: question.questionId,
          workflowRevision: question.workflowRevision,
          patch: {
            field: question.response.field,
            value: question.options[0]!.label,
            reason: question.response.reason,
          },
          decision: {
            state: 'accepted',
            value: question.options[0]!.label,
          },
        };
      },
      async recordTrace(input) {
        traces.push(input.payload);
      },
    }),
    BoundedExecutionResumeError,
  );

  assert.equal(decisions, 1);
  assert.equal(deliveries, 0);
  assert.ok(
    traces.some(
      (payload) =>
        typeof payload === 'object' &&
        payload !== null &&
        'boundedExecution' in payload,
    ),
  );
});

test('configured bounded execution fails closed when the stage port is unavailable', async () => {
  const request: HarnessWorkflowInput = {
    ...taskInput(),
    boundedExecution: {
      schemaVersion: 'bounded-execution-snapshot/v1',
      maxIterations: 1,
      maxCostCents: 'unset',
      maxWallClockMs: 'unset',
      maxDelegations: 'unset',
      requiredLimits: ['maxIterations'],
      consumption: {
        iterations: 0,
        costCents: 0,
        wallClockMs: 0,
        delegations: 0,
      },
      stopReason: null,
      triggeredLimit: null,
    },
  };
  const stages = fixtureStages();
  let ordinarySelections = 0;
  stages.executeAndSelect = async () => {
    ordinarySelections += 1;
    throw new Error('Configured bounds must not use ordinary selection.');
  };

  await assert.rejects(
    runHarnessWorkflow('task-35', request, stages, {
      async runStep(_key, operation) {
        return operation();
      },
      async progress() {},
      async token() {},
      async awaitDecision() {
        throw new Error('Missing bounded ports must fail before suspension.');
      },
      async recordTrace() {},
    }),
    /Configured bounded execution requires a bounded selection port/u,
  );
  assert.equal(ordinarySelections, 0);
});

test('server-raised limit resumes bounded selection from its checkpoint and delivers once', async () => {
  const request: HarnessWorkflowInput = {
    ...taskInput(),
    boundedExecution: {
      schemaVersion: 'bounded-execution-snapshot/v1',
      maxIterations: 1,
      maxCostCents: 'unset',
      maxWallClockMs: 'unset',
      maxDelegations: 'unset',
      requiredLimits: ['maxIterations'],
      consumption: {
        iterations: 0,
        costCents: 0,
        wallClockMs: 0,
        delegations: 0,
      },
      stopReason: null,
      triggeredLimit: null,
    },
  };
  const stages = fixtureStages();
  const observabilityEvents: unknown[] = [];
  stages.recordObservabilityEvent = async (event) => {
    observabilityEvents.push(event);
  };
  const completedSelection = stages.executeAndSelect.bind(stages);
  let boundedCalls = 0;
  let deliveries = 0;
  const effectKeys: string[] = [];
  stages.executeAndSelectBounded = async (input) => {
    boundedCalls += 1;
    if (input.boundedResume) {
      assert.equal(
        input.boundedResume.snapshot.consumption.iterations,
        1,
      );
      return completedSelection(input);
    }
    return {
      state: 'suspended',
      snapshot: {
        ...request.boundedExecution!,
        consumption: {
          ...request.boundedExecution!.consumption,
          iterations: 1,
        },
        stopReason: 'limit_reached',
        triggeredLimit: 'maxIterations',
      },
      currentBest: {
        candidate: { candidateId: 'c01', title: '当前最好版本' },
        deliverable: false,
      },
      unmetExplanation: '仍需一次修正',
      resumable: true,
    };
  };
  stages.assembleAndDeliver = async () => {
    deliveries += 1;
    return { packageId: 'package-1', versionId: 'version-3', revision: 3 };
  };
  let resumptions = 0;

  const result = await runHarnessWorkflow('task-35', request, stages, {
    async runStep(key, operation) {
      effectKeys.push(key);
      return operation();
    },
    async progress() {},
    async token() {},
    async awaitDecision(question) {
      return {
        idempotencyKey: 'bounded-continuation-1',
        questionId: question.questionId,
        workflowRevision: question.workflowRevision,
        patch: {
          field: question.response.field,
          value: question.options[0]!.label,
          reason: question.response.reason,
        },
        decision: {
          state: 'accepted',
          value: question.options[0]!.label,
        },
      };
    },
    async resumeBoundedExecution(input) {
      resumptions += 1;
      return {
        ...input.request,
        boundedExecution: resumeWithRaisedServerLimit(
          input.suspension.snapshot,
          {
            limit: 'maxIterations',
            value: 2,
          },
        ),
      };
    },
    async recordTrace(_trace, afterPersist) {
      await afterPersist?.();
    },
  });

  assert.deepEqual(result.delivery, {
    packageId: 'package-1',
    versionId: 'version-3',
    revision: 3,
  });
  assert.equal(boundedCalls, 2);
  assert.equal(resumptions, 1);
  assert.equal(deliveries, 1);
  assert.equal(
    effectKeys.some((key) => key.startsWith('bounded:')),
    false,
  );
  assert.deepEqual(
    observabilityEvents.map((event) => {
      const value = event as {
        event: { eventType: string };
        idempotencyKey: string;
      };
      return [value.event.eventType, value.idempotencyKey];
    }),
    [
      [
        'bounded_execution.suspended',
        'bounded:task-35:0:suspended',
      ],
      [
        'bounded_execution.resumed',
        'bounded:task-35:bounded-continuation-1:resumed',
      ],
    ],
  );
});

test('repeated non-iteration suspensions keep distinct durable trace identities', async () => {
  const request: HarnessWorkflowInput = {
    ...taskInput(),
    boundedExecution: {
      schemaVersion: 'bounded-execution-snapshot/v1',
      maxIterations: 'unset',
      maxCostCents: 1,
      maxWallClockMs: 'unset',
      maxDelegations: 'unset',
      requiredLimits: ['maxCostCents'],
      consumption: {
        iterations: 0,
        costCents: 0,
        wallClockMs: 0,
        delegations: 0,
      },
      stopReason: null,
      triggeredLimit: null,
    },
  };
  const stages = fixtureStages();
  const completedSelection = stages.executeAndSelect.bind(stages);
  let boundedCalls = 0;
  stages.executeAndSelectBounded = async (input) => {
    boundedCalls += 1;
    if (boundedCalls === 3) return completedSelection(input);
    const snapshot = input.request.boundedExecution!;
    return {
      state: 'suspended',
      snapshot: {
        ...snapshot,
        consumption: {
          ...snapshot.consumption,
          costCents: boundedCalls,
        },
        stopReason: 'limit_reached',
        triggeredLimit: 'maxCostCents',
      },
      currentBest: {
        candidate: { candidateId: 'c01', title: '当前最好版本' },
        deliverable: false,
      },
      unmetExplanation: '仍需追加一次成本额度',
      resumable: true,
    };
  };
  const boundedTraceIds: string[] = [];

  const result = await runHarnessWorkflow('task-cost-repeat', request, stages, {
    async runStep(_key, operation) {
      return operation();
    },
    async progress() {},
    async token() {},
    async awaitDecision(question) {
      return {
        idempotencyKey: `bounded-continuation-${boundedCalls}`,
        questionId: question.questionId,
        workflowRevision: question.workflowRevision,
        patch: {
          field: question.response.field,
          value: question.options[0]!.label,
          reason: question.response.reason,
        },
        decision: {
          state: 'accepted',
          value: question.options[0]!.label,
        },
      };
    },
    async resumeBoundedExecution(input) {
      return {
        ...input.request,
        boundedExecution: resumeWithRaisedServerLimit(
          input.suspension.snapshot,
          {
            limit: 'maxCostCents',
            value:
              input.suspension.snapshot.maxCostCents === 'unset'
                ? 1
                : input.suspension.snapshot.maxCostCents + 1,
          },
        ),
      };
    },
    async recordTrace(input) {
      if (input.id.includes('bounded-')) boundedTraceIds.push(input.id);
    },
  });

  assert.ok(result.delivery);
  assert.equal(boundedCalls, 3);
  assert.equal(boundedTraceIds.length, 2);
  assert.equal(new Set(boundedTraceIds).size, 2);
});

const NON_ITERATION_BOUNDS = [
  ['maxCostCents', 'costCents'],
  ['maxWallClockMs', 'wallClockMs'],
  ['maxDelegations', 'delegations'],
] as const;

for (const [limit, consumptionKey] of NON_ITERATION_BOUNDS) {
  test(`${limit} enters bounded HITL, records its consumption, and resumes after a server raise`, async () => {
    const boundedExecution = {
      schemaVersion: 'bounded-execution-snapshot/v1' as const,
      maxIterations: 'unset' as const,
      maxCostCents: 'unset' as const,
      maxWallClockMs: 'unset' as const,
      maxDelegations: 'unset' as const,
      [limit]: 1,
      requiredLimits: [limit],
      consumption: {
        iterations: 0,
        costCents: 0,
        wallClockMs: 0,
        delegations: 0,
      },
      stopReason: null,
      triggeredLimit: null,
    };
    const request: HarnessWorkflowInput = {
      ...taskInput(),
      boundedExecution,
    };
    const stages = fixtureStages();
    const completedSelection = stages.executeAndSelect.bind(stages);
    const traces: unknown[] = [];
    let boundedCalls = 0;
    let resumptions = 0;
    stages.executeAndSelectBounded = async (input) => {
      boundedCalls += 1;
      if (input.boundedResume) {
        return completedSelection(input);
      }
      return {
        state: 'suspended',
        snapshot: {
          ...boundedExecution,
          consumption: {
            ...boundedExecution.consumption,
            [consumptionKey]: 1,
          },
          stopReason: 'limit_reached',
          triggeredLimit: limit,
        },
        currentBest: {
          candidate: { candidateId: 'c01', title: '当前最好版本' },
          deliverable: false,
        },
        unmetExplanation: `${limit} 仍需抬限`,
        resumable: true,
      };
    };

    const result = await runHarnessWorkflow(
      `task-${limit}`,
      request,
      stages,
      {
        async runStep(_key, operation) {
          return operation();
        },
        async progress() {},
        async token() {},
        async awaitDecision(question) {
          return {
            idempotencyKey: `${limit}-continuation`,
            questionId: question.questionId,
            workflowRevision: question.workflowRevision,
            patch: {
              field: question.response.field,
              value: question.options[0]!.label,
              reason: question.response.reason,
            },
            decision: {
              state: 'accepted',
              value: question.options[0]!.label,
            },
          };
        },
        async resumeBoundedExecution(input) {
          resumptions += 1;
          return {
            ...input.request,
            boundedExecution: resumeWithRaisedServerLimit(
              input.suspension.snapshot,
              { limit, value: 2 },
            ),
          };
        },
        async recordTrace(input) {
          traces.push(input.payload);
        },
      },
    );

    assert.ok(result.delivery);
    assert.equal(boundedCalls, 2);
    assert.equal(resumptions, 1);
    assert.ok(
      traces.some((payload) => {
        if (
          typeof payload !== 'object' ||
          payload === null ||
          !('boundedExecution' in payload)
        ) {
          return false;
        }
        const suspensionTrace = payload as {
          boundedExecution: typeof boundedExecution;
          currentBest: {
            candidate: { candidateId: string };
            deliverable: boolean;
          };
          unmetExplanation: string;
          resumable: boolean;
        };
        const snapshot = suspensionTrace.boundedExecution;
        return (
          snapshot.triggeredLimit === limit &&
          snapshot.consumption[consumptionKey] === 1 &&
          suspensionTrace.currentBest.candidate.candidateId === 'c01' &&
          suspensionTrace.currentBest.deliverable === false &&
          suspensionTrace.unmetExplanation === `${limit} 仍需抬限` &&
          suspensionTrace.resumable === true
        );
      }),
    );
  });
}

test('non-permission selection failure does not enter permission HITL', async () => {
  const stages = fixtureStages();
  const selectionError = new HarnessSelectionError(
    ['critical_fact_source'],
    '关键事实缺少来源',
  );
  let decisionCount = 0;
  let deliveryCount = 0;
  const progress: string[] = [];
  stages.executeAndSelect = async () => {
    throw selectionError;
  };
  stages.assembleAndDeliver = async () => {
    deliveryCount += 1;
    throw new Error('Blocked selection must not reach delivery.');
  };

  await assert.rejects(
    runHarnessWorkflow('task-35', taskInput(), stages, {
      async runStep(_key, operation) {
        return operation();
      },
      async progress(event) {
        progress.push(`${event.stage}:${event.state}`);
      },
      async token() {},
      async awaitDecision() {
        decisionCount += 1;
        throw new Error('Non-permission failures must not enter HITL.');
      },
      async recordTrace() {},
    }),
    (error: unknown) => {
      assert.equal(error, selectionError);
      return true;
    },
  );

  assert.equal(decisionCount, 0);
  assert.equal(deliveryCount, 0);
  assert.deepEqual(progress, [
    'intent_naming:success',
    'context_injection:success',
    'brief_compilation:success',
  ]);
});

function fixtureStages(): HarnessStagePorts {
  return {
    async nameIntent() {
      return {
        declaration: {
          normalizedIntent: '推广本店团购',
          taskType: 'promotion_groupbuy_conversion',
          deliveryLayer: 'copy',
          relevantAssetCategories: ['promotion_activity'],
          usedAssetCategories: ['promotion_activity'],
          route: 'customized',
          routingSource: 'model',
          implicitConstraints: ['不得编造价格'],
        },
        blockingQuestion: null,
      };
    },
    async injectContext() {
      return {
        bundle: {
          bundleId: 'bundle-1',
          revision: 1,
          hash: 'a'.repeat(64),
          serializerVersion: 'context-bundle-c14n-v1',
          workspaceId: 'workspace-1',
          taskId: 'task-35',
          frozenAt: '2026-07-18T00:00:00.000Z',
          frozenBy: 'owner-1',
          previousRevision: null,
          referencedFactRevisions: [],
          sourceRevisions: {
            facts: 2,
            assets: 1,
            identity: 1,
            rights: 1,
            preferences: 1,
            recipe: 1,
            platformRules: 1,
            currentSignal: 1,
          },
          dimensions: {
            promotion_task: {},
            traffic_opportunity: {},
            expression_identity: {},
            platform_mechanism: {},
            store_facts_assets: {},
            conversion_action: {},
          },
        },
        factsRevision: 7,
        policyReferences: { sourceRefs: [], rightsRefs: [], identityRefs: [] },
      };
    },
    async fenceContext(input) {
      return input.context;
    },
    async compileBrief() {
      return {
        kind: 'copy',
        instructions:
          '请基于当前有效团购事实，面向目标顾客生成一条可直接发布的文案，保留事实引用、表达身份、平台结构和明确行动号召，不得编造价格与效果。',
        platform: 'xiaohongshu',
        cta: '私信预约',
        factRefs: ['fact-1'],
        assetRefs: [],
        identityRefs: ['identity-1'],
        constraints: ['不得编造价格'],
      };
    },
    async executeAndSelect() {
      return {
        candidates: [
          {
            candidateId: 'c01',
            title: '新团购上线',
            body: '已确认的团购信息。',
            conversionHook: '私信预约',
            score: 90,
          },
        ],
        winner: {
          candidateId: 'c01',
          title: '新团购上线',
          body: '已确认的团购信息。',
          conversionHook: '私信预约',
        },
        trace: {
          stage: 'execution_selection',
          winnerCandidateId: 'c01',
          candidateScores: [],
          blockedCandidates: [],
          rubricVersion: 'copy-quality-v1',
          rubricHash: 'rubric-hash',
        },
      };
    },
    async assembleAndDeliver() {
      return {
        packageId: 'package-1',
        versionId: 'version-3',
        revision: 3,
      };
    },
  };
}

function taskInput() {
  return {
    actorId: 'owner-1',
    workspaceId: 'workspace-1',
    packageId: 'package-1',
    expectedRevision: 2,
    workflowRevision: 4,
    creationMode: 'customized' as const,
    rawInput: '把新团购做一套能发的',
    intent: {
      context: {
        workId: 'work-1',
        intent: '把新团购做一套能发的',
        sourceSummaries: [],
      },
      assetReferences: [],
    },
  };
}

function snapshotTaskInput(): HarnessWorkflowInput {
  const snapshot = createCreationExecutionSnapshot(
    {
      actorId: 'owner-1',
      workspaceId: 'workspace-1',
      idempotencyKey: 'submission-copy-1',
      taskId: 'task-copy',
      workId: 'work-copy',
      contentPackageId: 'package-copy',
      expectedContentPackageRevision: 0,
      creationMode: 'customized',
      intent: '给门店写一条日常内容',
      surface: { id: 'surface-1', revision: 'surface-r1' },
      recipe: { id: 'recipe-copy-1', revision: 'recipe-copy-r1' },
      lens: 'copy',
      platform: { id: 'xiaohongshu' },
      deliverables: [
        {
          id: 'copy-main',
          kind: 'copy',
          order: 0,
          quantity: 1,
        },
      ],
      sources: { assets: [] },
      rights: { revision: 'rights-r1', summary: 'authorized' },
      identity: { id: 'identity-1', revision: 'identity-r1' },
      modelPolicy: { id: 'policy-1', revision: 'policy-r1', mode: 'auto' },
      catalogModel: { id: 'model-copy-1', revision: 'model-copy-r1' },
      quote: { id: 'quote-1', revision: 'quote-r1' },
      route: { id: 'route-1', revision: 'route-r1' },
      briefContext: { id: 'brief-context-1', revision: 1 },
      contentModules: ['social_cover'],
    },
    '2026-07-25T09:00:00.000Z'
  );
  return {
    ...taskInput(),
    packageId: snapshot.contentPackage.id,
    expectedRevision: snapshot.contentPackage.expectedRevision,
    workflowRevision: snapshot.revision,
    rawInput: snapshot.intent.text,
    intent: {
      context: {
        workId: snapshot.work.id,
        intent: snapshot.intent.text,
        sourceSummaries: [],
      },
      assetReferences: [],
    },
    executionSnapshot: snapshot,
  };
}

function fixtureIndustryGapStages() {
  const stages = fixtureStages();
  stages.nameIntent = async () => ({
    declaration: {
      normalizedIntent: '给门店写一条日常内容',
      taskType: 'daily_service_exposure',
      deliveryLayer: 'copy',
      relevantAssetCategories: ['industry_category'],
      usedAssetCategories: [],
      route: 'guidance',
      routingSource: 'model',
      implicitConstraints: [],
    },
    blockingQuestion: {
      questionId: 'task-copy:s1:industry_category',
      workflowId: 'task-copy',
      workflowRevision: 1,
      question: '这次内容主要属于哪一类美业服务？',
      options: [],
      freeText: { enabled: true },
      response: {
        field: 'industry_category',
        reason: '补充本次内容所属的美业服务类别',
      },
      unattended: 'continue',
      scope: 'current_task',
    },
  });
  return stages;
}

function mediaTaskInput(
  kind: 'image' | 'image_text_note' | 'video',
): HarnessWorkflowInput {
  const snapshot = createCreationExecutionSnapshot(
    {
      actorId: 'owner-1',
      workspaceId: 'workspace-1',
      idempotencyKey: `submission-${kind}-1`,
      taskId: `task-${kind}`,
      workId: 'work-1',
      contentPackageId: 'package-1',
      expectedContentPackageRevision: 2,
      creationMode: 'customized',
      intent: '把夏日护理项目做成可发布的素材',
      surface: { id: 'surface-1', revision: 'surface-r1' },
      recipe: { id: `recipe-${kind}-1`, revision: `recipe-${kind}-r1` },
      lens: kind,
      platform: { id: 'douyin' },
      contentPackagePlatform: 'douyin',
      distributionTarget: 'export',
      deliverable: {
        kind:
          kind === 'video'
            ? 'video_package'
            : kind === 'image_text_note'
              ? 'note'
              : 'image_set',
        quantity: 1,
        aspectRatio: '9:16',
        ...(kind === 'video' ? { durationSeconds: 8 } : {}),
        ...(kind === 'image_text_note' ? { notePageBound: 3 } : {}),
      },
      deliverables: [
        {
          id: `${kind}-main`,
          kind,
          order: 0,
          quantity: 1,
          aspectRatio: '9:16',
          ...(kind === 'video' ? { durationSeconds: 8 } : {}),
          ...(kind === 'image_text_note' ? { notePageBound: 3 } : {}),
        },
      ],
      sources: {
        assets: [{ id: 'asset-1', revision: 'asset-r1', role: 'reference' }],
      },
      rights: { revision: 'rights-r1', summary: 'authorized' },
      identity: { id: 'identity-1', revision: 'identity-r1' },
      modelPolicy: { id: 'policy-1', revision: 'policy-r1', mode: 'fixed' },
      catalogModel: { id: `model-${kind}-1`, revision: `model-${kind}-r1` },
      quote: { id: 'quote-1', revision: 'quote-r1' },
      route: { id: 'route-1', revision: 'route-r1' },
      briefContext: { id: 'brief-context-1', revision: 1 },
      briefConfirmation: { id: 'brief-1', revision: 'brief-r1' },
      contentModules: ['social_cover'],
    },
    '2026-07-22T09:00:00.000Z'
  );
  return { ...taskInput(), executionSnapshot: snapshot };
}

function boundedExecutionSnapshot(iterations: number, maxIterations: number) {
  return {
    schemaVersion: 'bounded-execution-snapshot/v1' as const,
    maxIterations,
    maxCostCents: 'unset' as const,
    maxWallClockMs: 'unset' as const,
    maxDelegations: 'unset' as const,
    requiredLimits: ['maxIterations' as const],
    consumption: {
      iterations,
      costCents: 0,
      wallClockMs: 0,
      delegations: 0,
    },
    stopReason: null,
    triggeredLimit: null,
  };
}

function mediaBoundedCheckpoint(suffix: number) {
  return {
    schemaVersion: 'harness-media-current-best/v1' as const,
    requestFingerprint: 'a'.repeat(64),
    executionRootFingerprint: 'b'.repeat(64),
    kind: 'image' as const,
    phase: 'ready' as const,
    attempts: [
      {
        role: 'primary' as const,
        jobId: `job-image-${suffix}`,
        status: 'completed' as const,
      },
    ],
    asset: {
      id: `image-asset-${suffix}`,
      sha256: `image-sha-${suffix}`,
    },
    countedAttemptIds: [`attempt-image-${suffix}`],
    countedProviderCostIds: [`cost-image-${suffix}`],
    attemptReceiptDigests: [
      { id: `attempt-image-${suffix}`, digest: 'c'.repeat(64) },
    ],
    providerCostReceiptDigests: [
      { id: `cost-image-${suffix}`, digest: 'd'.repeat(64) },
    ],
  };
}

function noteStages(
  partial = false,
  onExecute?: (
    input: Parameters<HarnessNoteStagePorts['executeNoteAndSelect']>[0],
  ) => Promise<void>,
): HarnessNoteStagePorts {
  const brief = noteBrief();
  return {
    ...fixtureStages(),
    async nameIntent() {
      return {
        declaration: {
          normalizedIntent: '制作护理科普图文',
          taskType: 'daily_service_exposure',
          deliveryLayer: 'finished_media',
          relevantAssetCategories: ['product_service'],
          usedAssetCategories: ['product_service'],
          route: 'customized',
          routingSource: 'model',
          implicitConstraints: [],
        },
        blockingQuestion: null,
      };
    },
    async compileNoteBrief() {
      return brief;
    },
    async executeNoteAndSelect(input) {
      assert.equal(input.selectedStyleId, 'story');
      await onExecute?.(input);
      return {
        auditSignals: [
          {
            eventType: 'note_consistency_evaluated',
            payload: {
              checkId: 'note-plan-consistency',
              status: partial ? 'warned' : 'passed',
              strategy: 'warn',
            },
          },
        ],
        childRuns: [],
        ownedAssets: [],
        selectedStyleId: input.selectedStyleId,
        version: {
          schema: 'image-text-note-version/v1',
          plan: brief.candidates.candidates[1]!.plan,
          regenerationReceipts: [],
        },
        trace: {
          stage: 'execution_selection',
          winnerCandidateId: input.selectedStyleId,
          candidateScores: [],
          blockedCandidates: [],
          rubricVersion: 'note-style-user-choice-v1',
          rubricHash: 'note-style-rubric',
        },
        ...(partial
          ? {
              partial: {
                unresolvedPageIds: ['page-2'],
                reason: 'consistency_remained_incomplete' as const,
              },
            }
          : {}),
      };
    },
    async assembleNoteAndDeliver() {
      return {
        packageId: 'package-1',
        versionId: 'note-version-1',
        revision: 3,
      };
    },
  };
}

function noteBrief(): HarnessNoteBrief {
  const plan = (styleId: string, styleName: string) => ({
    schema: 'note-plan/v1' as const,
    themeAnchor: '护理科普',
    style: {
      id: styleId,
      name: styleName,
      positioning: `${styleName}定位`,
    },
    pages: [
      {
        id: 'page-1',
        order: 1,
        revision: 1,
        pageRole: 'cover' as const,
        pagePurpose: 'capture_attention' as const,
        imageIntent: {
          operation: 'image.generate' as const,
          purpose: '封面配图',
          subject: '护理项目',
          scene: '真实门店场景',
          composition: '主体清晰',
          references: [],
          exactText: [],
          changes: [],
          invariants: [],
          factRefs: [],
          rightsRefs: [],
          outputPlan: { kind: 'single' as const },
        },
        textBlock: {
          title: `${styleName}标题`,
          body: `${styleName}正文`,
          exactText: [],
        },
        dependencies: [],
      },
      {
        id: 'page-2',
        order: 2,
        revision: 1,
        pageRole: 'cta_guide' as const,
        pagePurpose: 'drive_action' as const,
        imageIntent: {
          operation: 'image.generate' as const,
          purpose: '行动页配图',
          subject: '预约行动',
          scene: '真实门店场景',
          composition: '主体清晰',
          references: [],
          exactText: [],
          changes: [],
          invariants: [],
          factRefs: [],
          rightsRefs: [],
          outputPlan: { kind: 'single' as const },
        },
        textBlock: {
          title: '预约建议',
          body: '私信了解详情',
          exactText: [],
        },
        dependencies: [
          { pageId: 'page-1', kind: 'text_sequence' as const },
        ],
      },
    ],
  });
  return {
    kind: 'image_text_note',
    candidates: {
      candidates: [
        {
          styleId: 'facts',
          styleName: '干货版',
          positioning: '适合收藏',
          plan: plan('facts', '干货版'),
        },
        {
          styleId: 'story',
          styleName: '故事版',
          positioning: '适合互动',
          plan: plan('story', '故事版'),
        },
      ],
    },
  };
}

function mediaStages(kind: 'image' | 'video'): HarnessMediaStagePorts {
  return {
    ...fixtureStages(),
    async nameIntent() {
      return {
        declaration: {
          normalizedIntent: '制作团购成片',
          taskType: 'promotion_groupbuy_conversion',
          deliveryLayer: 'finished_media',
          relevantAssetCategories: ['promotion_activity'],
          usedAssetCategories: ['promotion_activity'],
          route: 'customized',
          routingSource: 'model',
          implicitConstraints: ['不得编造价格'],
        },
        blockingQuestion: null,
      };
    },
    async compileMediaBrief() {
      if (kind === 'image') {
        return {
          kind,
          intent: {
            operation: 'image.generate',
            purpose: '门店活动图片',
            subject: '门店项目',
            scene: '真实门店场景',
            composition: '竖版主体居中',
            references: [],
            exactText: [],
            changes: [],
            invariants: [],
            factRefs: [],
            rightsRefs: [],
            outputPlan: { kind: 'single' },
          },
          prompt:
            '为夏日护理项目生成竖版门店活动海报，保留品牌主视觉和预约行动号召。',
          referenceAssetIds: ['asset-1'],
          parameters: { ratio: '9:16', resolution: '1080p' },
          constraints: ['不得编造价格'],
        };
      }
      return {
        kind,
        firstFramePrompt:
          '夏日护理项目门店开场，展示明确的品牌主视觉和预约行动号召。',
        storyboard: [
          {
            index: 1,
            description: '门店护理场景与主视觉展示。',
            durationSeconds: 8,
          },
        ],
        referenceAssetIds: ['asset-1'],
        parameters: { durationSeconds: 8, ratio: '9:16' },
        constraints: ['不得编造价格'],
      };
    },
    async executeMediaAndSelect() {
      return {
        kind,
        asset: {
          contentType: kind === 'image' ? 'image/png' : 'video/mp4',
          id: `${kind}-asset-1`,
          objectKey: `owned/${kind}-asset-1`,
          sha256: `${kind}-sha-1`,
          sizeBytes: 1024,
        },
        childRun: {
          runId: `${kind}-run-1`,
          runType: 'model_job',
          status: 'succeeded',
        },
        ...(kind === 'video' ? { measuredDurationSeconds: 6 } : {}),
        trace: {
          stage: 'execution_selection',
          winnerCandidateId: `${kind}-asset-1`,
          candidateScores: [],
          blockedCandidates: [],
          rubricVersion: 'media-receipt-v1',
          rubricHash: 'media-rubric-hash',
        },
      };
    },
    async assembleMediaAndDeliver() {
      return {
        packageId: 'package-1',
        versionId: `${kind}-version-1`,
        revision: 3,
      };
    },
  };
}

function fallbackPrompt(name: string) {
  return {
    name,
    version: 'builtin-v1',
    content: 'Built-in content must not enter the observability payload.',
    contentHash: 'f'.repeat(64),
    label: 'production',
    source: 'builtin' as const,
    isFallback: true,
    fallbackReason: 'http_503',
  };
}

function fallbackPromptBundle(): HarnessFrozenPrompts {
  return Object.fromEntries(
    Object.entries(HARNESS_LANGFUSE_PROMPT_NAMES).map(([key, name]) => [
      key,
      fallbackPrompt(name),
    ]),
  ) as HarnessFrozenPrompts;
}
