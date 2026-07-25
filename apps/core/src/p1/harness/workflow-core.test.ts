import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HarnessSnapshotDecisionError,
  runHarnessWorkflow,
  type HarnessMediaStagePorts,
  type HarnessStagePorts,
  type HarnessWorkflowRuntime,
} from './workflow-core.js';
import type { HarnessWorkflowInput } from './task-admission.js';
import { createCreationExecutionSnapshot } from '../execution-spine/creation-execution-snapshot.js';
import { buildSemanticDecisionResumption } from './semantic-decision-resumption.js';

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
      },
    );

    assert.deepEqual(keys, [
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
    assert.equal(result.recommendation.recommendedCandidateId, `${kind}-asset-1`);
    assert.deepEqual(
      traces.map(({ stage }) => stage),
      [
        'intent_naming',
        'context_injection',
        'brief_compilation',
        'execution_selection',
        'assembly_delivery',
      ],
    );
    assert.match(
      JSON.stringify(traces[0]?.payload),
      new RegExp(`"modality":"${kind}"`, 'u'),
    );
  }
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
    async recordTrace() {},
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

test('a snapshot-backed semantic answer resubmits the same task and work before continuing', async () => {
  const originalRequest = snapshotTaskInput();
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
  assert.equal(injectedRequest?.executionSnapshot?.contentPackage.id, 'package-copy');
  assert.notEqual(
    injectedRequest?.executionSnapshot?.id,
    originalRequest.executionSnapshot?.id,
  );
  assert.deepEqual(injectedRequest?.executionSnapshot?.semanticDecision, {
    sourceSnapshotId: originalRequest.executionSnapshot?.id,
    reference: injectedRequest?.decisionReferences?.[0],
  });
  assert.equal(
    (injectedRequest?.intent.context as Record<string, unknown> | undefined)
      ?.industry_category,
    '美甲',
  );
  assert.deepEqual(originalRequest.executionSnapshot, originalSnapshot);
  assert.ok(progress.includes('已收到，继续为你生成。'));
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
    HarnessSnapshotDecisionError,
  );
});

test('intent routing golden cases cover every D-111 quadrant twice', async () => {
  const cases = [
    { id: 'useful-store', intent: '按本店已确认的护理项目写朋友圈', initial: 'customized', decision: null, final: 'customized' },
    { id: 'useful-ip', intent: '用已确认的老板娘口吻介绍开店初心', initial: 'customized', decision: null, final: 'customized' },
    { id: 'no-gain-promotion', intent: '给新团购写一条推广文案', initial: 'guidance', decision: 'accepted', final: 'free' },
    { id: 'no-gain-product', intent: '介绍一个还没录入资料的新项目', initial: 'guidance', decision: 'accepted', final: 'free' },
    { id: 'completed-promotion', intent: '补齐团购项目和价格后生成文案', initial: 'guidance', decision: 'accepted', final: 'customized' },
    { id: 'completed-ip', intent: '补齐主理人口吻后写开店故事', initial: 'guidance', decision: 'accepted', final: 'customized' },
    { id: 'skipped-product', intent: '先跳过新品资料直接生成', initial: 'guidance', decision: 'ignored', final: 'free' },
    { id: 'skipped-industry', intent: '先跳过行业信息直接生成', initial: 'guidance', decision: 'ignored', final: 'free' },
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
          taskType: golden.intent.includes('口吻') || golden.intent.includes('开店')
            ? 'brand_personal_ip'
            : 'promotion_groupbuy_conversion',
          deliveryLayer: 'copy',
          relevantAssetCategories: ['promotion_activity'],
          usedAssetCategories: route === 'customized' ? ['promotion_activity'] : [],
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
            finalRoute = (
              trace.payload as { declaration: { route: string } }
            ).declaration.route;
          }
        },
      },
    );
    assert.equal(initialDeclarations[0], golden.initial, golden.id);
    assert.equal(finalRoute, golden.final, golden.id);
    const notice = messages.find((message) =>
      message.includes('更贴合本店') || message.includes('通用模式'),
    );
    assert.ok(notice, golden.id);
    assert.doesNotMatch(notice, /route|schema|asset|id|fallback/iu);
  }
});

test('fallback prompt version and hash enter stage traces without prompt content', async () => {
  const traces: Array<{ stage: string; payload: unknown }> = [];
  const request = {
    ...taskInput(),
    prompts: {
      intentNaming: fallbackPrompt('harness/intent-naming'),
      briefCompilation: fallbackPrompt('harness/brief-copy'),
    },
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
    ['intent_naming', 'brief_compilation'].includes(stage),
  );
  for (const trace of promptTraces) {
    const prompt = (trace.payload as { prompt: Record<string, unknown> }).prompt;
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
  assert.ok(
    progressMessages.includes('资料有更新，已同步到本次创作')
  );
  assert.ok(
    progressMessages.includes('已按最新资料更新推荐文案')
  );
  for (const message of progressMessages) {
    assert.doesNotMatch(
      message,
      /Harness|revision|candidate|workflow|direct mode|直接模式|排查与详情/iu
    );
  }
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
    '2026-07-25T09:00:00.000Z',
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

function mediaTaskInput(kind: 'image' | 'video'): HarnessWorkflowInput {
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
      deliverables: [
        {
          id: `${kind}-main`,
          kind,
          order: 0,
          quantity: 1,
          aspectRatio: '9:16',
          ...(kind === 'video' ? { durationSeconds: 8 } : {}),
        },
      ],
      sources: {
        assets: [
          { id: 'asset-1', revision: 'asset-r1', role: 'reference' },
        ],
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
    '2026-07-22T09:00:00.000Z',
  );
  return { ...taskInput(), executionSnapshot: snapshot };
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
          prompt: '为夏日护理项目生成竖版门店活动海报，保留品牌主视觉和预约行动号召。',
          referenceAssetIds: ['asset-1'],
          parameters: { ratio: '9:16', resolution: '1080p' },
          constraints: ['不得编造价格'],
        };
      }
      return {
        kind,
        firstFramePrompt: '夏日护理项目门店开场，展示明确的品牌主视觉和预约行动号召。',
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
