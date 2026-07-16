import assert from 'node:assert/strict';
import test from 'node:test';
import { P1DomainError, type P1Context } from '../foundation/domain.js';
import { MemoryJobPort } from '../foundation/memory-job-port.js';
import {
  JobRuntimeFoundationModule,
  type JobRuntimeControlPort,
} from './foundation-module.js';
import type { QueueRuntimeMetrics } from './job-contracts.js';
import type { OperationalMetricsSnapshot } from './operational-metrics.js';
import {
  DurableTracerWorker,
  MemoryTracerJobRepository,
  TracerJobApplicationService,
  type TracerJobRecord,
} from './tracer-worker.js';

const metrics: QueueRuntimeMetrics = {
  activeCount: 0,
  attemptCount: 0,
  averageClaimLatencyMs: null,
  capturedAt: '2026-07-11T00:00:00.000Z',
  deadLetterDepth: 0,
  deferredCount: 0,
  failedCount: 0,
  leaseExpiryCount: 0,
  maxClaimLatencyMs: null,
  nextLeaseExpiryAt: null,
  oldestRunnableAgeMs: 0,
  queueDepth: 1,
  recoveryCount: 0,
};

function known<T>(value: T) {
  return { status: 'known' as const, value };
}

const operationalMetrics: OperationalMetricsSnapshot = {
  capturedAt: metrics.capturedAt,
  database: {
    activeConnections: known(2),
    activeTransactions: known(1),
    indexGrowthBytes24h: known(10),
    indexSizeBytes: known(1024),
    oldestTransactionMs: known(12),
    poolIdle: known(1),
    poolTotal: known(2),
    poolWaiting: known(0),
    slowQueries: {
      status: 'unknown',
      reason: 'pg_stat_statements_not_installed',
    },
    workspaceLockOldestWaitMs: known(null),
    workspaceLockWaiters: known(0),
  },
  moduleRevisions: {
    publishedLast30Days: known(2),
    retiredLast30Days: known(1),
    rolledBackLast30Days: known(1),
  },
  queue: {
    averageClaimLatencyMs: known(metrics.averageClaimLatencyMs),
    leaseExpiryCount: known(metrics.leaseExpiryCount),
    oldestRunnableAgeMs: known(metrics.oldestRunnableAgeMs),
    queueDepth: known(metrics.queueDepth),
    recoveryCount: known(metrics.recoveryCount ?? 0),
  },
  runner: {
    deferredCount: known(1),
    failuresByKind: known({}),
    outcomeCounts: known({
      completed: 2,
      dead_letter: 0,
      deferred: 1,
      retry: 0,
      threw: 0,
    }),
    recoveredFailureCount: known(0),
    windowMinutes: 30,
  },
  worker: {
    activeJobs: known(0),
    cpuUtilizationPercent: known(2),
    eventLoopLagMs: known(1),
    heartbeatAt: known(metrics.capturedAt),
    heapUsedBytes: known(1024),
    mediaAverageDurationMs: known(200),
    rssBytes: known(2048),
  },
};

const owner: P1Context = {
  actor: 'owner',
  correlationId: 'corr-owner',
  userId: 'owner-a',
  workspaceId: 'workspace-a',
};

function fixture() {
  const queue = new MemoryJobPort();
  const repository = new MemoryTracerJobRepository(queue);
  const tracer = new TracerJobApplicationService(repository);
  const calls: string[] = [];
  const runtime: JobRuntimeControlPort = {
    async cancel(workspaceId, jobId) {
      calls.push(`cancel:${workspaceId}:${jobId}`);
      await queue.cancel(workspaceId, jobId);
    },
    async getMetrics() {
      calls.push('metrics');
      return metrics;
    },
    async scheduleRecurring(input) {
      calls.push(`schedule:${input.workspaceId}:${input.scheduleId}`);
    },
    async unscheduleRecurring(workspaceId, scheduleId) {
      calls.push(`unschedule:${workspaceId}:${scheduleId}`);
    },
  };
  const module = new JobRuntimeFoundationModule(tracer, runtime, {
    adminActorIds: ['admin-a'],
    operationalMetrics: {
      async collect() {
        calls.push('observability');
        return operationalMetrics;
      },
    },
    workerActorIds: ['worker-a'],
  });
  return { calls, module, queue, repository, tracer };
}

function execute(
  module: JobRuntimeFoundationModule,
  context: P1Context,
  action: string,
  payload: Record<string, unknown> = {}
) {
  return module.execute({
    context,
    idempotencyKey: `${context.userId}:${action}`,
    input: { action, payload },
  });
}

function forbidden(error: unknown) {
  return error instanceof P1DomainError && error.code === 'FORBIDDEN';
}

test('owner keeps a strictly workspace-scoped job query but cannot invoke runtime operations or global metrics', async () => {
  const { calls, module, tracer } = fixture();
  await tracer.submit({
    jobId: 'job-a',
    kind: 'product.tracer',
    payload: { source: 'weekly-trigger' },
    workspaceId: owner.workspaceId,
  });

  const job = (await module.query({
    context: owner,
    input: {
      action: 'job',
      payload: { jobId: 'job-a', workspaceId: 'workspace-other' },
    },
  })) as TracerJobRecord;

  assert.equal(job.workspaceId, owner.workspaceId);
  for (const [action, payload] of [
    ['submit', { jobId: 'job-b', kind: 'product.tracer', payload: {} }],
    ['cancel', { jobId: 'job-a' }],
    [
      'schedule_recurring',
      {
        cron: '0 9 * * 1',
        kind: 'product.tracer',
        payload: {},
        scheduleId: 'weekly',
      },
    ],
    ['unschedule_recurring', { scheduleId: 'weekly' }],
  ] as const) {
    await assert.rejects(execute(module, owner, action, payload), forbidden);
  }
  await assert.rejects(
    module.query({ context: owner, input: { action: 'metrics' } }),
    forbidden
  );
  await assert.rejects(
    module.query({ context: owner, input: { action: 'observability' } }),
    forbidden
  );
  assert.deepEqual(calls, []);
});

test('runtime operations and metrics require both a trusted actor role and its allowlisted identity', async () => {
  const { calls, module } = fixture();
  const worker: P1Context = {
    actor: 'worker',
    correlationId: 'corr-worker',
    userId: 'worker-a',
    workspaceId: 'workspace-a',
  };
  const admin: P1Context = {
    actor: 'admin',
    correlationId: 'corr-admin',
    userId: 'admin-a',
    workspaceId: 'workspace-a',
  };

  await execute(module, worker, 'submit', {
    jobId: 'job-worker',
    kind: 'product.tracer',
    payload: {},
    workspaceId: 'workspace-other',
  });
  await execute(module, admin, 'schedule_recurring', {
    cron: '0 9 * * 1',
    kind: 'product.tracer',
    payload: {},
    scheduleId: 'weekly',
    workspaceId: 'workspace-other',
  });
  await execute(module, admin, 'unschedule_recurring', {
    scheduleId: 'weekly',
  });
  await execute(module, worker, 'cancel', { jobId: 'job-worker' });
  assert.equal(
    await module.query({ context: worker, input: { action: 'metrics' } }),
    metrics
  );
  assert.equal(
    await module.query({ context: admin, input: { action: 'metrics' } }),
    metrics
  );
  assert.equal(
    await module.query({ context: admin, input: { action: 'observability' } }),
    operationalMetrics
  );
  assert.deepEqual(calls, [
    'schedule:workspace-a:weekly',
    'unschedule:workspace-a:weekly',
    'metrics',
    'metrics',
    'observability',
  ]);

  for (const context of [
    { ...worker, userId: 'worker-not-allowed' },
    { ...admin, userId: 'admin-not-allowed' },
    { ...owner, userId: 'worker-a' },
  ]) {
    await assert.rejects(
      execute(module, context, 'submit', {
        jobId: `blocked-${context.userId}`,
        kind: 'product.tracer',
        payload: {},
      }),
      forbidden
    );
    await assert.rejects(
      module.query({ context, input: { action: 'metrics' } }),
      forbidden
    );
  }
});

test('job lookup cannot cross workspace even when the caller supplies another workspace id', async () => {
  const { module, tracer } = fixture();
  await tracer.submit({
    jobId: 'other-job',
    kind: 'product.tracer',
    payload: {},
    workspaceId: 'workspace-b',
  });

  await assert.rejects(
    module.query({
      context: owner,
      input: {
        action: 'job',
        payload: { jobId: 'other-job', workspaceId: 'workspace-b' },
      },
    }),
    (error: unknown) =>
      error instanceof Error && 'code' in error && error.code === 'NOT_FOUND'
  );
});

test('runtime cancellation persists provider intent and keeps transport deliverable until the tracer settles', async () => {
  const { calls, module, queue, repository, tracer } = fixture();
  const workerContext: P1Context = {
    actor: 'worker',
    correlationId: 'corr-worker-cancel',
    userId: 'worker-a',
    workspaceId: 'workspace-a',
  };
  await execute(module, workerContext, 'submit', {
    jobId: 'provider-job',
    kind: 'model.media-generation',
    payload: { prompt: '取消任务' },
  });
  const record = await tracer.get(workerContext.workspaceId, 'provider-job');
  const cancelledTaskRefs: string[] = [];
  const worker = new DurableTracerWorker(repository, {
    async execute() {
      return {
        acceptance: 'accepted',
        delivery: 'pending',
        taskRef: 'provider-task-for-runtime-cancel',
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
  assert.equal((await worker.handle(envelope)).status, 'deferred');

  await execute(module, workerContext, 'cancel', { jobId: record.jobId });
  assert.equal(
    (await tracer.get(workerContext.workspaceId, record.jobId)).status,
    'cancel_requested'
  );
  assert.equal(
    (await queue.inspect(workerContext.workspaceId, record.jobId))?.status,
    'queued',
    'the transport must remain deliverable so provider cancellation can run'
  );

  assert.equal((await worker.handle(envelope)).status, 'completed');
  assert.equal(
    (await tracer.get(workerContext.workspaceId, record.jobId)).status,
    'cancelled'
  );
  assert.deepEqual(cancelledTaskRefs, ['provider-task-for-runtime-cancel']);
  assert.deepEqual(calls, []);
});
