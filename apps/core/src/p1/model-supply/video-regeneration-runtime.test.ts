import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProductQuoteSnapshot } from '@meiye/contracts';
import {
  ProductBillingLifecycle,
  ProductQuoteService,
} from '../product-billing/index.js';
import type {
  BillingAttemptCost,
  BillingLifecyclePort,
} from '../product-billing/lifecycle-port.js';
import type { ProductBillingApplicationPort } from '../product-billing/durable-service.js';
import type { DurableVideoWorkflow } from './video-workflow-contract.js';
import { videoFreeActions } from './video-regeneration.js';
import {
  VideoRegenerationApplicationService,
  type VideoRegenerationRepository,
  type VideoRegenerationWorkflowPort,
} from './video-regeneration-runtime.js';

class MemoryRegenerationRepository implements VideoRegenerationRepository {
  readonly bindings = new Map<string, Awaited<ReturnType<VideoRegenerationRepository['getQuoteBinding']>>>();
  readonly tasks = new Map<string, Awaited<ReturnType<VideoRegenerationRepository['getTaskBinding']>>>();
  readonly freeActions: Array<{
    action: string;
    taskId: string;
    workspaceId: string;
  }> = [];

  async saveQuoteBinding(binding: NonNullable<Awaited<ReturnType<VideoRegenerationRepository['getQuoteBinding']>>>) {
    this.bindings.set(`${binding.workspaceId}:${binding.quoteId}`, structuredClone(binding));
  }

  async getQuoteBinding(workspaceId: string, quoteId: string) {
    return structuredClone(this.bindings.get(`${workspaceId}:${quoteId}`) ?? null);
  }

  async saveTaskBinding(task: NonNullable<Awaited<ReturnType<VideoRegenerationRepository['getTaskBinding']>>>) {
    this.tasks.set(`${task.workspaceId}:${task.taskId}`, structuredClone(task));
  }

  async getTaskBinding(workspaceId: string, taskId: string) {
    return structuredClone(this.tasks.get(`${workspaceId}:${taskId}`) ?? null);
  }

  async appendFreeAction(input: {
    action: string;
    taskId: string;
    workspaceId: string;
  }) {
    this.freeActions.push(structuredClone(input));
  }
}

class BillingHarness
  implements ProductBillingApplicationPort, BillingLifecyclePort
{
  readonly quotes = new ProductQuoteService({
    clock: () => new Date('2026-07-20T12:00:00.000Z'),
  });
  private readonly lifecycle = new ProductBillingLifecycle(this.quotes);

  buildQuote = this.quotes.buildQuote.bind(this.quotes);
  getQuote(quoteId: string) {
    return this.quotes.getQuote(quoteId);
  }
  getQuoteByTask(taskId: string) {
    return this.quotes.getQuoteByTask(taskId);
  }
  confirm = this.quotes.confirm.bind(this.quotes);
  reserve = this.quotes.reserve.bind(this.quotes);
  dispatch = this.quotes.dispatch.bind(this.quotes);
  fallbackDispatch = this.quotes.fallbackDispatch.bind(this.quotes);
  settle = this.quotes.settle.bind(this.quotes);
  failAndRefund = this.quotes.failAndRefund.bind(this.quotes);
  listProviderCosts(taskId: string) {
    return this.quotes.listProviderCosts(taskId);
  }
  getUsage(taskId: string) {
    return this.quotes.getUsage(taskId);
  }
  beforeSubmit(input: Parameters<BillingLifecyclePort['beforeSubmit']>[0]) {
    return this.lifecycle.beforeSubmit(input);
  }
  dispatchAttempt(input: Parameters<BillingLifecyclePort['dispatchAttempt']>[0]) {
    return this.lifecycle.dispatchAttempt(input);
  }
  settleTask(input: Parameters<BillingLifecyclePort['settleTask']>[0]) {
    return this.lifecycle.settleTask(input);
  }
}

class WorkflowHarness implements VideoRegenerationWorkflowPort {
  readonly source: DurableVideoWorkflow = {
    actorId: 'owner-1',
    aigcLabelEnabled: true,
    attempts: [],
    catalogModelId: 'seedance-2',
    clipAssets: [],
    confirmed: true,
    createdAt: '2026-07-20T00:00:00.000Z',
    dataClass: [],
    executionContract: {
      aigcLabelEnabled: true,
      aspectRatio: '9:16',
      catalogModelId: 'seedance-2',
      catalogRevision: 'catalog-1',
      currency: 'CNY',
      dataClass: [],
      durationSeconds: 12,
      estimatedAmount: 12,
      operation: 'video.generate',
      outputCount: 1,
      outputLabel: '视频',
      quoteAcceptedAt: '2026-07-20T00:00:00.000Z',
      quoteRevision: 'source-quote',
      watermarkEnabled: false,
    },
    id: 'source-run',
    revision: 1,
    shots: [
      {
        candidates: [],
        candidatesPerShot: 1,
        durationSeconds: 4,
        id: 'opening',
        prompt: '开场',
      },
      {
        candidates: [],
        candidatesPerShot: 1,
        durationSeconds: 8,
        id: 'detail',
        prompt: '细节',
      },
    ],
    status: 'completed',
    storyboardRevision: 'story-1',
    storyboardVersion: 1,
    updatedAt: '2026-07-20T00:01:00.000Z',
    workId: 'work-1',
    workspaceId: 'workspace-1',
  };
  readonly drafts: Array<Parameters<VideoRegenerationWorkflowPort['createDraft']>[0]> = [];
  readonly adoptions: string[] = [];
  readonly recoveries: string[] = [];
  failNextDraft = false;

  async query(input: { workflowId: string; workspaceId: string }) {
    if (input.workflowId === this.source.id) return { workflow: this.source };
    const draft = this.drafts.find((item) => item.workflowId === input.workflowId);
    if (!draft) throw new Error('unknown workflow');
    return {
      workflow: {
        ...this.source,
        actorId: draft.actorId,
        attempts: [
          {
            acceptance: 'accepted' as const,
            catalogModelId: 'seedance-2',
            createdAt: '2026-07-20T12:00:00.000Z',
            deploymentId: 'deployment-a',
            id: 'attempt-recover',
            jobId: `job:${draft.workflowId}`,
            providerTaskRef: 'supplier-1',
            status: 'unknown' as const,
          },
        ],
        derivedFromWorkflowId: draft.derivedFromWorkflowId,
        id: draft.workflowId,
        shots: draft.shots.map((shot, index) =>
          typeof shot === 'string'
            ? { candidates: [], candidatesPerShot: 1, id: shot, prompt: shot }
            : { ...shot, id: shot.id ?? `shot-${index + 1}`, candidates: [] },
        ),
        status: 'running' as const,
        workId: draft.workId,
      },
    };
  }

  async createDraft(input: Parameters<VideoRegenerationWorkflowPort['createDraft']>[0]) {
    if (this.failNextDraft) {
      this.failNextDraft = false;
      throw new Error('simulated crash before workflow checkpoint');
    }
    this.drafts.push(structuredClone(input));
    return { id: input.workflowId };
  }

  async confirmAndSubmit(input: { workflowId: string; workspaceId: string }) {
    return { job: { id: `job:${input.workflowId}` }, workflow: { id: input.workflowId } };
  }

  async adoptCandidate(input: { workflowId: string; workspaceId: string }) {
    this.adoptions.push(input.workflowId);
    return { workflowId: input.workflowId };
  }

  async recoverSupplierTask(input: {
    workflowId: string;
    workspaceId: string;
  }) {
    this.recoveries.push(input.workflowId);
    return this.query(input);
  }
}

function quoteInput(
  quoteId: string,
  scope: 'shot' | 'full_compose',
) {
  return {
    actorId: 'owner-1',
    quoteId,
    scope,
    ...(scope === 'shot' ? { shotId: 'opening' } : {}),
    sourceRunId: 'source-run',
    workspaceId: 'workspace-1',
  };
}

const quoteAuthority = {
  async resolve(input: {
    catalogModelId: string;
    quoteId: string;
    targetSeconds?: number;
    workspaceId: string;
  }) {
    return {
      billingMode: 'per_output_second' as const,
      catalogModelId: input.catalogModelId,
      catalogModelRevision: 'catalog-server-1',
      minChargeSeconds: 2,
      quoteId: input.quoteId,
      quotePolicyRevision: 'quote.policy@1',
      roundingStepSeconds: 1,
      targetSeconds: input.targetSeconds,
      unitRate: 1,
      workspaceId: input.workspaceId,
    };
  },
};

function approvalHarness() {
  const approvals: Array<{
    approvalKey: string;
    contract: NonNullable<Parameters<VideoRegenerationWorkflowPort['createDraft']>[0]['executionContract']>;
    workId: string;
  }> = [];
  return {
    approvals,
    authority: {
      async approve(input: {
        approvalKey: string;
        contract: NonNullable<Parameters<VideoRegenerationWorkflowPort['createDraft']>[0]['executionContract']>;
        workId: string;
      }) {
        approvals.push(structuredClone(input));
        return { id: `approval:${input.approvalKey}` };
      },
    },
  };
}

describe('durable video regeneration application', () => {
  it('uses one quote lifecycle for shot/full scopes and persists canonical derived workflows', async () => {
    const approval = approvalHarness();
    const billing = new BillingHarness();
    const repository = new MemoryRegenerationRepository();
    const workflows = new WorkflowHarness();
    const service = new VideoRegenerationApplicationService({
      approvalAuthority: approval.authority,
      billing,
      quoteAuthority,
      repository,
      workflows,
      clock: () => new Date('2026-07-20T12:00:00.000Z'),
    });

    for (const scope of ['shot', 'full_compose'] as const) {
      const quoteId = `quote-${scope}`;
      const quoted = await service.quote(quoteInput(quoteId, scope));
      const taskId = `regen-${scope}`;
      const confirmed = await service.confirmAndDispatch({
        quoteId,
        taskId,
        workspaceId: 'workspace-1',
      });
      assert.equal(quoted.scope, scope);
      assert.equal(confirmed.task.taskId, taskId);
      assert.equal(billing.getUsage(taskId)?.status, 'reserved');
    }

    assert.deepEqual(
      workflows.drafts.map((draft) => draft.shots.length),
      [1, 2],
    );
    assert.deepEqual(
      workflows.drafts.map((draft) => draft.deliveryMode),
      ['candidate_only', 'content_package'],
    );
    assert.ok(
      workflows.drafts.every(
        (draft) => draft.derivedFromWorkflowId === 'source-run',
      ),
    );
    assert.equal(approval.approvals.length, 1);
    const approvalKey = approval.approvals[0]?.approvalKey;
    assert.match(
      approvalKey ?? '',
      /^video-regeneration:regen-full_compose:[a-f0-9]+$/,
    );
    assert.equal(
      workflows.drafts[1]?.approvalReceiptId,
      `approval:${approvalKey}`,
    );
    assert.equal(
      approval.approvals[0]?.contract.quoteRevision,
      workflows.drafts[1]?.executionContract?.quoteRevision,
    );
    assert.equal(workflows.drafts[0]?.approvalReceiptId, undefined);
  });

  it('recovers the same supplier task for free and settles exactly once from trusted media duration', async () => {
    const billing = new BillingHarness();
    const repository = new MemoryRegenerationRepository();
    const workflows = new WorkflowHarness();
    const service = new VideoRegenerationApplicationService({
      approvalAuthority: approvalHarness().authority,
      billing,
      quoteAuthority,
      repository,
      workflows,
      clock: () => new Date('2026-07-20T12:00:00.000Z'),
    });
    await service.quote(quoteInput('quote-recover', 'full_compose'));
    await service.confirmAndDispatch({
      quoteId: 'quote-recover',
      taskId: 'regen-recover',
      workspaceId: 'workspace-1',
    });
    const before = billing.getUsage('regen-recover');

    await service.recover({
      supplierTaskRef: 'supplier-1',
      taskId: 'regen-recover',
      workspaceId: 'workspace-1',
    });
    await service.recover({
      supplierTaskRef: 'supplier-1',
      taskId: 'regen-recover',
      workspaceId: 'workspace-1',
    });
    assert.deepEqual(billing.getUsage('regen-recover'), before);
    assert.equal(repository.freeActions.length, 1);
    assert.deepEqual(workflows.recoveries, [
      'regen-recover',
      'regen-recover',
    ]);
    for (const action of videoFreeActions) {
      await service.executeFreeAction({
        action,
        taskId: 'regen-recover',
        workspaceId: 'workspace-1',
      });
      assert.deepEqual(billing.getUsage('regen-recover'), before);
    }
    assert.deepEqual(workflows.adoptions, ['regen-recover']);

    const completed = {
      ...workflows.source,
      attempts: [
        {
          acceptance: 'accepted',
          attempt: 1,
          createdAt: '2026-07-20T12:00:00.000Z',
          deploymentId: 'deployment-a',
          id: 'attempt-1',
          jobId: 'job-1',
          provider: 'recorded',
          status: 'completed',
        },
      ],
      composedAsset: {
        compositionEvidence: {
          clipAssetIds: ['clip-1'],
          composerRevision: 'composer-1',
          sourceHashes: ['a'.repeat(64)],
        },
        contentType: 'video/mp4',
        createdAt: '2026-07-20T12:00:00.000Z',
        dataClass: [],
        id: 'video-1',
        objectKey: 'workspace-1/video-1.mp4',
        sha256: 'b'.repeat(64),
        sizeBytes: 10,
        technicalValidation: {
          durationSeconds: 6,
          evidenceKind: 'measured',
          playable: true,
        },
        workspaceId: 'workspace-1',
      },
      derivedFromWorkflowId: 'source-run',
      id: 'regen-recover',
      status: 'completed',
    } as unknown as DurableVideoWorkflow;
    await service.settleFromWorkflow(completed);
    await service.settleFromWorkflow(completed);

    const settled = billing.getUsage('regen-recover');
    assert.equal(settled?.status, 'partially_refunded');
    assert.equal(settled?.settledQuantity, 6);
    assert.equal(billing.getQuoteByTask('regen-recover')?.billedSeconds, 6);
  });

  it('refunds a cancelled derived workflow once and persists its terminal task truth', async () => {
    const billing = new BillingHarness();
    const repository = new MemoryRegenerationRepository();
    const workflows = new WorkflowHarness();
    const service = new VideoRegenerationApplicationService({
      approvalAuthority: approvalHarness().authority,
      billing,
      quoteAuthority,
      repository,
      workflows,
      clock: () => new Date('2026-07-20T12:00:00.000Z'),
    });
    await service.quote(quoteInput('quote-cancel', 'shot'));
    await service.confirmAndDispatch({
      quoteId: 'quote-cancel',
      taskId: 'regen-cancel',
      workspaceId: 'workspace-1',
    });
    const cancelled = {
      ...workflows.source,
      derivedFromWorkflowId: 'source-run',
      id: 'regen-cancel',
      status: 'cancelled' as const,
    };

    await service.settleFromWorkflow(cancelled);
    await service.settleFromWorkflow(cancelled);

    assert.equal(billing.getUsage('regen-cancel')?.status, 'refunded');
    assert.equal(
      'status' in
        ((await repository.getTaskBinding('workspace-1', 'regen-cancel')) ?? {}),
      false,
    );
  });

  it('resumes a dispatching task after a crash between reserve and workflow creation', async () => {
    const billing = new BillingHarness();
    const repository = new MemoryRegenerationRepository();
    const workflows = new WorkflowHarness();
    const service = new VideoRegenerationApplicationService({
      approvalAuthority: approvalHarness().authority,
      billing,
      quoteAuthority,
      repository,
      workflows,
      clock: () => new Date('2026-07-20T12:00:00.000Z'),
    });
    await service.quote(quoteInput('quote-crash', 'shot'));
    workflows.failNextDraft = true;

    await assert.rejects(
      service.confirmAndDispatch({
        quoteId: 'quote-crash',
        taskId: 'regen-crash',
        workspaceId: 'workspace-1',
      }),
      /simulated crash/,
    );
    assert.ok(
      await repository.getTaskBinding('workspace-1', 'regen-crash'),
    );
    const reserved = billing.getUsage('regen-crash');

    const resumed = await service.confirmAndDispatch({
      quoteId: 'quote-crash',
      taskId: 'regen-crash',
      workspaceId: 'workspace-1',
    });

    assert.equal(resumed.task.status, 'running');
    assert.equal(workflows.drafts.length, 1);
    assert.equal(reserved?.id, billing.getUsage('regen-crash')?.id);
  });

  it('requires a fresh quote and task when retrying a paid regeneration', async () => {
    const billing = new BillingHarness();
    const repository = new MemoryRegenerationRepository();
    const workflows = new WorkflowHarness();
    const service = new VideoRegenerationApplicationService({
      approvalAuthority: approvalHarness().authority,
      billing,
      quoteAuthority,
      repository,
      workflows,
      clock: () => new Date('2026-07-20T12:00:00.000Z'),
    });
    await service.quote(quoteInput('quote-original', 'shot'));
    await service.confirmAndDispatch({
      quoteId: 'quote-original',
      taskId: 'regen-original',
      workspaceId: 'workspace-1',
    });
    await assert.rejects(
      service.retry({
        ...quoteInput('quote-original', 'shot'),
        taskId: 'regen-retry',
      }),
      /requires a fresh quote/,
    );

    const retried = await service.retry({
      ...quoteInput('quote-retry', 'shot'),
      taskId: 'regen-retry',
    });

    assert.equal(retried.quote.quoteId, 'quote-retry');
    assert.equal(retried.task.taskId, 'regen-retry');
    assert.equal(billing.getQuoteByTask('regen-original')?.quoteId, 'quote-original');
    assert.equal(billing.getQuoteByTask('regen-retry')?.quoteId, 'quote-retry');
    assert.notEqual(
      billing.getUsage('regen-original')?.id,
      billing.getUsage('regen-retry')?.id,
    );
    assert.deepEqual(
      workflows.drafts.map(({ workflowId }) => workflowId),
      ['regen-original', 'regen-retry'],
    );
  });
});
