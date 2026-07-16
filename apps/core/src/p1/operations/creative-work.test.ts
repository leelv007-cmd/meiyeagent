import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MemoryOperationsRepository,
  OperationsApplicationService,
  OperationsError,
  type CreationExecutionResult,
  type CreationExecutorPort,
  type CreativeExecutionContract,
  type CreativeGroundingResolverPort,
  type CreativeGroundingSnapshot,
  type CreativeBrief,
  type CreativeInheritanceContext,
  type CreativeSourceReference,
  type OperationContext,
} from './index.js';

const owner: OperationContext = {
  actor: 'owner',
  correlationId: 'corr-creative-work',
  userId: 'owner-a',
  workspaceId: 'workspace-a',
};

const contract: CreativeExecutionContract = {
  aigcLabelEnabled: true,
  catalogModelId: 'llm-live',
  catalogRevision: 'catalog-live-v1',
  currency: 'CNY',
  dataClass: [],
  estimatedAmount: 1,
  operation: 'copy.generate',
  outputCount: 3,
  outputLabel: '3 条内容候选',
  quoteAcceptedAt: '2026-07-12T08:00:00.000Z',
  quoteRevision: 'quote-live-v1',
  watermarkEnabled: false,
};

function threeCandidates(title = '真实到店记录', body = '按已确认事实写成的内容。') {
  return [
    { title, body, conversionHook: '先沟通需求' },
    {
      title: `${title} · B`,
      body: `${body}保留用户可编辑空间。`,
      conversionHook: '收藏后再预约',
    },
    {
      title: `${title} · C`,
      body: `${body}补充同城到店行动。`,
      conversionHook: '到店前留言',
    },
  ];
}

class RecordedCreationExecutor implements CreationExecutorPort {
  calls: string[] = [];
  streamCalls: string[] = [];
  contracts: CreativeExecutionContract[] = [];
  briefSnapshots: Array<CreativeBrief | undefined> = [];
  groundingSnapshots: Array<CreativeGroundingSnapshot | undefined> = [];
  inheritanceContexts: Array<CreativeInheritanceContext | undefined> = [];
  streamBriefSnapshots: Array<CreativeBrief | undefined> = [];
  streamGroundingSnapshots: Array<CreativeGroundingSnapshot | undefined> = [];
  streamInheritanceContexts: Array<CreativeInheritanceContext | undefined> = [];
  verifyCalls: string[] = [];
  productUsageQuantities: Array<0 | 1 | undefined> = [];
  qualityEvents: Array<{ rerollKind: 'paid' | 'quality'; targetJobId: string }> = [];
  qualityErrors: Error[] = [];
  available = true;
  submissionErrors: Error[] = [];
  results: CreationExecutionResult[] = [];
  verificationResults: Array<
    CreationExecutionResult | Promise<CreationExecutionResult>
  > = [];

  async inspect() {
    if (!this.available) {
      throw new OperationsError(
        'MODEL_NOT_LIVE_VERIFIED',
        'Only active and live-verified deployments can submit.',
        409
      );
    }
  }

  async submit(input: Parameters<CreationExecutorPort['submit']>[0]) {
    this.calls.push(input.idempotencyKey);
    this.contracts.push(structuredClone(input.contract));
    this.briefSnapshots.push(structuredClone(input.briefSnapshot));
    this.groundingSnapshots.push(structuredClone(input.groundingSnapshot));
    this.inheritanceContexts.push(structuredClone(input.inheritanceContext));
    this.productUsageQuantities.push(input.productUsageQuantity);
    const error = this.submissionErrors.shift();
    if (error) throw error;
    return (
      this.results.shift() ?? {
        copyCandidates: threeCandidates(),
        providerJobId: 'provider-job-a',
        routeSnapshotId: 'route-live-a',
        status: 'completed',
      }
    );
  }

  async startCopyStream(
    input: Parameters<NonNullable<CreationExecutorPort['startCopyStream']>>[0]
  ) {
    this.streamCalls.push(input.idempotencyKey);
    this.streamBriefSnapshots.push(structuredClone(input.briefSnapshot));
    this.streamGroundingSnapshots.push(
      structuredClone(input.groundingSnapshot)
    );
    this.streamInheritanceContexts.push(
      structuredClone(input.inheritanceContext)
    );
    this.productUsageQuantities.push(input.productUsageQuantity);
    return {
      response: new Response('one\ntwo\n', {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      }),
      completion: Promise.resolve({
        copyCandidates: threeCandidates(),
        providerJobId: 'provider-stream-a',
        routeSnapshotId: 'route-stream-a',
        status: 'completed' as const,
      }),
    };
  }

  async verify(input: { providerJobId: string; routeSnapshotId: string }) {
    this.verifyCalls.push(input.providerJobId);
    return await (
      this.verificationResults.shift() ?? {
        providerJobId: input.providerJobId,
        routeSnapshotId: input.routeSnapshotId,
        status: 'unknown',
      }
    );
  }

  async recordReroll(input: {
    rerollKind: 'paid' | 'quality';
    targetJobId: string;
  }) {
    this.qualityEvents.push(structuredClone(input));
    const error = this.qualityErrors.shift();
    if (error) throw error;
  }
}

function setup(
  executor = new RecordedCreationExecutor(),
  assetDataClassResolver?: {
    resolve(
      workspaceId: string,
      assetId: string
    ): Promise<Array<'contains_face' | 'pii' | 'medical'> | null>;
  },
  groundingResolver?: CreativeGroundingResolverPort,
  contentWriteOwnership?: {
    get(workspaceId: string): Promise<'legacy' | 'frozen' | 'contentpackage'>;
  }
) {
  const repository = new MemoryOperationsRepository();
  repository.grantMembership(owner.userId, owner.workspaceId);
  const service = new OperationsApplicationService(repository, {
    assetDataClassResolver,
    canvasExporter: {
      async export() {
        throw new Error('not used');
      },
    },
    creationExecutor: executor,
    contentWriteOwnership,
    groundingResolver,
    imageGenerator: {
      async submit() {
        throw new Error('not used');
      },
    },
    notifier: { async send() {} },
  });
  return { executor, repository, service };
}

describe('creative work lifecycle', () => {
  it('persists AI and merchant Brief ownership through adopt, edit, revert and confirm', async () => {
    const { service } = setup();
    const work = await service.createCreativeWork(owner, {
      intent: '为新客写一组美甲到店内容',
      mode: 'agent',
      sessionId: 'session-persistent-brief',
      sourceReferences: [],
    });

    await service.updateCreativeWorkBrief(owner, work.id, {
      action: 'adopt',
      aiDraft: '回应新客对美甲效果和到店流程的疑问',
      field: 'intent',
    });
    await service.updateCreativeWorkBrief(owner, work.id, {
      action: 'adopt',
      aiDraft: '门店内实拍',
      field: 'scene',
    });
    await service.updateCreativeWorkBrief(owner, work.id, {
      action: 'edit',
      current: '像老板娘面对面介绍',
      field: 'scene',
    });

    let current = (await service.getCreativeWorkbench(owner)).works.find(
      (candidate) => candidate.id === work.id
    );
    assert.deepEqual(current?.brief?.fields.scene, {
      aiDraft: '门店内实拍',
      current: '像老板娘面对面介绍',
      owner: 'merchant',
    });

    await service.updateCreativeWorkBrief(owner, work.id, {
      action: 'revert',
      field: 'scene',
    });
    const confirmed = await service.confirmCreativeWorkBrief(owner, work.id);

    assert.equal(confirmed.brief?.fields.scene?.current, '门店内实拍');
    assert.equal(confirmed.brief?.fields.scene?.owner, 'ai');
    assert.equal(confirmed.brief?.fields.intent?.current, confirmed.intent);
    assert.ok(confirmed.brief?.confirmedAt);
    current = (await service.getCreativeWorkbench(owner)).works.find(
      (candidate) => candidate.id === work.id
    );
    assert.deepEqual(current?.brief, confirmed.brief);
  });

  it('freezes confirmed Brief and Product grounding on the Job and passes only those snapshots to execution', async () => {
    const groundingSnapshot: CreativeGroundingSnapshot = {
      assets: [
        {
          authorizationStatus: 'authorized',
          category: 'store',
          consentScope: 'public_marketing',
          containsPerson: false,
          containsSensitiveData: false,
          id: 'asset-real-a',
          minorStatus: 'none',
          rightsEvidenceRecorded: true,
          sourceType: 'real',
          tags: ['门头'],
        },
      ],
      capturedAt: '2026-07-14T08:00:00.000Z',
      store: {
        address: '88 号',
        booking: '提前预约',
        brandVoice: '真诚、不夸张',
        city: '成都',
        confirmedAt: '2026-07-14T07:00:00.000Z',
        district: '锦江区',
        name: '春日美甲',
        prohibitions: ['不宣称最低价'],
        projects: [
          {
            durationMinutes: 90,
            id: 'project-a',
            name: '纯色美甲',
            price: 168,
          },
        ],
        regulated: false,
      },
    };
    let resolution = structuredClone(groundingSnapshot);
    const groundingResolver: CreativeGroundingResolverPort = {
      async resolve() {
        return { snapshot: structuredClone(resolution), status: 'ready' };
      },
    };
    const executor = new RecordedCreationExecutor();
    executor.results.push({
      copyCandidates: threeCandidates(),
      executionProvenance: {
        activationStatus: 'recorded',
        actualCatalogModelId: 'llm-live',
        apiCounterparty: 'recorded-fixture',
        modelDisplayName: 'Recorded copy',
        providerModel: 'recorded-copy-v1',
      },
      providerJobId: 'provider-frozen-grounding',
      routeSnapshotId: 'route-frozen-grounding',
      status: 'completed',
    });
    const { service } = setup(
      executor,
      {
        async resolve() {
          return [];
        },
      },
      groundingResolver
    );
    const work = await service.createCreativeWork(owner, {
      intent: '介绍真实门店项目',
      mode: 'agent',
      sessionId: 'session-frozen-grounding',
      sourceReferences: [{ id: 'asset-real-a', kind: 'asset' }],
    });
    await service.updateCreativeWorkBrief(owner, work.id, {
      action: 'adopt',
      aiDraft: '介绍真实门店项目',
      field: 'intent',
    });
    const confirmed = await service.confirmCreativeWorkBrief(owner, work.id);

    await service.submitCreativeWork(
      owner,
      work.id,
      contract,
      'frozen-grounding-job'
    );
    resolution.store.name = '不应进入执行的后续修改';

    const persisted = (await service.getCreativeWorkbench(owner)).jobs.find(
      (candidate) => candidate.workId === work.id
    );
    assert.deepEqual(persisted?.briefSnapshot, confirmed.brief);
    assert.deepEqual(persisted?.groundingSnapshot, groundingSnapshot);
    assert.deepEqual(persisted?.executionProvenance, {
      activationStatus: 'recorded',
      actualCatalogModelId: 'llm-live',
      apiCounterparty: 'recorded-fixture',
      modelDisplayName: 'Recorded copy',
      providerModel: 'recorded-copy-v1',
    });
    assert.deepEqual(executor.briefSnapshots, [confirmed.brief]);
    assert.deepEqual(executor.groundingSnapshots, [groundingSnapshot]);
  });

  it('fails closed before Job creation when Brief or confirmed grounding is missing', async () => {
    const executor = new RecordedCreationExecutor();
    const groundingResolver: CreativeGroundingResolverPort = {
      async resolve() {
        return {
          missing: ['confirmed_store', 'real_authorized_asset'],
          status: 'missing',
        };
      },
    };
    const { service } = setup(executor, undefined, groundingResolver);
    const work = await service.createCreativeWork(owner, {
      intent: '生成一条门店内容',
      mode: 'agent',
      sessionId: 'session-grounding-fail-closed',
      sourceReferences: [],
    });
    await service.updateCreativeWorkBrief(owner, work.id, {
      action: 'adopt',
      aiDraft: '生成一条门店内容',
      field: 'intent',
    });

    await assert.rejects(
      service.submitCreativeWork(owner, work.id, contract, 'brief-unconfirmed'),
      (error: unknown) =>
        error instanceof OperationsError &&
        error.code === 'CREATIVE_BRIEF_NOT_CONFIRMED' &&
        error.status === 409
    );
    await service.confirmCreativeWorkBrief(owner, work.id);
    await assert.rejects(
      service.submitCreativeWork(owner, work.id, contract, 'grounding-missing'),
      (error: unknown) =>
        error instanceof OperationsError &&
        error.code === 'CREATIVE_GROUNDING_INCOMPLETE' &&
        error.status === 409
    );

    assert.equal((await service.getCreativeWorkbench(owner)).jobs.length, 0);
    assert.deepEqual(executor.calls, []);
  });

  it('keeps retry execution on the original Brief and grounding snapshots', async () => {
    const firstGrounding: CreativeGroundingSnapshot = {
      assets: [
        {
          authorizationStatus: 'authorized',
          consentScope: 'public_marketing',
          containsPerson: false,
          containsSensitiveData: false,
          id: 'asset-retry-a',
          minorStatus: 'none',
          rightsEvidenceRecorded: true,
          sourceType: 'real',
          tags: [],
        },
      ],
      capturedAt: '2026-07-14T08:00:00.000Z',
      store: {
        address: '1 号',
        booking: '预约',
        brandVoice: '真诚',
        city: '成都',
        confirmedAt: '2026-07-14T07:00:00.000Z',
        district: '锦江区',
        name: '原门店',
        prohibitions: [],
        projects: [
          { durationMinutes: 60, id: 'p-a', name: '项目 A', price: 100 },
        ],
        regulated: false,
      },
    };
    let currentGrounding = structuredClone(firstGrounding);
    let resolveCalls = 0;
    const executor = new RecordedCreationExecutor();
    executor.results.push(
      {
        failureCode: 'PROVIDER_TIMEOUT',
        providerJobId: 'provider-failed',
        routeSnapshotId: 'route-failed',
        status: 'failed',
      },
      {
        copyCandidates: threeCandidates(),
        providerJobId: 'provider-retry',
        routeSnapshotId: 'route-retry',
        status: 'completed',
      }
    );
    const { service } = setup(
      executor,
      { async resolve() { return []; } },
      {
        async resolve() {
          resolveCalls += 1;
          return {
            snapshot: structuredClone(currentGrounding),
            status: 'ready',
          };
        },
      }
    );
    const work = await service.createCreativeWork(owner, {
      intent: '验证失败重试快照',
      mode: 'agent',
      sessionId: 'session-retry-grounding',
      sourceReferences: [{ id: 'asset-retry-a', kind: 'asset' }],
    });
    await service.updateCreativeWorkBrief(owner, work.id, {
      action: 'adopt',
      aiDraft: '验证失败重试快照',
      field: 'intent',
    });
    const confirmed = await service.confirmCreativeWorkBrief(owner, work.id);
    const failed = await service.submitCreativeWork(
      owner,
      work.id,
      contract,
      'grounding-first-attempt'
    );
    currentGrounding.store.name = '修改后门店';
    await service.retryCreativeJob(
      owner,
      failed.job.id,
      'grounding-retry-attempt'
    );

    assert.equal(resolveCalls, 1);
    assert.deepEqual(executor.briefSnapshots, [confirmed.brief, confirmed.brief]);
    assert.deepEqual(executor.groundingSnapshots, [firstGrounding, firstGrounding]);
  });

  it('settles one copy stream into the same Work and rejects a repeated submission key', async () => {
    const { executor, service } = setup();
    const work = await service.createCreativeWork(owner, {
      intent: '写一条真实的门店项目介绍',
      mode: 'agent',
      sessionId: 'session-copy-stream',
      sourceReferences: [],
    });

    const started = await service.startCreativeCopyStream(
      owner,
      work.id,
      contract,
      'stable-copy-stream-key'
    );
    assert.equal(await started.response.text(), 'one\ntwo\n');
    const settled = await started.completion;

    assert.equal(settled.work.id, work.id);
    assert.equal(settled.work.status, 'completed');
    assert.equal(settled.job.submissionKey, 'stable-copy-stream-key');
    assert.equal(settled.assets.length, 3);
    assert.deepEqual(
      settled.assets.map((asset) => asset.conversionHook),
      ['先沟通需求', '收藏后再预约', '到店前留言']
    );
    assert.deepEqual(executor.streamCalls, ['stable-copy-stream-key']);

    await assert.rejects(
      service.startCreativeCopyStream(
        owner,
        work.id,
        contract,
        'stable-copy-stream-key'
      ),
      (error: unknown) =>
        error instanceof OperationsError &&
        error.code === 'COPY_STREAM_ALREADY_STARTED' &&
        error.status === 409
    );
    assert.deepEqual(executor.streamCalls, ['stable-copy-stream-key']);
    assert.equal(
      (await service.getCreativeWorkbench(owner)).assets.length,
      3
    );
  });

  it('keeps E0 empty, records skip separately, and creates no object from intent alone', async () => {
    const { service } = setup();
    const empty = await service.getCreativeWorkbench(owner);
    assert.deepEqual(empty, {
      assets: [],
      contents: [],
      events: [],
      jobs: [],
      works: [],
    });

    await service.recordOnboardingSkip(owner);
    const skipped = await service.getCreativeWorkbench(owner);
    assert.equal(skipped.works.length, 0);
    assert.deepEqual(
      skipped.events.map((event) => event.type),
      ['cold_start_skipped']
    );
    assert.equal(skipped.events[0]?.correlationId, owner.correlationId);
    assert.equal(skipped.events[0]?.schemaVersion, 'uiux-activation-v1');
  });

  it('creates a Work only on an explicit action and reuses E1 source references', async () => {
    const { service } = setup();
    const work = await service.createCreativeWork(owner, {
      intent: '为本周新项目准备一条克制的到店内容',
      mode: 'agent',
      sessionId: 'session-a',
      sourceReferences: [
        { id: 'task-existing', kind: 'task' },
        { id: 'asset-existing', kind: 'asset' },
      ],
    });
    const projection = await service.getCreativeWorkbench(owner);

    assert.equal(projection.works.length, 1);
    assert.deepEqual(work.sourceReferences, [
      { id: 'task-existing', kind: 'task' },
      { id: 'asset-existing', kind: 'asset' },
    ]);
    assert.equal(projection.assets.length, 0);
    assert.equal(projection.jobs.length, 0);
    assert.equal(projection.contents.length, 0);
    assert.deepEqual(
      projection.events.map((event) => event.type),
      ['first_work_created']
    );

    const remixed = await service.deriveCreativeWork(owner, work.id, {
      intent: work.intent,
      sessionId: work.sessionId,
      sourceReferences: [{ id: 'historical-work-a', kind: 'work' }],
    });
    assert.deepEqual(remixed.sourceReferences, [
      { id: 'task-existing', kind: 'task' },
      { id: 'asset-existing', kind: 'asset' },
      { id: 'historical-work-a', kind: 'work' },
    ]);
    assert.equal((await service.getCreativeWorkbench(owner)).jobs.length, 0);
  });

  it('persists content modules and inherited source fields into the Work and Job snapshot', async () => {
    const { executor, service } = setup();
    const canvasWork = await service.createBlankWork(owner, {
      height: 1350,
      name: '继承来源模板',
      width: 1080,
    });
    const sourceTemplate = await service.saveUserTemplate(owner, {
      name: '继承来源模板',
      workId: canvasWork.id,
    });
    const work = await service.createCreativeWork(owner, {
      contentModules: ['store_intro', 'review_card'],
      intent: '为门店准备一组介绍与好评内容',
      mode: 'agent',
      sessionId: 'session-content-suite',
      sourceReferences: [
        {
          id: sourceTemplate.id,
          inheritanceFields: [
            'content_structure',
            'layout_slots',
            'copy_skeleton',
            'output_specification',
          ],
          kind: 'template',
        },
      ],
    });

    assert.deepEqual(work.contentModules, ['store_intro', 'review_card']);
    assert.deepEqual(work.sourceReferences[0]?.inheritanceFields, [
      'content_structure',
      'layout_slots',
      'copy_skeleton',
      'output_specification',
    ]);

    const updated = await service.updateCreativeWorkDraft(owner, work.id, {
      contentModules: ['before_after', 'price_card'],
    });
    assert.deepEqual(updated.contentModules, ['before_after', 'price_card']);

    await service.submitCreativeWork(
      owner,
      work.id,
      { ...contract, contentModules: ['before_after', 'price_card'] },
      'content-suite-submit'
    );

    assert.deepEqual(executor.contracts[0]?.contentModules, [
      'before_after',
      'price_card',
    ]);
    const projection = await service.getCreativeWorkbench(owner);
    assert.deepEqual(projection.jobs[0]?.contract.contentModules, [
      'before_after',
      'price_card',
    ]);
    assert.deepEqual(
      projection.jobs[0]?.inheritanceContext,
      executor.inheritanceContexts[0]
    );

    await assert.rejects(
      service.updateCreativeWorkDraft(owner, work.id, { contentModules: [] }),
      (error: unknown) =>
      error instanceof OperationsError &&
        error.code === 'INVALID_CONTENT_MODULES'
    );
  });

  it('snapshots only selected structural facts for submit and copy stream execution', async () => {
    const { executor, service } = setup();
    const canvasWork = await service.createBlankWork(owner, {
      height: 1350,
      name: 'Safe inheritance source',
      width: 1080,
    });
    await service.saveCanvasRevision(
      owner,
      canvasWork.id,
      {
        height: 1350,
        pages: [
          {
            elements: [
              {
                fill: '#Ab12Cd',
                fontFamily: 'Inter',
                fontSize: 48,
                height: 120,
                id: 'private-copy-slot',
                kind: 'text',
                rotation: 0,
                text: 'Private Store 18888888888 price 99',
                width: 800,
                x: 100,
                y: 100,
              },
              {
                assetId: 'internal-owned-asset-id',
                height: 700,
                id: 'private-media-slot',
                kind: 'image',
                rotation: 0,
                src: 'https://private.example/original-media.png',
                width: 900,
                x: 90,
                y: 300,
              },
            ],
            id: 'source-page',
          },
        ],
        width: 1080,
      },
      canvasWork.currentRevisionId
    );
    const sourceTemplate = await service.saveUserTemplate(owner, {
      name: 'Safe inheritance source',
      workId: canvasWork.id,
    });
    const sourceReferences: CreativeSourceReference[] = [
      {
        id: sourceTemplate.id,
        inheritanceFields: [
          'content_structure',
          'layout_slots',
          'copy_skeleton',
          'output_specification',
        ],
        kind: 'template',
      },
    ];

    const submittedWork = await service.createCreativeWork(owner, {
      intent: 'Reuse the selected safe structure',
      mode: 'agent',
      sessionId: 'session-safe-inheritance-submit',
      sourceReferences,
    });
    const submitted = await service.submitCreativeWork(
      owner,
      submittedWork.id,
      contract,
      'safe-inheritance-submit'
    );
    const expectedContext: CreativeInheritanceContext = {
      sources: [
        {
          facts: [
            { field: 'content_structure', pageCount: 1 },
            {
              field: 'layout_slots',
              mediaSlotCount: 1,
              pageCount: 1,
              textSlotCount: 1,
            },
            {
              emphasisLevelCount: 1,
              field: 'copy_skeleton',
              textSlotCount: 1,
            },
            {
              field: 'output_specification',
              height: 1350,
              pageCount: 1,
              width: 1080,
            },
          ],
          kind: 'template',
        },
      ],
    };
    assert.deepEqual(executor.inheritanceContexts[0], expectedContext);
    assert.deepEqual(submitted.job.inheritanceContext, expectedContext);

    const streamedWork = await service.createCreativeWork(owner, {
      intent: 'Reuse the same selected safe structure',
      mode: 'agent',
      sessionId: 'session-safe-inheritance-stream',
      sourceReferences,
    });
    const streamed = await service.startCreativeCopyStream(
      owner,
      streamedWork.id,
      contract,
      'safe-inheritance-stream'
    );
    const completedStream = await streamed.completion;
    assert.deepEqual(executor.streamInheritanceContexts[0], expectedContext);
    assert.deepEqual(completedStream.job.inheritanceContext, expectedContext);

    const serialized = JSON.stringify(expectedContext);
    assert.doesNotMatch(serialized, /Private Store|18888888888|price 99/);
    assert.doesNotMatch(serialized, /private\.example|internal-owned-asset-id/);
    assert.doesNotMatch(serialized, /#ab12cd|Inter|visual_style/i);
  });

  it('fails closed before Job creation when an inherited source is unavailable', async () => {
    const { service } = setup();
    const work = await service.createCreativeWork(owner, {
      intent: 'Reuse a missing source structure',
      mode: 'agent',
      sessionId: 'session-missing-inheritance-source',
      sourceReferences: [
        {
          id: 'missing-template',
          inheritanceFields: ['content_structure'],
          kind: 'template',
        },
      ],
    });

    await assert.rejects(
      service.submitCreativeWork(
        owner,
        work.id,
        contract,
        'missing-inheritance-source'
      ),
      (error: unknown) =>
        error instanceof OperationsError &&
        error.code === 'CREATIVE_INHERITANCE_SOURCE_NOT_FOUND' &&
        error.status === 404
    );
    assert.equal((await service.getCreativeWorkbench(owner)).jobs.length, 0);
  });

  it('keeps retry-family executions on the original inheritance snapshot', async () => {
    const { executor, service } = setup();
    const admin: OperationContext = {
      ...owner,
      actor: 'admin',
      userId: 'admin-inheritance-snapshot',
    };
    await service.seedOfficialTemplateFamilies(admin);
    const template = (
      await service.listTemplates(owner, { families: ['social_cover'] })
    )[0];
    assert.ok(template);
    const sourceReferences: CreativeSourceReference[] = [
      {
        id: template.id,
        inheritanceFields: ['output_specification'],
        kind: 'template',
      },
    ];
    const originalWork = await service.createCreativeWork(owner, {
      intent: 'Create from the original template structure',
      mode: 'agent',
      sessionId: 'session-original-template-snapshot',
      sourceReferences,
    });
    const original = await service.submitCreativeWork(
      owner,
      originalWork.id,
      contract,
      'original-template-snapshot'
    );

    const replacement = await service.createTemplateVersion(admin, {
      document: {
        height: 640,
        pages: [{ elements: [], id: 'replacement-page' }],
        width: 320,
      },
      templateId: template.id,
    });
    await service.publishTemplateVersion(
      admin,
      template.id,
      replacement.id
    );

    const rerolled = await service.rerollCreativeJob(
      owner,
      original.job.id,
      'reroll-original-template-snapshot'
    );
    assert.deepEqual(
      rerolled.job.inheritanceContext,
      original.job.inheritanceContext
    );

    const freshWork = await service.createCreativeWork(owner, {
      intent: 'Create from the replacement template structure',
      mode: 'agent',
      sessionId: 'session-replacement-template-snapshot',
      sourceReferences,
    });
    const fresh = await service.submitCreativeWork(
      owner,
      freshWork.id,
      contract,
      'replacement-template-snapshot'
    );
    assert.notDeepEqual(
      fresh.job.inheritanceContext,
      original.job.inheritanceContext
    );
    assert.deepEqual(executor.inheritanceContexts, [
      original.job.inheritanceContext,
      original.job.inheritanceContext,
      fresh.job.inheritanceContext,
    ]);
  });

  it('rebuilds canonical history from persisted objects without creating duplicate facts', async () => {
    const { service } = setup();
    const creativeWork = await service.createCreativeWork(owner, {
      intent: '为本周项目准备一条内容',
      mode: 'agent',
      sessionId: 'session-history',
      sourceReferences: [],
    });
    const canvasWork = await service.createBlankWork(owner, {
      height: 1350,
      name: '本周价格卡',
      width: 1080,
    });

    const history = await service.getCanonicalHistory(owner);

    assert.deepEqual(history.sessions, [
      {
        createdAt: creativeWork.createdAt,
        id: 'session-history',
        updatedAt: creativeWork.updatedAt,
        workIds: [creativeWork.id],
      },
    ]);
    assert.deepEqual(
      history.creativeWorks.map((work) => work.id),
      [creativeWork.id]
    );
    assert.deepEqual(
      history.canvasWorks.map((work) => work.id),
      [canvasWork.id]
    );
    assert.equal(
      'document' in history.canvasWorks[0]!.revisions[0]!,
      false
    );
    assert.deepEqual(history.assets, []);
    assert.deepEqual(history.contents, []);
    assert.deepEqual(history.jobs, []);

    const page = await service.getCanonicalHistory(owner, {
      limit: 1,
      offset: 0,
    });
    assert.equal(page.canvasWorks.length, 1);
    assert.deepEqual(page.pageInfo, {
      limit: 1,
      offset: 0,
      totals: {
        assets: 0,
        canvasWorks: 1,
        contents: 0,
        creativeWorks: 1,
        exportReceipts: 0,
        imageJobs: 0,
        jobs: 0,
        sessions: 1,
        tasks: 0,
      },
    });
  });

  it('rejects non-live models before Job creation and persists Work to Job to Assets to accepted Content', async () => {
    const { executor, service } = setup();
    const work = await service.createCreativeWork(owner, {
      intent: '写一条真实的门店项目介绍',
      mode: 'agent',
      sessionId: 'session-model',
      sourceReferences: [],
    });
    executor.available = false;
    await assert.rejects(
      service.submitCreativeWork(owner, work.id, contract, 'submit-unavailable'),
      /Only active and live-verified/
    );
    assert.equal((await service.getCreativeWorkbench(owner)).jobs.length, 0);

    executor.available = true;
    const result = await service.submitCreativeWork(
      owner,
      work.id,
      contract,
      'submit-live'
    );
    assert.equal(result.work.status, 'completed');
    assert.equal(result.job.status, 'completed');
    assert.equal(result.job.batchRootJobId, result.job.id);
    assert.equal(result.job.batchNumber, 1);
    assert.equal(result.job.qualityRetryNumber, 0);
    assert.equal(result.job.productUsageQuantity, 1);
    assert.equal(result.assets.length, 3);
    assert.deepEqual(
      result.assets.map((asset) => asset.candidateIndex),
      [0, 1, 2]
    );
    assert.equal(result.contents.length, 0);
    assert.deepEqual(
      (await service.getCreativeWorkbench(owner)).events.map(
        (event) => event.type
      ),
      ['first_work_created', 'first_job_submitted', 'first_assets_visible']
    );

    const accepted = await service.acceptCreativeAsset(
      owner,
      result.assets[0]!.id
    );
    assert.equal(accepted.status, 'accepted');
    assert.deepEqual(accepted.assetIds, [result.assets[0]!.id]);
    assert.equal(
      (await service.getCreativeWorkbench(owner)).works[0]?.status,
      'accepted'
    );
    assert.equal(
      (await service.acceptCreativeAsset(owner, result.assets[0]!.id)).id,
      accepted.id
    );
    await assert.rejects(
      service.acceptCreativeAsset(owner, result.assets[1]!.id),
      (error: unknown) =>
        error instanceof OperationsError &&
        error.code === 'COPY_CANDIDATE_ALREADY_ACCEPTED' &&
        error.status === 409
    );
    assert.equal(
      (await service.getCreativeWorkbench(owner)).contents.length,
      1
    );
    const events = (await service.getCreativeWorkbench(owner)).events;
    assert.deepEqual(
      events.map((event) => event.type),
      [
        'first_work_created',
        'first_job_submitted',
        'first_assets_visible',
        'first_content_accepted',
      ]
    );
    assert.ok(
      events.every(
        (event) =>
          event.correlationId === owner.correlationId &&
          event.schemaVersion === 'uiux-activation-v1'
      )
    );
  });

  it('rechecks ContentPackage ownership inside the lock before accepting legacy content', async () => {
    let contentOwner: 'legacy' | 'frozen' | 'contentpackage' = 'legacy';
    let markInitialOwnerRead = () => {};
    const initialOwnerRead = new Promise<void>((resolve) => {
      markInitialOwnerRead = resolve;
    });
    let ownerReads = 0;
    const { repository, service } = setup(
      new RecordedCreationExecutor(),
      undefined,
      undefined,
      {
        async get() {
          ownerReads += 1;
          if (ownerReads === 1) markInitialOwnerRead();
          return contentOwner;
        },
      }
    );
    const work = await service.createCreativeWork(owner, {
      intent: '验证迁移切换窗口',
      mode: 'agent',
      sessionId: 'session-content-owner-race',
      sourceReferences: [],
    });
    const result = await service.submitCreativeWork(
      owner,
      work.id,
      contract,
      'submit-content-owner-race'
    );
    let releaseLock = () => {};
    let markLockAcquired = () => {};
    const lockAcquired = new Promise<void>((resolve) => {
      markLockAcquired = resolve;
    });
    const lockGate = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const holding = repository.withWorkspaceLock(
      owner.workspaceId,
      async () => {
        markLockAcquired();
        await lockGate;
      }
    );
    await lockAcquired;

    const accepting = service.acceptCreativeAsset(owner, result.assets[0]!.id);
    await initialOwnerRead;
    contentOwner = 'frozen';
    releaseLock();
    await holding;

    await assert.rejects(
      accepting,
      (error) =>
        error instanceof OperationsError &&
        error.code === 'CONTENT_COMMANDS_FROZEN'
    );
    assert.equal((await service.getCreativeWorkbench(owner)).contents.length, 0);
  });

  it('completes a Work when image generation persists its owned Asset', async () => {
    const executor = new RecordedCreationExecutor();
    executor.results.push({
      asset: {
        contentType: 'image/png',
        id: 'provider-image-a',
        objectKey: 'workspace-a/generated/image-a.png',
        sha256: 'image-a-sha256',
      },
      providerJobId: 'provider-image-job-a',
      routeSnapshotId: 'route-image-a',
      status: 'completed',
    });
    const { service } = setup(executor);
    const work = await service.createCreativeWork(owner, {
      intent: '生成一张真实门店图片',
      mode: 'agent',
      sessionId: 'session-image-completion',
      sourceReferences: [],
    });
    await service.updateCreativeWorkBrief(owner, work.id, {
      action: 'adopt',
      aiDraft: '生成一张真实门店图片',
      field: 'intent',
    });
    await service.confirmCreativeWorkBrief(owner, work.id);

    const result = await service.submitCreativeWork(
      owner,
      work.id,
      {
        ...contract,
        aspectRatio: '1:1',
        catalogModelId: 'image-live',
        operation: 'image.generate',
        outputCount: 1,
        outputLabel: '1 张图片',
      },
      'submit-image-completion'
    );

    assert.equal(result.job.status, 'completed');
    assert.equal(result.assets.length, 1);
    assert.equal(result.work.status, 'completed');
  });

  it('fails media generation that reports completion without a usable Asset', async () => {
    const executor = new RecordedCreationExecutor();
    executor.results.push({
      providerJobId: 'provider-image-without-asset',
      routeSnapshotId: 'route-image-without-asset',
      status: 'completed',
    });
    const { service } = setup(executor);
    const work = await service.createCreativeWork(owner, {
      intent: '生成一张门店图片',
      mode: 'agent',
      sessionId: 'session-image-without-asset',
      sourceReferences: [],
    });

    const result = await service.submitCreativeWork(
      owner,
      work.id,
      {
        ...contract,
        aspectRatio: '1:1',
        catalogModelId: 'image-live',
        operation: 'image.generate',
        outputCount: 1,
        outputLabel: '1 张图片',
      },
      'submit-image-without-asset'
    );

    assert.equal(result.job.status, 'failed');
    assert.equal(result.job.failureCode, 'MISSING_MEDIA_ASSET');
    assert.deepEqual(result.assets, []);
    assert.equal(result.work.status, 'failed');
  });

  it('fails an incomplete copy batch without persisting adoptable Assets', async () => {
    const { executor, service } = setup();
    const work = await service.createCreativeWork(owner, {
      intent: '生成三条可比较的项目文案',
      mode: 'agent',
      sessionId: 'session-incomplete-copy',
      sourceReferences: [],
    });
    executor.results.push({
      copyCandidates: threeCandidates().slice(0, 2),
      providerJobId: 'provider-incomplete-copy',
      routeSnapshotId: 'route-incomplete-copy',
      status: 'completed',
    });

    const result = await service.submitCreativeWork(
      owner,
      work.id,
      contract,
      'incomplete-copy'
    );

    assert.equal(result.job.status, 'failed');
    assert.equal(result.job.failureCode, 'INVALID_COPY_CANDIDATE_COUNT');
    assert.deepEqual(result.job.outputAssetIds, []);
    assert.deepEqual(result.assets, []);
    assert.deepEqual(result.contents, []);
  });

  it('creates paid rerolls and at most two zero-usage quality retries on the fixed model', async () => {
    const { executor, service } = setup();
    const work = await service.createCreativeWork(owner, {
      intent: '生成可选优的门店文案',
      mode: 'agent',
      sessionId: 'session-copy-reroll',
      sourceReferences: [],
    });
    const root = await service.submitCreativeWork(
      owner,
      work.id,
      contract,
      'copy-root'
    );
    executor.qualityErrors.push(new Error('quality telemetry unavailable'));

    const paid = await service.rerollCreativeJob(
      owner,
      root.job.id,
      'copy-paid-reroll'
    );
    assert.equal(paid.job.rerollOf, root.job.id);
    assert.equal(paid.job.rerollKind, 'paid');
    assert.equal(paid.job.batchRootJobId, paid.job.id);
    assert.equal(paid.job.batchNumber, 2);
    assert.equal(paid.job.qualityRetryNumber, 0);
    assert.equal(paid.job.productUsageQuantity, 1);
    assert.equal(paid.job.workId, root.job.workId);
    assert.deepEqual(paid.job.contract, root.job.contract);
    assert.equal(paid.job.contract.catalogModelId, root.job.contract.catalogModelId);
    assert.equal(executor.calls.length, 2);

    const replayedPaid = await service.rerollCreativeJob(
      owner,
      root.job.id,
      'copy-paid-reroll'
    );
    assert.equal(replayedPaid.job.id, paid.job.id);
    assert.equal(executor.calls.length, 2);

    const qualityOne = await service.qualityRetryCreativeJob(
      owner,
      paid.job.id,
      'copy-quality-one'
    );
    const qualityTwo = await service.qualityRetryCreativeJob(
      owner,
      qualityOne.job.id,
      'copy-quality-two'
    );
    assert.equal(qualityOne.job.batchRootJobId, paid.job.id);
    assert.equal(qualityOne.job.rerollKind, 'quality');
    assert.equal(qualityOne.job.qualityRetryNumber, 1);
    assert.equal(qualityOne.job.productUsageQuantity, 0);
    assert.equal(qualityOne.job.batchNumber, 3);
    assert.deepEqual(qualityOne.job.contract, paid.job.contract);
    assert.equal(qualityTwo.job.batchRootJobId, paid.job.id);
    assert.equal(qualityTwo.job.qualityRetryNumber, 2);
    assert.equal(qualityTwo.job.productUsageQuantity, 0);
    assert.equal(qualityTwo.job.batchNumber, 4);
    assert.deepEqual(executor.productUsageQuantities, [1, 1, 0, 0]);
    assert.ok(
      executor.contracts.every(
        (submitted) =>
          submitted.catalogModelId === root.job.contract.catalogModelId
      )
    );

    await assert.rejects(
      service.qualityRetryCreativeJob(
        owner,
        qualityTwo.job.id,
        'copy-quality-three'
      ),
      (error: unknown) =>
        error instanceof OperationsError &&
        error.code === 'QUALITY_RETRY_LIMIT_REACHED' &&
        error.status === 409
    );
    assert.equal(executor.calls.length, 4);
  });

  it('accepts only one copy candidate across a quality-retry batch family', async () => {
    const { service } = setup();
    const work = await service.createCreativeWork(owner, {
      intent: '生成可选优的门店文案',
      mode: 'agent',
      sessionId: 'session-copy-quality-family',
      sourceReferences: [],
    });
    const root = await service.submitCreativeWork(
      owner,
      work.id,
      contract,
      'quality-family-root'
    );
    const paid = await service.rerollCreativeJob(
      owner,
      root.job.id,
      'quality-family-paid'
    );
    const quality = await service.qualityRetryCreativeJob(
      owner,
      paid.job.id,
      'quality-family-retry'
    );
    await service.acceptCreativeAsset(owner, paid.assets[0]!.id);

    await assert.rejects(
      service.acceptCreativeAsset(owner, quality.assets[0]!.id),
      (error: unknown) =>
        error instanceof OperationsError &&
        error.code === 'COPY_CANDIDATE_ALREADY_ACCEPTED' &&
        error.status === 409
    );
  });

  it('accepts only one copy candidate across paid reroll batches in one Work', async () => {
    const { service } = setup();
    const work = await service.createCreativeWork(owner, {
      intent: '生成可选优的门店文案',
      mode: 'agent',
      sessionId: 'session-copy-paid-batches',
      sourceReferences: [],
    });
    const root = await service.submitCreativeWork(
      owner,
      work.id,
      contract,
      'paid-batches-root'
    );
    const paid = await service.rerollCreativeJob(
      owner,
      root.job.id,
      'paid-batches-reroll'
    );
    const accepted = await service.acceptCreativeAsset(
      owner,
      root.assets[0]!.id
    );
    assert.equal(
      (await service.acceptCreativeAsset(owner, root.assets[0]!.id)).id,
      accepted.id
    );

    await assert.rejects(
      service.acceptCreativeAsset(owner, paid.assets[0]!.id),
      (error: unknown) =>
        error instanceof OperationsError &&
        error.code === 'COPY_CANDIDATE_ALREADY_ACCEPTED' &&
        error.status === 409
    );
  });

  it('rejects a submission key replayed for a different creative action', async () => {
    const { executor, service } = setup();
    const work = await service.createCreativeWork(owner, {
      intent: '生成可选优的门店文案',
      mode: 'agent',
      sessionId: 'session-copy-replay-action',
      sourceReferences: [],
    });
    const root = await service.submitCreativeWork(
      owner,
      work.id,
      contract,
      'shared-creative-key'
    );

    await assert.rejects(
      service.qualityRetryCreativeJob(
        owner,
        root.job.id,
        'shared-creative-key'
      ),
      (error: unknown) =>
        error instanceof OperationsError &&
        error.code === 'IDEMPOTENCY_CONFLICT' &&
        error.status === 409
    );
    assert.equal(executor.calls.length, 1);
  });

  it('rejects a submission key replayed with a different creative contract', async () => {
    const { executor, service } = setup();
    const work = await service.createCreativeWork(owner, {
      intent: '生成可选优的门店文案',
      mode: 'agent',
      sessionId: 'session-copy-replay-contract',
      sourceReferences: [],
    });
    await service.submitCreativeWork(
      owner,
      work.id,
      contract,
      'shared-contract-key'
    );

    await assert.rejects(
      service.submitCreativeWork(
        owner,
        work.id,
        { ...contract, quoteRevision: 'quote-live-v2' },
        'shared-contract-key'
      ),
      (error: unknown) =>
        error instanceof OperationsError &&
        error.code === 'IDEMPOTENCY_CONFLICT' &&
        error.status === 409
    );
    assert.equal(executor.calls.length, 1);
  });

  it('reports replay payload conflicts before rechecking current model availability', async () => {
    const { executor, service } = setup();
    const work = await service.createCreativeWork(owner, {
      intent: '生成可选优的门店文案',
      mode: 'agent',
      sessionId: 'session-copy-replay-offline',
      sourceReferences: [],
    });
    await service.submitCreativeWork(
      owner,
      work.id,
      contract,
      'shared-offline-key'
    );
    executor.available = false;

    await assert.rejects(
      service.submitCreativeWork(
        owner,
        work.id,
        { ...contract, quoteRevision: 'quote-offline-v2' },
        'shared-offline-key'
      ),
      (error: unknown) =>
        error instanceof OperationsError &&
        error.code === 'IDEMPOTENCY_CONFLICT' &&
        error.status === 409
    );
  });

  it('derives source data classes on the server and resumes a submitting Job with the same key', async () => {
    const executor = new RecordedCreationExecutor();
    const resolvedAssets: string[] = [];
    const { service } = setup(executor, {
      async resolve(workspaceId, assetId) {
        assert.equal(workspaceId, owner.workspaceId);
        resolvedAssets.push(assetId);
        return ['contains_face', 'pii'];
      },
    });
    const work = await service.createCreativeWork(owner, {
      intent: '基于已授权素材生成内容',
      mode: 'agent',
      sessionId: 'session-sensitive-source',
      sourceReferences: [{ id: 'asset-sensitive', kind: 'asset' }],
    });
    executor.submissionErrors.push(new Error('response lost'));
    await assert.rejects(
      service.submitCreativeWork(owner, work.id, contract, 'stable-submit-key'),
      /response lost/
    );
    const interrupted = await service.getCreativeWorkbench(owner);
    assert.equal(interrupted.jobs[0]?.status, 'submitting');

    executor.results.push({
      copyCandidates: threeCandidates('恢复结果', '没有重复创建 Job。'),
      providerJobId: 'provider-recovered',
      routeSnapshotId: 'route-recovered',
      status: 'completed',
    });
    const recovered = await service.resumeCreativeJob(
      owner,
      interrupted.jobs[0]!.id
    );
    assert.equal(recovered.job.id, interrupted.jobs[0]?.id);
    assert.equal(recovered.job.status, 'completed');
    assert.deepEqual(executor.calls, ['stable-submit-key', 'stable-submit-key']);
    assert.deepEqual(resolvedAssets, ['asset-sensitive']);
    assert.deepEqual(executor.contracts[0]?.dataClass, [
      'contains_face',
      'pii',
    ]);
  });

  it('keeps a completed Job terminal when an older verification returns late', async () => {
    const { executor, service } = setup();
    const work = await service.createCreativeWork(owner, {
      intent: '核验并发任务的终态单调性',
      mode: 'agent',
      sessionId: 'session-monotonic',
      sourceReferences: [],
    });
    executor.results.push({
      providerJobId: 'provider-concurrent',
      routeSnapshotId: 'route-concurrent',
      status: 'running',
    });
    const running = await service.submitCreativeWork(
      owner,
      work.id,
      contract,
      'monotonic-job'
    );
    let releaseOlder = (_result: CreationExecutionResult) => {};
    const older = new Promise<CreationExecutionResult>((resolve) => {
      releaseOlder = resolve;
    });
    executor.verificationResults.push(
      older,
      Promise.resolve({
        copyCandidates: threeCandidates('最终结果', '终态不可倒退。'),
        providerJobId: 'provider-concurrent',
        routeSnapshotId: 'route-concurrent',
        status: 'completed',
      })
    );
    const late = service.resumeCreativeJob(owner, running.job.id);
    await new Promise((resolve) => setImmediate(resolve));
    const completed = await service.resumeCreativeJob(owner, running.job.id);
    assert.equal(completed.job.status, 'completed');
    releaseOlder({
      providerJobId: 'provider-concurrent',
      routeSnapshotId: 'route-concurrent',
      status: 'running',
    });
    assert.equal((await late).job.status, 'completed');
  });

  it('resumes recoverable on the same Job, verifies unknown, and creates retryOf and derivedFrom objects', async () => {
    const { executor, service } = setup();
    const work = await service.createCreativeWork(owner, {
      intent: '生成一条可恢复的项目内容',
      mode: 'agent',
      sessionId: 'session-recovery',
      sourceReferences: [],
    });
    executor.results.push(
      {
        failureCode: 'RATE_LIMITED',
        providerJobId: 'provider-recoverable',
        routeSnapshotId: 'route-recoverable',
        status: 'recoverable',
      },
      {
        copyCandidates: threeCandidates('恢复完成', '同一个任务继续。'),
        providerJobId: 'provider-recoverable',
        routeSnapshotId: 'route-recoverable',
        status: 'completed',
      }
    );
    const recoverable = await service.submitCreativeWork(
      owner,
      work.id,
      contract,
      'recover-same-job'
    );
    const resumed = await service.resumeCreativeJob(owner, recoverable.job.id);
    assert.equal(resumed.job.id, recoverable.job.id);
    assert.deepEqual(executor.calls, ['recover-same-job', 'recover-same-job']);

    const unknownWork = await service.deriveCreativeWork(owner, work.id, {
      intent: '核验不明结果',
      sessionId: 'session-unknown',
    });
    executor.results.push({
      failureCode: 'ACCEPTANCE_UNKNOWN',
      providerJobId: 'provider-unknown',
      routeSnapshotId: 'route-unknown',
      status: 'unknown',
    });
    const unknown = await service.submitCreativeWork(
      owner,
      unknownWork.id,
      contract,
      'unknown-job'
    );
    await service.resumeCreativeJob(owner, unknown.job.id);
    assert.equal(executor.calls.filter((key) => key === 'unknown-job').length, 1);
    assert.deepEqual(executor.verifyCalls, ['provider-unknown']);

    const runningWork = await service.deriveCreativeWork(owner, work.id, {
      intent: '恢复同一个异步任务',
      sessionId: 'session-running',
    });
    executor.results.push({
      providerJobId: 'provider-running',
      routeSnapshotId: 'route-running',
      status: 'running',
    });
    executor.verificationResults.push({
      copyCandidates: threeCandidates('异步恢复完成', '沿用原任务。'),
      providerJobId: 'provider-running',
      routeSnapshotId: 'route-running',
      status: 'completed',
    });
    const running = await service.submitCreativeWork(
      owner,
      runningWork.id,
      contract,
      'running-job'
    );
    const recovered = await service.resumeCreativeJob(owner, running.job.id);
    assert.equal(recovered.job.id, running.job.id);
    assert.equal(recovered.job.status, 'completed');
    assert.ok(recovered.job.recoveredAt);

    const failedWork = await service.deriveCreativeWork(owner, work.id, {
      intent: '失败后新建重试',
      sessionId: 'session-failed',
    });
    executor.results.push(
      {
        failureCode: 'TERMINAL_FAILURE',
        providerJobId: 'provider-failed',
        routeSnapshotId: 'route-failed',
        status: 'failed',
      },
      {
        copyCandidates: threeCandidates('重试完成', '新任务完成。'),
        providerJobId: 'provider-retry',
        routeSnapshotId: 'route-retry',
        status: 'completed',
      }
    );
    const failed = await service.submitCreativeWork(
      owner,
      failedWork.id,
      contract,
      'failed-job'
    );
    const retry = await service.retryCreativeJob(
      owner,
      failed.job.id,
      'retry-job'
    );
    assert.notEqual(retry.job.id, failed.job.id);
    assert.equal(retry.job.retryOf, failed.job.id);
    assert.equal(retry.job.rerollOf, undefined);
    assert.equal(retry.job.rerollKind, undefined);
    assert.equal(retry.job.batchRootJobId, failed.job.batchRootJobId);
    assert.equal(retry.job.batchNumber, failed.job.batchNumber);
    assert.equal(retry.job.qualityRetryNumber, failed.job.qualityRetryNumber);
    assert.equal(retry.job.productUsageQuantity, 1);
    assert.equal(unknownWork.derivedFrom, work.id);
    assert.equal(failedWork.derivedFrom, work.id);
  });
});
