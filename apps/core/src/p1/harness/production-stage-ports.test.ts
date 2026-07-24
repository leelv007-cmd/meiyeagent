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
import { createCreationExecutionSnapshot } from '../execution-spine/creation-execution-snapshot.js';
import type {
  StructuredNodeRunner,
  StructuredNodeRunnerRequest,
} from '../model-supply/structured-node-runner.js';

test('production tracer rejects a finished-media intent before execution', async () => {
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

  await assert.rejects(
    ports.nameIntent({ workflowId: 'task-media', request: taskInput() }),
    /copy delivery layer/u,
  );
  assert.equal(delivery.inputs.length, 0);
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
  assert.equal(
    await ports.injectContext({ ...input, declaration: named.declaration }),
    snapshot,
  );
  assert.equal(contextRequests, 2);
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
  assert.equal(named.blockingQuestion?.questionId, 'task-ambiguous-price:s1:offer_price');
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
  });

  assert.equal(result.brief.platform, 'douyin');
  assert.deepEqual(result.brief.identityRefs, [
    'marketing_identity:identity-1:identity-r1',
  ]);
  const prompt = JSON.parse(runner.requests[0]?.prompt ?? '{}');
  assert.equal(prompt.executionContract.platform.id, 'douyin');
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
  );
  const snapshot = composerSnapshot();

  const delivery = await ports.assembleAndDeliver({
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

  assert.deepEqual(delivery, {
    packageId: 'package-1',
    revision: 1,
    versionId: executionDelivery.inputs[0]?.version.id,
  });
  assert.equal(legacyDelivery.inputs.length, 0);
  assert.equal(executionDelivery.inputs.length, 1);
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
    assetIds: [],
    childRuns: [],
  });
  assert.deepEqual(executionDelivery.inputs[0]?.harnessSelection, {
    recommendedCandidateId: 'candidate-1',
  });
  assert.deepEqual(executionDelivery.inputs[0]?.version.orderedAssetIds, ['asset-1']);
  assert.deepEqual(
    executionDelivery.inputs[0]?.additionalVersions?.map(
      (version) => version.harnessCandidateId,
    ),
    ['candidate-2'],
  );
});

test('a source ContentPackage enters the Copy Brief and fails closed after revocation', async () => {
  const source = { id: 'source-package-1', revision: '3' };
  let available = true;
  const runner = new QueueRunner([
    {
      kind: 'copy',
      instructions: '请基于已确认旧内容的结构和风格，写一条适合新平台的预约文案。'.repeat(3),
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
        if (!available) throw new SourceContentPackageUnavailableError(input.source!);
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
    prompt.bundle.dimensions.store_facts_assets.source_content_package_structure.value,
    {
      packageId: source.id,
      revision: source.revision,
      ...sourceContentPackageProjection().structure,
    },
  );
  assert.deepEqual(
    prompt.bundle.dimensions.store_facts_assets.source_content_package_assets.value,
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
      instructions: '请只使用已选择且仍有授权的来源素材，写一条可发布的预约文案。'.repeat(3),
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
    [['selected-asset-1'], ['selected-asset-1']],
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
        if (!available) throw new SourceContentPackageUnavailableError(input.source!);
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

test('production ports compose #31, canonical gates, N-to-1 and copy delivery', async () => {
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
  const result = await runHarnessWorkflow(
    'task-production',
    taskInput(),
    ports,
    {
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
    },
  );

  assert.equal(result.trace.winnerCandidateId, 'c02');
  assert.equal(delivery.inputs[0]?.winner.candidateId, 'c02');
  assert.deepEqual(
    delivery.inputs[0]?.candidates.map(({ candidateId, score }) => ({
      candidateId,
      score,
    })),
    [
      { candidateId: 'c01', score: 70 },
      { candidateId: 'c02', score: 92 },
      { candidateId: 'c03', score: 92 },
    ],
  );
  assert.equal(delivery.inputs[0]?.marketing.promotionOffer?.status, 'unpriced');
  assert.deepEqual(traces.get('intent_naming')?.metrics, {
    initial: { calls: 1, schemaValid: 1, schemaInvalid: 0 },
    repair: { status: 'unsupported' },
    retry: { triggered: 0 },
    nestedCompleteness: { complete: 7, total: 7 },
  });
  assert.deepEqual(traces.get('brief_compilation')?.metrics, {
    initial: { calls: 1, schemaValid: 1, schemaInvalid: 0 },
    repair: { status: 'unsupported' },
    retry: { triggered: 0 },
    nestedCompleteness: { complete: 5, total: 8 },
  });
  assert.deepEqual(
    runner.requests.map(({ effectIdempotencyKey }) => effectIdempotencyKey),
    [
      'wf:task-production:s1:intent:0',
      'wf:task-production:s3:copy-primary:0',
      'wf:task-production:s4:copy-primary:c01',
      'wf:task-production:s4:copy-primary:c02',
      'wf:task-production:s4:copy-primary:c03',
      'wf:task-production:s4:copy-primary:score-c01',
      'wf:task-production:s4:copy-primary:score-c02',
      'wf:task-production:s4:copy-primary:score-c03',
    ],
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

class QueueRunner implements StructuredNodeRunner {
  readonly requests: StructuredNodeRunnerRequest<unknown>[] = [];

  constructor(private readonly outputs: unknown[]) {}

  async run<Output>(request: StructuredNodeRunnerRequest<Output>) {
    this.requests.push(request as StructuredNodeRunnerRequest<unknown>);
    return {
      output: request.schema.parse(this.outputs.shift()),
      attempts: 1,
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
    if (!fence) throw new Error('Expected source fence before provider attempt.');
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
  assert.equal(runner.requests.length, 3);
}

function unpricedPorts(runner: QueueRunner) {
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

function taskInput() {
  return {
    actorId: 'owner-1',
    workspaceId: 'workspace-1',
    packageId: 'package-1',
    expectedRevision: 2,
    workflowRevision: 4,
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

function contextWithSourcePackage(): HarnessContextSnapshot {
  const context = contextSnapshot();
  const source = sourceContentPackageProjection();
  const sourceRef = `content_package:${source.reference.id}:${source.reference.revision}`;
  context.bundle.dimensions.store_facts_assets.source_content_package_structure = {
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

function composerSnapshot(
  sourceContentPackage?: { id: string; revision: string },
) {
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
        ...(sourceContentPackage ? { contentPackage: sourceContentPackage } : {}),
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
