import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MemoryJobPort } from '../foundation/memory-job-port.js';
import {
  DurableTracerWorker,
  MemoryTracerJobRepository,
  TracerJobApplicationService,
  type TracerExternalEffect,
} from './tracer-worker.js';

describe('durable tracer job', () => {
  it('submits through an application service and reconciles acceptance-unknown without resubmitting', async () => {
    const queue = new MemoryJobPort();
    const repository = new MemoryTracerJobRepository(queue);
    const application = new TracerJobApplicationService(repository);
    const submitted = await application.submit({
      workspaceId: 'ws-1',
      jobId: 'tracer-1',
      kind: 'generate_copy',
      payload: { prompt: '写一条门店文案' },
    });
    assert.equal(submitted.status, 'queued');
    assert.equal((await queue.inspect('ws-1', 'tracer-1'))?.status, 'queued');

    let executeCalls = 0;
    let reconcileCalls = 0;
    const effect: TracerExternalEffect = {
      async execute() {
        executeCalls += 1;
        assert.equal(repository.mutationActive, false, 'external effect must run outside repository transaction');
        return { acceptance: 'acceptance_unknown', delivery: 'unknown' };
      },
      async reconcile() {
        reconcileCalls += 1;
        assert.equal(repository.mutationActive, false, 'reconciliation must run outside repository transaction');
        return {
          acceptance: 'accepted',
          delivery: 'completed',
          taskRef: 'provider-task-1',
          output: { copy: '今天来店，给自己一次放松。' },
        };
      },
    };
    const worker = new DurableTracerWorker(repository, effect);
    const envelope = {
      jobId: 'tracer-1',
      workspaceId: 'ws-1',
      kind: 'generate_copy',
      payload: { prompt: '写一条门店文案' },
      fingerprint: 'fixture-fingerprint',
      enqueuedAt: '2026-07-11T01:00:00.000Z',
    };

    assert.equal((await worker.handle(envelope)).status, 'deferred');
    assert.equal((await application.get('ws-1', 'tracer-1')).status, 'unknown');
    assert.equal((await worker.handle(envelope)).status, 'completed');
    assert.equal(executeCalls, 1);
    assert.equal(reconcileCalls, 1);
    assert.deepEqual((await application.get('ws-1', 'tracer-1')).output, {
      copy: '今天来店，给自己一次放松。',
    });
  });

  it('keeps an active worker lease until expiry and then fences its stale write', async () => {
    let now = new Date('2026-07-11T01:00:00.000Z');
    const repository = new MemoryTracerJobRepository(
      new MemoryJobPort(),
      () => new Date(now),
      { leaseDurationMs: 60_000 },
    );
    await repository.submit({
      workspaceId: 'ws-1',
      jobId: 'tracer-stale',
      kind: 'generate_copy',
      payload: { prompt: '生成门店文案' },
    });
    const oldLease = await repository.reserve('ws-1', 'tracer-stale');
    const activeLease = await repository.reserve('ws-1', 'tracer-stale');
    assert.ok(oldLease.leaseToken);
    assert.equal(activeLease.decision, 'in_progress');
    assert.equal(activeLease.leaseToken, null);

    now = new Date('2026-07-11T01:01:01.000Z');
    const currentLease = await repository.reserve('ws-1', 'tracer-stale');
    assert.ok(currentLease.leaseToken);
    await repository.complete(
      'ws-1',
      'tracer-stale',
      currentLease.leaseToken,
      { copy: '新 worker 的结果' },
      'provider-task'
    );

    await assert.rejects(
      () =>
        repository.recordUnknown(
          'ws-1',
          'tracer-stale',
          oldLease.leaseToken!,
          'old worker timed out'
        ),
      /stale worker lease/
    );
    assert.deepEqual((await repository.get('ws-1', 'tracer-stale'))?.output, {
      copy: '新 worker 的结果',
    });
  });

  it('persists an acceptance-unknown task ref and reconciles it after a worker restart', async () => {
    const repository = new MemoryTracerJobRepository(new MemoryJobPort());
    const application = new TracerJobApplicationService(repository);
    await application.submit({
      workspaceId: 'ws-1',
      jobId: 'media-restart',
      kind: 'model.media-generation',
      payload: { prompt: '生成图片' },
    });
    const envelope = {
      jobId: 'media-restart',
      workspaceId: 'ws-1',
      kind: 'model.media-generation',
      payload: { prompt: '生成图片' },
      fingerprint: 'fixture-fingerprint',
      enqueuedAt: '2026-07-11T01:00:00.000Z',
    };
    let submitCalls = 0;
    const firstWorker = new DurableTracerWorker(repository, {
      async execute() {
        submitCalls += 1;
        return {
          acceptance: 'acceptance_unknown',
          delivery: 'unknown',
          taskRef: 'provider-task-kept-across-restart',
        };
      },
      async reconcile() {
        throw new Error('first process must not reconcile');
      },
    });
    assert.equal((await firstWorker.handle(envelope)).status, 'deferred');
    assert.equal(
      (await application.get('ws-1', 'media-restart')).providerTaskRef,
      'provider-task-kept-across-restart',
    );

    const restartedWorker = new DurableTracerWorker(repository, {
      async execute() {
        throw new Error('restarted process must not submit again');
      },
      async reconcile(request) {
        assert.equal(request.providerTaskRef, 'provider-task-kept-across-restart');
        return {
          acceptance: 'accepted',
          delivery: 'completed',
          taskRef: request.providerTaskRef,
          output: { assetId: 'asset-after-restart' },
        };
      },
    });
    assert.equal((await restartedWorker.handle(envelope)).status, 'completed');
    assert.equal(submitCalls, 1);
  });

  it('persists cancel intent before invoking provider cancellation', async () => {
    const repository = new MemoryTracerJobRepository(new MemoryJobPort());
    const application = new TracerJobApplicationService(repository);
    await application.submit({
      workspaceId: 'ws-1',
      jobId: 'media-cancel',
      kind: 'model.media-generation',
      payload: { prompt: '生成视频' },
    });
    const envelope = {
      jobId: 'media-cancel',
      workspaceId: 'ws-1',
      kind: 'model.media-generation',
      payload: { prompt: '生成视频' },
      fingerprint: 'fixture-fingerprint',
      enqueuedAt: '2026-07-11T01:00:00.000Z',
    };
    const providerEvents: string[] = [];
    const worker = new DurableTracerWorker(repository, {
      async execute() {
        return {
          acceptance: 'accepted',
          delivery: 'pending',
          taskRef: 'provider-video-task',
        };
      },
      async reconcile() {
        throw new Error('cancelled work must not poll');
      },
      async cancel(request) {
        providerEvents.push(`cancel:${request.providerTaskRef}`);
        assert.equal(
          (await application.get('ws-1', 'media-cancel')).status,
          'cancel_requested',
        );
        return { taskRef: request.providerTaskRef };
      },
    });
    assert.equal((await worker.handle(envelope)).status, 'deferred');
    await application.cancel('ws-1', 'media-cancel');
    assert.equal((await application.get('ws-1', 'media-cancel')).status, 'cancel_requested');
    assert.equal((await worker.handle(envelope)).status, 'completed');
    assert.equal((await application.get('ws-1', 'media-cancel')).status, 'cancelled');
    assert.deepEqual(providerEvents, ['cancel:provider-video-task']);
  });

  it('releases the worker lease when cancellation remains unknown', async () => {
    const repository = new MemoryTracerJobRepository(
      new MemoryJobPort(),
      () => new Date('2026-07-11T01:00:00.000Z'),
      { leaseDurationMs: 60_000 },
    );
    const application = new TracerJobApplicationService(repository);
    await application.submit({
      workspaceId: 'ws-1',
      jobId: 'media-cancel-retry',
      kind: 'model.media-generation',
      payload: { prompt: '生成视频' },
    });
    const envelope = {
      jobId: 'media-cancel-retry',
      workspaceId: 'ws-1',
      kind: 'model.media-generation',
      payload: { prompt: '生成视频' },
      fingerprint: 'fixture-fingerprint',
      enqueuedAt: '2026-07-11T01:00:00.000Z',
    };
    let cancellationAttempts = 0;
    const worker = new DurableTracerWorker(repository, {
      async execute() {
        return {
          acceptance: 'accepted',
          delivery: 'pending',
          taskRef: 'provider-video-task',
        };
      },
      async reconcile() {
        throw new Error('cancelled work must not poll');
      },
      async cancel(request) {
        cancellationAttempts += 1;
        if (cancellationAttempts === 1) {
          throw new Error('provider cancellation remains pending');
        }
        return { taskRef: request.providerTaskRef };
      },
    });

    assert.equal((await worker.handle(envelope)).status, 'deferred');
    await application.cancel('ws-1', 'media-cancel-retry');
    assert.equal((await worker.handle(envelope)).status, 'deferred');
    assert.match(
      (await application.get('ws-1', 'media-cancel-retry')).error ?? '',
      /Cancellation result is unknown/,
    );
    assert.equal((await worker.handle(envelope)).status, 'completed');
    assert.equal(
      (await application.get('ws-1', 'media-cancel-retry')).status,
      'cancelled',
    );
    assert.equal(cancellationAttempts, 2);
  });
});
