import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import type { QueueRuntimeMetrics } from './job-contracts.js';
import { PostgresOperationalMetricsCollector } from './operational-metrics.js';
import {
  MemoryOperationalTelemetryStore,
  PostgresOperationalTelemetryStore,
} from './operational-telemetry.js';

const connectionString = process.env.TEST_DATABASE_URL;

const queue: QueueRuntimeMetrics = {
  activeCount: 1,
  attemptCount: 3,
  averageClaimLatencyMs: 20,
  capturedAt: '2026-07-11T00:00:00.000Z',
  deadLetterDepth: 0,
  deferredCount: 0,
  failedCount: 0,
  leaseExpiryCount: 0,
  maxClaimLatencyMs: 20,
  nextLeaseExpiryAt: null,
  oldestRunnableAgeMs: 5,
  queueDepth: 2,
  recoveryCount: 1,
};

test(
  'collects durable worker, runner, database, and index-growth evidence from PostgreSQL',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const tables = {
      workerSamplesTable: `p1_worker_samples_${suffix}`,
      runnerEventsTable: `p1_runner_events_${suffix}`,
      indexSamplesTable: `p1_index_samples_${suffix}`,
    };
    const pool = new Pool({ connectionString });
    const telemetry = new PostgresOperationalTelemetryStore(pool, tables);
    await telemetry.migrate();
    t.after(async () => {
      await Promise.all(
        Object.values(tables).map((table) =>
          pool.query(`DROP TABLE IF EXISTS "${table}" CASCADE`)
        )
      );
      await pool.end();
    });
    const capturedAt = new Date('2026-07-11T12:00:00.000Z');
    await telemetry.recordWorkerSample({
      activeJobs: 2,
      cpuUtilizationPercent: 37.5,
      eventLoopLagMs: 4,
      heapUsedBytes: 2048,
      rssBytes: 4096,
      sampledAt: '2026-07-11T11:59:59.000Z',
      windowStartedAt: '2026-07-11T11:59:54.000Z',
      workerId: 'worker-pg',
    });
    await telemetry.recordRunnerEvent({
      durationMs: 200,
      kind: 'model.media-generation',
      occurredAt: '2026-07-11T11:55:00.000Z',
      outcome: 'completed',
      recovered: false,
      workerId: 'worker-pg',
    });
    await telemetry.recordRunnerEvent({
      durationMs: 50,
      kind: 'product.tracer',
      occurredAt: '2026-07-11T11:56:00.000Z',
      outcome: 'retry',
      recovered: true,
      workerId: 'worker-pg',
    });
    const currentIndexSize = await pool.query<{ bytes: string }>(`
      SELECT COALESCE(sum(pg_relation_size(indexrelid)), 0)::text AS bytes
      FROM pg_stat_user_indexes
    `);
    await telemetry.recordIndexSizeSample({
      indexSizeBytes: Number(currentIndexSize.rows[0]?.bytes ?? 0) - 128,
      sampledAt: '2026-07-10T11:00:00.000Z',
    });
    const collector = new PostgresOperationalMetricsCollector(
      pool,
      { async getMetrics() { return queue; } },
      telemetry,
      { clock: () => new Date(capturedAt) }
    );

    const snapshot = await collector.collect();

    assert.deepEqual(snapshot.queue.queueDepth, {
      scope: 'configured_job_runtime',
      status: 'known',
      value: 2,
    });
    assert.deepEqual(snapshot.worker.cpuUtilizationPercent, {
      scope: 'independent_job_worker_latest_heartbeat',
      status: 'known',
      value: 37.5,
    });
    assert.deepEqual(snapshot.worker.activeJobs, {
      scope: 'independent_job_worker_latest_heartbeat',
      status: 'known',
      value: 2,
    });
    assert.equal(snapshot.runner.outcomeCounts.status, 'known');
    if (snapshot.runner.outcomeCounts.status === 'known') {
      assert.equal(snapshot.runner.outcomeCounts.value.completed, 1);
      assert.equal(snapshot.runner.outcomeCounts.value.retry, 1);
    }
    assert.deepEqual(snapshot.runner.recoveredFailureCount, {
      scope: 'p1_job_worker_handler_events_last_30m',
      status: 'known',
      value: 1,
    });
    assert.equal(snapshot.database.indexGrowthBytes24h.status, 'known');
    assert.equal(snapshot.database.activeTransactions.status, 'known');
    assert.equal(snapshot.database.workspaceLockWaiters.status, 'known');

    const stale = await new PostgresOperationalMetricsCollector(
      pool,
      { async getMetrics() { return queue; } },
      telemetry,
      { clock: () => new Date('2026-07-11T12:01:00.000Z') }
    ).collect();
    assert.deepEqual(stale.worker.rssBytes, {
      reason: 'worker_sample_stale',
      scope: 'independent_job_worker_latest_heartbeat',
      status: 'unknown',
    });
  }
);

test('reports permission, schema, and missing worker evidence as unknown instead of zero', async () => {
  const fakePool = {
    totalCount: 2,
    idleCount: 1,
    waitingCount: 0,
    async query(text: string) {
      if (text.includes('pg_roles')) {
        const error = new Error('permission denied') as Error & { code: string };
        error.code = '42501';
        throw error;
      }
      if (text.includes('pg_stat_user_indexes')) {
        return { rows: [{ bytes: '100' }] };
      }
      if (text.includes('pg_extension')) {
        return { rows: [{ installed: false }] };
      }
      const error = new Error('missing relation') as Error & { code: string };
      error.code = '42P01';
      throw error;
    },
  } as unknown as Pool;
  const telemetry = new MemoryOperationalTelemetryStore();
  const snapshot = await new PostgresOperationalMetricsCollector(
    fakePool,
    { async getMetrics() { return queue; } },
    telemetry,
    { clock: () => new Date('2026-07-11T12:00:00.000Z') }
  ).collect();

  assert.deepEqual(snapshot.database.activeTransactions, {
    reason: 'postgres_permission_denied',
    scope: 'current_database_all_sessions',
    status: 'unknown',
  });
  assert.deepEqual(snapshot.worker.activeJobs, {
    reason: 'no_worker_sample',
    scope: 'independent_job_worker_latest_heartbeat',
    status: 'unknown',
  });
  assert.deepEqual(snapshot.moduleRevisions.publishedLast30Days, {
    reason: 'schema_unavailable',
    scope: 'integration_tool_template_and_model_revision_events_last_30d',
    status: 'unknown',
  });
  assert.deepEqual(snapshot.database.slowQueries, {
    reason: 'pg_stat_statements_not_installed',
    scope: 'pg_stat_statements_mean_exec_time_gte_250ms',
    status: 'unknown',
  });
});

test('reports telemetry table drift as unknown instead of an empty healthy window', async () => {
  class DriftedTelemetryStore extends MemoryOperationalTelemetryStore {
    private drift() {
      const error = new Error('column missing') as Error & { code: string };
      error.code = '42703';
      return error;
    }

    override latestWorkerSample(): ReturnType<
      MemoryOperationalTelemetryStore['latestWorkerSample']
    > {
      return Promise.reject(this.drift());
    }

    override aggregateRunnerEvents(
      _from: string,
      _to: string
    ): ReturnType<MemoryOperationalTelemetryStore['aggregateRunnerEvents']> {
      return Promise.reject(this.drift());
    }

    override indexSizeBaseline(
      _atOrBefore: string
    ): ReturnType<MemoryOperationalTelemetryStore['indexSizeBaseline']> {
      return Promise.reject(this.drift());
    }
  }
  const fakePool = {
    totalCount: 1,
    idleCount: 1,
    waitingCount: 0,
    async query(text: string) {
      if (text.includes('pg_roles')) return { rows: [{ allowed: false }] };
      if (text.includes('pg_stat_user_indexes')) {
        return { rows: [{ bytes: '100' }] };
      }
      if (text.includes('pg_extension')) {
        return { rows: [{ installed: false }] };
      }
      return {
        rows: [
          {
            published_count: '0',
            retired_count: '0',
            rolled_back_count: '0',
          },
        ],
      };
    },
  } as unknown as Pool;
  const snapshot = await new PostgresOperationalMetricsCollector(
    fakePool,
    { async getMetrics() { return queue; } },
    new DriftedTelemetryStore(),
    { clock: () => new Date('2026-07-11T12:00:00.000Z') }
  ).collect();

  assert.equal(snapshot.worker.activeJobs.status, 'unknown');
  if (snapshot.worker.activeJobs.status === 'unknown') {
    assert.equal(snapshot.worker.activeJobs.reason, 'schema_unavailable');
  }
  assert.equal(snapshot.runner.outcomeCounts.status, 'unknown');
  if (snapshot.runner.outcomeCounts.status === 'unknown') {
    assert.equal(snapshot.runner.outcomeCounts.reason, 'schema_unavailable');
  }
  assert.deepEqual(snapshot.database.indexGrowthBytes24h, {
    reason: 'schema_unavailable',
    scope: 'persistent_index_samples_24h',
    status: 'unknown',
  });
});
