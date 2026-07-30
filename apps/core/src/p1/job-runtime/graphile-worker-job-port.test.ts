import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DbJob, Job, TaskSpec } from 'graphile-worker';
import type { PoolClient } from 'pg';
import {
  GraphileWorkerJobPort,
  type GraphileStoredJob,
  type GraphileWorkerBoundary,
} from './graphile-worker-job-port.js';

class RecordedGraphileWorker implements GraphileWorkerBoundary {
  readonly jobs = new Map<string, GraphileStoredJob>();
  nextId = 1;
  transactionUsed = false;
  executionHandler?: (
    job: GraphileStoredJob,
    helpers: { abortSignal: AbortSignal }
  ) => Promise<void>;

  async migrate() {}
  async release() {}

  async addJob(identifier: string, payload: unknown, spec: TaskSpec = {}) {
    const key = spec.jobKey ?? String(this.nextId);
    const existing = [...this.jobs.values()].find((job) => job.key === key);
    if (existing) {
      existing.revision += 1;
      return toJob(existing);
    }
    const now = new Date('2026-07-11T01:00:00.000Z');
    const job: GraphileStoredJob = {
      id: String(this.nextId++),
      taskIdentifier: identifier,
      payload,
      runAt: spec.runAt ?? now,
      attempts: 0,
      maxAttempts: spec.maxAttempts ?? 5,
      lastError: null,
      createdAt: now,
      updatedAt: now,
      key,
      lockedAt: null,
      lockedBy: null,
      revision: 0,
    };
    this.jobs.set(job.id, job);
    return toJob(job);
  }

  async findByKey(key: string) {
    return [...this.jobs.values()].find((job) => job.key === key) ?? null;
  }

  async findById(id: string) {
    return this.jobs.get(id) ?? null;
  }

  async list() {
    return [...this.jobs.values()];
  }

  async enqueueWithClient(_client: PoolClient, identifier: string, payload: unknown, spec: TaskSpec) {
    this.transactionUsed = true;
    await this.addJob(identifier, payload, spec);
    const job = await this.findByKey(spec.jobKey!);
    assert.ok(job);
    return job;
  }

  async renewLease(id: string) {
    const job = this.jobs.get(id);
    if (!job?.lockedAt) return false;
    job.lockedAt = new Date('2026-07-11T01:00:20.000Z');
    return true;
  }

  async startWorker(
    _taskIdentifier: string,
    handler: (job: GraphileStoredJob, helpers: { abortSignal: AbortSignal }) => Promise<void>
  ) {
    this.executionHandler = handler;
    return { stop: async () => undefined };
  }

  async completeJobs(ids: string[]) {
    return ids.flatMap((id) => {
      const job = this.jobs.get(id);
      if (!job || job.lockedAt) return [];
      this.jobs.delete(id);
      return [toDbJob(job)];
    });
  }

  async permanentlyFailJobs(ids: string[], reason?: string) {
    return ids.flatMap((id) => {
      const job = this.jobs.get(id);
      if (!job) return [];
      job.attempts = job.maxAttempts;
      job.lastError = reason ?? null;
      return [toDbJob(job)];
    });
  }

  async rescheduleJobs(ids: string[], options: { runAt?: string | Date; attempts?: number; maxAttempts?: number }) {
    return ids.flatMap((id) => {
      const job = this.jobs.get(id);
      if (!job || job.lockedAt) return [];
      if (options.runAt) job.runAt = new Date(options.runAt);
      if (options.attempts !== undefined) job.attempts = options.attempts;
      if (options.maxAttempts !== undefined) job.maxAttempts = options.maxAttempts;
      return [toDbJob(job)];
    });
  }
}

function toDbJob(job: GraphileStoredJob): DbJob {
  return {
    id: job.id,
    job_queue_id: null,
    task_id: 1,
    payload: job.payload,
    priority: 0,
    run_at: job.runAt,
    attempts: job.attempts,
    max_attempts: job.maxAttempts,
    last_error: job.lastError,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
    key: job.key,
    revision: job.revision,
    locked_at: job.lockedAt,
    locked_by: job.lockedBy,
    flags: null,
    is_available: job.lockedAt === null && job.attempts < job.maxAttempts,
  };
}

function toJob(job: GraphileStoredJob): Job {
  return { ...toDbJob(job), task_identifier: job.taskIdentifier };
}

describe('GraphileWorkerJobPort', () => {
  it('implements the same persistent logical-id, delay, cancellation, and redrive contract', async () => {
    const boundary = new RecordedGraphileWorker();
    const port = new GraphileWorkerJobPort(boundary, { taskIdentifier: 'p1_job' });
    const command = {
      jobId: 'job-1',
      workspaceId: 'ws-1',
      kind: 'generate_copy',
      runAt: '2026-07-11T02:00:00.000Z',
      payload: { contentId: 'content-1' },
    };

    await port.enqueue(command);
    await new GraphileWorkerJobPort(boundary, { taskIdentifier: 'p1_job' }).enqueue(command);
    assert.equal(boundary.jobs.size, 1);
    assert.equal((await port.inspect('ws-1', 'job-1'))?.runAt, command.runAt);

    await port.cancel('ws-1', 'job-1');
    assert.equal(await port.inspect('ws-1', 'job-1'), null);

    await port.enqueue({ ...command, jobId: 'job-2' });
    const failed = await boundary.findByKey(port.logicalKey('ws-1', 'job-2'));
    assert.ok(failed);
    await boundary.permanentlyFailJobs([failed.id], 'boom');
    assert.equal(await port.redrive(10), 1);
    assert.equal((await boundary.findById(failed.id))?.attempts, 0);
  });

  it('supports transaction-scoped enqueue, conflict detection, config cron, lease/retry metrics', async () => {
    const now = new Date('2026-07-11T01:01:00.000Z');
    const boundary = new RecordedGraphileWorker();
    const port = new GraphileWorkerJobPort(boundary, {
      taskIdentifier: 'p1_job',
      clock: () => now,
    });
    const transactionClient = {} as PoolClient;
    const input = {
      jobId: 'job-transaction',
      workspaceId: 'ws-1',
      kind: 'generate_copy',
      payload: { contentId: 'content-1' },
    };
    await port.enqueueInTransaction(input, transactionClient);
    assert.equal(boundary.transactionUsed, true);
    await assert.rejects(
      () => port.enqueue({ ...input, payload: { contentId: 'content-2' } }),
      /different payload/
    );

    const cron = port.defineRecurring({
      scheduleId: 'weekly-review',
      workspaceId: 'ws-1',
      kind: 'weekly_review',
      cron: '0 9 * * 1',
      payload: { week: 'next' },
    });
    assert.equal(cron.match, '0 9 * * 1');
    assert.equal(port.listRecurring().length, 1);

    const job = await boundary.findByKey(port.logicalKey('ws-1', 'job-transaction'));
    assert.ok(job);
    job.lockedAt = new Date('2026-07-11T01:00:10.000Z');
    job.attempts = 2;
    assert.equal(await boundary.renewLease(job.id), true);
    const metrics = await port.getMetrics();
    assert.equal(metrics.activeCount, 1);
    assert.equal(metrics.attemptCount, 3);
    assert.equal(metrics.recoveryCount, null);
    assert.equal(metrics.averageClaimLatencyMs, 20_000);
    assert.equal(metrics.nextLeaseExpiryAt, '2026-07-11T05:00:20.000Z');

    await port.startWorker(async () => ({ status: 'deferred', deferForSeconds: 5 }));
    await boundary.executionHandler!(job, { abortSignal: new AbortController().signal });
    assert.equal(boundary.jobs.size, 2);
    const continuation = [...boundary.jobs.values()].find((candidate) => candidate.id !== job.id);
    assert.equal((continuation?.payload as { sequence?: number }).sequence, 1);
  });

  it('enqueues a transaction-scoped resume as a new continuation transport', async () => {
    const boundary = new RecordedGraphileWorker();
    const port = new GraphileWorkerJobPort(boundary, {
      taskIdentifier: 'p1_job',
    });
    const transactionClient = {} as PoolClient;
    const input = {
      jobId: 'job-resume',
      workspaceId: 'ws-1',
      kind: 'generate_copy',
      payload: { limit: 1 },
    };

    await port.enqueueInTransaction(input, transactionClient);
    const original = await boundary.findByKey(
      port.logicalKey(input.workspaceId, input.jobId),
    );
    assert.ok(original);

    const resumedInput = { ...input, payload: { limit: 2 } };
    await port.resumeInTransaction(resumedInput, 1, transactionClient);
    await port.resumeInTransaction(resumedInput, 1, transactionClient);

    assert.equal(boundary.jobs.size, 2);
    assert.deepEqual(
      (
        (await boundary.findById(original.id))?.payload as {
          payload?: unknown;
        }
      ).payload,
      { limit: 1 },
    );
    const continuation = [...boundary.jobs.values()].find(
      (job) => job.id !== original.id,
    );
    assert.equal(
      (continuation?.payload as { workspaceId?: string }).workspaceId,
      input.workspaceId,
    );
    assert.equal(
      (continuation?.payload as { jobId?: string }).jobId,
      input.jobId,
    );
    assert.equal(
      (continuation?.payload as { sequence?: number }).sequence,
      1,
    );
    assert.deepEqual(
      (continuation?.payload as { payload?: unknown }).payload,
      { limit: 2 },
    );
    await assert.rejects(
      () =>
        port.enqueue({
          ...input,
          payload: { limit: 3 },
        }),
      /different payload/,
    );
  });
});
