import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MemoryJobPort } from '../foundation/memory-job-port.js';
import {
  DurableTracerWorker,
  MemoryTracerJobRepository,
  TracerJobApplicationService,
} from '../job-runtime/tracer-worker.js';
import {
  MemoryModelAssetStorage,
  ModelSupplyApplicationService,
  RecordedAdapterRouter,
  createDefaultCatalogModels,
  createDefaultDeployments,
  type MediaProviderLifecyclePort,
  type ModelSupplyLedgerPort,
  type ModelSupplyResult,
} from './index.js';
import {
  DurableMediaGenerationApplicationService,
  ModelMediaGenerationEffect,
} from './media-generation-workflow.js';
import { ProviderReferencePolicyError } from './reference-asset-delivery.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zp3sAAAAASUVORK5CYII=',
  'base64',
);

class RecoveringLedger implements ModelSupplyLedgerPort {
  result?: ModelSupplyResult;
  lateTerminalCalls = 0;

  async checkpointAttempt() {
    return this.result
      ? { replayed: true, recoveredResult: structuredClone(this.result) }
      : { replayed: false };
  }

  async settleAttempt(input: { result: ModelSupplyResult }) {
    this.result = structuredClone(input.result);
  }

  async recordCancelledProviderTerminal(input: { result: ModelSupplyResult }) {
    this.lateTerminalCalls += 1;
    this.result = structuredClone(input.result);
  }
}

class RecoveringProvider implements MediaProviderLifecyclePort {
  submitCalls = 0;
  recoverCalls = 0;
  pollCalls = 0;
  cancelCalls = 0;
  private readonly receipts = new Map<
    string,
    Awaited<ReturnType<MediaProviderLifecyclePort['submit']>>
  >();

  constructor(
    private readonly firstAcceptance:
      | 'accepted'
      | 'acceptance_unknown' = 'acceptance_unknown',
  ) {}

  async submit(request: Parameters<MediaProviderLifecyclePort['submit']>[0]) {
    this.submitCalls += 1;
    const effectIdempotencyKey = Reflect.get(
      request,
      'effectIdempotencyKey',
    );
    assert.equal(typeof effectIdempotencyKey, 'string');
    const receipt = {
      acceptance: this.firstAcceptance,
      taskRef: 'provider-task-stable',
      providerCost: {
        amount: 0.1,
        currency: 'USD' as const,
        usage: { mediaUnits: 1 },
      },
    };
    this.receipts.set(effectIdempotencyKey, receipt);
    return receipt;
  }

  async recover(request: Parameters<MediaProviderLifecyclePort['submit']>[0]) {
    this.recoverCalls += 1;
    const effectIdempotencyKey = Reflect.get(
      request,
      'effectIdempotencyKey',
    );
    assert.equal(typeof effectIdempotencyKey, 'string');
    return this.receipts.get(effectIdempotencyKey) ?? null;
  }

  async poll() {
    this.pollCalls += 1;
    return {
      status: 'completed' as const,
      providerCost: {
        amount: 0.1,
        currency: 'USD' as const,
        usage: { mediaUnits: 1 },
      },
    };
  }

  async download() {
    return {
      bytes: png,
      contentType: 'image/png' as const,
      sourceExpiresAt: '2026-07-11T02:00:00.000Z',
    };
  }

  async cancel() {
    this.cancelCalls += 1;
  }
}

function createModels(
  ledger: ModelSupplyLedgerPort,
  assets: MemoryModelAssetStorage,
) {
  return new ModelSupplyApplicationService({
    assetStorage: assets,
    deployments: createDefaultDeployments({
      activatedDeploymentIds: ['gpt-image-2-managed'],
      activationEvidenceStatus: 'recorded',
    }),
    execution: new RecordedAdapterRouter(),
    ledger,
    models: createDefaultCatalogModels(),
  });
}

function envelope(record: Awaited<ReturnType<TracerJobApplicationService['get']>>) {
  return {
    jobId: record.jobId,
    workspaceId: record.workspaceId,
    kind: record.kind,
    payload: record.payload,
    fingerprint: record.payloadHash,
    enqueuedAt: record.createdAt,
  };
}

describe('durable media generation', () => {
  it('recovers a provider receipt by stable effect key after response loss without resubmitting', async () => {
    let now = new Date('2026-07-11T01:00:00.000Z');
    class ResponseLossRepository extends MemoryTracerJobRepository {
      private loseFirstAcceptedRecord = true;

      override recordAccepted(
        ...args: Parameters<MemoryTracerJobRepository['recordAccepted']>
      ) {
        if (this.loseFirstAcceptedRecord) {
          this.loseFirstAcceptedRecord = false;
          throw new Error('simulated tracer response loss');
        }
        return super.recordAccepted(...args);
      }
    }

    const ledger = new RecoveringLedger();
    const assets = new MemoryModelAssetStorage();
    const models = createModels(ledger, assets);
    const repository = new ResponseLossRepository(
      new MemoryJobPort(),
      () => new Date(now),
      { leaseDurationMs: 60_000 },
    );
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({ jobs, models });
    models.attachDurableMediaRuntime(runtime);
    const provider = new RecoveringProvider('accepted');
    const queued = await models.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'response-loss-image-a',
      operation: 'image.generate',
      prompt: '响应丢失后恢复',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId: 'workspace-a',
    });
    const record = await jobs.get('workspace-a', queued.jobId);
    const worker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({ models, provider }),
    );

    await assert.rejects(
      worker.handle(envelope(record)),
      /simulated tracer response loss/,
    );
    const responseLost = await jobs.get('workspace-a', queued.jobId);
    assert.equal(responseLost.status, 'running');
    assert.equal(responseLost.providerTaskRef, null);
    assert.equal(provider.submitCalls, 1);

    assert.equal((await worker.handle(envelope(record))).status, 'deferred');
    assert.equal(provider.recoverCalls, 0);
    now = new Date('2026-07-11T01:01:01.000Z');

    assert.equal((await worker.handle(envelope(record))).status, 'completed');
    assert.equal(provider.submitCalls, 1);
    assert.equal(provider.recoverCalls, 1);
    assert.equal(provider.pollCalls, 1);
    assert.equal(
      (await jobs.get('workspace-a', queued.jobId)).providerTaskRef,
      'provider-task-stable',
    );
    assert.equal(
      (await runtime.get('workspace-a', queued.jobId))
        .providerLifecycleLatencyMs,
      61_000,
    );
  });

  it('recovers the same provider task after restart and completes only after storage receipt', async () => {
    const ledger = new RecoveringLedger();
    const assets = new MemoryModelAssetStorage();
    const firstModels = createModels(ledger, assets);
    const repository = new MemoryTracerJobRepository(new MemoryJobPort());
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({
      jobs,
      models: firstModels,
    });
    firstModels.attachDurableMediaRuntime(runtime);
    const provider = new RecoveringProvider();

    const queued = await firstModels.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'durable-image-a',
      operation: 'image.generate',
      prompt: '门店项目图',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId: 'workspace-a',
    });
    const record = await jobs.get('workspace-a', queued.jobId);
    const firstWorker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({ models: firstModels, provider }),
    );
    assert.equal((await firstWorker.handle(envelope(record))).status, 'deferred');
    assert.equal(provider.submitCalls, 1);
    assert.equal(
      (await jobs.get('workspace-a', queued.jobId)).providerTaskRef,
      'provider-task-stable',
    );

    const restartedModels = createModels(ledger, assets);
    const restartedWorker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({ models: restartedModels, provider }),
    );
    assert.equal((await restartedWorker.handle(envelope(record))).status, 'completed');
    assert.equal(provider.submitCalls, 1);
    assert.equal(provider.pollCalls, 1);
    const completed = await runtime.get('workspace-a', queued.jobId);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.result.asset?.sourceTaskRef, 'provider-task-stable');
    assert.equal(
      completed.result.asset?.sourceTtlEvidence?.expiresAt,
      '2026-07-11T02:00:00.000Z',
    );
    assert.equal(
      completed.result.asset?.sourceTtlEvidence?.providerTaskRef,
      'provider-task-stable',
    );
    assert.ok(completed.result.asset?.sourceTtlEvidence?.recordedAt);
    assert.deepEqual(
      Buffer.from(assets.read(completed.result.asset?.objectKey ?? '') ?? []),
      png,
    );
  });

  it('applies cancel to the durable provider task instead of a local projection', async () => {
    const ledger = new RecoveringLedger();
    const models = createModels(ledger, new MemoryModelAssetStorage());
    const repository = new MemoryTracerJobRepository(new MemoryJobPort());
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({ jobs, models });
    models.attachDurableMediaRuntime(runtime);
    const provider = new RecoveringProvider('accepted');
    const queued = await models.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'cancel-image-a',
      operation: 'image.generate',
      prompt: '取消我',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId: 'workspace-a',
    });
    const record = await jobs.get('workspace-a', queued.jobId);
    const worker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({ models, provider }),
    );
    await worker.handle(envelope(record));
    assert.equal(ledger.result?.attempt.acceptance, 'accepted');
    assert.equal(ledger.result?.attempt.providerTaskRef, 'provider-task-stable');
    assert.equal((await runtime.cancel({
      actorId: 'owner-a',
      jobId: queued.jobId,
      workspaceId: 'workspace-a',
    })).status, 'cancel_requested');
    await worker.handle(envelope(record));
    const cancelled = await runtime.get('workspace-a', queued.jobId);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.result.status, 'failed');
    assert.equal(cancelled.result.usage.status, 'refunded');
    assert.equal(ledger.result?.status, 'failed');
    assert.equal(ledger.result?.usage.status, 'refunded');
    assert.equal(provider.cancelCalls, 1);
  });

  it('keeps an in-flight submit fenced until its task reference is durable, then cancels and refunds it', async () => {
    let releaseSubmit!: () => void;
    let markSubmitEntered!: () => void;
    const submitEntered = new Promise<void>((resolve) => {
      markSubmitEntered = resolve;
    });
    const submitGate = new Promise<void>((resolve) => {
      releaseSubmit = resolve;
    });
    const cancelledTaskRefs: string[] = [];
    const provider: MediaProviderLifecyclePort = {
      async submit() {
        markSubmitEntered();
        await submitGate;
        return {
          acceptance: 'accepted',
          taskRef: 'provider-task-accepted-during-cancel',
          providerCost: {
            amount: 0.1,
            currency: 'USD',
            usage: { mediaUnits: 1 },
          },
        };
      },
      async recover() {
        return {
          acceptance: 'accepted',
          taskRef: 'provider-task-accepted-during-cancel',
          providerCost: {
            amount: 0.1,
            currency: 'USD',
            usage: { mediaUnits: 1 },
          },
        };
      },
      async poll() {
        throw new Error('a cancelled task must not be polled');
      },
      async download() {
        throw new Error('a cancelled task must not be downloaded');
      },
      async cancel(request) {
        cancelledTaskRefs.push(request.taskRef);
      },
    };
    const ledger = new RecoveringLedger();
    const models = createModels(ledger, new MemoryModelAssetStorage());
    const repository = new MemoryTracerJobRepository(new MemoryJobPort());
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({ jobs, models });
    models.attachDurableMediaRuntime(runtime);
    const queued = await models.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'cancel-during-submit-image-a',
      operation: 'image.generate',
      prompt: '提交中取消',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId: 'workspace-a',
    });
    const record = await jobs.get('workspace-a', queued.jobId);
    const worker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({ models, provider }),
    );

    const submitting = worker.handle(envelope(record));
    await submitEntered;
    await runtime.cancel({
      actorId: 'owner-a',
      jobId: queued.jobId,
      workspaceId: 'workspace-a',
    });
    assert.equal(
      (await worker.handle(envelope(record))).status,
      'deferred',
      'cancellation must wait for the active submit lease'
    );

    releaseSubmit();
    assert.equal((await submitting).status, 'deferred');
    const accepted = await jobs.get('workspace-a', queued.jobId);
    assert.equal(accepted.status, 'cancel_requested');
    assert.equal(
      accepted.providerTaskRef,
      'provider-task-accepted-during-cancel'
    );

    assert.equal((await worker.handle(envelope(record))).status, 'completed');
    const cancelled = await runtime.get('workspace-a', queued.jobId);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.result.usage.status, 'refunded');
    assert.equal(ledger.result?.usage.status, 'refunded');
    assert.deepEqual(cancelledTaskRefs, [
      'provider-task-accepted-during-cancel',
    ]);
  });

  it('recovers a lost accepted task reference before cancelling and refunding', async () => {
    let now = new Date('2026-07-11T02:00:00.000Z');
    class LostAcceptanceRepository extends MemoryTracerJobRepository {
      private loseReceipt = true;

      override recordAccepted(
        ...args: Parameters<MemoryTracerJobRepository['recordAccepted']>
      ) {
        if (this.loseReceipt) {
          this.loseReceipt = false;
          throw new Error('acceptance receipt lost before tracer commit');
        }
        return super.recordAccepted(...args);
      }
    }

    const ledger = new RecoveringLedger();
    const models = createModels(ledger, new MemoryModelAssetStorage());
    const repository = new LostAcceptanceRepository(
      new MemoryJobPort(),
      () => new Date(now),
      { leaseDurationMs: 60_000 },
    );
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({ jobs, models });
    models.attachDurableMediaRuntime(runtime);
    const provider = new RecoveringProvider('accepted');
    const queued = await models.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'cancel-after-lost-task-ref',
      operation: 'image.generate',
      prompt: '恢复后取消',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId: 'workspace-a',
    });
    const record = await jobs.get('workspace-a', queued.jobId);
    const worker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({ models, provider }),
    );

    await assert.rejects(
      worker.handle(envelope(record)),
      /acceptance receipt lost before tracer commit/,
    );
    await runtime.cancel({
      actorId: 'owner-a',
      jobId: queued.jobId,
      workspaceId: 'workspace-a',
    });
    now = new Date('2026-07-11T02:01:01.000Z');

    assert.equal((await worker.handle(envelope(record))).status, 'completed');
    const cancelled = await runtime.get('workspace-a', queued.jobId);
    assert.equal(cancelled.providerTaskRef, 'provider-task-stable');
    assert.equal(cancelled.result.usage.status, 'refunded');
    assert.equal(ledger.result?.usage.status, 'refunded');
    assert.equal(provider.submitCalls, 1);
    assert.equal(provider.recoverCalls, 1);
    assert.equal(provider.cancelCalls, 1);
  });

  it('settles a reserved unknown attempt when cancellation recovery confirms pre-acceptance rejection', async () => {
    const provider: MediaProviderLifecyclePort = {
      async submit() {
        return {
          acceptance: 'acceptance_unknown',
          providerCost: {
            amount: 0,
            currency: 'USD',
            usage: {},
          },
        };
      },
      async recover() {
        return {
          acceptance: 'rejected_before_accept',
          providerCost: {
            amount: 0,
            currency: 'USD',
            usage: {},
          },
        };
      },
      async poll() {
        throw new Error('a rejected task must not be polled');
      },
      async download() {
        throw new Error('a rejected task must not be downloaded');
      },
      async cancel() {
        throw new Error('a task rejected before acceptance must not be cancelled');
      },
    };
    const ledger = new RecoveringLedger();
    const models = createModels(ledger, new MemoryModelAssetStorage());
    const repository = new MemoryTracerJobRepository(new MemoryJobPort());
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({ jobs, models });
    models.attachDurableMediaRuntime(runtime);
    const queued = await models.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'cancel-recovered-rejection',
      operation: 'image.generate',
      prompt: '恢复确认未接单',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId: 'workspace-a',
    });
    const record = await jobs.get('workspace-a', queued.jobId);
    const worker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({ models, provider }),
    );

    assert.equal((await worker.handle(envelope(record))).status, 'deferred');
    assert.equal(ledger.result?.usage.status, 'reserved');
    await runtime.cancel({
      actorId: 'owner-a',
      jobId: queued.jobId,
      workspaceId: 'workspace-a',
    });
    assert.equal((await worker.handle(envelope(record))).status, 'completed');

    assert.equal(
      (await runtime.get('workspace-a', queued.jobId)).result.usage.status,
      'refunded'
    );
    assert.equal(ledger.result?.usage.status, 'refunded');
    assert.equal(ledger.result?.attempt.acceptance, 'rejected_before_accept');
  });

  it('does not automatically resubmit fixed media after provider rejection', async () => {
    const ledger = new RecoveringLedger();
    const models = createModels(ledger, new MemoryModelAssetStorage());
    const repository = new MemoryTracerJobRepository(new MemoryJobPort());
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({ jobs, models });
    models.attachDurableMediaRuntime(runtime);
    let submitCalls = 0;
    const provider: MediaProviderLifecyclePort = {
      async submit() {
        submitCalls += 1;
        return {
          acceptance: 'rejected_before_accept',
          providerCost: {
            amount: 0,
            currency: 'USD',
            usage: {},
          },
          errorCode: 'content_rejected',
          retryable: false,
          error: 'capacity rejected',
        };
      },
      async recover() {
        return null;
      },
      async poll() {
        throw new Error('rejected media must not poll');
      },
      async download() {
        throw new Error('rejected media must not download');
      },
      async cancel() {},
    };
    const queued = await models.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'rejected-image-a',
      operation: 'image.generate',
      prompt: '不自动重试',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId: 'workspace-a',
    });
    const record = await jobs.get('workspace-a', queued.jobId);
    const worker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({ models, provider }),
    );
    assert.equal((await worker.handle(envelope(record))).status, 'dead_letter');
    assert.equal((await worker.handle(envelope(record))).status, 'dead_letter');
    const failed = await jobs.get('workspace-a', queued.jobId);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.acceptance, 'rejected_before_accept');
    assert.match(
      failed.error ?? '',
      /phase=submit code=content_rejected retryable=false/,
    );
    const failedView = await runtime.get('workspace-a', queued.jobId);
    assert.equal(failedView.result.status, 'failed');
    assert.equal(failedView.result.usage.status, 'refunded');
    assert.equal(failedView.result.providerCost.amount, 0);
    assert.equal(submitCalls, 1);
  });

  it('keeps provider poll error code and retryability in terminal tracer evidence', async () => {
    const provider: MediaProviderLifecyclePort = {
      async submit() {
        return {
          acceptance: 'accepted',
          taskRef: 'provider-task-poll-failed',
          providerCost: {
            amount: 0.12,
            currency: 'USD',
            usage: { mediaUnits: 1 },
          },
        };
      },
      async recover() {
        return null;
      },
      async poll() {
        return {
          status: 'failed',
          providerCost: {
            amount: 0.12,
            currency: 'USD',
            usage: { mediaUnits: 1 },
          },
          errorCode: 'logical_timeout',
          retryable: true,
          error: 'provider task exceeded its logical timeout',
        };
      },
      async download() {
        throw new Error('a failed task must not download');
      },
      async cancel() {},
    };
    const ledger = new RecoveringLedger();
    const models = createModels(ledger, new MemoryModelAssetStorage());
    const repository = new MemoryTracerJobRepository(new MemoryJobPort());
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({
      jobs,
      models,
      provider,
    });
    models.attachDurableMediaRuntime(runtime);
    const queued = await models.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'poll-failure-image-a',
      operation: 'image.generate',
      prompt: '轮询失败证据',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId: 'workspace-a',
    });
    const record = await jobs.get('workspace-a', queued.jobId);
    const worker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({ models, provider }),
    );

    assert.equal((await worker.handle(envelope(record))).status, 'deferred');
    assert.equal((await worker.handle(envelope(record))).status, 'dead_letter');
    const failed = await jobs.get('workspace-a', queued.jobId);
    assert.match(
      failed.error ?? '',
      /phase=poll code=logical_timeout retryable=true/,
    );
  });

  it('keeps provider cancellation pending without refunding until the provider confirms cancellation', async () => {
    let cancelCalls = 0;
    const provider: MediaProviderLifecyclePort = {
      async submit() {
        return {
          acceptance: 'accepted',
          taskRef: 'provider-task-cancel-pending',
          providerCost: {
            amount: 0.45,
            currency: 'USD',
            usage: { mediaUnits: 1 },
          },
        };
      },
      async recover() {
        return null;
      },
      async poll() {
        throw new Error('a cancellation request must not enter normal polling');
      },
      async download() {
        throw new Error('a cancellation request must not download');
      },
      async cancel() {
        cancelCalls += 1;
        return cancelCalls === 1
          ? {
              status: 'pending',
              errorCode: 'cancel_pending',
              retryable: true,
              error: 'provider cancellation is still pending',
            }
          : { status: 'cancelled' };
      },
    };
    const ledger = new RecoveringLedger();
    const models = createModels(ledger, new MemoryModelAssetStorage());
    const repository = new MemoryTracerJobRepository(new MemoryJobPort());
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({
      jobs,
      models,
      provider,
    });
    models.attachDurableMediaRuntime(runtime);
    const queued = await models.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'cancel-pending-image-a',
      operation: 'image.generate',
      prompt: '等待供应方确认取消',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId: 'workspace-a',
    });
    const record = await jobs.get('workspace-a', queued.jobId);
    const worker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({ models, provider }),
    );

    assert.equal((await worker.handle(envelope(record))).status, 'deferred');
    await runtime.cancel({
      actorId: 'owner-a',
      jobId: queued.jobId,
      workspaceId: 'workspace-a',
    });
    assert.equal((await worker.handle(envelope(record))).status, 'deferred');
    const pending = await runtime.get('workspace-a', queued.jobId);
    assert.equal(pending.status, 'cancel_requested');
    assert.equal(pending.result.usage.status, 'reserved');
    assert.match(
      (await jobs.get('workspace-a', queued.jobId)).error ?? '',
      /phase=cancel code=cancel_pending retryable=true/,
    );

    assert.equal((await worker.handle(envelope(record))).status, 'completed');
    const cancelled = await runtime.get('workspace-a', queued.jobId);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.result.usage.status, 'refunded');
    assert.equal(cancelCalls, 2);
  });

  it('retries download and owned storage for the same accepted task without resubmitting generation', async () => {
    let submitCalls = 0;
    let pollCalls = 0;
    let downloadCalls = 0;
    const provider: MediaProviderLifecyclePort = {
      async submit() {
        submitCalls += 1;
        return {
          acceptance: 'accepted',
          taskRef: 'provider-task-download-retry',
          providerCost: {
            amount: 0.12,
            currency: 'USD',
            usage: { mediaUnits: 1 },
          },
        };
      },
      async recover() {
        return null;
      },
      async poll() {
        pollCalls += 1;
        return {
          status: 'completed',
          providerCost: {
            amount: 0.12,
            currency: 'USD',
            usage: { mediaUnits: 1 },
          },
        };
      },
      async download() {
        downloadCalls += 1;
        if (downloadCalls === 1) {
          throw Object.assign(new Error('recorded provider download failed'), {
            code: 'download_failed',
            retryable: true,
          });
        }
        return {
          bytes: png,
          contentType: 'image/png',
        };
      },
      async cancel() {},
    };
    const ledger = new RecoveringLedger();
    const assets = new MemoryModelAssetStorage();
    const models = createModels(ledger, assets);
    const repository = new MemoryTracerJobRepository(new MemoryJobPort());
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({
      jobs,
      models,
      provider,
    });
    models.attachDurableMediaRuntime(runtime);
    const queued = await models.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'download-retry-image-a',
      operation: 'image.generate',
      prompt: '下载失败后恢复',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId: 'workspace-a',
    });
    const record = await jobs.get('workspace-a', queued.jobId);
    const worker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({ models, provider }),
    );

    assert.equal((await worker.handle(envelope(record))).status, 'deferred');
    assert.equal((await worker.handle(envelope(record))).status, 'deferred');
    const failedDownload = await jobs.get('workspace-a', queued.jobId);
    assert.equal(failedDownload.acceptance, 'accepted');
    assert.equal(failedDownload.providerTaskRef, 'provider-task-download-retry');
    assert.match(
      failedDownload.error ?? '',
      /phase=download code=download_failed retryable=true/,
    );

    assert.equal((await worker.handle(envelope(record))).status, 'completed');
    const completed = await runtime.get('workspace-a', queued.jobId);
    assert.equal(completed.result.asset?.sourceTaskRef, 'provider-task-download-retry');
    assert.equal(submitCalls, 1);
    assert.equal(pollCalls, 2);
    assert.equal(downloadCalls, 2);
  });

  it('reconciles a late provider success into an isolated owned asset and observed cost idempotently', async () => {
    let pollCalls = 0;
    let downloadCalls = 0;
    const provider: MediaProviderLifecyclePort = {
      async submit() {
        return {
          acceptance: 'accepted',
          taskRef: 'provider-task-late-success',
          providerCost: {
            amount: 0.2,
            currency: 'USD',
            usage: { mediaUnits: 1 },
          },
        };
      },
      async recover() {
        return null;
      },
      async poll() {
        pollCalls += 1;
        return {
          status: 'completed',
          providerCost: {
            amount: 0.37,
            currency: 'USD',
            usage: { mediaUnits: 2 },
          },
          sourceExpiresAt: '2026-07-11T06:00:00.000Z',
        };
      },
      async download() {
        downloadCalls += 1;
        return {
          bytes: png,
          contentType: 'image/png',
          sourceExpiresAt: '2026-07-11T06:00:00.000Z',
        };
      },
      async cancel() {
        return { status: 'cancelled' };
      },
    };
    const ledger = new RecoveringLedger();
    const assets = new MemoryModelAssetStorage();
    const models = createModels(ledger, assets);
    const repository = new MemoryTracerJobRepository(new MemoryJobPort());
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({
      jobs,
      models,
      provider,
    });
    models.attachDurableMediaRuntime(runtime);
    const queued = await models.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'late-success-image-a',
      operation: 'image.generate',
      prompt: '取消后供应方仍成功',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId: 'workspace-a',
    });
    const record = await jobs.get('workspace-a', queued.jobId);
    const worker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({ models, provider }),
    );
    await worker.handle(envelope(record));
    await runtime.cancel({
      actorId: 'owner-a',
      jobId: queued.jobId,
      workspaceId: 'workspace-a',
    });
    await worker.handle(envelope(record));

    const first = await runtime.reconcileCancelledProviderTerminal({
      jobId: queued.jobId,
      providerTaskRef: 'provider-task-late-success',
      workspaceId: 'workspace-a',
    });
    assert.equal(first.status, 'completed');
    assert.equal(first.reconciliation?.isolatedFromCancelledWorkflow, true);
    assert.equal(first.reconciliation?.asset?.sourceTaskRef, 'provider-task-late-success');
    assert.equal(first.result.status, 'failed');
    assert.equal(first.result.usage.status, 'refunded');
    assert.equal(first.result.providerCost.status, 'observed');
    assert.equal(first.result.providerCost.amount, 0.37);
    assert.deepEqual(first.result.providerCost.usage, { mediaUnits: 2 });
    assert.equal(ledger.lateTerminalCalls, 1);

    const replay = await runtime.reconcileCancelledProviderTerminal({
      jobId: queued.jobId,
      providerTaskRef: 'provider-task-late-success',
      workspaceId: 'workspace-a',
    });
    assert.deepEqual(replay, first);
    assert.equal(pollCalls, 1);
    assert.equal(downloadCalls, 1);
    assert.equal(ledger.lateTerminalCalls, 1);
    await assert.rejects(
      runtime.reconcileCancelledProviderTerminal({
        jobId: queued.jobId,
        providerTaskRef: 'provider-task-late-success',
        workspaceId: 'workspace-b',
      }),
      /not found/i,
    );
    await assert.rejects(
      runtime.reconcileCancelledProviderTerminal({
        jobId: queued.jobId,
        providerTaskRef: 'another-provider-task',
        workspaceId: 'workspace-a',
      }),
      /task reference/i,
    );
  });

  it('reconciles a late provider failure without reopening the cancelled workflow', async () => {
    let pollCalls = 0;
    const provider: MediaProviderLifecyclePort = {
      async submit() {
        return {
          acceptance: 'accepted',
          taskRef: 'provider-task-late-failure',
          providerCost: {
            amount: 0.2,
            currency: 'USD',
            usage: { mediaUnits: 1 },
          },
        };
      },
      async recover() {
        return null;
      },
      async poll() {
        pollCalls += 1;
        return {
          status: 'failed',
          providerCost: {
            amount: 0.29,
            currency: 'USD',
            usage: { mediaUnits: 1 },
          },
          errorCode: 'provider_render_failed',
          retryable: false,
          error: 'provider render failed after cancellation',
        };
      },
      async download() {
        throw new Error('a late failed task must not download');
      },
      async cancel() {
        return { status: 'cancelled' };
      },
    };
    const ledger = new RecoveringLedger();
    const models = createModels(ledger, new MemoryModelAssetStorage());
    const repository = new MemoryTracerJobRepository(new MemoryJobPort());
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({
      jobs,
      models,
      provider,
    });
    models.attachDurableMediaRuntime(runtime);
    const queued = await models.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'late-failure-image-a',
      operation: 'image.generate',
      prompt: '取消后供应方失败',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId: 'workspace-a',
    });
    const record = await jobs.get('workspace-a', queued.jobId);
    const worker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({ models, provider }),
    );
    await worker.handle(envelope(record));
    await runtime.cancel({
      actorId: 'owner-a',
      jobId: queued.jobId,
      workspaceId: 'workspace-a',
    });
    await worker.handle(envelope(record));

    const reconciled = await runtime.reconcileCancelledProviderTerminal({
      jobId: queued.jobId,
      providerTaskRef: 'provider-task-late-failure',
      workspaceId: 'workspace-a',
    });
    assert.equal(reconciled.status, 'failed');
    assert.equal(reconciled.reconciliation?.errorCode, 'provider_render_failed');
    assert.equal(reconciled.reconciliation?.retryable, false);
    assert.equal(reconciled.result.status, 'failed');
    assert.equal(reconciled.result.usage.status, 'refunded');
    assert.equal(reconciled.result.providerCost.amount, 0.29);
    assert.equal(
      (await runtime.get('workspace-a', queued.jobId)).status,
      'cancelled',
    );
    assert.equal(pollCalls, 1);
  });

  it('preserves authorized reference roles before provider submission and still archives the result', async () => {
    let providerReferenceUrl: string | undefined;
    let providerReferenceRole: string | undefined;
    const provider: MediaProviderLifecyclePort = {
      async submit(request) {
        providerReferenceUrl = request.resolvedReferenceAssets?.[0]
          ?.providerReadableUrl;
        providerReferenceRole = request.resolvedInputAssets?.[0]?.role;
        assert.equal(
          providerReferenceUrl,
          'data:image/png;base64,cmVmZXJlbmNl',
        );
        assert.equal(providerReferenceRole, 'reference_image');
        return {
          acceptance: 'accepted',
          taskRef: 'provider-task-reference-success',
          providerCost: {
            amount: 0.1,
            currency: 'USD',
            usage: { mediaUnits: 1 },
          },
        };
      },
      async recover() {
        return null;
      },
      async poll() {
        return {
          status: 'completed',
          providerCost: {
            amount: 0.1,
            currency: 'USD',
            usage: { mediaUnits: 1 },
          },
        };
      },
      async download() {
        return { bytes: png, contentType: 'image/png' };
      },
      async cancel() {},
    };
    const ledger = new RecoveringLedger();
    const models = createModels(ledger, new MemoryModelAssetStorage());
    const repository = new MemoryTracerJobRepository(new MemoryJobPort());
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({ jobs, models });
    models.attachDurableMediaRuntime(runtime);
    const queued = await models.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'reference-success-image-a',
      input: {
        inputAssets: [
          { assetId: 'asset-store-a', role: 'reference_image' },
        ],
      },
      operation: 'image.generate',
      prompt: '基于门店照片生成',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId: 'workspace-a',
    });
    const record = await jobs.get('workspace-a', queued.jobId);
    const worker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({
        models,
        provider,
        referencePolicy: {
          assertCanDispatch() {},
        },
        referenceAssets: {
          async inspect() {
            throw new Error('submission inspection belongs to operations');
          },
          async resolve() {
            return [
              {
                assetId: 'asset-store-a',
                bytes: Buffer.from('reference'),
                contentType: 'image/png',
                kind: 'resolved',
                providerReadableUrl: 'data:image/png;base64,cmVmZXJlbmNl',
                sha256: 'reference-sha256',
              },
            ];
          },
        },
      }),
    );

    assert.equal((await worker.handle(envelope(record))).status, 'deferred');
    assert.equal((await worker.handle(envelope(record))).status, 'completed');
    const completed = await runtime.get('workspace-a', queued.jobId);
    assert.equal(completed.result.status, 'completed');
    assert.equal(completed.result.usage.status, 'committed');
    assert.match(completed.result.asset?.objectKey ?? '', /\/generated\//);
    assert.equal(providerReferenceUrl, 'data:image/png;base64,cmVmZXJlbmNl');
    assert.equal(providerReferenceRole, 'reference_image');
  });

  it('fails closed and refunds before provider dispatch when an injected reference policy rejects it', async () => {
    let providerCalls = 0;
    const provider: MediaProviderLifecyclePort = {
      async submit() {
        providerCalls += 1;
        throw new Error('must not submit');
      },
      async recover() {
        return null;
      },
      async poll() {
        throw new Error('must not poll');
      },
      async download() {
        throw new Error('must not download');
      },
      async cancel() {},
    };
    const ledger = new RecoveringLedger();
    const models = createModels(ledger, new MemoryModelAssetStorage());
    const repository = new MemoryTracerJobRepository(new MemoryJobPort());
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({
      jobs,
      models,
    });
    models.attachDurableMediaRuntime(runtime);
    const queued = await models.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'reference-policy-failed-image-a',
      input: { referenceAssetIds: ['asset-store-a'] },
      operation: 'image.generate',
      prompt: '基于门店照片生成',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId: 'workspace-a',
    });
    const record = await jobs.get('workspace-a', queued.jobId);
    const worker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({
        models,
        provider,
        referencePolicy: {
          assertCanDispatch() {
            throw new ProviderReferencePolicyError(
              'PROVIDER_REFERENCE_PROBE_REQUIRED',
              'Provider reference transport is unavailable.',
            );
          },
        },
        referenceAssets: {
          async inspect() {
            throw new Error('submission inspection belongs to operations');
          },
          async resolve() {
            return [
              {
                assetId: 'asset-store-a',
                bytes: Buffer.from('reference'),
                contentType: 'image/png',
                kind: 'resolved',
                providerReadableUrl: 'data:image/png;base64,cmVmZXJlbmNl',
                sha256: 'reference-sha256',
              },
            ];
          },
        },
      }),
    );

    assert.equal((await worker.handle(envelope(record))).status, 'dead_letter');
    const failed = await runtime.get('workspace-a', queued.jobId);
    assert.equal(failed.result.status, 'failed');
    assert.equal(
      failed.result.failureCode,
      'PROVIDER_REFERENCE_PROBE_REQUIRED',
    );
    assert.equal(failed.result.usage.status, 'refunded');
    assert.equal(providerCalls, 0);
  });

  it('fails and refunds without provider effect when execution-time reference resolution is lost', async () => {
    let providerCalls = 0;
    const provider: MediaProviderLifecyclePort = {
      async submit() {
        providerCalls += 1;
        throw new Error('must not submit');
      },
      async recover() {
        return null;
      },
      async poll() {
        throw new Error('must not poll');
      },
      async download() {
        throw new Error('must not download');
      },
      async cancel() {},
    };
    const ledger = new RecoveringLedger();
    const models = createModels(ledger, new MemoryModelAssetStorage());
    const repository = new MemoryTracerJobRepository(new MemoryJobPort());
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({ jobs, models });
    models.attachDurableMediaRuntime(runtime);
    const queued = await models.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'reference-failed-image-a',
      input: { referenceAssetIds: ['asset-store-a'] },
      operation: 'image.generate',
      prompt: '基于门店照片生成',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId: 'workspace-a',
    });
    const record = await jobs.get('workspace-a', queued.jobId);
    const worker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({
        models,
        provider,
        referenceAssets: {
          async inspect() {
            throw new Error('submission inspection belongs to operations');
          },
          async resolve() {
            return [
              {
                assetId: 'asset-store-a',
                kind: 'failure',
                reason: 'authorization_withdrawn',
              },
            ];
          },
        },
      }),
    );

    assert.equal((await worker.handle(envelope(record))).status, 'dead_letter');
    const failed = await runtime.get('workspace-a', queued.jobId);
    assert.equal(failed.result.status, 'failed');
    assert.equal(
      failed.result.failureCode,
      'reference_asset_resolution_required',
    );
    assert.equal(failed.result.usage.status, 'refunded');
    assert.equal(providerCalls, 0);
    assert.equal((await worker.handle(envelope(record))).status, 'dead_letter');
    assert.equal(providerCalls, 0);
  });
});
