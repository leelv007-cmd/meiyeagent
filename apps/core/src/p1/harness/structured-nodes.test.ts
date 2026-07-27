import assert from 'node:assert/strict';
import test from 'node:test';
import {
  InMemoryStructuredNodeMetrics,
  compileExecutionBrief,
  intentNamingOutputSchema,
  nameHarnessIntent,
  type BriefContextBundle,
  type StructuredNodeRunner,
  type StructuredNodeRunnerRequest,
} from './structured-nodes.js';
import { createCreationExecutionSnapshot } from '../execution-spine/creation-execution-snapshot.js';
import { StructuredNodeRunError } from '../model-supply/structured-node-runner.js';
import { MemoryMarketingIdentityRepository } from '../operations/marketing-identity.js';

const taskFixtures = [
  ['daily_service_exposure', '把新项目写成一条朋友圈文案'],
  ['traffic_opportunity', '结合这个周末的同城活动写一条'],
  ['brand_personal_ip', '用老板娘第一人称讲讲为什么开这家店'],
  ['promotion_groupbuy_conversion', '把新团购做一套能发的'],
  ['routine_marketing_materials', '做一张长期使用的预约说明卡'],
] as const;

const deliveryFixtures = ['copy', 'finished_media'] as const;

test('intent naming covers five task types across both delivery layers', async () => {
  for (const [taskType, intent] of taskFixtures) {
    for (const deliveryLayer of deliveryFixtures) {
      const metrics = new InMemoryStructuredNodeMetrics();
      const runner = new FixtureStructuredNodeRunner({
        normalizedIntent: intent,
        taskType,
        deliveryLayer,
        relevantAssetCategories: ['industry_category'],
        usedAssetCategories: ['industry_category'],
        route: 'customized',
        implicitConstraints: ['只使用已确认的本店事实'],
        blockingGap: null,
      });

      const named = await nameHarnessIntent(
        {
          workflowId: `workflow-${taskType}-${deliveryLayer}`,
          workflowRevision: 3,
          intent: {
            context: {
              workId: 'work-1',
              intent,
              scene: taskType,
              sourceSummaries: ['门店价目表'],
            },
            assetReferences: ['asset-1'],
          },
        },
        runner,
        metrics
      );

      assert.equal(named.declaration.taskType, taskType);
      assert.equal(named.declaration.deliveryLayer, deliveryLayer);
      assert.equal(named.blockingQuestion, null);
      assert.equal(
        runner.requests[0]?.effectIdempotencyKey,
        `wf:workflow-${taskType}-${deliveryLayer}:s1:intent:0`
      );
      assert.deepEqual(metrics.snapshot(), {
        initial: { calls: 1, schemaValid: 1, schemaInvalid: 0 },
        repair: { status: 'unsupported' },
        retry: { triggered: 0 },
        nestedCompleteness: { complete: 7, total: 7 },
      });
    }
  }
});

test('intent naming turns one blocking gap into one QuestionCard', async () => {
  const runner = new FixtureStructuredNodeRunner({
    normalizedIntent: '推广新团购并带动预约',
    taskType: 'promotion_groupbuy_conversion',
    deliveryLayer: 'copy',
    relevantAssetCategories: ['promotion_activity', 'product_service'],
    usedAssetCategories: [],
    route: 'guidance',
    implicitConstraints: ['价格必须来自当前有效事实'],
    blockingGap: {
      field: 'offer_price',
      question: '这次团购价按哪个金额写？',
      options: ['¥398', '¥498'],
      allowFreeText: true,
      scope: 'current_task',
    },
  });

  const named = await nameHarnessIntent(
    {
      workflowId: 'workflow-question',
      workflowRevision: 5,
      intent: {
        context: {
          workId: 'work-question',
          intent: '把新团购做一套能发的',
          sourceSummaries: [],
        },
        assetReferences: [],
      },
    },
    runner
  );

  assert.deepEqual(named.blockingQuestion, {
    questionId: 'workflow-question:s1:offer_price',
    workflowId: 'workflow-question',
    workflowRevision: 5,
    question: '为了让成品更贴合你的想法，想确认一下：这次团购价按哪个金额写？',
    options: [
      { id: 'option-1', label: '¥398' },
      { id: 'option-2', label: '¥498' },
    ],
    freeText: { enabled: true },
    response: {
      field: 'offer_price',
      reason: '让这次内容更贴合你的实际情况',
    },
    unattended: 'continue',
    scope: 'current_task',
  });
});

test('the server-owned delivery layer cannot be changed by intent model output', async () => {
  const runner = new FixtureStructuredNodeRunner({
    normalizedIntent: '生成一张护理海报',
    taskType: 'routine_marketing_materials',
    deliveryLayer: 'copy',
    relevantAssetCategories: ['industry_category'],
    usedAssetCategories: ['industry_category'],
    route: 'customized',
    implicitConstraints: [],
    blockingGap: null,
  });

  const named = await nameHarnessIntent(
    {
      workflowId: 'workflow-server-delivery-layer',
      workflowRevision: 1,
      deliveryLayer: 'finished_media',
      intent: {
        context: {
          workId: 'work-server-delivery-layer',
          intent: '生成一张护理海报',
          sourceSummaries: [],
        },
        assetReferences: [],
      },
    },
    runner
  );

  assert.equal(named.declaration.deliveryLayer, 'finished_media');
});

test('brief compilation produces complete copy, image and video unit briefs', async () => {
  const outputs = {
    copy: {
      kind: 'copy',
      instructions:
        '写一条可信、克制的本地门店项目曝光文案。先说明顾客常见困扰，再引用已确认的项目与环境事实解释服务价值；不编造价格、疗效或资质，结尾使用低压力的私信预约行动，并保持主理人本人分享的口吻。',
      platform: 'xiaohongshu',
      cta: '私信预约到店咨询',
      factRefs: ['fact-service-1'],
      assetRefs: ['asset-room-1'],
      identityRefs: ['identity-owner-1'],
      constraints: ['不得编造价格'],
    },
    image: {
      kind: 'image',
      intent: {
        operation: 'image.generate',
        purpose: '门店项目封面',
        subject: '护理项目',
        scene: '真实门店环境',
        composition: '竖版主体居中',
        references: [],
        exactText: [],
        changes: [],
        invariants: [],
        factRefs: [],
        rightsRefs: [],
        outputPlan: { kind: 'single' },
      },
      prompt: '竖版门店项目封面，真实环境照片为主体，留出中文标题安全区。',
      referenceAssetIds: ['asset-room-1'],
      parameters: { ratio: '3:4', resolution: '2048' },
      constraints: ['不得改变人物身份'],
    },
    video: {
      kind: 'video',
      storyboard: [
        {
          index: 1,
          description: '门店外景进入项目区',
          narration: '先看真实到店环境',
          durationSeconds: 4,
        },
      ],
      firstFramePrompt:
        '使用已授权的门店真实外景作为首帧，竖屏构图，保留清晰招牌与安全标题区域。',
      referenceAssetIds: ['asset-room-1'],
      parameters: { durationSeconds: 12, ratio: '9:16' },
      constraints: ['不得使用未授权顾客素材'],
    },
  } as const;

  for (const kind of ['copy', 'image', 'video'] as const) {
    const metrics = new InMemoryStructuredNodeMetrics();
    const runner = new FixtureStructuredNodeRunner(outputs[kind]);
    const brief = await compileExecutionBrief(
      {
        workflowId: 'workflow-brief',
        unitId: `${kind}-primary`,
        unitKind: kind,
        declaration: {
          normalizedIntent: '介绍日常护理服务',
          taskType: 'daily_service_exposure',
          deliveryLayer: kind === 'video' ? 'finished_media' : 'copy',
          relevantAssetCategories: ['industry_category'],
          usedAssetCategories: ['industry_category'],
          route: 'customized',
          routingSource: 'model',
          implicitConstraints: ['只使用已确认信息'],
        },
        bundle: contextBundleFixture(),
      },
      runner,
      metrics
    );

    switch (brief.kind) {
      case 'copy':
        assert.equal(brief.platform, 'xiaohongshu');
        assert.equal(brief.cta, '私信预约到店咨询');
        assert.deepEqual(brief.factRefs, ['fact-service-1']);
        break;
      case 'image':
        assert.equal(brief.parameters.ratio, '3:4');
        assert.equal(brief.parameters.resolution, '2048');
        assert.deepEqual(brief.referenceAssetIds, ['asset-room-1']);
        break;
      case 'video':
        assert.equal(brief.storyboard.length, 1);
        assert.equal(brief.storyboard[0]?.durationSeconds, 4);
        assert.equal(brief.parameters.durationSeconds, 12);
        assert.equal(brief.parameters.ratio, '9:16');
        break;
    }
    assert.equal(
      runner.requests[0]?.effectIdempotencyKey,
      `wf:workflow-brief:s3:${kind}-primary:0`
    );
    const expectedComplete = { copy: 8, image: 14, video: 12 }[kind];
    const expectedTotal = { copy: 8, image: 20, video: 12 }[kind];
    assert.deepEqual(metrics.snapshot().nestedCompleteness, {
      complete: expectedComplete,
      total: expectedTotal,
    });
  }
});

/**
 * D-122 ③段兜底. A brief that will not compile must not end the run — but the
 * conservative brief it degrades to may not claim anything either, or the
 * fallback would smuggle in exactly the ungrounded content the gates exist to
 * stop.
 */
test('a copy brief that will not compile degrades instead of ending the run', async () => {
  const declaration = {
    normalizedIntent: '介绍夏日头皮护理服务',
    taskType: 'daily_service_exposure' as const,
    deliveryLayer: 'copy' as const,
    relevantAssetCategories: ['industry_category' as const],
    usedAssetCategories: ['industry_category' as const],
    route: 'customized' as const,
    routingSource: 'model' as const,
    implicitConstraints: ['只使用已确认信息'],
  };
  const failingRunner: StructuredNodeRunner = {
    async run() {
      throw new StructuredNodeRunError('failed', 'rejected_before_accept');
    },
  };
  let degraded = 0;

  const brief = await compileExecutionBrief(
    {
      workflowId: 'workflow-brief-fallback',
      unitId: 'copy-primary',
      unitKind: 'copy',
      declaration,
      bundle: contextBundleFixture(),
    },
    failingRunner,
    undefined,
    () => {
      degraded += 1;
    },
  );

  assert.equal(degraded, 1);
  assert.equal(brief.kind, 'copy');
  if (brief.kind !== 'copy') return;
  assert.deepEqual(brief.factRefs, []);
  assert.deepEqual(brief.assetRefs, []);
  assert.deepEqual(brief.identityRefs, []);
  assert.match(brief.instructions, /介绍夏日头皮护理服务/u);
  assert.ok(
    brief.constraints.some((constraint) => constraint.includes('不得编造')),
  );

  // Without the fallback hook the failure still surfaces — the resilience is
  // opt-in per call site, never a silent swallow.
  await assert.rejects(
    compileExecutionBrief(
      {
        workflowId: 'workflow-brief-fallback',
        unitId: 'copy-primary',
        unitKind: 'copy',
        declaration,
        bundle: contextBundleFixture(),
      },
      failingRunner,
    ),
    /Structured node execution failed/u,
  );

  // And a hard gate stays hard: a source-fence or authorization failure is not
  // a model failure, so it reaches the caller even with the hook armed.
  let degradedOnFence = 0;
  await assert.rejects(
    compileExecutionBrief(
      {
        workflowId: 'workflow-brief-fallback',
        unitId: 'copy-primary',
        unitKind: 'copy',
        declaration,
        bundle: contextBundleFixture(),
      },
      {
        async run() {
          throw new Error('SOURCE_REFERENCE_UNVERIFIED');
        },
      },
      undefined,
      () => {
        degradedOnFence += 1;
      },
    ),
    /SOURCE_REFERENCE_UNVERIFIED/u,
  );
  assert.equal(degradedOnFence, 0);
});

test('brief compilation exposes only fact refs authorized by satisfaction', async () => {
  const bundle = contextBundleFixture();
  bundle.referencedFactRevisions = [
    { factId: 'service-1', revision: 1 },
    { factId: 'price-1', revision: 1 },
  ];
  bundle.dimensions.store_facts_assets = {
    service: factContribution('service-1', 'service', '头皮清洁护理'),
    price: factContribution('price-1', 'price', 398),
  };
  const runner = new FixtureStructuredNodeRunner({
    kind: 'copy',
    instructions:
      '介绍已经确认的头皮清洁护理服务，不引用任何未经本次事实满足度判断授权的价格信息，并以私信咨询作为低压力行动建议。'.repeat(
        2,
      ),
    platform: 'xiaohongshu',
    cta: '私信咨询',
    factRefs: ['store_fact:service-1:1'],
    assetRefs: [],
    identityRefs: [],
    constraints: ['不得引用未授权价格'],
  });

  await compileExecutionBrief(
    {
      workflowId: 'workflow-authorized-facts',
      unitId: 'copy-primary',
      unitKind: 'copy',
      declaration: {
        normalizedIntent: '介绍护理服务',
        taskType: 'daily_service_exposure',
        deliveryLayer: 'copy',
        relevantAssetCategories: ['product_service'],
        usedAssetCategories: ['product_service'],
        route: 'customized',
        routingSource: 'model',
        implicitConstraints: [],
      },
      bundle,
      allowedFactRefs: ['store_fact:service-1:1'],
    },
    runner,
  );

  const prompt = JSON.parse(runner.requests[0]?.prompt ?? '{}');
  assert.deepEqual(
    Object.keys(prompt.bundle.dimensions.store_facts_assets),
    ['service'],
  );
  assert.deepEqual(prompt.bundle.referencedFactRevisions, [
    { factId: 'service-1', revision: 1 },
  ]);
  assert.doesNotMatch(JSON.stringify(prompt), /price-1|398/u);
});

test('brief compilation receives the frozen structured Composer contract before model output', async () => {
  const identities = new MemoryMarketingIdentityRepository();
  await identities.register({
    workspaceId: 'workspace-1',
    actorId: 'owner-1',
    occurredAt: '2026-07-22T08:00:00.000Z',
    command: {
      identityId: 'identity-1',
      kind: 'brand',
      expectedVersion: 0,
      displayName: '青禾门店',
      owner: '青禾门店',
      professionalBoundaries: ['不作医疗承诺'],
      allowedPlatforms: ['xiaohongshu'],
      allowedScenes: ['daily_service_exposure'],
      expressionSamples: ['用门店官方口吻介绍服务。'],
      effectiveFrom: '2026-07-22T00:00:00.000Z',
      expiresAt: null,
      departureHandling: '停用后不再用于新内容',
      sourceRef: 'source-identity-1',
      brandClaims: ['社区护理门店'],
      forbiddenClaims: ['医疗疗效'],
      visualPrinciples: ['真实门店'],
      seriesAnchors: ['护理日常'],
    },
  });
  await identities.setDefault({
    workspaceId: 'workspace-1',
    actorId: 'owner-1',
    occurredAt: '2026-07-22T08:10:00.000Z',
    decisionId: 'default-decision-1',
    command: {
      expectedDecisionRevision: 0,
      identity: { identityId: 'identity-1', version: 1 },
      reason: 'Remember the voice chosen in Composer.',
    },
  });
  const projection = await identities.project(
    'workspace-1',
    'owner-1',
    '2026-07-22T09:00:00.000Z'
  );
  const runner = new FixtureStructuredNodeRunner({
    kind: 'copy',
    instructions:
      '写一条可信、克制的本地门店项目曝光文案。先说明顾客常见困扰，再引用已确认的项目与环境事实解释服务价值；不编造价格、疗效或资质，结尾使用低压力的私信预约行动，并保持主理人本人分享的口吻。',
    platform: 'xiaohongshu',
    cta: '私信预约到店咨询',
    factRefs: ['fact-service-1'],
    assetRefs: ['asset-room-1'],
    identityRefs: ['identity-owner-1'],
    constraints: ['不得编造价格'],
  });
  const snapshot = createCreationExecutionSnapshot(
    {
      actorId: 'owner-1',
      workspaceId: 'workspace-1',
      idempotencyKey: 'submission-1',
      taskId: 'task-1',
      workId: 'work-1',
      contentPackageId: 'package-1',
      expectedContentPackageRevision: 0,
      creationMode: 'customized',
      intent: '请写一条小红书护理预约文案',
      surface: { id: 'surface-1', revision: 'surface-r1' },
      recipe: { id: 'recipe-1', revision: 'recipe-r1' },
      lens: 'copy',
      platform: { id: 'douyin' },
      deliverables: [
        { id: 'copy-primary', kind: 'copy', quantity: 1, order: 1 },
      ],
      sources: { assets: [] },
      rights: { revision: 'rights-r1', summary: 'authorized' },
      identity: {
        id: projection.defaultIdentity!.identityId,
        revision: String(projection.defaultIdentity!.version),
      },
      identityDecision: {
        id: projection.defaultDecision!.decisionId,
        revision: projection.defaultDecision!.decisionRevision,
      },
      modelPolicy: { id: 'policy-1', revision: 'policy-r1', mode: 'fixed' },
      catalogModel: { id: 'model-1', revision: 'model-r1' },
      quote: { id: 'quote-1', revision: 'quote-r1' },
      route: { id: 'route-1', revision: 'route-r1' },
      briefConfirmation: { id: 'brief-1', revision: 'brief-r1' },
      briefContext: { id: 'brief-context-1', revision: 1 },
      contentModules: ['social_cover'],
    },
    '2026-07-22T09:00:00.000Z'
  );

  await compileExecutionBrief(
    {
      workflowId: 'workflow-snapshot-contract',
      unitId: 'copy-primary',
      unitKind: 'copy',
      declaration: {
        normalizedIntent: '介绍护理服务并邀请预约',
        taskType: 'daily_service_exposure',
        deliveryLayer: 'copy',
        relevantAssetCategories: ['industry_category'],
        usedAssetCategories: ['industry_category'],
        route: 'customized',
        routingSource: 'model',
        implicitConstraints: [],
      },
      bundle: contextBundleFixture(),
      executionSnapshot: snapshot,
    },
    runner
  );

  const prompt = JSON.parse(runner.requests[0]?.prompt ?? '{}');
  assert.deepEqual(prompt.executionContract, {
    briefConfirmation: { id: 'brief-1', revision: 'brief-r1' },
    briefContext: { id: 'brief-context-1', revision: 1 },
    catalogModel: { id: 'model-1', revision: 'model-r1' },
    contentModules: ['social_cover'],
    deliverables: [{ id: 'copy-primary', kind: 'copy', quantity: 1, order: 1 }],
    identity: { id: 'identity-1', revision: '1' },
    identityDecision: { id: 'default-decision-1', revision: 1 },
    lens: 'copy',
    modelPolicy: { id: 'policy-1', revision: 'policy-r1', mode: 'fixed' },
    operation: 'copy.generate',
    platform: { id: 'douyin' },
    quote: { id: 'quote-1', revision: 'quote-r1' },
    route: { id: 'route-1', revision: 'route-r1' },
    sources: { assets: [] },
  });

  const { identityDecision: _identityDecision, ...snapshotWithoutDefaultRead } =
    snapshot;
  const controlRunner = new FixtureStructuredNodeRunner({
    kind: 'copy',
    instructions:
      '使用门店官方中性口吻完成文案。先说明顾客常见困扰，再结合已确认的门店事实解释服务价值；不编造价格、疗效或资质，不使用任何个人身份表达，结尾给出低压力的预约建议。',
    platform: 'xiaohongshu',
    cta: '私信预约',
    factRefs: [],
    assetRefs: [],
    identityRefs: [],
    constraints: [],
  });
  await compileExecutionBrief(
    {
      workflowId: 'workflow-without-default-read',
      unitId: 'copy-primary',
      unitKind: 'copy',
      declaration: {
        normalizedIntent: '介绍护理服务并邀请预约',
        taskType: 'daily_service_exposure',
        deliveryLayer: 'copy',
        relevantAssetCategories: [],
        usedAssetCategories: [],
        route: 'customized',
        routingSource: 'model',
        implicitConstraints: [],
      },
      bundle: contextBundleFixture(),
      executionSnapshot: {
        ...snapshotWithoutDefaultRead,
        identity: { id: 'official-neutral', revision: '1' },
      },
    },
    controlRunner
  );
  const controlPrompt = JSON.parse(controlRunner.requests[0]?.prompt ?? '{}');
  assert.notDeepEqual(
    controlPrompt.executionContract.identityDecision,
    prompt.executionContract.identityDecision,
    'Removing the default read must remove the decision provenance from compiler input.'
  );
});

test('nested completeness reports partial non-empty output independently from schema validity', async () => {
  const metrics = new InMemoryStructuredNodeMetrics();
  await nameHarnessIntent(
    {
      workflowId: 'workflow-partial-metrics',
      workflowRevision: 1,
      intent: {
        context: {
          workId: 'work-partial-metrics',
          intent: '写一条日常护理内容',
          sourceSummaries: [],
        },
        assetReferences: [],
      },
    },
    new FixtureStructuredNodeRunner({
      normalizedIntent: '介绍日常护理',
      taskType: 'daily_service_exposure',
      deliveryLayer: 'copy',
      relevantAssetCategories: ['industry_category'],
      usedAssetCategories: ['industry_category'],
      route: 'customized',
      implicitConstraints: [],
      blockingGap: null,
    }),
    metrics
  );

  const snapshot = metrics.snapshot();
  const schemaValidity = snapshot.initial.schemaValid / snapshot.initial.calls;
  const completeness =
    snapshot.nestedCompleteness.complete / snapshot.nestedCompleteness.total;
  assert.equal(schemaValidity, 1);
  assert.ok(completeness > 0 && completeness < 1);
  assert.notEqual(completeness, schemaValidity);
});

test('structured nodes execute the prompt content frozen at task admission', async () => {
  const runner = new FixtureStructuredNodeRunner({
    normalizedIntent: '介绍日常护理',
    taskType: 'daily_service_exposure',
    deliveryLayer: 'copy',
    relevantAssetCategories: ['industry_category'],
    usedAssetCategories: ['industry_category'],
    route: 'customized',
    implicitConstraints: [],
    blockingGap: null,
  });

  await nameHarnessIntent(
    {
      workflowId: 'workflow-frozen-prompt',
      workflowRevision: 1,
      intent: {
        context: {
          workId: 'work-frozen-prompt',
          intent: '写一条日常护理内容',
          sourceSummaries: [],
        },
        assetReferences: [],
      },
      prompt: {
        name: 'harness/intent-naming',
        version: '9',
        content: 'This is the immutable intent prompt accepted with the task.',
        contentHash: '9'.repeat(64),
        label: 'production',
        source: 'langfuse',
        isFallback: false,
      },
    },
    runner
  );

  assert.equal(
    runner.requests[0]?.instructions,
    'This is the immutable intent prompt accepted with the task.'
  );
});

test('nested completeness reports an empty optional choice list honestly', async () => {
  const metrics = new InMemoryStructuredNodeMetrics();
  await nameHarnessIntent(
    {
      workflowId: 'workflow-full-metrics',
      workflowRevision: 1,
      intent: {
        context: {
          workId: 'work-full-metrics',
          intent: '按当前价格写团购内容',
          sourceSummaries: [],
        },
        assetReferences: [],
      },
    },
    new FixtureStructuredNodeRunner({
      normalizedIntent: '推广当前团购',
      taskType: 'promotion_groupbuy_conversion',
      deliveryLayer: 'copy',
      relevantAssetCategories: ['promotion_activity', 'product_service'],
      usedAssetCategories: [],
      route: 'guidance',
      implicitConstraints: ['只使用当前有效价格'],
      blockingGap: {
        field: 'offer_price',
        question: '本次采用哪个已核验价格？',
        options: ['当前价'],
        allowFreeText: false,
        scope: 'current_task',
      },
    }),
    metrics
  );

  const completeness = metrics.snapshot().nestedCompleteness;
  assert.deepEqual(completeness, { complete: 12, total: 13 });
});

test('intent output rejects more than one blocking gap by construction', () => {
  assert.equal(
    intentNamingOutputSchema.safeParse({
      normalizedIntent: '介绍日常护理',
      taskType: 'daily_service_exposure',
      deliveryLayer: 'copy',
      relevantAssetCategories: ['industry_category'],
      usedAssetCategories: [],
      route: 'guidance',
      implicitConstraints: [],
      blockingGaps: [{ field: 'price' }, { field: 'rights' }],
    }).success,
    false
  );
});

test('free entry is declared without asking the model to choose the route', async () => {
  const runner = new FixtureStructuredNodeRunner({});
  const named = await nameHarnessIntent(
    {
      workflowId: 'workflow-free-entry',
      workflowRevision: 1,
      creationMode: 'free',
      intent: {
        context: {
          workId: 'work-free',
          intent: '随手写一条护理预约文案',
          sourceSummaries: [],
        },
        assetReferences: [],
      },
    },
    runner
  );
  assert.equal(named.declaration.route, 'free');
  assert.equal(named.declaration.routingSource, 'entry');
  assert.equal(named.blockingQuestion, null);
  assert.equal(runner.requests.length, 0);
});

test('model failures choose intent-specific conservative guidance', async () => {
  const cases = [
    ['推广新团购', 'promotion_details'],
    ['用老板娘本人风格写开店故事', 'personal_ip_details'],
    ['介绍刚上的新项目', 'product_details'],
  ] as const;
  for (const [intent, expectedField] of cases) {
    const runner: StructuredNodeRunner = {
      async run() {
        throw new StructuredNodeRunError('failed', 'rejected_before_accept');
      },
    };
    const named = await nameHarnessIntent(
      {
        workflowId: `workflow-fallback-${expectedField}`,
        workflowRevision: 1,
        creationMode: 'customized',
        intent: {
          context: { workId: 'work-fallback', intent, sourceSummaries: [] },
          assetReferences: [],
        },
      },
      runner
    );
    assert.equal(named.declaration.route, 'guidance');
    assert.equal(named.declaration.routingSource, 'fallback');
    assert.equal(named.blockingQuestion?.response.field, expectedField);
    assert.equal(named.blockingQuestion?.freeText.enabled, true);
    assert.equal(named.blockingQuestion?.unattended, 'continue');
  }
});

test('authorization and source-fence errors never become routing fallback', async () => {
  const runner: StructuredNodeRunner = {
    async run() {
      throw new Error('SOURCE_REFERENCE_UNVERIFIED');
    },
  };
  await assert.rejects(
    nameHarnessIntent(
      {
        workflowId: 'workflow-hard-gate',
        workflowRevision: 1,
        creationMode: 'customized',
        intent: {
          context: {
            workId: 'work-hard-gate',
            intent: '写一条项目文案',
            sourceSummaries: [],
          },
          assetReferences: ['asset-unverified'],
        },
      },
      runner
    ),
    /SOURCE_REFERENCE_UNVERIFIED/u
  );
});

test('invalid model output falls back to conservative guidance', async () => {
  const metrics = new InMemoryStructuredNodeMetrics();
  const runner = new FixtureStructuredNodeRunner({
    normalizedIntent: '随便做点内容',
    taskType: 'unknown_task',
    deliveryLayer: 'copy',
    relevantAssetCategories: ['industry_category'],
    usedAssetCategories: [],
    route: 'guidance',
    implicitConstraints: [],
    blockingGap: null,
  });

  const named = await nameHarnessIntent(
      {
        workflowId: 'workflow-invalid',
        workflowRevision: 0,
        intent: {
          context: {
            workId: 'work-invalid',
            intent: '随便做点内容',
            sourceSummaries: [],
          },
          assetReferences: [],
        },
      },
      runner,
      metrics
    );
  assert.equal(named.declaration.route, 'guidance');
  assert.equal(named.declaration.routingSource, 'fallback');
  assert.equal(named.blockingQuestion?.response.field, 'industry_category');
  assert.equal(named.fallbackUsed, true);
  assert.deepEqual(metrics.snapshot(), {
    initial: { calls: 1, schemaValid: 0, schemaInvalid: 1 },
    repair: { status: 'unsupported' },
    retry: { triggered: 0 },
    nestedCompleteness: { complete: 0, total: 7 },
  });
});

class FixtureStructuredNodeRunner implements StructuredNodeRunner {
  readonly requests: StructuredNodeRunnerRequest<unknown>[] = [];

  constructor(private readonly output: unknown) {}

  async run<Output>(request: StructuredNodeRunnerRequest<Output>) {
    this.requests.push(request as StructuredNodeRunnerRequest<unknown>);
    return {
      output: request.schema.parse(this.output),
      attempts: 1,
      providerTaskRef: 'fixture-structured-task',
      replayed: false,
      usage: { inputTokens: 10, outputTokens: 20 },
    };
  }
}

function contextBundleFixture(): BriefContextBundle {
  return {
    bundleId: 'bundle-1',
    revision: 1,
    hash: 'a'.repeat(64),
    serializerVersion: 'context-bundle-c14n-v1' as const,
    workspaceId: 'workspace-1',
    taskId: 'task-1',
    frozenAt: '2026-07-18T00:00:00.000Z',
    frozenBy: 'owner-1',
    previousRevision: null,
    referencedFactRevisions: [],
    sourceRevisions: {
      facts: 3,
      assets: 4,
      identity: 2,
      rights: 5,
      preferences: 1,
      recipe: 2,
      platformRules: 7,
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
