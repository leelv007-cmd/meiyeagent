import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Db, JobResult, JobWithMetadata, QueueResult, Schedule, SendOptions, WorkOptions } from 'pg-boss';
import type { PoolClient } from 'pg';
import { PgBossJobPort, type PgBossClient } from './pg-boss-job-port.js';

class RecordedPgBossClient implements PgBossClient {
  readonly jobs = new Map<string, JobWithMetadata<Record<string, unknown>>>();
  readonly queues = new Map<string, QueueResult>();
  readonly schedules: Schedule[] = [];
  lastSendDb?: Db;
  lastSendOptions?: SendOptions;
  lastWorkOptions?: WorkOptions;
  redriveCount = 0;
  workerHandler?: (jobs: JobWithMetadata<Record<string, unknown>>[]) => Promise<JobResult[]>;

  async start() {
    return this;
  }

  async stop() {}

  async createQueue(name: string, options: Record<string, unknown> = {}) {
    if (this.queues.has(name)) return;
    this.queues.set(name, {
      name,
      policy: 'standard',
      retryLimit: Number(options.retryLimit ?? 3),
      retryDelay: Number(options.retryDelay ?? 1),
      retryBackoff: Boolean(options.retryBackoff),
      retryDelayMax: undefined,
      expireInSeconds: Number(options.expireInSeconds ?? 60),
      retentionSeconds: 86_400,
      deleteAfterSeconds: 86_400,
      warningQueueSize: 100,
      heartbeatSeconds: Number(options.heartbeatSeconds ?? 10),
      notify: false,
      deadLetter: typeof options.deadLetter === 'string' ? options.deadLetter : undefined,
      partition: false,
      deferredCount: 0,
      queuedCount: 0,
      readyCount: 0,
      activeCount: 0,
      failedCount: 0,
      totalCount: 0,
      table: 'job',
      createdOn: new Date('2026-07-11T00:00:00.000Z'),
      updatedOn: new Date('2026-07-11T00:00:00.000Z'),
      singletonsActive: null,
    });
  }

  async send(name: string, data?: object | null, options: SendOptions = {}) {
    this.lastSendDb = options.db;
    this.lastSendOptions = options;
    if (
      options.singletonKey &&
      [...this.jobs.values()].some(
        (job) =>
          job.singletonKey === options.singletonKey &&
          (job.state === 'active' ||
            job.state === 'created' ||
            job.state === 'retry')
      )
    ) {
      return null;
    }
    const id = String(options.id);
    if (this.jobs.has(id)) return null;
    const now = new Date('2026-07-11T01:00:00.000Z');
    this.jobs.set(id, {
      id,
      name,
      data: (data ?? {}) as Record<string, unknown>,
      priority: options.priority ?? 0,
      state: 'created',
      retryLimit: 3,
      retryCount: 0,
      retryDelay: 1,
      retryBackoff: true,
      startAfter: options.startAfter ? new Date(options.startAfter) : now,
      startedOn: now,
      singletonKey: options.singletonKey ?? null,
      singletonOn: null,
      expireInSeconds: 60,
      deleteAfterSeconds: 86_400,
      createdOn: now,
      completedOn: null,
      keepUntil: new Date('2026-07-12T01:00:00.000Z'),
      policy: 'standard',
      output: {},
      heartbeatOn: null,
      heartbeatSeconds: 10,
      blocked: false,
      blocking: false,
      pendingDependencies: 0,
      deadLetter: 'p1-jobs-dead',
      sourceName: null,
      sourceId: null,
      sourceCreatedOn: null,
      sourceRetryCount: null,
      signal: AbortSignal.abort(),
    });
    return id;
  }

  async findJobs<T>(_name: string, options: { id?: string; key?: string; data?: object; queued?: boolean } = {}) {
    return [...this.jobs.values()].filter((job) => {
      if (options.id && job.id !== options.id) return false;
      if (options.key && job.singletonKey !== options.key) return false;
      if (options.data) {
        return Object.entries(options.data).every(([key, value]) => job.data[key] === value);
      }
      return !options.queued || job.state === 'created' || job.state === 'retry';
    }) as JobWithMetadata<T>[];
  }

  async cancel(_name: string, id: string | string[]) {
    const ids = Array.isArray(id) ? id : [id];
    let affected = 0;
    for (const jobId of ids) {
      const job = this.jobs.get(jobId);
      if (job && job.state !== 'completed' && job.state !== 'cancelled' && job.state !== 'failed') {
        job.state = 'cancelled';
        affected += 1;
      }
    }
    return { jobs: ids, requested: ids.length, affected };
  }

  async retry(_name: string, id: string | string[]) {
    const ids = Array.isArray(id) ? id : [id];
    let affected = 0;
    for (const jobId of ids) {
      const job = this.jobs.get(jobId);
      if (job?.state === 'failed') {
        job.state = 'retry';
        affected += 1;
      }
    }
    return { affected };
  }

  async touch(_name: string, id: string | string[]) {
    const ids = Array.isArray(id) ? id : [id];
    let affected = 0;
    for (const jobId of ids) {
      const job = this.jobs.get(jobId);
      if (job?.state === 'active') {
        job.heartbeatOn = new Date('2026-07-11T01:00:05.000Z');
        affected += 1;
      }
    }
    return { affected };
  }

  async redrive() {
    return this.redriveCount;
  }

  async schedule(name: string, cron: string, data?: object | null, options: SendOptions & { key?: string; tz?: string } = {}) {
    this.schedules.push({ name, cron, data: data ?? undefined, key: options.key ?? name, timezone: options.tz ?? 'UTC', options });
  }

  async unschedule() {}

  async getSchedules() {
    return this.schedules;
  }

  async getQueue(name: string) {
    return this.queues.get(name) ?? null;
  }

  async work<T>(
    _name: string,
    options: WorkOptions,
    handler: (jobs: JobWithMetadata<T>[]) => Promise<JobResult[]>
  ) {
    this.lastWorkOptions = options;
    this.workerHandler = async (jobs) => handler(jobs as JobWithMetadata<T>[]);
    return 'worker-id';
  }

  async offWork() {}
}

describe('PgBossJobPort', () => {
  it('keeps a delayed enqueue idempotent across processes and cancels it by logical job id', async () => {
    const client = new RecordedPgBossClient();
    const first = new PgBossJobPort(client, { queuePrefix: 'p1' });
    await first.enqueue({
      jobId: 'job-1',
      workspaceId: 'ws-1',
      kind: 'generate_copy',
      runAt: '2026-07-11T02:00:00.000Z',
      payload: { contentId: 'content-1' },
    });

    const restartedProcess = new PgBossJobPort(client, { queuePrefix: 'p1' });
    await restartedProcess.enqueue({
      jobId: 'job-1',
      workspaceId: 'ws-1',
      kind: 'generate_copy',
      runAt: '2026-07-11T02:00:00.000Z',
      payload: { contentId: 'content-1' },
    });

    assert.equal(client.jobs.size, 1);
    assert.equal((await restartedProcess.inspect('ws-1', 'job-1'))?.runAt, '2026-07-11T02:00:00.000Z');
    await restartedProcess.cancel('ws-1', 'job-1');
    assert.equal((await restartedProcess.inspect('ws-1', 'job-1'))?.status, 'cancelled');
  });

  it('uses the caller transaction, rejects id reuse with another payload, and registers durable cron', async () => {
    const client = new RecordedPgBossClient();
    const port = new PgBossJobPort(client, { queuePrefix: 'p1' });
    const transactionClient = {
      async query() {
        return { rows: [] };
      },
    } as unknown as PoolClient;
    const input = {
      jobId: 'job-transaction',
      workspaceId: 'ws-1',
      kind: 'generate_copy',
      payload: { contentId: 'content-1' },
    };

    await port.enqueueInTransaction(input, transactionClient);
    assert.ok(client.lastSendDb, 'pg-boss must receive the transaction-scoped database adapter');
    await assert.rejects(
      () => port.enqueue({ ...input, payload: { contentId: 'content-2' } }),
      /different payload/
    );

    await port.scheduleRecurring({
      scheduleId: 'weekly-review',
      workspaceId: 'ws-1',
      kind: 'weekly_review',
      cron: '0 9 * * 1',
      timezone: 'Asia/Shanghai',
      payload: { week: '2026-W28' },
    });
    const schedules = await port.listRecurring();
    assert.equal(schedules.length, 1);
    assert.equal(schedules[0]?.timezone, 'Asia/Shanghai');
  });

  it('maps Product priority and workspace concurrency to pg-boss native scheduling', async () => {
    const client = new RecordedPgBossClient();
    const port = new PgBossJobPort(client, {
      queuePrefix: 'p1',
      workspaceConcurrencyLimits: [1, 4, 8],
    });
    await port.enqueue({
      jobId: 'job-pro',
      workspaceId: 'workspace-pro',
      kind: 'generate_copy',
      payload: { contentId: 'content-1' },
      scheduling: {
        queuePriority: 10,
        workspaceConcurrencyLimit: 8,
      },
    });
    await port.startWorker(async () => ({ status: 'completed' }));

    assert.equal(client.lastSendOptions?.priority, 10);
    assert.deepEqual(client.lastSendOptions?.group, {
      id: 'workspace-pro',
      tier: 'limit-8',
    });
    assert.deepEqual(client.lastWorkOptions?.groupConcurrency, {
      default: 1,
      tiers: { 'limit-1': 1, 'limit-4': 4, 'limit-8': 8 },
    });
  });

  it('notifies the orchestration binding only after a terminal execution result', async () => {
    const client = new RecordedPgBossClient();
    const notifications: Array<{ status: string; jobId: string }> = [];
    const port = new PgBossJobPort(client, {
      queuePrefix: 'p1',
      terminalNotifier: async ({ envelope, status }) => {
        notifications.push({ jobId: envelope.jobId, status });
      },
    });
    await port.enqueue({
      jobId: 'job-eventized',
      workspaceId: 'ws-1',
      kind: 'model.media-generation',
      payload: { submission: { correlationId: 'workflow-1' } },
    });
    const job = [...client.jobs.values()][0]!;

    await port.startWorker(async () => ({
      status: 'deferred',
      deferForSeconds: 5,
    }));
    assert.equal((await client.workerHandler!([job]))[0]?.status, 'completed');
    assert.deepEqual(notifications, []);

    await port.startWorker(async () => ({
      status: 'completed',
      output: { accepted: true },
    }));
    assert.equal((await client.workerHandler!([job]))[0]?.status, 'completed');
    assert.deepEqual(notifications, [
      { jobId: 'job-eventized', status: 'completed' },
    ]);

    await port.startWorker(async () => ({
      status: 'dead_letter',
      output: { error: 'provider failed' },
    }));
    assert.equal((await client.workerHandler!([job]))[0]?.status, 'deadletter');
    assert.deepEqual(notifications, [
      { jobId: 'job-eventized', status: 'completed' },
      { jobId: 'job-eventized', status: 'failed' },
    ]);
  });

  it('claims with attempt metadata, renews leases, maps retry/dead-letter, redrives, and exposes metrics', async () => {
    const now = new Date('2026-07-11T01:01:00.000Z');
    const client = new RecordedPgBossClient();
    const port = new PgBossJobPort(client, { queuePrefix: 'p1', clock: () => now });
    await port.enqueue({
      jobId: 'job-worker',
      workspaceId: 'ws-1',
      kind: 'generate_copy',
      payload: { contentId: 'content-1' },
    });
    const job = [...client.jobs.values()][0]!;
    job.state = 'active';
    job.retryCount = 2;
    job.createdOn = new Date('2026-07-11T01:00:00.000Z');
    job.startedOn = new Date('2026-07-11T01:00:10.000Z');
    client.queues.get(port.queueName)!.activeCount = 1;
    client.queues.get(port.queueName)!.readyCount = 0;

    let observedAttempt = 0;
    await port.startWorker(async (_envelope, context) => {
      observedAttempt = context.attempt;
      await context.renewLease();
      return { status: 'retry', output: { reason: 'temporary' } };
    });
    const retryResult = await client.workerHandler!([job]);
    assert.equal(observedAttempt, 3);
    assert.equal(retryResult[0]?.status, 'failed');
    assert.equal(job.heartbeatOn?.toISOString(), '2026-07-11T01:00:05.000Z');

    await port.startWorker(async () => ({ status: 'deferred', deferForSeconds: 5 }));
    assert.equal((await client.workerHandler!([job]))[0]?.status, 'completed');
    assert.equal(client.jobs.size, 2);
    const continuation = [...client.jobs.values()].find(
      (candidate) => candidate.id !== job.id
    );
    assert.equal(continuation?.data.sequence, 1);
    assert.equal(continuation?.singletonKey, null);
    assert.ok(continuation);
    job.state = 'completed';
    continuation.state = 'created';
    continuation.createdOn = new Date('2026-07-11T01:00:05.000Z');
    assert.equal((await port.inspect('ws-1', 'job-worker'))?.status, 'queued');
    await port.cancel('ws-1', 'job-worker');
    assert.equal(continuation.state, 'cancelled');
    client.jobs.delete(continuation.id);
    job.state = 'active';

    await port.startWorker(async () => ({ status: 'dead_letter', output: { reason: 'terminal' } }));
    assert.equal((await client.workerHandler!([job]))[0]?.status, 'deadletter');
    client.redriveCount = 1;
    assert.equal(await port.redrive(10), 1);

    job.output = { value: { message: 'job heartbeat timeout' } };
    const metrics = await port.getMetrics();
    assert.equal(metrics.activeCount, 1);
    assert.equal(metrics.averageClaimLatencyMs, 10_000);
    assert.equal(metrics.attemptCount, 3);
    assert.equal(metrics.recoveryCount, 1);
    assert.equal(metrics.nextLeaseExpiryAt, '2026-07-11T01:00:15.000Z');
  });

  it('keeps a redriven job addressable after pg-boss assigns a new transport id', async () => {
    const client = new RecordedPgBossClient();
    const port = new PgBossJobPort(client, { queuePrefix: 'p1' });
    await port.enqueue({
      jobId: 'job-redrive',
      workspaceId: 'ws-1',
      kind: 'generate_copy',
      payload: { contentId: 'content-1' },
    });
    const original = [...client.jobs.values()][0]!;
    original.state = 'failed';
    const redriven = structuredClone(original);
    redriven.id = '48cbb0b1-43ea-4f12-8a3a-11750b2f94c0';
    redriven.state = 'created';
    redriven.retryCount = 0;
    redriven.createdOn = new Date('2026-07-11T01:02:00.000Z');
    client.jobs.set(redriven.id, redriven);

    assert.equal((await port.inspect('ws-1', 'job-redrive'))?.transportId, redriven.id);
    await port.cancel('ws-1', 'job-redrive');
    assert.equal(redriven.state, 'cancelled');
    assert.equal(original.state, 'failed');
  });
});
