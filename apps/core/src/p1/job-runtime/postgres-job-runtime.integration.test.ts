import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { Pool } from 'pg';
import { PgBossJobPort } from './pg-boss-job-port.js';
import {
  DurableTracerWorker,
  PostgresTracerJobRepository,
  TracerJobApplicationService,
  type TracerExternalEffect,
} from './tracer-worker.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe('Postgres job runtimes', () => {
  it(
    'pg-boss persists a transactionally submitted tracer across a worker restart',
    { skip: !databaseUrl },
    async () => {
      if (!databaseUrl) return;
      const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
      const schema = `p1_boss_${suffix}`;
      const table = `p1_tracer_${suffix}`;
      const pool = new Pool({ connectionString: databaseUrl, max: 6 });
      let runtime: PgBossJobPort | undefined;
      let worker: { stop(): Promise<void> } | undefined;
      try {
        runtime = PgBossJobPort.connect({
          connection: { connectionString: databaseUrl, schema },
          queuePrefix: `p1-${suffix}`,
          retryDelaySeconds: 1,
          heartbeatSeconds: 10,
        });
        const repository = new PostgresTracerJobRepository(pool, runtime, { table });
        const application = new TracerJobApplicationService(repository);
        await application.submit({
          workspaceId: 'ws-pg-boss',
          jobId: 'restart-tracer',
          kind: 'generate_copy',
          payload: { prompt: '写一条门店文案' },
        });
        assert.equal((await application.get('ws-pg-boss', 'restart-tracer')).status, 'queued');
        await runtime.stop();

        runtime = PgBossJobPort.connect({
          connection: { connectionString: databaseUrl, schema },
          queuePrefix: `p1-${suffix}`,
          retryDelaySeconds: 1,
          heartbeatSeconds: 10,
        });
        const recoveredRepository = new PostgresTracerJobRepository(pool, runtime, { table });
        const effect: TracerExternalEffect = {
          async execute() {
            return {
              acceptance: 'accepted',
              delivery: 'completed',
              taskRef: 'recorded-provider-task',
              output: { copy: '恢复后交付的门店文案' },
            };
          },
          async reconcile() {
            return {
              acceptance: 'accepted',
              delivery: 'completed',
              taskRef: 'recorded-provider-task',
              output: { copy: '恢复后交付的门店文案' },
            };
          },
        };
        const tracer = new DurableTracerWorker(recoveredRepository, effect);
        worker = await runtime.startWorker((envelope, context) => tracer.handle(envelope, context));
        const completed = await waitFor(async () => {
          const record = await recoveredRepository.get('ws-pg-boss', 'restart-tracer');
          return record?.status === 'completed' ? record : null;
        });
        assert.deepEqual(completed.output, { copy: '恢复后交付的门店文案' });

        await runtime.scheduleRecurring({
          scheduleId: 'weekly-review',
          workspaceId: 'ws-pg-boss',
          kind: 'weekly_review',
          cron: '0 9 * * 1',
          timezone: 'Asia/Shanghai',
          payload: { source: 'integration-test' },
        });
        assert.equal((await runtime.listRecurring()).length, 1);
        assert.ok((await runtime.getMetrics()).attemptCount >= 1);
      } finally {
        await worker?.stop().catch(() => undefined);
        await runtime?.stop().catch(() => undefined);
        await pool.query(`DROP TABLE IF EXISTS "public"."${table}" CASCADE`).catch(() => undefined);
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
        await pool.end();
      }
    }
  );

  it(
    'Postgres keeps cancel intent behind an active submit lease and preserves its provider task reference',
    { skip: !databaseUrl },
    async () => {
      if (!databaseUrl) return;
      const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
      const schema = `p1_cancel_${suffix}`;
      const table = `p1_cancel_tracer_${suffix}`;
      const pool = new Pool({ connectionString: databaseUrl, max: 6 });
      let runtime: PgBossJobPort | undefined;
      try {
        runtime = PgBossJobPort.connect({
          connection: { connectionString: databaseUrl, schema },
          queuePrefix: `p1-cancel-${suffix}`,
          retryDelaySeconds: 1,
          heartbeatSeconds: 10,
        });
        const repository = new PostgresTracerJobRepository(pool, runtime, {
          table,
        });
        const application = new TracerJobApplicationService(repository);
        const record = await application.submit({
          workspaceId: 'ws-pg-cancel',
          jobId: 'cancel-during-submit',
          kind: 'model.media-generation',
          payload: { prompt: '提交中取消' },
        });
        let releaseSubmit!: () => void;
        let markSubmitEntered!: () => void;
        const submitEntered = new Promise<void>((resolve) => {
          markSubmitEntered = resolve;
        });
        const submitGate = new Promise<void>((resolve) => {
          releaseSubmit = resolve;
        });
        const cancelledTaskRefs: string[] = [];
        const tracer = new DurableTracerWorker(repository, {
          async execute() {
            markSubmitEntered();
            await submitGate;
            return {
              acceptance: 'accepted',
              delivery: 'pending',
              taskRef: 'pg-provider-task-during-cancel',
            };
          },
          async reconcile() {
            throw new Error('cancelled work must not reconcile');
          },
          async cancel(request) {
            cancelledTaskRefs.push(request.providerTaskRef ?? 'missing');
            return {
              acceptance: 'accepted',
              taskRef: request.providerTaskRef,
            };
          },
        });
        const envelope = {
          enqueuedAt: record.createdAt,
          fingerprint: record.payloadHash,
          jobId: record.jobId,
          kind: record.kind,
          payload: record.payload,
          workspaceId: record.workspaceId,
        };

        const submitting = tracer.handle(envelope);
        await submitEntered;
        await application.cancel(record.workspaceId, record.jobId);
        assert.equal((await tracer.handle(envelope)).status, 'deferred');
        releaseSubmit();
        assert.equal((await submitting).status, 'deferred');
        const accepted = await application.get(record.workspaceId, record.jobId);
        assert.equal(accepted.status, 'cancel_requested');
        assert.equal(
          accepted.providerTaskRef,
          'pg-provider-task-during-cancel'
        );

        assert.equal((await tracer.handle(envelope)).status, 'completed');
        assert.equal(
          (await application.get(record.workspaceId, record.jobId)).status,
          'cancelled'
        );
        assert.deepEqual(cancelledTaskRefs, ['pg-provider-task-during-cancel']);

        const lateTerminalOutput = {
          cancelledProviderTerminal: {
            reconciliationKey: 'late-provider-terminal-pg-fixture',
            providerTaskRef: 'pg-provider-task-during-cancel',
            providerStatus: 'completed',
            isolatedFromCancelledWorkflow: true,
          },
        };
        const reconciled = await application.recordCancelledReconciliation(
          record.workspaceId,
          record.jobId,
          'pg-provider-task-during-cancel',
          'late-provider-terminal-pg-fixture',
          lateTerminalOutput,
        );
        assert.deepEqual(reconciled.output, lateTerminalOutput);
        const replayed = await application.recordCancelledReconciliation(
          record.workspaceId,
          record.jobId,
          'pg-provider-task-during-cancel',
          'late-provider-terminal-pg-fixture',
          lateTerminalOutput,
        );
        assert.equal(replayed.updatedAt, reconciled.updatedAt);
        await assert.rejects(
          application.recordCancelledReconciliation(
            'another-workspace',
            record.jobId,
            'pg-provider-task-during-cancel',
            'late-provider-terminal-pg-fixture',
            lateTerminalOutput,
          ),
          /not found/i,
        );
        await assert.rejects(
          application.recordCancelledReconciliation(
            record.workspaceId,
            record.jobId,
            'another-provider-task',
            'late-provider-terminal-pg-fixture',
            lateTerminalOutput,
          ),
          /task reference/i,
        );
      } finally {
        await runtime?.stop().catch(() => undefined);
        await pool
          .query(`DROP TABLE IF EXISTS "public"."${table}" CASCADE`)
          .catch(() => undefined);
        await pool
          .query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
          .catch(() => undefined);
        await pool.end();
      }
    }
  );

  it(
    'pg-boss restart reconciles the persisted unknown provider task without resubmitting',
    { skip: !databaseUrl },
    async () => {
      if (!databaseUrl) return;
      const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
      const schema = `p1_media_${suffix}`;
      const table = `p1_media_tracer_${suffix}`;
      const pool = new Pool({ connectionString: databaseUrl, max: 6 });
      let runtime: PgBossJobPort | undefined;
      let worker: { stop(): Promise<void> } | undefined;
      let submitCalls = 0;
      try {
        runtime = PgBossJobPort.connect({
          connection: { connectionString: databaseUrl, schema },
          queuePrefix: `p1-media-${suffix}`,
          retryDelaySeconds: 1,
          heartbeatSeconds: 10,
        });
        const repository = new PostgresTracerJobRepository(pool, runtime, {
          table,
        });
        const application = new TracerJobApplicationService(repository);
        await application.submit({
          workspaceId: 'ws-media-restart',
          jobId: 'media-unknown-task',
          kind: 'model.media-generation',
          payload: { submission: { prompt: '门店视频' } },
        });
        const firstTracer = new DurableTracerWorker(repository, {
          async execute() {
            submitCalls += 1;
            return {
              acceptance: 'acceptance_unknown',
              delivery: 'unknown',
              taskRef: 'provider-task-survives-pg-restart',
            };
          },
          async reconcile() {
            throw new Error('first worker must not reconcile');
          },
        });
        worker = await runtime.startWorker((envelope, context) =>
          firstTracer.handle(envelope, context),
        );
        await waitFor(async () => {
          const record = await repository.get(
            'ws-media-restart',
            'media-unknown-task',
          );
          return record?.status === 'unknown' ? record : null;
        });
        await worker.stop();
        worker = undefined;
        await runtime.stop();

        runtime = PgBossJobPort.connect({
          connection: { connectionString: databaseUrl, schema },
          queuePrefix: `p1-media-${suffix}`,
          retryDelaySeconds: 1,
          heartbeatSeconds: 10,
        });
        const recoveredRepository = new PostgresTracerJobRepository(
          pool,
          runtime,
          { table },
        );
        const recoveredTracer = new DurableTracerWorker(
          recoveredRepository,
          {
            async execute() {
              throw new Error('restart must not submit provider work again');
            },
            async reconcile(request) {
              assert.equal(
                request.providerTaskRef,
                'provider-task-survives-pg-restart',
              );
              return {
                acceptance: 'accepted',
                delivery: 'completed',
                taskRef: request.providerTaskRef,
                output: { assetId: 'asset-after-pg-restart' },
              };
            },
          },
        );
        worker = await runtime.startWorker((envelope, context) =>
          recoveredTracer.handle(envelope, context),
        );
        const completed = await waitFor(async () => {
          const record = await recoveredRepository.get(
            'ws-media-restart',
            'media-unknown-task',
          );
          return record?.status === 'completed' ? record : null;
        });
        assert.equal(
          completed.providerTaskRef,
          'provider-task-survives-pg-restart',
        );
        assert.equal(submitCalls, 1);
      } finally {
        await worker?.stop().catch(() => undefined);
        await runtime?.stop().catch(() => undefined);
        await pool
          .query(`DROP TABLE IF EXISTS "public"."${table}" CASCADE`)
          .catch(() => undefined);
        await pool
          .query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
          .catch(() => undefined);
        await pool.end();
      }
    },
  );
});

async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await read();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for durable job completion.`);
}
