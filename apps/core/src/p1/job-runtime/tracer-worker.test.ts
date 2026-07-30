import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { MemoryJobPort } from '../foundation/memory-job-port.js';
import type { JobPort } from '../foundation/ports.js';
import {
  DurableTracerWorker,
  MemoryTracerJobRepository,
  PostgresTracerJobRepository,
  TracerJobApplicationService,
  type TracerExternalEffect,
  type TransactionalJobPort,
} from './tracer-worker.js';

class RecordingJobPort implements JobPort {
  readonly enqueued: Array<Parameters<JobPort['enqueue']>[0]> = [];
  readonly resumed: Array<{
    input: Parameters<JobPort['enqueue']>[0];
    sequence: number;
  }> = [];

  async enqueue(input: Parameters<JobPort['enqueue']>[0]) {
    this.enqueued.push(structuredClone(input));
  }

  async resume(
    input: Parameters<JobPort['enqueue']>[0],
    sequence: number,
  ) {
    this.resumed.push({ input: structuredClone(input), sequence });
  }

  async cancel() {}
}

class PostgresRecordingJobPort implements TransactionalJobPort {
  constructor(private readonly qualifiedTable: string) {}

  async enqueue() {
    throw new Error('Postgres tracer must enqueue inside its transaction.');
  }

  async enqueueInTransaction(
    input: Parameters<JobPort['enqueue']>[0],
    client: PoolClient,
  ) {
    await client.query(
      `INSERT INTO ${this.qualifiedTable} (
         workspace_id, job_id, payload, sequence
       )
       VALUES ($1, $2, $3::jsonb, 0)`,
      [input.workspaceId, input.jobId, JSON.stringify(input.payload)],
    );
  }

  async resumeInTransaction(
    input: Parameters<JobPort['enqueue']>[0],
    sequence: number,
    client: PoolClient,
  ) {
    await client.query(
      `INSERT INTO ${this.qualifiedTable} (
         workspace_id, job_id, payload, sequence
       ) VALUES ($1, $2, $3::jsonb, $4)`,
      [
        input.workspaceId,
        input.jobId,
        JSON.stringify(input.payload),
        sequence,
      ],
    );
  }

  async cancel() {}
}

const databaseUrl = process.env.TEST_DATABASE_URL;

describe('durable tracer job', () => {
  it('atomically resumes a failed tracer with replacement payload and exactly one new enqueue', async () => {
    const queue = new RecordingJobPort();
    const repository = new MemoryTracerJobRepository(queue);
    const application = new TracerJobApplicationService(repository);
    const submitted = await application.submit({
      workspaceId: 'ws-1',
      jobId: 'media-resume',
      kind: 'model.media-generation',
      payload: { routeAttempt: 1, limit: 1 },
    });
    const reservation = await repository.reserve('ws-1', 'media-resume');
    assert.ok(reservation.leaseToken);
    const failed = await repository.recordRejectedTerminal(
      'ws-1',
      'media-resume',
      reservation.leaseToken,
      'MEDIA_BOUNDED_ITERATION_EXCEEDED',
      { failureCode: 'MEDIA_BOUNDED_ITERATION_EXCEEDED' },
    );

    const resumed = await application.resumeFailed({
      workspaceId: 'ws-1',
      jobId: 'media-resume',
      expectedPayloadHash: failed.payloadHash,
      payload: { routeAttempt: 1, limit: 2 },
    });

    assert.equal(resumed.status, 'queued');
    assert.deepEqual(resumed.payload, { routeAttempt: 1, limit: 2 });
    assert.notEqual(resumed.payloadHash, failed.payloadHash);
    assert.equal(resumed.acceptance, null);
    assert.equal(resumed.providerTaskRef, null);
    assert.equal(resumed.output, null);
    assert.equal(resumed.error, null);
    assert.equal(resumed.leaseExpiresAt, null);
    assert.equal(resumed.jobId, submitted.jobId);
    assert.equal(resumed.effectIdempotencyKey, submitted.effectIdempotencyKey);
    assert.equal(resumed.attempts, 1);
    assert.equal(queue.enqueued.length, 1);
    assert.equal(queue.resumed.length, 1);
    assert.equal(queue.resumed[0]?.sequence, 1);
    assert.deepEqual(queue.resumed[0]?.input.payload, {
      routeAttempt: 1,
      limit: 2,
    });
  });

  it('allows exactly one concurrent failed-tracer resume for the expected payload hash', async () => {
    const queue = new RecordingJobPort();
    const repository = new MemoryTracerJobRepository(queue);
    const application = new TracerJobApplicationService(repository);
    await application.submit({
      workspaceId: 'ws-1',
      jobId: 'media-resume-race',
      kind: 'model.media-generation',
      payload: { limit: 1 },
    });
    const reservation = await repository.reserve('ws-1', 'media-resume-race');
    assert.ok(reservation.leaseToken);
    const failed = await repository.recordRejectedTerminal(
      'ws-1',
      'media-resume-race',
      reservation.leaseToken,
      'MEDIA_BOUNDED_ITERATION_EXCEEDED',
    );
    const resumeInput = {
      workspaceId: 'ws-1',
      jobId: 'media-resume-race',
      expectedPayloadHash: failed.payloadHash,
      payload: { limit: 2 },
    };

    const outcomes = await Promise.allSettled([
      application.resumeFailed(resumeInput),
      application.resumeFailed(resumeInput),
    ]);

    assert.equal(
      outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
      1,
    );
    const rejected = outcomes.find(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === 'rejected',
    );
    assert.equal(rejected?.reason?.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal(queue.enqueued.length, 1);
    assert.equal(queue.resumed.length, 1);
  });

  it('counts only active worker leases across a suspended tracer resume', async () => {
    let now = new Date('2026-07-11T01:00:00.000Z');
    const queue = new RecordingJobPort();
    const repository = new MemoryTracerJobRepository(
      queue,
      () => new Date(now),
    );
    const application = new TracerJobApplicationService(repository);
    const submitted = await application.submit({
      workspaceId: 'ws-1',
      jobId: 'media-active-wall',
      kind: 'model.media-generation',
      payload: { limit: 1 },
    });
    const firstLease = await repository.reserve(
      submitted.workspaceId,
      submitted.jobId,
    );
    assert.ok(firstLease.leaseToken);
    now = new Date('2026-07-11T01:00:00.025Z');
    const failed = await repository.recordRejectedTerminal(
      submitted.workspaceId,
      submitted.jobId,
      firstLease.leaseToken,
      'MEDIA_BOUNDED_ITERATION_EXCEEDED',
    );

    now = new Date('2026-07-11T02:00:00.025Z');
    const resumed = await application.resumeFailed({
      workspaceId: submitted.workspaceId,
      jobId: submitted.jobId,
      expectedPayloadHash: failed.payloadHash,
      payload: { limit: 2 },
    });
    assert.equal(resumed.createdAt, submitted.createdAt);
    assert.equal(resumed.activeExecutionMs, 25);

    const secondLease = await repository.reserve(
      submitted.workspaceId,
      submitted.jobId,
    );
    assert.ok(secondLease.leaseToken);
    now = new Date('2026-07-11T02:00:00.040Z');
    const completed = await repository.complete(
      submitted.workspaceId,
      submitted.jobId,
      secondLease.leaseToken,
      { assetId: 'asset-after-hitl' },
    );
    assert.equal(completed.activeExecutionMs, 40);
    assert.equal(completed.createdAt, submitted.createdAt);
  });

  it('accumulates every expired memory lease once before consecutive takeovers', async () => {
    let now = new Date('2026-07-11T01:00:00.000Z');
    const repository = new MemoryTracerJobRepository(
      new RecordingJobPort(),
      () => new Date(now),
      { leaseDurationMs: 60_000 },
    );
    const submitted = await repository.submit({
      workspaceId: 'ws-memory-takeover',
      jobId: 'media-takeover',
      kind: 'model.media-generation',
      payload: { prompt: 'take over expired work' },
    });
    const original = await repository.reserve(
      submitted.workspaceId,
      submitted.jobId,
    );
    assert.ok(original.leaseToken);

    now = new Date('2026-07-11T01:01:30.000Z');
    const firstTakeover = await repository.reserve(
      submitted.workspaceId,
      submitted.jobId,
    );
    assert.ok(firstTakeover.leaseToken);
    assert.equal(firstTakeover.record.activeExecutionMs, 60_000);

    now = new Date('2026-07-11T01:03:00.000Z');
    const secondTakeover = await repository.reserve(
      submitted.workspaceId,
      submitted.jobId,
    );
    assert.ok(secondTakeover.leaseToken);
    assert.equal(secondTakeover.record.activeExecutionMs, 120_000);

    const completed = await repository.complete(
      submitted.workspaceId,
      submitted.jobId,
      secondTakeover.leaseToken,
      { assetId: 'asset-after-takeover' },
    );
    assert.equal(completed.activeExecutionMs, 120_000);
  });

  it('rejects failed-tracer resume when status, payload hash, or provider-task fence is unsafe', async () => {
    const queue = new RecordingJobPort();
    const repository = new MemoryTracerJobRepository(queue);
    const application = new TracerJobApplicationService(repository);
    const queued = await application.submit({
      workspaceId: 'ws-1',
      jobId: 'media-resume-unsafe',
      kind: 'model.media-generation',
      payload: { limit: 1 },
    });
    await assert.rejects(
      application.resumeFailed({
        workspaceId: queued.workspaceId,
        jobId: queued.jobId,
        expectedPayloadHash: queued.payloadHash,
        payload: { limit: 2 },
      }),
      (error: unknown) =>
        Reflect.get(Object(error), 'code') === 'INVALID_JOB',
    );

    const reservation = await repository.reserve(
      queued.workspaceId,
      queued.jobId,
    );
    assert.ok(reservation.leaseToken);
    const failed = await repository.fail(
      queued.workspaceId,
      queued.jobId,
      reservation.leaseToken,
      'Provider accepted work before failing.',
      'provider-task-still-active',
    );
    await assert.rejects(
      application.resumeFailed({
        workspaceId: failed.workspaceId,
        jobId: failed.jobId,
        expectedPayloadHash: failed.payloadHash,
        payload: { limit: 2 },
      }),
      (error: unknown) =>
        Reflect.get(Object(error), 'code') === 'INVALID_JOB',
    );
    await assert.rejects(
      application.resumeFailed({
        workspaceId: failed.workspaceId,
        jobId: failed.jobId,
        expectedPayloadHash: 'stale-payload-hash',
        payload: { limit: 2 },
      }),
      (error: unknown) =>
        Reflect.get(Object(error), 'code') === 'IDEMPOTENCY_CONFLICT',
    );
    assert.equal(queue.enqueued.length, 1);
    assert.equal(queue.resumed.length, 0);
  });

  it('fails closed when the queue transport has no explicit resume capability', async () => {
    const enqueued: Array<Parameters<JobPort['enqueue']>[0]> = [];
    const queue: JobPort = {
      async enqueue(input) {
        enqueued.push(structuredClone(input));
      },
      async cancel() {},
    };
    const repository = new MemoryTracerJobRepository(queue);
    const application = new TracerJobApplicationService(repository);
    await application.submit({
      workspaceId: 'ws-1',
      jobId: 'resume-unsupported',
      kind: 'model.media-generation',
      payload: { limit: 1 },
    });
    const reservation = await repository.reserve(
      'ws-1',
      'resume-unsupported',
    );
    assert.ok(reservation.leaseToken);
    const failed = await repository.recordRejectedTerminal(
      'ws-1',
      'resume-unsupported',
      reservation.leaseToken,
      'MEDIA_BOUNDED_ITERATION_EXCEEDED',
    );

    await assert.rejects(
      application.resumeFailed({
        workspaceId: failed.workspaceId,
        jobId: failed.jobId,
        expectedPayloadHash: failed.payloadHash,
        payload: { limit: 2 },
      }),
      (error: unknown) =>
        Reflect.get(Object(error), 'code') === 'RUNTIME_NOT_STARTED',
    );
    assert.equal(enqueued.length, 1);
    assert.equal(
      (await application.get(failed.workspaceId, failed.jobId)).status,
      'failed',
    );
  });

  it(
    'Postgres resumes one failed tracer and enqueues the replacement in the same transaction',
    { skip: !databaseUrl },
    async () => {
      if (!databaseUrl) return;
      const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
      const tracerTable = `p1_resume_tracer_${suffix}`;
      const queueTable = `p1_resume_queue_${suffix}`;
      const pool = new Pool({ connectionString: databaseUrl, max: 4 });
      let now = new Date('2026-07-11T01:00:00.000Z');
      try {
        await pool.query(
          `CREATE TABLE "public"."${queueTable}" (
             id bigserial PRIMARY KEY,
             workspace_id text NOT NULL,
             job_id text NOT NULL,
             payload jsonb NOT NULL,
             sequence integer NOT NULL
           )`,
        );
        const repository = new PostgresTracerJobRepository(
          pool,
          new PostgresRecordingJobPort(`"public"."${queueTable}"`),
          { table: tracerTable, clock: () => new Date(now) },
        );
        const application = new TracerJobApplicationService(repository);
        const submitted = await application.submit({
          workspaceId: 'ws-postgres-resume',
          jobId: 'media-resume',
          kind: 'model.media-generation',
          payload: { limit: 1 },
        });
        const reservation = await repository.reserve(
          'ws-postgres-resume',
          'media-resume',
        );
        assert.ok(reservation.leaseToken);
        now = new Date('2026-07-11T01:00:00.025Z');
        const failed = await repository.recordRejectedTerminal(
          'ws-postgres-resume',
          'media-resume',
          reservation.leaseToken,
          'MEDIA_BOUNDED_ITERATION_EXCEEDED',
          { failureCode: 'MEDIA_BOUNDED_ITERATION_EXCEEDED' },
        );
        assert.equal(failed.activeExecutionMs, 25);

        now = new Date('2026-07-11T02:00:00.025Z');
        const outcomes = await Promise.allSettled([
          application.resumeFailed({
            workspaceId: failed.workspaceId,
            jobId: failed.jobId,
            expectedPayloadHash: failed.payloadHash,
            payload: { limit: 2 },
          }),
          application.resumeFailed({
            workspaceId: failed.workspaceId,
            jobId: failed.jobId,
            expectedPayloadHash: failed.payloadHash,
            payload: { limit: 2 },
          }),
        ]);

        assert.equal(
          outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
          1,
        );
        assert.equal(
          outcomes.filter(
            (outcome) =>
              outcome.status === 'rejected' &&
              outcome.reason?.code === 'IDEMPOTENCY_CONFLICT',
          ).length,
          1,
        );
        const resumed = await application.get(
          failed.workspaceId,
          failed.jobId,
        );
        assert.equal(resumed.status, 'queued');
        assert.deepEqual(resumed.payload, { limit: 2 });
        assert.equal(resumed.acceptance, null);
        assert.equal(resumed.providerTaskRef, null);
        assert.equal(resumed.output, null);
        assert.equal(resumed.error, null);
        assert.equal(resumed.leaseExpiresAt, null);
        assert.equal(resumed.effectIdempotencyKey, failed.effectIdempotencyKey);
        assert.equal(resumed.createdAt, submitted.createdAt);
        assert.equal(resumed.activeExecutionMs, 25);
        const queued = await pool.query<{
          payload: Record<string, unknown>;
          sequence: number;
        }>(
          `SELECT payload, sequence
             FROM "public"."${queueTable}"
            ORDER BY id`,
        );
        assert.equal(queued.rowCount, 2);
        assert.equal(queued.rows[0]?.sequence, 0);
        assert.equal(queued.rows[1]?.sequence, 1);
        assert.deepEqual(queued.rows[1]?.payload, { limit: 2 });
      } finally {
        await pool
          .query(`DROP TABLE IF EXISTS "public"."${tracerTable}" CASCADE`)
          .catch(() => undefined);
        await pool
          .query(`DROP TABLE IF EXISTS "public"."${queueTable}" CASCADE`)
          .catch(() => undefined);
        await pool.end();
      }
    },
  );

  it(
    'Postgres accumulates every expired lease once before consecutive takeovers',
    { skip: !databaseUrl },
    async () => {
      if (!databaseUrl) return;
      const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
      const tracerTable = `p1_takeover_tracer_${suffix}`;
      const queueTable = `p1_takeover_queue_${suffix}`;
      const pool = new Pool({ connectionString: databaseUrl, max: 4 });
      let now = new Date('2026-07-11T01:00:00.000Z');
      try {
        await pool.query(
          `CREATE TABLE "public"."${queueTable}" (
             id bigserial PRIMARY KEY,
             workspace_id text NOT NULL,
             job_id text NOT NULL,
             payload jsonb NOT NULL,
             sequence integer NOT NULL
           )`,
        );
        const repository = new PostgresTracerJobRepository(
          pool,
          new PostgresRecordingJobPort(`"public"."${queueTable}"`),
          {
            table: tracerTable,
            clock: () => new Date(now),
            leaseDurationMs: 60_000,
          },
        );
        const submitted = await repository.submit({
          workspaceId: 'ws-postgres-takeover',
          jobId: 'media-takeover',
          kind: 'model.media-generation',
          payload: { prompt: 'take over expired work' },
        });
        const original = await repository.reserve(
          submitted.workspaceId,
          submitted.jobId,
        );
        assert.ok(original.leaseToken);

        now = new Date('2026-07-11T01:01:30.000Z');
        const firstTakeover = await repository.reserve(
          submitted.workspaceId,
          submitted.jobId,
        );
        assert.ok(firstTakeover.leaseToken);
        assert.equal(firstTakeover.record.activeExecutionMs, 60_000);

        now = new Date('2026-07-11T01:03:00.000Z');
        const secondTakeover = await repository.reserve(
          submitted.workspaceId,
          submitted.jobId,
        );
        assert.ok(secondTakeover.leaseToken);
        assert.equal(secondTakeover.record.activeExecutionMs, 120_000);

        const completed = await repository.complete(
          submitted.workspaceId,
          submitted.jobId,
          secondTakeover.leaseToken,
          { assetId: 'asset-after-takeover' },
        );
        assert.equal(completed.activeExecutionMs, 120_000);
      } finally {
        await pool
          .query(`DROP TABLE IF EXISTS "public"."${tracerTable}" CASCADE`)
          .catch(() => undefined);
        await pool
          .query(`DROP TABLE IF EXISTS "public"."${queueTable}" CASCADE`)
          .catch(() => undefined);
        await pool.end();
      }
    },
  );

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
