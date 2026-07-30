import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HarnessIdentityPreflightError,
  HarnessSnapshotAssetReferenceError,
  HarnessSnapshotIdentityBindingError,
  ProductionHarnessStagePorts,
  type HarnessCopyDeliveryPort,
} from './production-stage-ports.js';
import type { ContentPackageRevisionWriteInput } from '../execution-spine/content-package-revision-port.js';
import { SourceContentPackageUnavailableError } from '../execution-spine/source-content-package-resolver.js';
import {
  runHarnessWorkflow,
  type HarnessContextSnapshot,
} from './workflow-core.js';
import {
  HarnessSelectionError,
  isCopySelectionCurrentBest,
} from './execution-selection.js';
import {
  isBoundedExecutionSuspension,
  resumeWithRaisedServerLimit,
} from './bounded-execution-controller.js';
import { createCreationExecutionSnapshot } from '../execution-spine/creation-execution-snapshot.js';
import type {
  StructuredNodeRunner,
  StructuredNodeRunnerRequest,
} from '../model-supply/structured-node-runner.js';
import {
  promptRevisionReferences,
  type HarnessFrozenPrompts,
} from './langfuse-prompts.js';
import type { HarnessWorkflowInput } from './task-admission.js';
import {
  AgentPrimitiveObservabilityAdapter,
  MemoryObservabilityEventAudit,
} from '../creation-experience/index.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';

test('production tracer keeps its server-owned copy delivery layer', async () => {
  const runner = new QueueRunner([
    {
      normalizedIntent: '制作团购成片',
      taskType: 'promotion_groupbuy_conversion',
      deliveryLayer: 'finished_media',
      relevantAssetCategories: ['promotion_activity'],
      usedAssetCategories: ['promotion_activity'],
      route: 'customized',
      implicitConstraints: [],
      blockingGap: null,
    },
  ]);
  const delivery = new RecordingDelivery();
  const ports = new ProductionHarnessStagePorts(
    { create: () => runner },
    {
      async compileAndFreeze() {
        return contextSnapshot();
      },
      async fence(input) {
        return input.context;
      },
    },
    delivery,
    () => '2026-07-18T00:01:00.000Z',
  );

  const named = await ports.nameIntent({
    workflowId: 'task-media',
    request: taskInput(),
  });
  assert.equal(named.declaration.deliveryLayer, 'copy');
  assert.equal(delivery.inputs.length, 0);
});

test('production intent naming receives resolved Skill value objects through the narrow resolver port', async () => {
  const runner = new QueueRunner([
    {
      normalizedIntent: '制作团购文案',
      taskType: 'promotion_groupbuy_conversion',
      deliveryLayer: 'copy',
      relevantAssetCategories: ['promotion_activity'],
      usedAssetCategories: ['promotion_activity'],
      route: 'customized',
      implicitConstraints: [],
      blockingGap: null,
    },
  ]);
  const resolverInputs: unknown[] = [];
  const ports = new ProductionHarnessStagePorts(
    { create: () => runner },
    {
      async compileAndFreeze() {
        return contextSnapshot();
      },
      async fence(input) {
        return input.context;
      },
    },
    new RecordingDelivery(),
    () => '2026-07-18T00:01:00.000Z',
    undefined,
    undefined,
    undefined,
    {
      async resolve(input) {
        resolverInputs.push(input);
        return {
          instructions: [
            {
              contentHash: 'hash-intent-skill',
              executionMode: 'prompt_materialized',
              instruction: 'Prefer the accepted promotion context.',
              requiredModelCapabilities: [],
              skillRevisionRef: 'skill.promotion-context@3',
            },
          ],
          receipts: [],
        };
      },
    },
  );
  const request = taskInput();
  const resolved = await ports.resolveStageSkills({
    workflowId: 'task-skill-port',
    request,
    stage: 'intent_naming',
    userSelectedSkillRefs: ['skill.user@3'],
  });

  await ports.nameIntent({
    workflowId: 'task-skill-port',
    request,
    skillInstructions: resolved.instructions,
  });

  assert.deepEqual(resolverInputs, [
    {
      stage: 'intent_naming',
      userSelectedSkillRefs: ['skill.user@3'],
      workflowId: 'task-skill-port',
      workflowRevision: 4,
      workspaceId: 'workspace-1',
    },
  ]);
  assert.match(
    runner.requests[0]!.instructions,
    /\[skill\.promotion-context@3\] Prefer the accepted promotion context\./u,
  );
});

test('an existing frozen fact suppresses the matching blocking QuestionCard', async () => {
  const runner = new QueueRunner([
    {
      normalizedIntent: '推广本店团购',
      taskType: 'promotion_groupbuy_conversion',
      deliveryLayer: 'copy',
      relevantAssetCategories: ['promotion_activity'],
      usedAssetCategories: [],
      route: 'guidance',
      implicitConstraints: ['价格必须来自事实'],
      blockingGap: {
        field: 'offer_price',
        question: '本次团购价是多少？',
        options: [],
        allowFreeText: true,
        scope: 'current_task',
      },
    },
  ]);
  let contextRequests = 0;
  const snapshot = contextSnapshot();
  snapshot.bundle.dimensions.store_facts_assets = {
    'service.scalp-clean.price': {
      value: 398,
      layer: 'current_fact',
      pool: 'store_personal',
      sourceRef: 'store_fact:price-a:1',
    },
  };
  const ports = new ProductionHarnessStagePorts(
    { create: () => runner },
    {
      async compileAndFreeze() {
        contextRequests += 1;
        return snapshot;
      },
      async fence(input) {
        return input.context;
      },
    },
    new RecordingDelivery(),
    () => '2026-07-18T00:01:00.000Z',
  );
  const input = { workflowId: 'task-fact-present', request: taskInput() };
  const named = await ports.nameIntent(input);
  assert.equal(named.blockingQuestion, null);
  assert.equal(named.declaration.route, 'customized');
  assert.equal(named.declaration.routingSource, 'policy');
  assert.deepEqual(named.declaration.usedAssetCategories, ['store']);
  assert.equal(
    await ports.injectContext({ ...input, declaration: named.declaration }),
    snapshot,
  );
  assert.equal(contextRequests, 2);
});

test('production Recipe fact satisfaction gates the facts visible to the Copy Brief', async () => {
  const runner = new QueueRunner([
    {
      status: 'satisfied',
      matchedFactRefs: ['store_fact:service-1:1'],
      missingFactTypes: [],
    },
    {
      kind: 'copy',
      instructions:
        '只基于已经确认且本次满足度判断允许使用的服务事实撰写护理介绍，不引用未授权价格，并以低压力私信咨询作为行动建议。'.repeat(
          2,
        ),
      platform: 'xiaohongshu',
      cta: '私信咨询',
      factRefs: ['store_fact:service-1:1'],
      assetRefs: [],
      identityRefs: [],
      constraints: ['不得引用未授权价格'],
    },
  ]);
  const context = contextSnapshot();
  context.bundle.referencedFactRevisions = [
    { factId: 'service-1', revision: 1 },
    { factId: 'price-1', revision: 1 },
  ];
  context.bundle.dimensions.store_facts_assets = {
    service: factContribution('service-1', 'service', '头皮清洁护理'),
    price: factContribution('price-1', 'price', 398),
  };
  const ports = new ProductionHarnessStagePorts(
    { create: () => runner },
    {
      async compileAndFreeze() {
        return context;
      },
      async fence(input) {
        return input.context;
      },
    },
    new RecordingDelivery(),
    () => '2026-07-22T10:00:00.000Z',
    undefined,
    undefined,
    undefined,
    undefined,
    {
      async getRecipeByRevisionId() {
        return {
          recipeId: 'recipe-1',
          revisionId: 'recipe-r1',
          factTypes: ['service'],
        };
      },
    },
    {
      async isAuthorized({ fact }) {
        return fact.factId === 'service-1';
      },
    },
  );
  const snapshot = composerSnapshot();
  const request = {
    ...composerRequest(snapshot),
    prompts: harnessPromptBundle(),
  };
  const declaration = {
    normalizedIntent: '介绍护理服务',
    taskType: 'daily_service_exposure' as const,
    deliveryLayer: 'copy' as const,
    relevantAssetCategories: ['product_service' as const],
    usedAssetCategories: ['product_service' as const],
    route: 'customized' as const,
    routingSource: 'model' as const,
    implicitConstraints: [],
  };

  const assessment = await ports.assessFacts({
    workflowId: snapshot.task.id,
    request,
    declaration,
    context,
  });
  assert.ok(assessment);
  await ports.compileBrief({
    workflowId: snapshot.task.id,
    request,
    declaration,
    context,
    allowedFactRefs: assessment.factRefs,
  });

  assert.deepEqual(assessment, {
    status: 'satisfied',
    action: 'execute',
    factRefs: ['store_fact:service-1:1'],
  });
  const prompt = JSON.parse(runner.requests[1]?.prompt ?? '{}');
  assert.deepEqual(Object.keys(prompt.bundle.dimensions.store_facts_assets), [
    'price',
    'service',
  ]);
  assert.equal(
    prompt.bundle.dimensions.store_facts_assets.price.factSnapshot,
    undefined,
  );
  assert.equal(runner.requests[0]?.instructions, 'frozen:factSatisfaction');
  assert.equal(runner.requests[1]?.instructions, 'frozen:briefCompilation');
});

test('an unanswered industry gap reports the confirmed grounding surface to the workflow', async () => {
  const runner = new QueueRunner([
    {
      normalizedIntent: '介绍本店日常服务',
      taskType: 'daily_service_exposure',
      deliveryLayer: 'copy',
      relevantAssetCategories: ['industry_category'],
      usedAssetCategories: [],
      route: 'guidance',
      implicitConstraints: [],
      blockingGap: {
        field: 'industry_category',
        question: '这次内容主要属于哪一类美业服务？',
        options: [],
        allowFreeText: true,
        scope: 'current_task',
      },
    },
  ]);
  const snapshot = contextSnapshot();
  snapshot.activeFactReferences = [
    { key: 'store.name', sourceRef: 'store_fact:store-name:1' },
    { key: 'service.name', sourceRef: 'store_fact:service-name:1' },
  ];
  const ports = new ProductionHarnessStagePorts(
    { create: () => runner },
    {
      async compileAndFreeze() {
        return snapshot;
      },
      async fence(input) {
        return input.context;
      },
    },
    new RecordingDelivery(),
    () => '2026-07-18T00:01:00.000Z',
  );

  const named = await ports.nameIntent({
    workflowId: 'task-unanswered-industry',
    request: taskInput(),
  });

  assert.equal(
    named.blockingQuestion?.questionId,
    'task-unanswered-industry:s1:industry_category',
  );
  assert.equal(named.blockingQuestion?.unattended, 'continue');
  assert.deepEqual(named.gapGrounding, {
    activeConfirmedFactCount: 2,
    answerableConfirmedFactCount: 0,
  });
});

test('the production reuse path keeps an unanswered industry QuestionCard reachable', async () => {
  const runner = new QueueRunner([
    {
      normalizedIntent: '沿用已有结构介绍本店服务',
      taskType: 'daily_service_exposure',
      deliveryLayer: 'copy',
      relevantAssetCategories: ['industry_category'],
      usedAssetCategories: [],
      route: 'guidance',
      implicitConstraints: [],
      blockingGap: {
        field: 'industry_category',
        question: '这次内容主要属于哪一类美业服务？',
        options: [],
        allowFreeText: true,
        scope: 'current_task',
      },
    },
  ]);
  const ports = new ProductionHarnessStagePorts(
    { create: () => runner },
    {
      async compileAndFreeze() {
        return contextSnapshot();
      },
      async fence(input) {
        return input.context;
      },
    },
    new RecordingDelivery(),
    () => '2026-07-18T00:01:00.000Z',
  );
  const request = {
    ...taskInput(),
    reuseSeed: {
      assetId: 'series-a',
      assetRevision: 2,
      sourcePackageId: 'package-source',
      sourceVersionId: 'version-source',
      sourcePackageRevision: 4,
      assetRevisionId: 'series-a:2',
      fixedItemKeys: ['structure.opening'],
      variableSlotKeys: ['industry_category'],
    },
  };

  const named = await ports.nameIntent({
    workflowId: 'task-reuse-industry',
    request,
  });

  assert.equal(
    named.blockingQuestion?.questionId,
    'task-reuse-industry:s1:industry_category',
  );
  assert.equal(named.blockingQuestion?.unattended, 'continue');
  assert.deepEqual(named.gapGrounding, {
    activeConfirmedFactCount: 0,
    answerableConfirmedFactCount: 0,
  });
});

test('ambiguous service price facts keep the blocking QuestionCard', async () => {
  const runner = new QueueRunner([
    {
      normalizedIntent: '推广本店团购',
      taskType: 'promotion_groupbuy_conversion',
      deliveryLayer: 'copy',
      relevantAssetCategories: ['promotion_activity'],
      usedAssetCategories: [],
      route: 'guidance',
      implicitConstraints: ['价格必须来自当前服务事实'],
      blockingGap: {
        field: 'offer_price',
        question: '本次团购价是多少？',
        options: [],
        allowFreeText: true,
        scope: 'current_task',
      },
    },
  ]);
  const snapshot = contextSnapshot();
  snapshot.bundle.dimensions.store_facts_assets = {
    'service.scalp-clean.price': {
      value: 398,
      layer: 'current_fact',
      pool: 'store_personal',
      sourceRef: 'store_fact:price-scalp:1',
    },
    'service.nail.price': {
      value: 128,
      layer: 'current_fact',
      pool: 'store_personal',
      sourceRef: 'store_fact:price-nail:1',
    },
  };
  const ports = new ProductionHarnessStagePorts(
    { create: () => runner },
    {
      async compileAndFreeze() {
        return snapshot;
      },
      async fence(input) {
        return input.context;
      },
    },
    new RecordingDelivery(),
    () => '2026-07-18T00:01:00.000Z',
  );

  const named = await ports.nameIntent({
    workflowId: 'task-ambiguous-price',
    request: taskInput(),
  });
  assert.equal(
    named.blockingQuestion?.questionId,
    'task-ambiguous-price:s1:offer_price',
  );
  assert.equal(named.blockingQuestion?.unattended, 'continue');
});

test('same-scope facts with the same key keep the blocking QuestionCard before bundle folding', async () => {
  const runner = new QueueRunner([
    {
      normalizedIntent: '推广本店团购',
      taskType: 'promotion_groupbuy_conversion',
      deliveryLayer: 'copy',
      relevantAssetCategories: ['promotion_activity'],
      usedAssetCategories: [],
      route: 'guidance',
      implicitConstraints: ['价格必须唯一'],
      blockingGap: {
        field: 'offer_price',
        question: '本次团购价是多少？',
        options: [],
        allowFreeText: true,
        scope: 'current_task',
      },
    },
  ]);
  const snapshot = contextSnapshot();
  snapshot.bundle.dimensions.store_facts_assets = {
    'offer.price': {
      value: 199,
      layer: 'current_fact',
      pool: 'store_personal',
      sourceRef: 'store_fact:price-old:1',
    },
  };
  Object.assign(snapshot, {
    activeFactReferences: [
      { key: 'offer.price', sourceRef: 'store_fact:price-old:1' },
      { key: 'offer.price', sourceRef: 'store_fact:price-new:1' },
    ],
  });
  const ports = new ProductionHarnessStagePorts(
    { create: () => runner },
    {
      async compileAndFreeze() {
        return snapshot;
      },
      async fence(input) {
        return input.context;
      },
    },
    new RecordingDelivery(),
    () => '2026-07-18T00:01:00.000Z',
  );

  const named = await ports.nameIntent({
    workflowId: 'task-conflicting-price-streams',
    request: taskInput(),
  });
  assert.equal(
    named.blockingQuestion?.questionId,
    'task-conflicting-price-streams:s1:offer_price',
  );
  assert.equal(named.blockingQuestion?.unattended, 'continue');
});

test('production Copy stage keeps the frozen structured platform over model output', async () => {
  const runner = new QueueRunner([
    {
      kind: 'copy',
      instructions:
        '请基于已确认的服务事实写一条克制、可信的到店预约文案，说明服务价值与适用人群，不编造价格、疗效或资质，并在结尾给出低压力的私信预约行动；全文应保持清楚、自然、可信的门店主理人表达。',
      platform: 'xiaohongshu',
      cta: '私信预约',
      factRefs: [],
      assetRefs: [],
      identityRefs: [],
      constraints: [],
    },
  ]);
  const ports = new ProductionHarnessStagePorts(
    { create: () => runner },
    {
      async compileAndFreeze() {
        return contextSnapshot();
      },
      async fence(input) {
        return input.context;
      },
    },
    new RecordingDelivery(),
    () => '2026-07-18T00:01:00.000Z',
  );
  const snapshot = composerSnapshot();

  const result = await ports.compileBrief({
    workflowId: snapshot.task.id,
    request: {
      ...taskInput(),
      expectedRevision: snapshot.contentPackage.expectedRevision,
      packageId: snapshot.contentPackage.id,
      workflowRevision: snapshot.revision,
      executionSnapshot: snapshot,
    },
    declaration: {
      normalizedIntent: '介绍日常护理服务',
      taskType: 'daily_service_exposure',
      deliveryLayer: 'copy',
      relevantAssetCategories: ['industry_category'],
      usedAssetCategories: ['industry_category'],
      route: 'customized',
      routingSource: 'model',
      implicitConstraints: [],
    },
    context: contextSnapshot(),
    skillInstructions: [
      {
        contentHash: 'hash-brief-skill',
        executionMode: 'prompt_materialized',
        instruction: 'Keep the brief grounded and concise.',
        requiredModelCapabilities: [],
        skillRevisionRef: 'skill.brief-compiler@4',
      },
    ],
  });

  assert.equal(result.brief.platform, 'douyin');
  assert.deepEqual(result.brief.identityRefs, [
    'marketing_identity:identity-1:identity-r1',
  ]);
  const prompt = JSON.parse(runner.requests[0]?.prompt ?? '{}');
  assert.equal(prompt.executionContract.platform.id, 'douyin');
  assert.match(
    runner.requests[0]!.instructions,
    /\[skill\.brief-compiler@4\] Keep the brief grounded and concise\./u,
  );
});

test('a Composer Copy snapshot rejects a different active identity before provider execution', () => {
  const runner = new QueueRunner([]);
  const ports = new ProductionHarnessStagePorts(
    { create: () => runner },
    {
      async compileAndFreeze() {
        return contextSnapshot();
      },
      async fence(input) {
        return input.context;
      },
    },
    new RecordingDelivery(),
    () => '2026-07-18T00:01:00.000Z',
  );
  const snapshot = composerSnapshot();
  const context = contextSnapshot();
  context.policyReferences.identityRefs = [
    {
      id: 'marketing_identity:identity-1:identity-r1',
      workspaceId: 'workspace-1',
      status: 'registered',
    },
    {
      id: 'marketing_identity:other-active:1',
      workspaceId: 'workspace-1',
      status: 'registered',
    },
  ];

  assert.throws(
    () =>
      ports.executeAndSelect({
        workflowId: snapshot.task.id,
        request: {
          ...taskInput(),
          expectedRevision: snapshot.contentPackage.expectedRevision,
          executionSnapshot: snapshot,
          packageId: snapshot.contentPackage.id,
          workflowRevision: snapshot.revision,
        },
        context,
        brief: {
          kind: 'copy',
          instructions: 'x'.repeat(80),
          platform: 'douyin',
          cta: '私信预约',
          factRefs: [],
          assetRefs: [],
          identityRefs: ['marketing_identity:other-active:1'],
          constraints: [],
        },
      }),
    HarnessSnapshotIdentityBindingError,
  );
  assert.equal(runner.requests.length, 0);
});

test('a Composer Copy snapshot rejects a foreign brief asset before provider execution', () => {
  const runner = new QueueRunner([]);
  const ports = new ProductionHarnessStagePorts(
    { create: () => runner },
    {
      async compileAndFreeze() {
        return contextSnapshot();
      },
      async fence(input) {
        return input.context;
      },
    },
    new RecordingDelivery(),
    () => '2026-07-18T00:01:00.000Z',
  );
  const snapshot = composerSnapshot();
  const context = contextSnapshot();
  context.policyReferences.identityRefs = [
    {
      id: 'marketing_identity:identity-1:identity-r1',
      workspaceId: 'workspace-1',
      status: 'registered',
    },
  ];

  assert.throws(
    () =>
      ports.executeAndSelect({
        workflowId: snapshot.task.id,
        request: {
          ...taskInput(),
          expectedRevision: snapshot.contentPackage.expectedRevision,
          executionSnapshot: snapshot,
          packageId: snapshot.contentPackage.id,
          workflowRevision: snapshot.revision,
        },
        context,
        brief: {
          kind: 'copy',
          instructions: 'x'.repeat(80),
          platform: 'douyin',
          cta: '私信预约',
          factRefs: [],
          assetRefs: ['asset-foreign'],
          identityRefs: ['marketing_identity:identity-1:identity-r1'],
          constraints: [],
        },
      }),
    HarnessSnapshotAssetReferenceError,
  );
  assert.equal(runner.requests.length, 0);
});

test('a frozen Composer Copy snapshot uses the single revision writer', async () => {
  const legacyDelivery = new RecordingDelivery();
  const executionDelivery = new RecordingRevisionWriter();
  let memoryCompletions = 0;
  let releaseMemoryCompletion!: () => void;
  let markMemoryStarted!: () => void;
  const memoryCompletion = new Promise<void>((resolve) => {
    releaseMemoryCompletion = resolve;
  });
  const memoryStarted = new Promise<void>((resolve) => {
    markMemoryStarted = resolve;
  });
  const ports = new ProductionHarnessStagePorts(
    { create: () => new QueueRunner([]) },
    {
      async compileAndFreeze() {
        return contextSnapshot();
      },
      async fence(input) {
        return input.context;
      },
    },
    legacyDelivery,
    () => '2026-07-22T10:00:00.000Z',
    undefined,
    executionDelivery,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      async complete() {
        markMemoryStarted();
        await memoryCompletion;
        memoryCompletions += 1;
      },
    },
  );
  const snapshot = composerSnapshot();
  const context = contextSnapshot();
  context.bundle.referencedFactRevisions = [
    { factId: 'service-1', revision: 1 },
  ];
  context.bundle.dimensions.store_facts_assets = {
    service: factContribution('service-1', 'service', '日常护理'),
  };
  context.activeFacts = [
    {
      key: 'service',
      value: '日常护理',
      sourceRef: 'store_fact:service-1:1',
      effectiveFrom: '2026-07-22T00:00:00.000Z',
      expiresAt: null,
    },
  ];
  context.policyReferences.sourceRefs = [
    {
      id: 'store_fact:service-1:1',
      workspaceId: 'workspace-1',
      revision: 1,
      status: 'current',
    },
  ];
  context.policyReferences.rightsRefs = [
    {
      assetId: 'asset-1',
      workspaceId: 'workspace-1',
      status: 'authorized',
      allowedUses: ['public_content'],
    },
  ];

  const deliveryPromise = ports.assembleAndDeliver({
    workflowId: snapshot.task.id,
    request: {
      ...taskInput(),
      expectedRevision: snapshot.contentPackage.expectedRevision,
      executionSnapshot: snapshot,
      packageId: snapshot.contentPackage.id,
      workflowRevision: snapshot.revision,
    },
    declaration: {
      normalizedIntent: '介绍日常护理服务',
      taskType: 'daily_service_exposure',
      deliveryLayer: 'copy',
      relevantAssetCategories: ['industry_category'],
      usedAssetCategories: ['industry_category'],
      route: 'customized',
      routingSource: 'model',
      implicitConstraints: [],
    },
    context,
    allowedFactRefs: ['store_fact:service-1:1'],
    brief: {
      kind: 'copy',
      instructions: 'x'.repeat(80),
      platform: 'douyin',
      cta: '私信预约',
      factRefs: ['store_fact:service-1:1'],
      assetRefs: ['asset-1', 'asset-1'],
      identityRefs: [],
      constraints: [],
    },
    selection: {
      candidates: [
        {
          candidateId: 'candidate-1',
          title: '候选一',
          body: '候选一正文',
          conversionHook: '私信预约',
          score: 91,
        },
        {
          candidateId: 'candidate-2',
          title: '候选二',
          body: '候选二正文',
          conversionHook: '了解详情',
          score: 88,
        },
      ],
      winner: {
        candidateId: 'candidate-1',
        title: '候选一',
        body: '候选一正文',
        conversionHook: '私信预约',
      },
      trace: {} as never,
    },
  });
  await memoryStarted;
  let deliverySettled = false;
  void deliveryPromise.then(() => {
    deliverySettled = true;
  });
  await Promise.resolve();
  assert.equal(
    deliverySettled,
    false,
    'the DBOS-owned delivery step must wait for durable memory completion',
  );
  releaseMemoryCompletion();
  const delivery = await deliveryPromise;

  assert.deepEqual(delivery, {
    packageId: 'package-1',
    revision: 1,
    versionId: executionDelivery.inputs[0]?.version.id,
  });
  assert.equal(legacyDelivery.inputs.length, 0);
  assert.equal(executionDelivery.inputs.length, 1);
  assert.equal(memoryCompletions, 1);
  assert.equal(
    executionDelivery.inputs[0]?.occurredAt,
    '2026-07-22T10:00:00.000Z',
  );
  assert.deepEqual(executionDelivery.inputs[0]?.snapshot, {
    id: snapshot.id,
    revision: snapshot.revision,
    schemaVersion: snapshot.schemaVersion,
  });
  assert.equal(executionDelivery.inputs[0]?.snapshotId, snapshot.id);
  assert.equal(executionDelivery.inputs[0]?.taskId, snapshot.task.id);
  assert.equal(executionDelivery.inputs[0]?.workId, snapshot.work.id);
  assert.deepEqual(executionDelivery.inputs[0]?.generated, {
    assetIds: [executionDelivery.inputs[0]?.workAsset?.id],
    childRuns: [],
  });
  assert.deepEqual(executionDelivery.inputs[0]?.workAsset, {
    body: '候选一正文',
    candidateIndex: 0,
    conversionHook: '私信预约',
    createdAt: '2026-07-22T10:00:00.000Z',
    id: executionDelivery.inputs[0]?.generated.assetIds[0],
    jobId: snapshot.task.id,
    kind: 'text',
    title: '候选一',
    workId: snapshot.work.id,
    workspaceId: 'workspace-1',
  });
  assert.match(
    executionDelivery.inputs[0]?.workAsset?.id ?? '',
    /^work-1-harness-copy-[a-f0-9]{20}$/u,
  );
  assert.deepEqual(executionDelivery.inputs[0]?.harnessSelection, {
    recommendedCandidateId: 'candidate-1',
  });
  assert.deepEqual(executionDelivery.inputs[0]?.marketing?.factRefs, [
    'store_fact:service-1:1',
  ]);
  assert.deepEqual(executionDelivery.inputs[0]?.marketing?.rightsRefs, [
    'asset-1',
  ]);
  assert.deepEqual(
    (
      executionDelivery.inputs[0] as unknown as {
        claimExtraction?: {
          claims: unknown[];
          inputHash: string;
          revision: string;
        };
      }
    )?.claimExtraction,
    {
      claims: [],
      inputHash:
        '0ec2a44efd3caf81a634640d01f6de957802a78b3520da0c4934b3f6a4ed725b',
      revision: 'visible-claim-extractor-v2',
    },
  );
  assert.equal(executionDelivery.inputs[0]?.version.conversionHook, '私信预约');
  assert.deepEqual(executionDelivery.inputs[0]?.version.orderedAssetIds, [
    'asset-1',
  ]);
  assert.deepEqual(
    executionDelivery.inputs[0]?.additionalVersions?.map(
      (version) => version.harnessCandidateId,
    ),
    ['candidate-2'],
  );
  assert.deepEqual(
    executionDelivery.inputs[0]?.variants?.map((variant) => ({
      currentVersionId: variant.currentVersionId,
      platform: variant.platform,
      versionCount: variant.versions.length,
    })),
    [
      {
        currentVersionId: `${executionDelivery.inputs[0]?.version.id}-xiaohongshu`,
        platform: 'xiaohongshu',
        versionCount: 2,
      },
      {
        currentVersionId: `${executionDelivery.inputs[0]?.version.id}-douyin`,
        platform: 'douyin',
        versionCount: 2,
      },
      {
        currentVersionId: `${executionDelivery.inputs[0]?.version.id}-video_account`,
        platform: 'video_account',
        versionCount: 2,
      },
    ],
  );
});

test('assembly blocks unsupported visible claims before writing a deliverable revision', async () => {
  const executionDelivery = new RecordingRevisionWriter();
  const ports = new ProductionHarnessStagePorts(
    { create: () => new QueueRunner([]) },
    {
      async compileAndFreeze() {
        return contextSnapshot();
      },
      async fence(input) {
        return input.context;
      },
    },
    new RecordingDelivery(),
    () => '2026-07-22T10:00:00.000Z',
    undefined,
    executionDelivery,
  );
  const snapshot = composerSnapshot();

  await assert.rejects(
    ports.assembleAndDeliver({
      workflowId: snapshot.task.id,
      request: composerRequest(snapshot),
      declaration: {
        normalizedIntent: '宣传本店团购',
        taskType: 'promotion_groupbuy_conversion',
        deliveryLayer: 'copy',
        relevantAssetCategories: ['promotion_activity'],
        usedAssetCategories: [],
        route: 'customized',
        routingSource: 'model',
        implicitConstraints: [],
      },
      context: contextSnapshot(),
      brief: {
        kind: 'copy',
        instructions: 'x'.repeat(80),
        platform: 'douyin',
        cta: '立即抢购',
        factRefs: [],
        assetRefs: [],
        identityRefs: [],
        constraints: [],
      },
      selection: {
        candidates: [
          {
            candidateId: 'candidate-redline',
            title: '国家认证五星机构，团购价398元',
            body: '到店即送全年护理',
            conversionHook: '立即抢购',
            score: 91,
          },
        ],
        winner: {
          candidateId: 'candidate-redline',
          title: '国家认证五星机构，团购价398元',
          body: '到店即送全年护理',
          conversionHook: '立即抢购',
        },
        trace: {} as never,
      },
    }),
    (error: unknown) =>
      error instanceof HarnessSelectionError &&
      error.gateIds.includes('critical_fact_source') &&
      error.merchantMessage ===
        '成品文案含有未被门店已确认资料支持的资质、价格或优惠、权益承诺，暂不能交付。' &&
      error.triggeredClaims?.some(
        (claim) =>
          claim.kind === 'qualification' && claim.value.includes('国家认证'),
      ) === true,
  );
  assert.equal(executionDelivery.inputs.length, 0);
});

test('assembly delivers legitimate promotion copy backed by confirmed facts', async () => {
  const executionDelivery = new RecordingRevisionWriter();
  const ports = new ProductionHarnessStagePorts(
    { create: () => new QueueRunner([]) },
    {
      async compileAndFreeze() {
        return contextSnapshot();
      },
      async fence(input) {
        return input.context;
      },
    },
    new RecordingDelivery(),
    () => '2026-07-22T10:00:00.000Z',
    undefined,
    executionDelivery,
  );
  const snapshot = composerSnapshot();
  const context = contextSnapshot();
  const activeFacts = [
    {
      key: 'offer.price',
      value: { amount: 398, currency: 'CNY' },
      sourceRef: 'store_fact:offer-price:1',
      effectiveFrom: '2026-07-22T00:00:00.000Z',
      expiresAt: null,
    },
    {
      key: 'offer.discount',
      value: { amount: 50, kind: 'discount' },
      sourceRef: 'store_fact:offer-discount:1',
      effectiveFrom: '2026-07-22T00:00:00.000Z',
      expiresAt: null,
    },
  ];
  context.activeFacts = activeFacts;
  context.policyReferences.sourceRefs = activeFacts.map(({ sourceRef }) => ({
    id: sourceRef,
    revision: 1,
    status: 'current' as const,
    workspaceId: 'workspace-1',
  }));
  context.bundle.dimensions.store_facts_assets = {
    price: factContribution('offer-price', 'price', 398),
    discount: factContribution('offer-discount', 'price', 50),
  };

  await ports.assembleAndDeliver({
    workflowId: snapshot.task.id,
    request: composerRequest(snapshot),
    declaration: {
      normalizedIntent: '宣传本店团购',
      taskType: 'promotion_groupbuy_conversion',
      deliveryLayer: 'copy',
      relevantAssetCategories: ['promotion_activity'],
      usedAssetCategories: [],
      route: 'customized',
      routingSource: 'model',
      implicitConstraints: [],
    },
    context,
    allowedFactRefs: activeFacts.map(({ sourceRef }) => sourceRef),
    brief: {
      kind: 'copy',
      instructions: 'x'.repeat(80),
      platform: 'douyin',
      cta: '立即预约',
      factRefs: activeFacts.map(({ sourceRef }) => sourceRef),
      assetRefs: [],
      identityRefs: [],
      constraints: [],
    },
    selection: {
      candidates: [
        {
          candidateId: 'candidate-grounded-offer',
          title: '光子嫩肤团购价398元',
          body: '限时优惠，立减50元，效果自然',
          conversionHook: '立即预约',
          score: 91,
        },
      ],
      winner: {
        candidateId: 'candidate-grounded-offer',
        title: '光子嫩肤团购价398元',
        body: '限时优惠，立减50元，效果自然',
        conversionHook: '立即预约',
      },
      trace: {} as never,
    },
  });

  assert.equal(executionDelivery.inputs.length, 1);
  assert.deepEqual(
    executionDelivery.inputs[0]?.claimExtraction?.claims.map(
      ({ field, kind, value }) => ({ field, kind, value }),
    ),
    [
      {
        field: 'candidate-grounded-offer.title',
        kind: 'offer',
        value: '光子嫩肤团购价398元',
      },
      {
        field: 'candidate-grounded-offer.body',
        kind: 'offer',
        value: '限时优惠,立减50元,效果自然',
      },
    ],
  );
});

test('a source ContentPackage enters the Copy Brief and fails closed after revocation', async () => {
  const source = { id: 'source-package-1', revision: '3' };
  let available = true;
  const runner = new QueueRunner([
    {
      kind: 'copy',
      instructions:
        '请基于已确认旧内容的结构和风格，写一条适合新平台的预约文案。'.repeat(
          3,
        ),
      platform: 'xiaohongshu',
      cta: '私信了解',
      factRefs: [],
      assetRefs: [],
      identityRefs: [],
      constraints: [],
    },
  ]);
  const executionDelivery = new RecordingRevisionWriter();
  const ports = new ProductionHarnessStagePorts(
    { create: () => runner },
    {
      async compileAndFreeze() {
        return contextWithSourcePackage();
      },
      async fence(input) {
        return input.context;
      },
    },
    new RecordingDelivery(),
    () => '2026-07-22T10:00:00.000Z',
    undefined,
    executionDelivery,
    {
      async resolve(input) {
        if (!available)
          throw new SourceContentPackageUnavailableError(input.source!);
        return sourceContentPackageProjection();
      },
    },
  );
  const snapshot = composerSnapshot(source);
  const request = {
    ...taskInput(),
    expectedRevision: snapshot.contentPackage.expectedRevision,
    executionSnapshot: snapshot,
    packageId: snapshot.contentPackage.id,
    workflowRevision: snapshot.revision,
  };
  const declaration = {
    normalizedIntent: '介绍日常护理服务',
    taskType: 'daily_service_exposure' as const,
    deliveryLayer: 'copy' as const,
    relevantAssetCategories: ['industry_category' as const],
    usedAssetCategories: ['industry_category' as const],
    route: 'customized' as const,
    routingSource: 'model' as const,
    implicitConstraints: [],
  };

  await ports.compileBrief({
    workflowId: snapshot.task.id,
    request,
    declaration,
    context: contextWithSourcePackage(),
  });
  const prompt = JSON.parse(runner.requests[0]?.prompt ?? '{}');
  assert.deepEqual(
    prompt.bundle.dimensions.store_facts_assets.source_content_package_structure
      .value,
    {
      packageId: source.id,
      revision: source.revision,
      ...sourceContentPackageProjection().structure,
    },
  );
  assert.deepEqual(
    prompt.bundle.dimensions.store_facts_assets.source_content_package_assets
      .value,
    {
      packageId: source.id,
      revision: source.revision,
      assets: sourceContentPackageProjection().assets.filter(
        (asset) => asset.role === 'selected',
      ),
    },
  );
  assert.doesNotMatch(JSON.stringify(prompt), /398元|限时团购|旧活动/u);
  assert.doesNotMatch(JSON.stringify(prompt), /source-asset-1/u);

  available = false;
  await assert.rejects(
    ports.nameIntent({ workflowId: snapshot.task.id, request }),
    SourceContentPackageUnavailableError,
  );
  await assert.rejects(
    ports.assembleAndDeliver({
      workflowId: snapshot.task.id,
      request,
      declaration,
      context: contextWithSourcePackage(),
      brief: {
        kind: 'copy',
        instructions: 'x'.repeat(80),
        platform: 'douyin',
        cta: '私信了解',
        factRefs: [],
        assetRefs: [],
        identityRefs: [],
        constraints: [],
      },
      selection: selectionFixture(),
    }),
    SourceContentPackageUnavailableError,
  );
  assert.equal(runner.requests.length, 1);
  assert.equal(executionDelivery.inputs.length, 0);
});

test('only selected source-package assets can cross Brief, selection, and delivery', async () => {
  const source = { id: 'source-package-1', revision: '3' };
  const runner = new QueueRunner([
    {
      kind: 'copy',
      instructions:
        '请只使用已选择且仍有授权的来源素材，写一条可发布的预约文案。'.repeat(
          3,
        ),
      platform: 'douyin',
      cta: '私信预约',
      factRefs: [],
      assetRefs: ['selected-asset-1'],
      identityRefs: [],
      constraints: [],
    },
    candidate('候选一', { assetRefs: ['selected-asset-1'] }),
    candidate('候选二', { assetRefs: ['selected-asset-1'] }),
    candidate('候选三', { assetRefs: ['selected-asset-1'] }),
    score(91),
    score(90),
    score(89),
  ]);
  const executionDelivery = new RecordingRevisionWriter();
  const ports = new ProductionHarnessStagePorts(
    { create: () => runner },
    {
      async compileAndFreeze() {
        return contextWithSourcePackage();
      },
      async fence(input) {
        return input.context;
      },
    },
    new RecordingDelivery(),
    () => '2026-07-22T10:00:00.000Z',
    undefined,
    executionDelivery,
    {
      async resolve() {
        return sourceContentPackageProjection();
      },
    },
  );
  const snapshot = composerSnapshot(source);
  const request = composerRequest(snapshot);
  const declaration = {
    normalizedIntent: '介绍日常护理服务',
    taskType: 'daily_service_exposure' as const,
    deliveryLayer: 'copy' as const,
    relevantAssetCategories: ['industry_category' as const],
    usedAssetCategories: ['industry_category' as const],
    route: 'customized' as const,
    routingSource: 'model' as const,
    implicitConstraints: [],
  };
  const context = contextWithSourcePackage();

  const { brief } = await ports.compileBrief({
    workflowId: snapshot.task.id,
    request,
    declaration,
    context,
  });
  assert.deepEqual(brief.assetRefs, ['selected-asset-1']);

  const selection = await ports.executeAndSelect({
    workflowId: snapshot.task.id,
    request,
    context,
    brief,
  });
  assert.equal(selection.winner.candidateId, 'c01');

  await ports.assembleAndDeliver({
    workflowId: snapshot.task.id,
    request,
    declaration,
    context,
    brief,
    selection,
  });
  assert.equal(executionDelivery.inputs.length, 1);
  assert.deepEqual(executionDelivery.inputs[0]?.version.orderedAssetIds, [
    'selected-asset-1',
  ]);
  assert.deepEqual(
    executionDelivery.inputs[0]?.additionalVersions?.map(
      (version) => version.orderedAssetIds,
    ),
    [],
  );

  const sourceOnlyRunner = new QueueRunner([
    {
      kind: 'copy',
      instructions: 'x'.repeat(80),
      platform: 'douyin',
      cta: '私信预约',
      factRefs: [],
      assetRefs: ['source-asset-1'],
      identityRefs: [],
      constraints: [],
    },
  ]);
  const sourceOnlyPorts = new ProductionHarnessStagePorts(
    { create: () => sourceOnlyRunner },
    {
      async compileAndFreeze() {
        return contextWithSourcePackage();
      },
      async fence(input) {
        return input.context;
      },
    },
    new RecordingDelivery(),
    () => '2026-07-22T10:00:00.000Z',
    undefined,
    new RecordingRevisionWriter(),
    {
      async resolve() {
        return sourceContentPackageProjection();
      },
    },
  );
  await assert.rejects(
    sourceOnlyPorts.compileBrief({
      workflowId: snapshot.task.id,
      request,
      declaration,
      context,
    }),
    HarnessSnapshotAssetReferenceError,
  );
});

test('source revocation after c01 prevents c02 provider work and delivery', async () => {
  const source = { id: 'source-package-1', revision: '3' };
  const runner = new QueueRunner([
    {
      normalizedIntent: '介绍日常护理服务',
      taskType: 'daily_service_exposure',
      deliveryLayer: 'copy',
      relevantAssetCategories: ['industry_category'],
      usedAssetCategories: ['industry_category'],
      route: 'customized',
      implicitConstraints: [],
      blockingGap: null,
    },
    {
      kind: 'copy',
      instructions: 'x'.repeat(80),
      platform: 'douyin',
      cta: '私信预约',
      factRefs: [],
      assetRefs: [],
      identityRefs: [],
      constraints: [],
    },
    candidate('候选一'),
  ]);
  const executionDelivery = new RecordingRevisionWriter();
  const ports = new ProductionHarnessStagePorts(
    { create: () => runner },
    {
      async compileAndFreeze() {
        return contextWithSourcePackage();
      },
      async fence(input) {
        return input.context;
      },
    },
    new RecordingDelivery(),
    () => '2026-07-22T10:00:00.000Z',
    undefined,
    executionDelivery,
    {
      async resolve(input) {
        if (runner.requests.length >= 3) {
          throw new SourceContentPackageUnavailableError(input.source!);
        }
        return sourceContentPackageProjection();
      },
    },
  );
  const snapshot = composerSnapshot(source);

  await assert.rejects(
    runHarnessWorkflow(snapshot.task.id, composerRequest(snapshot), ports, {
      async runStep(_key, operation) {
        return operation();
      },
      async progress() {},
      async token() {},
      async awaitDecision() {
        throw new Error('Unexpected decision wait.');
      },
      async recordTrace() {},
    }),
    SourceContentPackageUnavailableError,
  );
  assert.deepEqual(
    runner.requests.map((request) => request.effectIdempotencyKey),
    [
      `wf:${snapshot.task.id}:s1:intent:0`,
      `wf:${snapshot.task.id}:s3:copy-primary:0`,
      `wf:${snapshot.task.id}:s4:copy-primary:c01`,
    ],
  );
  assert.equal(executionDelivery.inputs.length, 0);
});

test('source revocation between auto fallback attempts stops the second provider effect', async () => {
  const source = { id: 'source-package-1', revision: '3' };
  let available = true;
  const runner = new FallbackFenceRunner(() => {
    available = false;
  });
  const ports = new ProductionHarnessStagePorts(
    { create: () => runner },
    {
      async compileAndFreeze() {
        return contextWithSourcePackage();
      },
      async fence(input) {
        return input.context;
      },
    },
    new RecordingDelivery(),
    () => '2026-07-22T10:00:00.000Z',
    undefined,
    new RecordingRevisionWriter(),
    {
      async resolve(input) {
        if (!available)
          throw new SourceContentPackageUnavailableError(input.source!);
        return sourceContentPackageProjection();
      },
    },
  );
  const snapshot = composerSnapshot(source);
  const request = composerRequest(snapshot);

  await assert.rejects(
    ports.compileBrief({
      workflowId: snapshot.task.id,
      request,
      declaration: {
        normalizedIntent: '介绍日常护理服务',
        taskType: 'daily_service_exposure',
        deliveryLayer: 'copy',
        relevantAssetCategories: ['industry_category'],
        usedAssetCategories: ['industry_category'],
        route: 'customized',
        routingSource: 'model',
        implicitConstraints: [],
      },
      context: contextWithSourcePackage(),
    }),
    SourceContentPackageUnavailableError,
  );
  assert.equal(runner.providerAttempts, 1);
  assert.equal(runner.fenceCalls, 2);
});

test('a Composer Copy snapshot rejects brief assets outside its frozen sources', async () => {
  const executionDelivery = new RecordingRevisionWriter();
  const ports = new ProductionHarnessStagePorts(
    { create: () => new QueueRunner([]) },
    {
      async compileAndFreeze() {
        return contextSnapshot();
      },
      async fence(input) {
        return input.context;
      },
    },
    new RecordingDelivery(),
    () => '2026-07-22T10:00:00.000Z',
    undefined,
    executionDelivery,
  );
  const snapshot = composerSnapshot();

  await assert.rejects(
    ports.assembleAndDeliver({
      workflowId: snapshot.task.id,
      request: {
        ...taskInput(),
        expectedRevision: snapshot.contentPackage.expectedRevision,
        executionSnapshot: snapshot,
        packageId: snapshot.contentPackage.id,
        workflowRevision: snapshot.revision,
      },
      declaration: {
        normalizedIntent: '介绍日常护理服务',
        taskType: 'daily_service_exposure',
        deliveryLayer: 'copy',
        relevantAssetCategories: ['industry_category'],
        usedAssetCategories: ['industry_category'],
        route: 'customized',
        routingSource: 'model',
        implicitConstraints: [],
      },
      context: contextSnapshot(),
      brief: {
        kind: 'copy',
        instructions: 'x'.repeat(80),
        platform: 'douyin',
        cta: '私信预约',
        factRefs: [],
        assetRefs: ['asset-foreign'],
        identityRefs: [],
        constraints: [],
      },
      selection: {
        candidates: [
          {
            candidateId: 'candidate-1',
            title: '候选一',
            body: '候选一正文',
            conversionHook: '私信预约',
            score: 91,
          },
        ],
        winner: {
          candidateId: 'candidate-1',
          title: '候选一',
          body: '候选一正文',
          conversionHook: '私信预约',
        },
        trace: {} as never,
      },
    }),
    HarnessSnapshotAssetReferenceError,
  );
  assert.equal(executionDelivery.inputs.length, 0);
});

test('production ports compose #31, canonical gates, a single primary result and copy delivery', async () => {
  const runner = new QueueRunner([
    {
      normalizedIntent: '推广本店团购',
      taskType: 'promotion_groupbuy_conversion',
      deliveryLayer: 'copy',
      relevantAssetCategories: ['promotion_activity'],
      usedAssetCategories: ['promotion_activity'],
      route: 'customized',
      implicitConstraints: ['不得编造价格'],
      blockingGap: null,
    },
    {
      kind: 'copy',
      instructions:
        '请基于当前有效团购事实，面向目标顾客生成一条可直接发布的小红书文案。正文需完整说明适用人群、服务价值和预约方式，保留事实引用、表达身份、平台结构和明确行动号召；不得编造价格、效果、资格或顾客案例，也不得使用未授权素材。',
      platform: 'xiaohongshu',
      cta: '私信预约',
      factRefs: [],
      assetRefs: [],
      identityRefs: [],
      constraints: ['不得编造价格'],
    },
    candidate('候选 A'),
    candidate('候选 B'),
    candidate('候选 C'),
    score(70),
    score(92),
    score(92),
  ]);
  const delivery = new RecordingDelivery();
  const ports = new ProductionHarnessStagePorts(
    { create: () => runner },
    {
      async compileAndFreeze() {
        return contextSnapshot();
      },
      async fence(input) {
        return input.context;
      },
    },
    delivery,
    () => '2026-07-18T00:01:00.000Z',
  );
  const traces = new Map<string, Record<string, unknown>>();
  const request = {
    ...taskInput(),
    prompts: harnessPromptBundle(),
  };
  const result = await runHarnessWorkflow('task-production', request, ports, {
    async runStep(_key, operation) {
      return operation();
    },
    async progress() {},
    async token() {},
    async awaitDecision() {
      throw new Error('Unexpected decision wait.');
    },
    async recordTrace(input) {
      traces.set(input.stage, input.payload as Record<string, unknown>);
    },
  });

  assert.equal(result.trace.winnerCandidateId, 'c01');
  assert.equal(delivery.inputs[0]?.winner.candidateId, 'c01');
  assert.deepEqual(
    delivery.inputs[0]?.candidates.map(({ candidateId, score }) => ({
      candidateId,
      score,
    })),
    [{ candidateId: 'c01', score: 0 }],
  );
  assert.equal(
    'promotionOffer' in (delivery.inputs[0]?.marketing ?? {}),
    false,
  );
  assert.deepEqual(traces.get('intent_naming')?.metrics, {
    initial: { calls: 1, schemaValid: 1, schemaInvalid: 0 },
    repair: { status: 'observed', count: 0, reasons: [] },
    retry: { triggered: 0 },
    nestedCompleteness: { complete: 7, total: 7 },
  });
  assert.deepEqual(traces.get('brief_compilation')?.metrics, {
    initial: { calls: 1, schemaValid: 1, schemaInvalid: 0 },
    repair: { status: 'observed', count: 0, reasons: [] },
    retry: { triggered: 0 },
    nestedCompleteness: { complete: 5, total: 8 },
  });
  assert.deepEqual(
    runner.requests.map(({ effectIdempotencyKey }) => effectIdempotencyKey),
    [
      'wf:task-production:s1:intent:0',
      'wf:task-production:s3:copy-primary:0',
      'wf:task-production:s4:copy-primary:c01',
    ],
  );
  assert.equal(runner.requests[0]?.instructions, 'frozen:intentNaming');
  assert.equal(runner.requests[1]?.instructions, 'frozen:briefCompilation');
  assert.equal(
    runner.requests[2]?.instructions.startsWith('frozen:copyCandidate'),
    true,
  );
});

const unpricedOfferBypassCases = [
  {
    name: 'numeric offer units in the title',
    output: candidate('体验价 99 元'),
  },
  {
    name: 'Chinese-number discounts in the title',
    output: candidate('会员专享九折'),
  },
  {
    name: 'repeated Chinese-number discounts in the body',
    output: candidate('护理体验', { body: '限时八八折，欢迎到店了解。' }),
  },
  {
    name: 'full-width offer digits in the body',
    output: candidate('护理体验', { body: '本期体验价１９９，欢迎咨询。' }),
  },
  {
    name: 'bare digits next to 只要 in the body',
    output: candidate('护理体验', { body: '本周到店只要199，欢迎咨询。' }),
  },
  {
    name: 'bare digits next to 立减 in the conversion hook',
    output: candidate('护理体验', { conversionHook: '现在预约立减50' }),
  },
  {
    name: 'nth-item half-price offers in the body',
    output: candidate('护理体验', { body: '同行好友第2件半价。' }),
  },
  {
    name: 'buy-one-get-one offers in the title',
    output: candidate('本周护理买一送一'),
  },
  {
    name: '满199减50',
    output: candidate('满199减50'),
  },
  {
    name: '特惠199',
    output: candidate('特惠199'),
  },
  {
    name: '特惠30%',
    output: candidate('特惠30%'),
  },
  {
    name: '199块',
    output: candidate('199块'),
  },
  {
    name: '199块钱',
    output: candidate('199块钱'),
  },
  {
    name: 'RMB199',
    output: candidate('RMB199'),
  },
  {
    name: 'rmb199',
    output: candidate('rmb199'),
  },
  {
    name: 'dollar-prefixed price in the title',
    output: candidate('$199'),
  },
  {
    name: 'spaced dollar-prefixed price in the body',
    output: candidate('护理体验', { body: '本期体验价 $ 199。' }),
  },
  {
    name: 'USD-prefixed price in the body',
    output: candidate('护理体验', { body: '本期体验价 USD199。' }),
  },
  {
    name: 'USD-suffixed price in the conversion hook',
    output: candidate('护理体验', { conversionHook: '现在预约 199 USD' }),
  },
  {
    name: 'yuan-prefixed price',
    output: candidate('yuan199'),
  },
  {
    name: 'yuan-suffixed price',
    output: candidate('199 yuan'),
  },
  {
    name: 'CNY-prefixed price',
    output: candidate('CNY199'),
  },
  {
    name: 'CNY-suffixed price',
    output: candidate('199 CNY'),
  },
  {
    name: 'euro currency symbol',
    output: candidate('€199'),
  },
  {
    name: 'pound currency symbol after the amount',
    output: candidate('199£'),
  },
  {
    name: 'simplified round price unit',
    output: candidate('199圆'),
  },
  {
    name: 'traditional round price unit',
    output: candidate('199圓'),
  },
  {
    name: 'traditional chunk price unit',
    output: candidate('199塊'),
  },
  {
    name: 'traditional chunk-money price unit',
    output: candidate('199塊錢'),
  },
  {
    name: 'Chinese foreign-currency name',
    output: candidate('199美元'),
  },
  {
    name: 'promotional percentage after an eight-character gap',
    output: candidate('限时优惠甲乙丙丁戊己庚辛30%'),
  },
  {
    name: 'promotional percentage after a nine-character gap',
    output: candidate('限时优惠甲乙丙丁戊己庚辛壬30%'),
  },
  {
    name: 'promotional percentage after a long same-clause gap',
    output: candidate(`限时优惠${'护理介绍'.repeat(8)}30%`),
  },
  {
    name: 'promotional percentage before a long same-clause gap',
    output: candidate(`30%${'护理介绍'.repeat(8)}限时优惠`),
  },
  {
    name: 'promotional service count after a long same-clause gap',
    output: candidate(`限时优惠${'护理介绍'.repeat(8)}3次`),
  },
  {
    name: '价格199',
    output: candidate('价格199'),
  },
  {
    name: '壹玖玖元',
    output: candidate('壹玖玖元'),
  },
  {
    name: '两百减五十',
    output: candidate('两百减五十'),
  },
  {
    name: '第二杯半价',
    output: candidate('第二杯半价'),
  },
  {
    name: 'promotional percentage context',
    output: candidate('限时优惠99%'),
  },
  {
    name: 'promotional service-count context',
    output: candidate('限时护理3次'),
  },
] as const;

for (const bypass of unpricedOfferBypassCases) {
  test(`unpriced promotion blocks ${bypass.name}`, async () => {
    await assertUnpricedCandidateBlocked(bypass.output);
  });
}

test('unpriced promotion keeps structured fact claims as an additional guard', async () => {
  await assertUnpricedCandidateBlocked(
    candidate('护理体验', {
      factClaims: [{ kind: 'price', value: '199 CNY' }],
    }),
  );
});

test('bounded production selection preserves the blocked primary instead of starting correction', async () => {
  const runner = new QueueRunner([
    candidate('限时护理3次'),
    candidate('门店护理步骤说明'),
  ]);
  const base = unpricedExecutionInput('task-unpriced-bounded');
  const input = {
    ...base,
    request: {
      ...base.request,
      boundedExecution: {
        schemaVersion: 'bounded-execution-snapshot/v1' as const,
        maxIterations: 1,
        maxCostCents: 'unset' as const,
        maxWallClockMs: 'unset' as const,
        maxDelegations: 'unset' as const,
        requiredLimits: ['maxIterations' as const],
        consumption: {
          iterations: 0,
          costCents: 0,
          wallClockMs: 0,
          delegations: 0,
        },
        stopReason: null,
        triggeredLimit: null,
      },
    },
  };

  const result = await unpricedPorts(runner).executeAndSelectBounded(input);

  assert.equal(isBoundedExecutionSuspension(result), true);
  if (!isBoundedExecutionSuspension(result)) return;
  assert.equal(isCopySelectionCurrentBest(result.currentBest), true);
  if (!isCopySelectionCurrentBest(result.currentBest)) return;
  assert.equal(result.snapshot.triggeredLimit, 'maxIterations');
  assert.equal(result.snapshot.consumption.iterations, 1);
  assert.equal(runner.requests.length, 1);

  const resumed = await unpricedPorts(runner).executeAndSelectBounded({
    ...input,
    request: {
      ...input.request,
      boundedExecution: resumeWithRaisedServerLimit(result.snapshot, {
        limit: 'maxIterations',
        value: 2,
      }),
    },
    boundedResume: result,
  });

  assert.equal(isBoundedExecutionSuspension(resumed), false);
  if (isBoundedExecutionSuspension(resumed)) return;
  assert.equal(resumed.winner.title, '门店护理步骤说明');
  assert.equal(resumed.boundedExecution?.consumption.iterations, 2);
  assert.equal(runner.requests.length, 2);
});

test('zero maxIterations suspends before the first production provider effect', async () => {
  const runner = new PhysicalAttemptQueueRunner(
    [candidate('不应执行的候选')],
    [1],
  );
  const base = unpricedExecutionInput('task-zero-iteration-budget');
  const input = {
    ...base,
    request: {
      ...base.request,
      boundedExecution: {
        schemaVersion: 'bounded-execution-snapshot/v1' as const,
        maxIterations: 0,
        maxCostCents: 'unset' as const,
        maxWallClockMs: 'unset' as const,
        maxDelegations: 'unset' as const,
        requiredLimits: ['maxIterations' as const],
        consumption: {
          iterations: 0,
          costCents: 0,
          wallClockMs: 0,
          delegations: 0,
        },
        stopReason: null,
        triggeredLimit: null,
      },
    },
  };

  const result = await unpricedPorts(runner).executeAndSelectBounded(input);

  assert.equal(isBoundedExecutionSuspension(result), true);
  if (!isBoundedExecutionSuspension(result)) return;
  assert.equal(result.snapshot.triggeredLimit, 'maxIterations');
  assert.equal(result.snapshot.consumption.iterations, 0);
  assert.equal(isCopySelectionCurrentBest(result.currentBest), true);
  if (!isCopySelectionCurrentBest(result.currentBest)) return;
  assert.equal(result.currentBest.candidate, null);
  assert.equal(runner.physicalAttempts, 0);
});

test('bounded production selection shares one physical attempt budget across correction layers', async () => {
  const runner = new PhysicalAttemptQueueRunner(
    [candidate('限时护理3次'), candidate('门店护理步骤说明')],
    [1, 2],
  );
  const base = unpricedExecutionInput('task-unpriced-shared-budget');
  const input = {
    ...base,
    request: {
      ...base.request,
      boundedExecution: {
        schemaVersion: 'bounded-execution-snapshot/v1' as const,
        maxIterations: 2,
        maxCostCents: 'unset' as const,
        maxWallClockMs: 'unset' as const,
        maxDelegations: 'unset' as const,
        requiredLimits: ['maxIterations' as const],
        consumption: {
          iterations: 0,
          costCents: 0,
          wallClockMs: 0,
          delegations: 0,
        },
        stopReason: null,
        triggeredLimit: null,
      },
    },
  };

  const result = await unpricedPorts(runner).executeAndSelectBounded(input);

  assert.equal(isBoundedExecutionSuspension(result), true);
  if (!isBoundedExecutionSuspension(result)) return;
  assert.equal(isCopySelectionCurrentBest(result.currentBest), true);
  if (!isCopySelectionCurrentBest(result.currentBest)) return;
  assert.equal(result.snapshot.triggeredLimit, 'maxIterations');
  assert.equal(result.snapshot.consumption.iterations, 2);
  assert.ok(result.currentBest.candidate);
  assert.equal(result.currentBest.candidate.title, '限时护理3次');
  assert.equal(runner.physicalAttempts, 2);
  assert.equal(runner.requests.length, 2);
});

const unpricedAllowedNumberCases = [
  '好评率99%',
  '满意度100%',
  '第3次为您服务',
  '每周3次护理',
  '限时优惠项目介绍，好评率99%',
  '限时优惠项目介绍，满意度100%',
  '限时优惠项目介绍，每周3次护理',
  '第3次为您服务，欢迎了解限时优惠项目',
  '限时优惠项目介绍。顾客满意度100%',
  '2026年',
  '第2步',
  '3个',
] as const;

for (const allowed of unpricedAllowedNumberCases) {
  test(`unpriced promotion allows ${allowed}`, async () => {
    const runner = new QueueRunner([
      candidate(allowed),
      candidate('门店护理步骤说明'),
      candidate('三类肤质的日常建议'),
      score(90),
      score(80),
      score(70),
    ]);
    const selection = await unpricedPorts(runner).executeAndSelect(
      unpricedExecutionInput(`task-unpriced-allowed-${allowed}`),
    );

    assert.equal(selection.winner.title, allowed);
  });
}

test('withdrawn identity references stop before any provider request', () => {
  const runner = new QueueRunner([]);
  const ports = new ProductionHarnessStagePorts(
    { create: () => runner },
    {
      async compileAndFreeze() {
        return contextSnapshot();
      },
      async fence(input) {
        return input.context;
      },
    },
    new RecordingDelivery(),
    () => '2026-07-18T00:01:00.000Z',
  );

  assert.throws(
    () =>
      ports.executeAndSelect({
        workflowId: 'task-invalid-identity',
        request: taskInput(),
        context: contextSnapshot(),
        brief: {
          kind: 'copy',
          instructions: 'x'.repeat(80),
          platform: 'xiaohongshu',
          cta: '私信预约',
          factRefs: [],
          assetRefs: [],
          identityRefs: ['marketing_identity:departed-person:2'],
          constraints: [],
        },
      }),
    HarnessIdentityPreflightError,
  );
  assert.equal(runner.requests.length, 0);
});

test('execution assembly drift stops before the structured provider effect', async () => {
  const runner = new QueueRunner([]);
  const ports = new ProductionHarnessStagePorts(
    { create: () => runner },
    {
      async compileAndFreeze() {
        return contextSnapshot();
      },
      async fence(input) {
        return input.context;
      },
    },
    new RecordingDelivery(),
    () => '2026-07-18T00:01:00.000Z',
  );
  const prompts = harnessPromptBundle();
  const promptRevisionRefs = promptRevisionReferences(prompts);
  const request: HarnessWorkflowInput = {
    ...taskInput(),
    prompts,
    promptRevisionRefs,
    frozenRouteSnapshot: {
      id: 'route-pinned',
      catalogRevisionId: 'catalog-pinned',
      capabilityRevisionId: 'capability-pinned',
      requestedSelection: {
        mode: 'fixed',
        catalogModelId: 'model-pinned',
      },
      candidateCatalogModelIds: ['model-pinned'],
      actualCatalogModelId: 'model-pinned',
      deploymentId: 'deployment-pinned',
      reason: 'fixed_selection',
      dataClass: [],
      createdAt: '2026-07-18T00:00:00.000Z',
    },
    executionAssembly: {
      schemaVersion: 'harness-execution-assembly/v1',
      workflowId: 'task-assembly-drift',
      skillStages: {
        intent_naming: [],
        context_injection: [],
        brief_compilation: [],
        execution_selection: [],
        assembly_delivery: [],
      },
      frozenRouteSnapshotDigest: 'drifted-route-digest',
      promptRevisionRefs,
      rootAxes: {
        axisScope: 'task_root',
        skillRevision: { kind: 'absent' },
        promptVersion: { kind: 'absent' },
        catalogRevision: {
          kind: 'bound',
          value: 'catalog-pinned',
        },
        scene: { kind: 'bound', value: 'harness:copy' },
      },
    },
  };

  await assert.rejects(
    () =>
      ports.nameIntent({
        workflowId: 'task-assembly-drift',
        request,
      }),
    /assembly binding does not match the frozen route/i,
  );
  assert.equal(runner.requests.length, 0);
});

test('canonical emitter flattens frozen child axes and uses snapshot catalog authority', async () => {
  const events = new MemoryObservabilityEventAudit();
  const ports = new ProductionHarnessStagePorts(
    { create: () => new QueueRunner([]) },
    {
      async compileAndFreeze() {
        return contextSnapshot();
      },
      async fence(input) {
        return input.context;
      },
    },
    new RecordingDelivery(),
    () => '2026-07-18T00:01:00.000Z',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    events,
  );
  const request = taskInputWithExecutionAssembly('task-canonical');
  request.executionAssembly!.skillStages.execution_selection = [
    {
      skillRevisionRef: 'skill.selection@3',
      contentHash: 'hash-selection',
      requiredModelCapabilities: [],
    },
  ];

  await ports.recordObservabilityEvent({
    workflowId: 'task-canonical',
    request,
    idempotencyKey: 'bounded:task-canonical:0:suspended',
    event: {
      eventType: 'bounded_execution.suspended',
      payload: {
        snapshot: {
          schemaVersion: 'bounded-execution-snapshot/v1',
          maxIterations: 1,
          maxCostCents: 'unset',
          maxWallClockMs: 'unset',
          maxDelegations: 'unset',
          requiredLimits: ['maxIterations'],
          consumption: {
            iterations: 1,
            costCents: 0,
            wallClockMs: 0,
            delegations: 0,
          },
          stopReason: 'limit_reached',
          triggeredLimit: 'maxIterations',
        },
        currentBest: { candidateId: 'candidate-1' },
        unmetExplanation: 'One more iteration is required.',
        resumable: true,
      },
    },
    promptKey: 'copyCandidate',
  });

  const [event] = events.list(request.workspaceId);
  assert.equal(event?.eventType, 'bounded_execution.suspended');
  assert.equal(event?.axisScope, 'execution_child');
  assert.equal(event?.skillRevision, 'skill.selection@3');
  assert.equal(
    event?.promptVersion,
    `${request.promptRevisionRefs!.copyCandidate!.name}@${request.promptRevisionRefs!.copyCandidate!.version}`,
  );
  assert.equal(
    event?.catalogRevision,
    request.executionSnapshot!.catalogModel.revision,
  );
});

test('a legacy request without execution assembly cannot start structured generation', async () => {
  const runner = new QueueRunner([
    {
      normalizedIntent: '制作团购文案',
      taskType: 'promotion_groupbuy_conversion',
      deliveryLayer: 'copy',
      relevantAssetCategories: ['promotion_activity'],
      usedAssetCategories: ['promotion_activity'],
      route: 'customized',
      implicitConstraints: [],
      blockingGap: null,
    },
  ]);
  const ports = new ProductionHarnessStagePorts(
    { create: () => runner },
    {
      async compileAndFreeze() {
        return contextSnapshot();
      },
      async fence(input) {
        return input.context;
      },
    },
    new RecordingDelivery(),
    () => '2026-07-18T00:01:00.000Z',
  );

  await assert.rejects(
    () =>
      ports.nameIntent({
        workflowId: 'task-legacy-generation',
        request: taskInputWithFrozenRoute('task-legacy-generation', 'copy'),
      }),
    /execution assembly is required before provider execution/i,
  );
  assert.equal(runner.requests.length, 0);
});

test('structured provider child lifecycle uses frozen single-value axes', async () => {
  const runner = new QueueRunner([
    {
      normalizedIntent: '制作团购文案',
      taskType: 'promotion_groupbuy_conversion',
      deliveryLayer: 'copy',
      relevantAssetCategories: ['promotion_activity'],
      usedAssetCategories: ['promotion_activity'],
      route: 'customized',
      implicitConstraints: [],
      blockingGap: null,
    },
  ]);
  const audit = new MemoryObservabilityEventAudit();
  const observer = new AgentPrimitiveObservabilityAdapter(audit, {
    resolve() {
      return { kind: 'not_billed' };
    },
  });
  const ports = new ProductionHarnessStagePorts(
    { create: () => runner },
    {
      async compileAndFreeze() {
        return contextSnapshot();
      },
      async fence(input) {
        return input.context;
      },
    },
    new RecordingDelivery(),
    () => '2026-07-18T00:01:00.000Z',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      create() {
        return observer;
      },
    },
  );

  const request = taskInputWithExecutionAssembly('task-child-axes');
  const effectiveSkill = {
    skillRevisionRef: 'skill.intent@2',
    instruction: 'Use the frozen Skill prompt.',
    contentHash: 'hash-skill-intent',
    requiredModelCapabilities: [],
    executionMode: 'prompt_materialized' as const,
    prompt: {
      name: 'skill/intent-prompt',
      version: '7',
      contentHash: 'hash-skill-prompt',
      isFallback: false,
    },
    promptContent: 'Frozen Skill intent prompt.',
  };
  request.executionAssembly!.skillStages.intent_naming[0] = {
    ...request.executionAssembly!.skillStages.intent_naming[0]!,
    resolvedInstruction: effectiveSkill,
  };
  request.executionAssembly!.frozenRouteSnapshotDigest = fingerprintValue(
    request.frozenRouteSnapshot,
  );
  await ports.nameIntent({
    workflowId: 'task-child-axes',
    request,
    skillInstructions: [effectiveSkill],
  });

  assert.equal(runner.requests.length, 1);
  const events = audit.list('workspace-1');
  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map((event) => {
      assert.equal(event.eventType, 'agent_primitive.lifecycle');
      if (event.eventType !== 'agent_primitive.lifecycle') {
        throw new Error('Expected agent primitive lifecycle event.');
      }
      return {
        phase: event.payload.phase,
        axisScope: event.axisScope,
        skillRevision: event.skillRevision,
        promptVersion: event.promptVersion,
        catalogRevision: event.catalogRevision,
        scene: event.scene,
      };
    }),
    [
      {
        phase: 'invoked',
        axisScope: 'execution_child',
        skillRevision: 'skill.intent@2',
        promptVersion: 'skill/intent-prompt@7',
        catalogRevision: 'model-r1',
        scene: 'harness:copy',
      },
      {
        phase: 'succeeded',
        axisScope: 'execution_child',
        skillRevision: 'skill.intent@2',
        promptVersion: 'skill/intent-prompt@7',
        catalogRevision: 'model-r1',
        scene: 'harness:copy',
      },
    ],
  );
});

test('copy selection awaits the additive primitive check with frozen child axes', async () => {
  const runner = new QueueRunner([
    candidate('门店护理建议'),
  ]);
  const audit = new MemoryObservabilityEventAudit();
  const observer = new AgentPrimitiveObservabilityAdapter(audit, {
    resolve() {
      return { kind: 'not_billed' };
    },
  });
  const checks: unknown[] = [];
  const ports = new ProductionHarnessStagePorts(
    { create: () => runner },
    {
      async compileAndFreeze() {
        return contextSnapshot();
      },
      async fence(input) {
        return input.context;
      },
    },
    new RecordingDelivery(),
    () => '2026-07-18T00:01:00.000Z',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      create() {
        return observer;
      },
    },
    {
      async execute(input) {
        checks.push(structuredClone(input));
        return {
          allowed: true,
          status: 'passed' as const,
          strategy: 'block' as const,
          violations: [],
        };
      },
    },
  );
  const workflowId = 'task-additive-primitive-check';
  const request = taskInputWithExecutionAssembly(workflowId);
  const context = contextSnapshot();
  context.policyReferences.identityRefs = [
    {
      id: 'marketing_identity:identity-1:identity-r1',
      workspaceId: request.workspaceId,
      status: 'registered',
    },
  ];

  const result = await ports.executeAndSelect({
    workflowId,
    request,
    context,
    brief: {
      kind: 'copy',
      instructions: 'x'.repeat(80),
      platform: 'xiaohongshu',
      cta: '私信预约',
      factRefs: [],
      assetRefs: [],
      identityRefs: ['marketing_identity:identity-1:identity-r1'],
      constraints: [],
    },
  });

  assert.equal(result.winner.title, '门店护理建议');
  assert.equal(checks.length, 1);
  assert.deepEqual(checks[0], {
    correlationId: `wf:${workflowId}:s4:agent-check`,
    observability: {
      axisScope: 'execution_child',
      skillRevision: { kind: 'absent' },
      promptVersion: {
        kind: 'bound',
        value: 'harness/copyCandidate@11',
      },
      catalogRevision: { kind: 'bound', value: 'model-r1' },
      scene: { kind: 'bound', value: 'harness:copy' },
    },
    policyInput: {
      phase: 'execution',
      bundle: {
        workspaceId: request.workspaceId,
        revision: context.bundle.revision,
      },
      brief: {
        kind: 'copy',
        instructions: 'x'.repeat(80),
        platform: 'xiaohongshu',
        cta: '私信预约',
        factRefs: [],
        assetRefs: [],
        identityRefs: ['marketing_identity:identity-1:identity-r1'],
        constraints: [],
      },
      candidate: result.winner,
      ...context.policyReferences,
    },
    taskId: workflowId,
    workflowId,
    workflowRevision: request.workflowRevision,
    workspaceId: request.workspaceId,
  });
});

test('an additive primitive check violation blocks the selected candidate', async () => {
  const runner = new QueueRunner([candidate('门店护理建议')]);
  const observer = new AgentPrimitiveObservabilityAdapter(
    new MemoryObservabilityEventAudit(),
    {
      resolve() {
        return { kind: 'not_billed' };
      },
    },
  );
  const ports = new ProductionHarnessStagePorts(
    { create: () => runner },
    {
      async compileAndFreeze() {
        return contextSnapshot();
      },
      async fence(input) {
        return input.context;
      },
    },
    new RecordingDelivery(),
    () => '2026-07-18T00:01:00.000Z',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { create: () => observer },
    {
      async execute() {
        return {
          allowed: false,
          status: 'blocked' as const,
          strategy: 'block' as const,
          violations: [
            {
              alternativePath: ['重新核验当前门店事实'],
              gateId: 'critical_fact_source' as const,
              reason: '候选使用了未经核验的关键事实。',
            },
          ],
        };
      },
    },
  );
  const workflowId = 'task-blocked-additive-check';
  const request = taskInputWithExecutionAssembly(workflowId);
  const context = contextSnapshot();
  context.policyReferences.identityRefs = [
    {
      id: 'marketing_identity:identity-1:identity-r1',
      workspaceId: request.workspaceId,
      status: 'registered',
    },
  ];

  await assert.rejects(
    ports.executeAndSelect({
      workflowId,
      request,
      context,
      brief: {
        kind: 'copy',
        instructions: 'x'.repeat(80),
        platform: 'xiaohongshu',
        cta: '私信预约',
        factRefs: [],
        assetRefs: [],
        identityRefs: ['marketing_identity:identity-1:identity-r1'],
        constraints: [],
      },
    }),
    (error: unknown) =>
      error instanceof HarnessSelectionError &&
      error.gateIds[0] === 'critical_fact_source' &&
      error.alternativePaths[0] === '重新核验当前门店事实',
  );
  assert.equal(runner.requests.length, 1);
});

test('copy self-correction uses the injected primitive candidate runner', async () => {
  const runner = new QueueRunner([
    candidate('99元护理体验'),
    candidate('门店护理建议'),
  ]);
  const observer = new AgentPrimitiveObservabilityAdapter(
    new MemoryObservabilityEventAudit(),
    {
      resolve() {
        return { kind: 'not_billed' };
      },
    },
  );
  const wraps: unknown[] = [];
  const primitiveRuns: string[] = [];
  const ports = new ProductionHarnessStagePorts(
    { create: () => runner },
    {
      async compileAndFreeze() {
        return contextSnapshot();
      },
      async fence(input) {
        return input.context;
      },
    },
    new RecordingDelivery(),
    () => '2026-07-18T00:01:00.000Z',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { create: () => observer },
    undefined,
    {
      wrap(input) {
        const { runner: activeRunner, ...metadata } = input;
        wraps.push(structuredClone(metadata));
        return {
          run(request) {
            primitiveRuns.push(request.effectIdempotencyKey);
            return activeRunner.run(request);
          },
        };
      },
    },
  );
  const workflowId = 'task-primitive-candidate-runner';
  const request = taskInputWithExecutionAssembly(workflowId);
  request.boundedExecution = {
    schemaVersion: 'bounded-execution-snapshot/v1',
    maxIterations: 2,
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
  };
  const context = contextSnapshot();
  context.policyReferences.identityRefs = [
    {
      id: 'marketing_identity:identity-1:identity-r1',
      workspaceId: request.workspaceId,
      status: 'registered',
    },
  ];

  const result = await ports.executeAndSelectBounded({
    workflowId,
    request,
    context,
    brief: {
      kind: 'copy',
      instructions: 'x'.repeat(80),
      platform: 'xiaohongshu',
      cta: '私信预约',
      factRefs: [],
      assetRefs: [],
      identityRefs: ['marketing_identity:identity-1:identity-r1'],
      constraints: [],
    },
  });

  assert.equal('state' in result, false);
  if ('state' in result) throw new Error('Expected a completed selection.');
  assert.equal(result.winner.title, '门店护理建议');
  assert.equal(wraps.length, 1);
  assert.deepEqual(wraps[0], {
    billing: {
      productUsageTaskId: workflowId,
      quoteId: request.executionSnapshot!.quote.id,
    },
    boundedExecution: request.boundedExecution,
    observability: {
      axisScope: 'execution_child',
      skillRevision: { kind: 'absent' },
      promptVersion: {
        kind: 'bound',
        value: 'harness/copyCandidate@11',
      },
      catalogRevision: { kind: 'bound', value: 'model-r1' },
      scene: { kind: 'bound', value: 'harness:copy' },
    },
    taskId: workflowId,
    workspaceId: request.workspaceId,
  });
  assert.equal(primitiveRuns.length, 2);
  assert.equal(runner.requests.length, 2);
});

test('bounded copy resume passes the durable candidate fence to the primitive runner', async () => {
  const runner = new PhysicalAttemptQueueRunner(
    [candidate('99元护理体验'), candidate('门店护理建议')],
    [2, 1],
  );
  const observer = new AgentPrimitiveObservabilityAdapter(
    new MemoryObservabilityEventAudit(),
    { resolve: () => ({ kind: 'not_billed' }) },
  );
  const workflowId = 'task-primitive-candidate-resume';
  const request = taskInputWithExecutionAssembly(workflowId);
  request.boundedExecution = {
    schemaVersion: 'bounded-execution-snapshot/v1',
    maxIterations: 2,
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
  };
  const context = contextSnapshot();
  context.policyReferences.identityRefs = [
    {
      id: 'marketing_identity:identity-1:identity-r1',
      workspaceId: request.workspaceId,
      status: 'registered',
    },
  ];
  const input = {
    workflowId,
    request,
    context,
    brief: {
      kind: 'copy' as const,
      instructions: 'x'.repeat(80),
      platform: 'xiaohongshu' as const,
      cta: '私信预约',
      factRefs: [],
      assetRefs: [],
      identityRefs: ['marketing_identity:identity-1:identity-r1'],
      constraints: [],
    },
  };
  const createPorts = (
    candidateFactory?: ConstructorParameters<
      typeof ProductionHarnessStagePorts
    >[12],
  ) =>
    new ProductionHarnessStagePorts(
      { create: () => runner },
      {
        async compileAndFreeze() {
          return contextSnapshot();
        },
        async fence(value) {
          return value.context;
        },
      },
      new RecordingDelivery(),
      () => '2026-07-18T00:01:00.000Z',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { create: () => observer },
      undefined,
      candidateFactory,
    );

  const suspended = await createPorts().executeAndSelectBounded(input);
  assert.equal(isBoundedExecutionSuspension(suspended), true);
  if (!isBoundedExecutionSuspension(suspended)) return;
  const firstEffectIdempotencyKey =
    runner.requests[0]?.effectIdempotencyKey;
  assert.ok(firstEffectIdempotencyKey);
  const wraps: unknown[] = [];
  const resumed = await createPorts({
    wrap(factoryInput) {
      const { runner: activeRunner, ...metadata } = factoryInput;
      wraps.push(structuredClone(metadata));
      return activeRunner;
    },
  }).executeAndSelectBounded({
    ...input,
    request: {
      ...request,
      boundedExecution: resumeWithRaisedServerLimit(suspended.snapshot, {
        limit: 'maxIterations',
        value: 3,
      }),
    },
    boundedResume: suspended,
  });

  assert.equal(isBoundedExecutionSuspension(resumed), false);
  if (isBoundedExecutionSuspension(resumed)) return;
  assert.equal(resumed.winner.title, '门店护理建议');
  assert.deepEqual(
    (wraps[0] as { resumeCandidate?: unknown }).resumeCandidate,
    {
      revision: 1,
      sourceEffectIdempotencyKey: firstEffectIdempotencyKey,
    },
  );
  assert.equal(runner.requests.length, 2);
});

test('a succeeded audit failure does not rewrite a successful structured provider as rejected', async () => {
  const phases: string[] = [];
  const runner = new QueueRunner([
    {
      normalizedIntent: '制作团购文案',
      taskType: 'promotion_groupbuy_conversion',
      deliveryLayer: 'copy',
      relevantAssetCategories: ['promotion_activity'],
      usedAssetCategories: ['promotion_activity'],
      route: 'customized',
      implicitConstraints: [],
      blockingGap: null,
    },
  ]);
  const observer = new AgentPrimitiveObservabilityAdapter(
    {
      append(_workspaceId, event) {
        assert.equal(event.eventType, 'agent_primitive.lifecycle');
        if (event.eventType !== 'agent_primitive.lifecycle') {
          throw new Error('Expected agent primitive lifecycle event.');
        }
        phases.push(event.payload.phase);
        if (event.payload.phase === 'succeeded') {
          throw new Error('terminal audit unavailable');
        }
        return event;
      },
    },
    { resolve: () => ({ kind: 'not_billed' }) },
  );
  const ports = new ProductionHarnessStagePorts(
    { create: () => runner },
    {
      async compileAndFreeze() {
        return contextSnapshot();
      },
      async fence(input) {
        return input.context;
      },
    },
    new RecordingDelivery(),
    () => '2026-07-18T00:01:00.000Z',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      create() {
        return observer;
      },
    },
  );

  await assert.rejects(
    () =>
      ports.nameIntent({
        workflowId: 'task-structured-audit-failure',
        request: taskInputWithExecutionAssembly(
          'task-structured-audit-failure',
        ),
      }),
    /terminal audit unavailable/u,
  );
  assert.deepEqual(phases, ['invoked', 'succeeded']);
});

test('structured controller receives the frozen route only for copy work', async () => {
  const runner = new QueueRunner([
    {
      normalizedIntent: '制作团购文案',
      taskType: 'promotion_groupbuy_conversion',
      deliveryLayer: 'copy',
      relevantAssetCategories: ['promotion_activity'],
      usedAssetCategories: ['promotion_activity'],
      route: 'customized',
      implicitConstraints: [],
      blockingGap: null,
    },
    {
      normalizedIntent: '制作团购图片',
      taskType: 'promotion_groupbuy_conversion',
      deliveryLayer: 'finished_media',
      relevantAssetCategories: ['promotion_activity'],
      usedAssetCategories: ['promotion_activity'],
      route: 'customized',
      implicitConstraints: [],
      blockingGap: null,
    },
    {
      normalizedIntent: '制作团购视频',
      taskType: 'promotion_groupbuy_conversion',
      deliveryLayer: 'finished_media',
      relevantAssetCategories: ['promotion_activity'],
      usedAssetCategories: ['promotion_activity'],
      route: 'customized',
      implicitConstraints: [],
      blockingGap: null,
    },
  ]);
  const receivedRouteIds: Array<string | null> = [];
  const observer = new AgentPrimitiveObservabilityAdapter(
    new MemoryObservabilityEventAudit(),
    { resolve: () => ({ kind: 'not_billed' }) },
  );
  const ports = new ProductionHarnessStagePorts(
    {
      create(input) {
        receivedRouteIds.push(input.frozenRouteSnapshot?.id ?? null);
        return runner;
      },
    },
    {
      async compileAndFreeze() {
        return contextSnapshot();
      },
      async fence(input) {
        return input.context;
      },
    },
    new RecordingDelivery(),
    () => '2026-07-18T00:01:00.000Z',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      create() {
        return observer;
      },
    },
  );

  await ports.nameIntent({
    workflowId: 'task-copy-controller',
    request: taskInputWithExecutionAssembly('task-copy-controller', 'copy'),
  });
  await ports.nameIntent({
    workflowId: 'task-image-controller',
    request: taskInputWithExecutionAssembly('task-image-controller', 'image'),
  });
  await ports.nameIntent({
    workflowId: 'task-video-controller',
    request: taskInputWithExecutionAssembly('task-video-controller', 'video'),
  });

  assert.deepEqual(receivedRouteIds, ['route-pinned', null, null]);
});

test('media structured controller child lifecycle uses snapshot catalog authority', async () => {
  const runner = new QueueRunner([
    {
      normalizedIntent: '制作团购图片',
      taskType: 'promotion_groupbuy_conversion',
      deliveryLayer: 'finished_media',
      relevantAssetCategories: ['promotion_activity'],
      usedAssetCategories: ['promotion_activity'],
      route: 'customized',
      implicitConstraints: [],
      blockingGap: null,
    },
  ]);
  const audit = new MemoryObservabilityEventAudit();
  const observer = new AgentPrimitiveObservabilityAdapter(audit, {
    resolve() {
      return { kind: 'not_billed' };
    },
  });
  const ports = new ProductionHarnessStagePorts(
    { create: () => runner },
    {
      async compileAndFreeze() {
        return contextSnapshot();
      },
      async fence(input) {
        return input.context;
      },
    },
    new RecordingDelivery(),
    () => '2026-07-18T00:01:00.000Z',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      create() {
        return observer;
      },
    },
  );

  await ports.nameIntent({
    workflowId: 'task-media-child-axes',
    request: taskInputWithExecutionAssembly('task-media-child-axes', 'image'),
  });

  assert.deepEqual(
    audit.list('workspace-1').map((event) => event.catalogRevision),
    ['model-r1', 'model-r1'],
  );
});

class QueueRunner implements StructuredNodeRunner {
  readonly requests: StructuredNodeRunnerRequest<unknown>[] = [];

  constructor(private readonly outputs: unknown[]) {}

  async run<Output>(request: StructuredNodeRunnerRequest<Output>) {
    this.requests.push(request as StructuredNodeRunnerRequest<unknown>);
    await request.beforeProviderAttempt?.();
    return {
      output: request.schema.parse(this.outputs.shift()),
      attempts: 1,
      providerTaskRef: `provider-${this.requests.length}`,
      replayed: false,
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }
}

class PhysicalAttemptQueueRunner implements StructuredNodeRunner {
  readonly requests: StructuredNodeRunnerRequest<unknown>[] = [];
  physicalAttempts = 0;

  constructor(
    private readonly outputs: unknown[],
    private readonly attemptsPerRun: number[],
  ) {}

  async run<Output>(request: StructuredNodeRunnerRequest<Output>) {
    this.requests.push(request as StructuredNodeRunnerRequest<unknown>);
    const attempts = this.attemptsPerRun.shift() ?? 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await request.beforeProviderAttempt?.();
      this.physicalAttempts += 1;
    }
    return {
      output: request.schema.parse(this.outputs.shift()),
      attempts,
      providerTaskRef: `provider-${this.requests.length}`,
      replayed: false,
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }
}

class FallbackFenceRunner implements StructuredNodeRunner {
  fenceCalls = 0;
  providerAttempts = 0;

  constructor(private readonly afterFirstProviderAttempt: () => void) {}

  async run<Output>(request: StructuredNodeRunnerRequest<Output>) {
    const fence = request.beforeProviderAttempt;
    if (!fence)
      throw new Error('Expected source fence before provider attempt.');
    this.fenceCalls += 1;
    await fence();
    this.providerAttempts += 1;
    this.afterFirstProviderAttempt();
    this.fenceCalls += 1;
    await fence();
    this.providerAttempts += 1;
    return {
      output: request.schema.parse({}),
      attempts: this.providerAttempts,
      providerTaskRef: 'provider-fallback',
      replayed: false,
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }
}

class RecordingDelivery implements HarnessCopyDeliveryPort {
  readonly inputs: Array<
    Parameters<HarnessCopyDeliveryPort['deliverCopyRevision']>[0]
  > = [];

  async deliverCopyRevision(
    input: Parameters<HarnessCopyDeliveryPort['deliverCopyRevision']>[0],
  ) {
    this.inputs.push(input);
    return { packageId: input.packageId, versionId: 'version-3', revision: 3 };
  }
}

class RecordingRevisionWriter {
  readonly inputs: ContentPackageRevisionWriteInput[] = [];

  async write(input: ContentPackageRevisionWriteInput) {
    this.inputs.push(structuredClone(input));
    return {
      packageId: input.packageId,
      revision: input.expectedRevision + 1,
      versionId: input.version.id,
    };
  }
}

type CandidateFixture = {
  title: string;
  body: string;
  conversionHook: string;
  factClaims: Array<{
    kind: 'price' | 'benefit' | 'qualification' | 'offer' | 'other';
    value: string;
    sourceRef?: string;
  }>;
  assetRefs: string[];
};

function candidate(
  title: string,
  overrides: Partial<CandidateFixture> = {},
): CandidateFixture {
  return {
    title,
    body: `${title} 正文`,
    conversionHook: '私信预约',
    factClaims: [],
    assetRefs: [],
    ...overrides,
  };
}

async function assertUnpricedCandidateBlocked(output: CandidateFixture) {
  const runner = new QueueRunner([
    structuredClone(output),
    structuredClone(output),
    structuredClone(output),
  ]);

  await assert.rejects(
    unpricedPorts(runner).executeAndSelect(
      unpricedExecutionInput(`task-unpriced-${runner.requests.length}`),
    ),
    /Every generated candidate was blocked/u,
  );
  assert.equal(runner.requests.length, 2);
}

function unpricedPorts(runner: StructuredNodeRunner) {
  return new ProductionHarnessStagePorts(
    { create: () => runner },
    {
      async compileAndFreeze() {
        return contextSnapshot();
      },
      async fence(input) {
        return input.context;
      },
    },
    new RecordingDelivery(),
    () => '2026-07-18T00:01:00.000Z',
  );
}

function unpricedExecutionInput(workflowId: string) {
  return {
    workflowId,
    request: taskInput(),
    context: contextSnapshot(),
    brief: {
      kind: 'copy' as const,
      instructions: 'x'.repeat(80),
      platform: 'xiaohongshu' as const,
      cta: '私信了解当期信息',
      factRefs: [],
      assetRefs: [],
      identityRefs: [],
      constraints: ['无已核验价格时不得使用具体优惠数字'],
    },
  };
}

function score(value: number) {
  return {
    score: value,
    dimensions: { grounding: 1, usefulness: 1, platformFit: 1 },
    reason: '固定评分',
  };
}

function contextSnapshot(): HarnessContextSnapshot {
  return {
    bundle: {
      bundleId: 'bundle-1',
      revision: 1,
      hash: 'a'.repeat(64),
      serializerVersion: 'context-bundle-c14n-v1' as const,
      workspaceId: 'workspace-1',
      taskId: 'task-production',
      frozenAt: '2026-07-18T00:00:00.000Z',
      frozenBy: 'owner-1',
      previousRevision: null,
      referencedFactRevisions: [],
      sourceRevisions: {
        facts: 1,
        assets: 1,
        identity: 1,
        rights: 1,
        preferences: 1,
        recipe: 1,
        platformRules: 1,
        currentSignal: 1,
      },
      dimensions: {
        promotion_task: {
          task_type: {
            value: 'promotion_groupbuy_conversion',
            layer: 'current_instruction' as const,
            pool: 'current_signal' as const,
            sourceRef: 'task:task-production:intent',
          },
        },
        traffic_opportunity: {},
        expression_identity: {},
        platform_mechanism: {},
        store_facts_assets: {},
        conversion_action: {},
      },
    },
    policyReferences: { sourceRefs: [], rightsRefs: [], identityRefs: [] },
  };
}

function factContribution(
  factId: string,
  kind: 'service' | 'price',
  value: string | number,
) {
  return {
    value,
    layer: 'current_fact' as const,
    pool: 'store_personal' as const,
    sourceRef: `store_fact:${factId}:1`,
    factSnapshot: {
      factId,
      kind,
      revision: 1,
      source: {
        kind: 'user_confirmation' as const,
        referenceId: `confirmation-${factId}`,
        capturedAt: '2026-07-18T00:00:00.000Z',
      },
      effectiveFrom: '2026-07-18T00:00:00.000Z',
      expiresAt: null,
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

function taskInputWithExecutionAssembly(
  workflowId: string,
  lens: 'copy' | 'image' | 'video' = 'copy',
): HarnessWorkflowInput {
  const prompts = harnessPromptBundle();
  const promptRevisionRefs = promptRevisionReferences(prompts);
  const snapshot = composerSnapshot();
  const frozenRouteSnapshot = {
    id: 'route-pinned',
    catalogRevisionId: 'catalog-pinned',
    capabilityRevisionId: 'capability-pinned',
    requestedSelection: {
      mode: 'fixed' as const,
      catalogModelId: 'model-pinned',
    },
    candidateCatalogModelIds: ['model-pinned'],
    actualCatalogModelId: 'model-pinned',
    deploymentId: 'deployment-pinned',
    reason: 'fixed_selection' as const,
    dataClass: [],
    createdAt: '2026-07-18T00:00:00.000Z',
  };
  return {
    ...taskInput(),
    prompts,
    promptRevisionRefs,
    executionSnapshot: {
      ...snapshot,
      task: { id: workflowId },
      lens,
      operation:
        lens === 'copy'
          ? 'copy.generate'
          : lens === 'image'
            ? 'image.generate'
            : 'video.generate',
    },
    frozenRouteSnapshot,
    executionAssembly: {
      schemaVersion: 'harness-execution-assembly/v1',
      workflowId,
      skillStages: {
        intent_naming: [
          {
            skillRevisionRef: 'skill.intent@2',
            contentHash: 'hash-skill-intent',
            requiredModelCapabilities: [],
          },
        ],
        context_injection: [],
        brief_compilation: [],
        execution_selection: [],
        assembly_delivery: [],
      },
      frozenRouteSnapshotDigest: fingerprintValue(frozenRouteSnapshot),
      promptRevisionRefs,
      rootAxes: {
        axisScope: 'task_root',
        skillRevision: {
          kind: 'bound',
          value: 'skill.intent@2',
        },
        promptVersion: { kind: 'absent' },
        catalogRevision: {
          kind: 'bound',
          value: 'catalog-pinned',
        },
        scene: { kind: 'bound', value: `harness:${lens}` },
      },
    },
  };
}

function taskInputWithFrozenRoute(
  workflowId: string,
  lens: 'copy' | 'image' | 'video',
): HarnessWorkflowInput {
  const request = taskInputWithExecutionAssembly(workflowId, lens);
  return {
    ...request,
    executionAssembly: undefined,
  };
}

function harnessPromptBundle(): HarnessFrozenPrompts {
  const keys = [
    'intentNaming',
    'briefCompilation',
    'briefImage',
    'briefVideo',
    'factSatisfaction',
    'factCriticality',
    'copyCandidate',
    'notePlan',
    'noteTextBlock',
    'noteConsistency',
    'destinationMapping',
    'copyGeneration',
    'platformAdaptation',
    'textResponse',
  ] as const;
  return Object.fromEntries(
    keys.map((key) => [
      key,
      {
        name: `harness/${key}`,
        version: '11',
        content: `frozen:${key}`,
        contentHash: '1'.repeat(64),
        label: 'production',
        source: 'langfuse',
        isFallback: false,
      },
    ]),
  ) as HarnessFrozenPrompts;
}

function contextWithSourcePackage(): HarnessContextSnapshot {
  const context = contextSnapshot();
  const source = sourceContentPackageProjection();
  const sourceRef = `content_package:${source.reference.id}:${source.reference.revision}`;
  context.bundle.dimensions.store_facts_assets.source_content_package_structure =
    {
      value: {
        packageId: source.reference.id,
        revision: source.reference.revision,
        ...source.structure,
      },
      layer: 'current_instruction',
      pool: 'current_signal',
      sourceRef,
    };
  context.bundle.dimensions.store_facts_assets.source_content_package_assets = {
    value: {
      packageId: source.reference.id,
      revision: source.reference.revision,
      assets: source.assets.filter((asset) => asset.role === 'selected'),
    },
    layer: 'current_instruction',
    pool: 'current_signal',
    sourceRef,
  };
  context.bundle.dimensions.platform_mechanism.source_content_package_style = {
    value: {
      packageId: source.reference.id,
      revision: source.reference.revision,
      ...source.style,
    },
    layer: 'current_instruction',
    pool: 'current_signal',
    sourceRef,
  };
  context.policyReferences.rightsRefs = [
    {
      assetId: 'selected-asset-1',
      workspaceId: 'workspace-1',
      status: 'authorized',
      allowedUses: ['public_content'],
    },
  ];
  context.policyReferences.identityRefs = [
    {
      id: 'marketing_identity:identity-1:identity-r1',
      workspaceId: 'workspace-1',
      status: 'registered',
    },
  ];
  return context;
}

function sourceContentPackageProjection() {
  return {
    reference: { id: 'source-package-1', revision: '3' },
    structure: {
      slots: ['headline', 'body', 'conversion_hook'] as Array<
        'headline' | 'body' | 'conversion_hook'
      >,
    },
    style: {
      kind: 'image_text' as const,
      sourcePlatform: 'xiaohongshu' as const,
    },
    assets: [
      { id: 'source-asset-1', role: 'source' as const },
      { id: 'selected-asset-1', role: 'selected' as const },
    ],
  };
}

function selectionFixture() {
  return {
    candidates: [
      {
        candidateId: 'candidate-1',
        title: '候选一',
        body: '候选一正文',
        conversionHook: '私信了解',
        score: 91,
      },
    ],
    winner: {
      candidateId: 'candidate-1',
      title: '候选一',
      body: '候选一正文',
      conversionHook: '私信了解',
    },
    trace: {} as never,
  };
}

function composerSnapshot(sourceContentPackage?: {
  id: string;
  revision: string;
}) {
  return createCreationExecutionSnapshot(
    {
      actorId: 'owner-1',
      workspaceId: 'workspace-1',
      idempotencyKey: 'composer-key-1',
      taskId: 'task-production',
      workId: 'work-1',
      contentPackageId: 'package-1',
      expectedContentPackageRevision: 0,
      creationMode: 'customized',
      intent: '请为小红书写一条护理预约文案，但结构化平台实际选择抖音。',
      surface: { id: 'surface-1', revision: 'surface-r1' },
      recipe: { id: 'recipe-1', revision: 'recipe-r1' },
      lens: 'copy',
      platform: { id: 'douyin' },
      deliverables: [
        { id: 'copy-primary', kind: 'copy', quantity: 1, order: 1 },
      ],
      sources: {
        assets: [{ id: 'asset-1', revision: 'asset-r1', role: 'reference' }],
        ...(sourceContentPackage
          ? { contentPackage: sourceContentPackage }
          : {}),
      },
      rights: { revision: 'rights-r1', summary: 'authorized source assets' },
      identity: { id: 'identity-1', revision: 'identity-r1' },
      modelPolicy: { id: 'policy-1', revision: 'policy-r1', mode: 'fixed' },
      catalogModel: { id: 'model-1', revision: 'model-r1' },
      quote: { id: 'quote-1', revision: 'quote-r1' },
      route: { id: 'route-1', revision: 'route-r1' },
      briefConfirmation: { id: 'brief-1', revision: 'brief-r1' },
      briefContext: { id: 'brief-context-1', revision: 1 },
      contentModules: ['social_cover'],
    },
    '2026-07-22T09:00:00.000Z',
  );
}

function composerRequest(snapshot: ReturnType<typeof composerSnapshot>) {
  return {
    ...taskInput(),
    packageId: snapshot.contentPackage.id,
    expectedRevision: snapshot.contentPackage.expectedRevision,
    workflowRevision: snapshot.revision,
    executionSnapshot: snapshot,
  };
}
