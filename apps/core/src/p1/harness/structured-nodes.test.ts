import assert from 'node:assert/strict';
import test from 'node:test';
import {
  InMemoryStructuredNodeMetrics,
  compileExecutionBrief,
  intentNamingOutputSchema,
  nameHarnessIntent,
  type StructuredNodeRunner,
  type StructuredNodeRunnerRequest,
} from './structured-nodes.js';
import { createCreationExecutionSnapshot } from '../execution-spine/creation-execution-snapshot.js';

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
        taskType,
        deliveryLayer,
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
        nestedCompleteness: { complete: 3, total: 3 },
      });
    }
  }
});

test('intent naming turns one blocking gap into one QuestionCard', async () => {
  const runner = new FixtureStructuredNodeRunner({
    taskType: 'promotion_groupbuy_conversion',
    deliveryLayer: 'copy',
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
    question: '这次团购价按哪个金额写？',
    options: [
      { id: 'option-1', label: '¥398' },
      { id: 'option-2', label: '¥498' },
    ],
    freeText: { enabled: true },
    response: {
      field: 'offer_price',
      reason: '补充当前任务所需的权威事实',
    },
    scope: 'current_task',
  });
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
          taskType: 'daily_service_exposure',
          deliveryLayer: kind === 'video' ? 'finished_media' : 'copy',
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
    const expectedTotal = { copy: 8, image: 7, video: 12 }[kind];
    assert.deepEqual(metrics.snapshot().nestedCompleteness, {
      complete: expectedTotal,
      total: expectedTotal,
    });
  }
});

test('brief compilation receives the frozen structured Composer contract before model output', async () => {
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
      identity: { id: 'identity-1', revision: 'identity-r1' },
      modelPolicy: { id: 'policy-1', revision: 'policy-r1', mode: 'fixed' },
      catalogModel: { id: 'model-1', revision: 'model-r1' },
      quote: { id: 'quote-1', revision: 'quote-r1' },
      route: { id: 'route-1', revision: 'route-r1' },
      briefConfirmation: { id: 'brief-1', revision: 'brief-r1' },
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
        taskType: 'daily_service_exposure',
        deliveryLayer: 'copy',
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
    catalogModel: { id: 'model-1', revision: 'model-r1' },
    contentModules: ['social_cover'],
    deliverables: [{ id: 'copy-primary', kind: 'copy', quantity: 1, order: 1 }],
    identity: { id: 'identity-1', revision: 'identity-r1' },
    lens: 'copy',
    modelPolicy: { id: 'policy-1', revision: 'policy-r1', mode: 'fixed' },
    platform: { id: 'douyin' },
    quote: { id: 'quote-1', revision: 'quote-r1' },
    route: { id: 'route-1', revision: 'route-r1' },
  });
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
      taskType: 'daily_service_exposure',
      deliveryLayer: 'copy',
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
    taskType: 'daily_service_exposure',
    deliveryLayer: 'copy',
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
    runner,
  );

  assert.equal(
    runner.requests[0]?.instructions,
    'This is the immutable intent prompt accepted with the task.',
  );
});

test('nested completeness reaches one for recursively full output', async () => {
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
      taskType: 'promotion_groupbuy_conversion',
      deliveryLayer: 'copy',
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
  assert.deepEqual(completeness, { complete: 9, total: 9 });
  assert.equal(completeness.complete / completeness.total, 1);
});

test('intent output rejects more than one blocking gap by construction', () => {
  assert.equal(
    intentNamingOutputSchema.safeParse({
      taskType: 'daily_service_exposure',
      deliveryLayer: 'copy',
      implicitConstraints: [],
      blockingGaps: [{ field: 'price' }, { field: 'rights' }],
    }).success,
    false
  );
});

test('metrics distinguish invalid initial schema from unsupported repair', async () => {
  const metrics = new InMemoryStructuredNodeMetrics();
  const runner = new FixtureStructuredNodeRunner({
    taskType: 'unknown_task',
    deliveryLayer: 'copy',
    implicitConstraints: [],
    blockingGap: null,
  });

  await assert.rejects(
    nameHarnessIntent(
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
    ),
    /Invalid option/u
  );
  assert.deepEqual(metrics.snapshot(), {
    initial: { calls: 1, schemaValid: 0, schemaInvalid: 1 },
    repair: { status: 'unsupported' },
    retry: { triggered: 0 },
    nestedCompleteness: { complete: 0, total: 3 },
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

function contextBundleFixture() {
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
