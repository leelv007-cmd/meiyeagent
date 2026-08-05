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
  type CreativeOperation,
  type CreativeSourceReference,
  type OperationContext,
} from './index.js';
import type { BillingLifecyclePort } from '../product-billing/lifecycle-port.js';
import { ProductCreativeGroundingResolver } from '../../product/p1-model-policy.js';
import type { ProductRepository } from '../../product/repository.js';
import type { ProductQuoteSnapshot, ProductState } from '@meiye/contracts';

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

function acceptedProductQuote(input: {
  quoteId?: string;
  taskId?: string;
  executionContract?: CreativeExecutionContract;
} = {}): ProductQuoteSnapshot {
  const executionContract = input.executionContract ?? contract;
  return {
    billingMode: 'per_request',
    catalogModelId: executionContract.catalogModelId,
    catalogModelRevision: executionContract.catalogRevision,
    confirmedAmount: executionContract.estimatedAmount,
    formula: {
      currency: executionContract.currency,
      expression: 'server accepted product quote',
      unitRate: executionContract.estimatedAmount,
    },
    lifecycleStatus: 'confirmed',
    outputCount: executionContract.outputCount,
    outputLabel: executionContract.outputLabel,
    quoteId: input.quoteId ?? 'quote-accepted',
    quotePolicyRevision: 'quote-policy-r1',
    revision: executionContract.quoteRevision,
    taskId: input.taskId,
    workspaceId: owner.workspaceId,
  };
}

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
  contracts: CreativeExecutionContract[] = [];
  briefSnapshots: Array<CreativeBrief | undefined> = [];
  groundingSnapshots: Array<CreativeGroundingSnapshot | undefined> = [];
  inheritanceContexts: Array<CreativeInheritanceContext | undefined> = [];
  verifyCalls: string[] = [];
  productUsageQuantities: Array<0 | 1 | undefined> = [];
  billingTasks: Array<{ taskId?: string; quoteRevision?: string }> = [];
  inspectionAuthorities: unknown[] = [];
  inspectionEvents?: string[];
  qualityEvents: Array<{ rerollKind: 'paid' | 'quality'; targetJobId: string }> = [];
  qualityErrors: Error[] = [];
  available = true;
  submissionErrors: Error[] = [];
  results: CreationExecutionResult[] = [];
  verificationResults: Array<
    CreationExecutionResult | Promise<CreationExecutionResult>
  > = [];

  async inspect(
    _workspaceId?: string,
    _contract?: CreativeExecutionContract,
    authority?: Parameters<CreationExecutorPort['inspect']>[2],
  ) {
    this.inspectionAuthorities.push(authority);
    this.inspectionEvents?.push('inspect');
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
    this.billingTasks.push({
      taskId: input.billingTaskId,
      quoteRevision: input.billingQuoteRevision,
    });
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
  },
  billingLifecycle?: BillingLifecyclePort,
  clock?: () => Date,
) {
  const repository = new MemoryOperationsRepository();
  repository.grantMembership(owner.userId, owner.workspaceId);
  const defaultBillingLifecycle: BillingLifecyclePort = {
    assertAcceptedQuote(input) {
      return acceptedProductQuote({
        quoteId: input.quoteId,
        taskId: input.taskId,
      });
    },
    beforeSubmit() {},
    dispatchAttempt() {},
    settleTask() {},
  };
  const service = new OperationsApplicationService(repository, {
    assetDataClassResolver,
    billingLifecycle: billingLifecycle ?? defaultBillingLifecycle,
    clock,
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
  it('enforces the server Brief gate at Composer create and submit', async () => {
    const { service } = setup();
    const checks: Array<{
      briefConfirmationId?: string;
      briefContextId: string;
      operation: CreativeOperation;
      workspaceId: string;
    }> = [];
    service.attachBriefSubmissionGate({
      async assertCurrent(input) {
        checks.push(input);
      },
    });
    await assert.rejects(
      () =>
        service.createCreativeWork(owner, {
          autoConfirmBrief: true,
          intent: '为门店写三条内容',
          mode: 'direct',
          operation: 'video.generate',
          sessionId: 'plain-session-cannot-bypass',
          sourceReferences: [],
        }),
      (error: unknown) => {
        assert.ok(error instanceof OperationsError);
        assert.equal(error.code, 'BRIEF_CONTEXT_REQUIRED');
        return true;
      },
    );
    const work = await service.createCreativeWork(owner, {
      autoConfirmBrief: true,
      briefConfirmationId: 'brief-confirm-1',
      briefContextId: 'brief-context-1',
      intent: '为门店写三条内容',
      mode: 'direct',
      operation: 'copy.generate',
      sessionId: 'composer:server-gated',
      sourceReferences: [],
    });
    await service.submitCreativeWork(
      owner,
      work.id,
      contract,
      'server-gated-submit',
    );
    assert.deepEqual(checks, [
      {
        briefConfirmationId: 'brief-confirm-1',
        briefContextId: 'brief-context-1',
        intent: '为门店写三条内容',
        operation: 'copy.generate',
        sourceReferenceIds: [],
        workspaceId: owner.workspaceId,
      },
      {
        briefConfirmationId: 'brief-confirm-1',
        briefContextId: 'brief-context-1',
        catalogModelId: 'llm-live',
        catalogRevision: 'catalog-live-v1',
        intent: '为门店写三条内容',
        operation: 'copy.generate',
        outputCount: 3,
        quoteRevision: 'quote-live-v1',
        sourceReferenceIds: [],
        workspaceId: owner.workspaceId,
      },
    ]);
  });


  it('allows D-046 derived autoConfirmBrief revise without a new server Brief context under the gate', async () => {
    const { service } = setup();
    service.attachBriefSubmissionGate({ async assertCurrent() {} });
    const source = await service.createCreativeWork(owner, {
      autoConfirmBrief: true,
      briefConfirmationId: 'brief-confirm-source',
      briefContextId: 'brief-context-source',
      intent: '为门店写三条内容',
      mode: 'direct',
      operation: 'copy.generate',
      sessionId: 'composer:revise-source',
      sourceReferences: [],
    });
    const revised = await service.deriveCreativeWork(owner, source.id, {
      autoConfirmBrief: true,
      intent: '为门店写三条内容\n\n调整要求：语气更柔和',
      sessionId: 'composer:revise-source',
    });
    assert.equal(revised.derivedFrom, source.id);
    assert.ok(revised.brief?.confirmedAt);
    assert.equal(revised.briefContextId, undefined);
    await service.submitCreativeWork(
      owner,
      revised.id,
      contract,
      'derived-revise-submit',
    );
  });

  it('keeps the Work Brief context and operation immutable at submit', async () => {
    const { service } = setup();
    service.attachBriefSubmissionGate({ async assertCurrent() {} });
    const work = await service.createCreativeWork(owner, {
      autoConfirmBrief: true,
      briefConfirmationId: 'brief-confirm-a',
      briefContextId: 'brief-context-a',
      intent: '为门店写三条内容',
      mode: 'direct',
      operation: 'copy.generate',
      sessionId: 'immutable-brief-binding',
      sourceReferences: [],
    });
    await assert.rejects(
      () =>
        service.submitCreativeWork(
          owner,
          work.id,
          contract,
          'replace-context',
          undefined,
          undefined,
          'brief-context-b',
          'brief-confirm-b',
        ),
      /Brief context cannot be replaced/,
    );
    await assert.rejects(
      () =>
        service.submitCreativeWork(
          owner,
          work.id,
          { ...contract, operation: 'video.generate' },
          'replace-operation',
        ),
      /execution operation must match/,
    );
  });

  it('reserves the accepted Work quote before forwarding its billing task to provider dispatch', async () => {
    const order: string[] = [];
    const executor = new RecordedCreationExecutor();
    const originalSubmit = executor.submit.bind(executor);
    executor.submit = async (input) => {
      order.push(`dispatch:${input.billingTaskId}`);
      return originalSubmit(input);
    };
    const billingLifecycle: BillingLifecyclePort = {
      beforeSubmit(input) {
        order.push(`reserve:${input.taskId}`);
        assert.equal(input.quoteRevision, contract.quoteRevision);
        assert.equal(input.workspaceId, owner.workspaceId);
      },
      dispatchAttempt() {},
      settleTask() {},
    };
    const { service } = setup(
      executor,
      undefined,
      undefined,
      undefined,
      billingLifecycle,
    );
    const work = await service.createCreativeWork(owner, {
      autoConfirmBrief: true,
      intent: '为门店写三条内容',
      mode: 'direct',
      operation: 'copy.generate',
      sessionId: 'session-billing-lifecycle',
      sourceReferences: [],
    });

    await service.submitCreativeWork(
      owner,
      work.id,
      contract,
      'billing-lifecycle-submit',
    );

    assert.deepEqual(order, [`reserve:${work.id}`, `dispatch:${work.id}`]);
    assert.deepEqual(executor.billingTasks, [
      { quoteRevision: contract.quoteRevision, taskId: work.id },
    ]);
  });

  it('binds an explicitly confirmed workspace quote to the submitted Job', async () => {
    const order: string[] = [];
    const executor = new RecordedCreationExecutor();
    executor.inspectionEvents = order;
    const validated: Array<{
      quoteId: string;
      quoteRevision: string;
      taskId: string;
      workspaceId: string;
    }> = [];
    const billingLifecycle: BillingLifecyclePort = {
      assertAcceptedQuote(input) {
        order.push('validate');
        validated.push(input);
        return acceptedProductQuote({
          quoteId: input.quoteId,
          taskId: input.taskId,
        });
      },
      beforeSubmit() {},
      dispatchAttempt() {},
      settleTask() {},
    };
    const { service } = setup(
      executor,
      undefined,
      undefined,
      undefined,
      billingLifecycle,
    );
    const work = await service.createCreativeWork(owner, {
      autoConfirmBrief: true,
      intent: '为已确认报价创建调整任务',
      mode: 'direct',
      operation: 'copy.generate',
      sessionId: 'explicit-confirmed-quote',
      sourceReferences: [],
    });
    const result = await service.submitCreativeWork(
      owner,
      work.id,
      contract,
      'explicit-confirmed-quote-submit',
      undefined,
      undefined,
      undefined,
      undefined,
      'quote-explicit-confirmed',
    );

    assert.equal(result.job.billingQuoteId, 'quote-explicit-confirmed');
    assert.deepEqual(order, ['validate', 'inspect']);
    assert.deepEqual(executor.inspectionAuthorities, [
      {
        catalogModelId: contract.catalogModelId,
        catalogModelRevision: contract.catalogRevision,
        confirmedAmount: contract.estimatedAmount,
        currency: contract.currency,
        kind: 'accepted_product_quote',
        outputCount: contract.outputCount,
        outputLabel: contract.outputLabel,
        quoteId: 'quote-explicit-confirmed',
        quoteRevision: contract.quoteRevision,
      },
    ]);
    assert.deepEqual(validated, [
      {
        quoteId: 'quote-explicit-confirmed',
        quoteRevision: contract.quoteRevision,
        taskId: work.id,
        workspaceId: owner.workspaceId,
      },
    ]);
  });

  it('rejects a Product quote whose server-accepted amount or output facts do not match the contract', async () => {
    const executor = new RecordedCreationExecutor();
    const billingLifecycle: BillingLifecyclePort = {
      assertAcceptedQuote(input) {
        return {
          ...acceptedProductQuote({
            quoteId: input.quoteId,
            taskId: input.taskId,
          }),
          confirmedAmount: contract.estimatedAmount + 1,
          outputCount: 1,
          outputLabel: '1 条内容候选',
        };
      },
      beforeSubmit() {},
      dispatchAttempt() {},
      settleTask() {},
    };
    const { service } = setup(
      executor,
      undefined,
      undefined,
      undefined,
      billingLifecycle,
    );
    const work = await service.createCreativeWork(owner, {
      autoConfirmBrief: true,
      intent: '拒绝被篡改的已确认报价',
      mode: 'direct',
      operation: 'copy.generate',
      sessionId: 'mismatched-confirmed-quote',
      sourceReferences: [],
    });

    await assert.rejects(
      service.submitCreativeWork(
        owner,
        work.id,
        contract,
        'mismatched-confirmed-quote-submit',
        undefined,
        undefined,
        undefined,
        undefined,
        'quote-mismatched-confirmed',
      ),
      /accepted Product quote no longer matches/i,
    );
    assert.deepEqual(executor.inspectionAuthorities, []);
  });


  it('persists the chosen operation before a creative work is executed', async () => {
    const { service } = setup();
    const work = await service.createCreativeWork(owner, {
      intent: '把今天的美甲实拍做成竖屏视频',
      mode: 'agent',
      operation: 'video.generate',
      sessionId: 'session-video-draft',
      sourceReferences: [],
    });

    assert.equal(work.operation, 'video.generate');
    assert.equal(work.currentJobId, undefined);
    assert.equal(
      (await service.getCreativeWorkbench(owner)).works[0]?.operation,
      'video.generate',
    );
  });

  it('auto-confirms Brief with AI draft values at creation (Day-0 zero-click seam)', async () => {
    const { service } = setup();
    const work = await service.createCreativeWork(owner, {
      intent: '为新客写一组美甲到店内容',
      mode: 'agent',
      sessionId: 'session-auto-brief',
      sourceReferences: [],
      autoConfirmBrief: true,
      briefDrafts: {
        scene: '门店内实拍',
        tone: '亲切专业',
        audience: '周边新客',
      },
    });
    assert.ok(work.brief?.confirmedAt);
    assert.equal(work.brief?.fields.intent?.owner, 'ai');
    assert.equal(work.brief?.fields.intent?.current, work.intent);
    assert.equal(work.brief?.fields.scene?.current, '门店内实拍');
    assert.equal(work.brief?.fields.tone?.current, '亲切专业');
    assert.equal(work.brief?.fields.audience?.current, '周边新客');
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

  it('derives a revise turn with an auto-confirmed brief (D-046)', async () => {
    const { service } = setup();
    const work = await service.createCreativeWork(owner, {
      intent: '推广夏日美甲新款',
      mode: 'agent',
      sessionId: 'session-revise',
      sourceReferences: [],
    });
    const revised = await service.deriveCreativeWork(owner, work.id, {
      autoConfirmBrief: true,
      briefDrafts: {
        audience: '到店老客',
        scene: '门店日常宣传',
        tone: '亲切口语',
      },
      intent: '推广夏日美甲新款（本版调整方向：更活泼一点）',
      sessionId: 'session-revise',
    });
    assert.equal(revised.derivedFrom, work.id);
    assert.ok(revised.brief?.confirmedAt);
    assert.equal(
      revised.brief?.fields.intent?.current,
      '推广夏日美甲新款（本版调整方向：更活泼一点）'
    );
    assert.equal(revised.brief?.fields.tone?.current, '亲切口语');
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



  it('rejects non-live models before Job creation and persists Work to Job to Assets', async () => {
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

    assert.equal((await service.getCreativeWorkbench(owner)).contents.length, 0);
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

/**
 * D-175. The merchant here is Day-0: no store row, so nothing is confirmed and
 * no project exists. These run the real Product resolver rather than a stub so
 * the mode split is proved end to end, from the Work through `prepareCreativeJob`
 * into the grounding snapshot the executor is handed.
 */
describe('free creation grounding', () => {
  const dayZeroProduct = {
    assets: [
      {
        authorizationStatus: 'authorized',
        consentScope: 'public_marketing',
        containsPerson: false,
        containsSensitiveData: false,
        id: 'asset-authorized',
        minorStatus: 'none',
        rightsEvidence: 'recorded',
        sourceType: 'real',
        tags: [],
      },
      {
        authorizationStatus: 'authorized',
        consentScope: 'internal_only',
        containsPerson: false,
        containsSensitiveData: false,
        id: 'asset-internal-only',
        minorStatus: 'none',
        rightsEvidence: 'recorded',
        sourceType: 'real',
        tags: [],
      },
    ],
  } as unknown as ProductState;

  function dayZeroSetup() {
    return setup(
      new RecordedCreationExecutor(),
      { async resolve() { return []; } },
      new ProductCreativeGroundingResolver({
        async load() {
          return structuredClone(dayZeroProduct);
        },
      } as unknown as ProductRepository),
    );
  }

  async function groundingRefusal(run: () => Promise<unknown>) {
    let captured: OperationsError | undefined;
    await assert.rejects(run, (error: unknown) => {
      assert.ok(error instanceof OperationsError);
      captured = error;
      return true;
    });
    assert.equal(captured!.code, 'CREATIVE_GROUNDING_INCOMPLETE');
    assert.equal(captured!.status, 409);
    return (captured!.details as { missing: string[] }).missing;
  }

  it('delivers for a Day-0 merchant who has no confirmed store or project', async () => {
    const { executor, service } = dayZeroSetup();
    const work = await service.createCreativeWork(owner, {
      creationMode: 'free',
      intent: '写三条立秋话题的内容',
      mode: 'direct',
      operation: 'copy.generate',
      sessionId: 'composer:day-zero-free',
      sourceReferences: [],
    });
    assert.equal(work.creationMode, 'free');

    const submitted = await service.submitCreativeWork(
      owner,
      work.id,
      contract,
      'day-zero-free-submit',
    );

    assert.equal(submitted.job.status, 'completed');
    // Delivered: the three candidates are readable from the workbench the
    // results surface reads, not merely returned by the executor.
    const workbench = await service.getCreativeWorkbench(owner);
    assert.equal(
      workbench.assets.filter((asset) => asset.workId === work.id).length,
      3,
    );
    // Grounded, but on nothing the merchant has not confirmed.
    const snapshot = executor.groundingSnapshots.at(-1);
    assert.ok(snapshot);
    assert.equal(snapshot.store, undefined);
    assert.deepEqual(snapshot.assets, []);
  });

  it('refuses the same Day-0 submission when the Work is customized', async () => {
    const { service } = dayZeroSetup();
    const work = await service.createCreativeWork(owner, {
      creationMode: 'customized',
      intent: '写三条立秋话题的内容',
      mode: 'direct',
      operation: 'copy.generate',
      sessionId: 'composer:day-zero-customized',
      sourceReferences: [],
    });

    assert.deepEqual(
      await groundingRefusal(() =>
        service.submitCreativeWork(
          owner,
          work.id,
          contract,
          'day-zero-customized-submit',
        ),
      ),
      ['confirmed_store', 'confirmed_project'],
    );
  });

  it('keeps the asset rights floor for free creation', async () => {
    const { service } = dayZeroSetup();
    const work = await service.createCreativeWork(owner, {
      creationMode: 'free',
      intent: '用这张内部素材写一条内容',
      mode: 'direct',
      operation: 'copy.generate',
      sessionId: 'composer:day-zero-free-rights',
      sourceReferences: [{ id: 'asset-internal-only', kind: 'asset' }],
    });

    assert.deepEqual(
      await groundingRefusal(() =>
        service.submitCreativeWork(
          owner,
          work.id,
          contract,
          'day-zero-free-rights-submit',
        ),
      ),
      ['real_authorized_asset'],
    );
  });

  it('carries free creation through 「基于此再创作」 into the next round', async () => {
    const { service } = dayZeroSetup();
    const source = await service.createCreativeWork(owner, {
      creationMode: 'free',
      intent: '写三条立秋话题的内容',
      mode: 'direct',
      operation: 'copy.generate',
      sessionId: 'composer:day-zero-free-derive',
      sourceReferences: [],
    });
    const derived = await service.deriveCreativeWork(owner, source.id, {
      intent: '写三条立秋话题的内容\n\n调整要求：更口语',
      sessionId: 'composer:day-zero-free-derive',
    });

    assert.equal(derived.creationMode, 'free');
    const submitted = await service.submitCreativeWork(
      owner,
      derived.id,
      contract,
      'day-zero-free-derive-submit',
    );
    assert.equal(submitted.job.status, 'completed');
  });
});
