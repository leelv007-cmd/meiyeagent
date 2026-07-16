import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeOperationalMetrics } from './admin-operations-health';

const known = <T>(value: T, scope?: string) => ({
  status: 'known',
  value,
  ...(scope ? { scope } : {}),
});
const unknown = (reason: string, scope?: string) => ({
  status: 'unknown',
  reason,
  ...(scope ? { scope } : {}),
});

test('normalizes explicit metric evidence and preserves unknown reasons', () => {
  const view = normalizeOperationalMetrics({
    capturedAt: '2026-07-11T00:00:00.000Z',
    queue: {
      averageClaimLatencyMs: known(12),
      leaseExpiryCount: known(1),
      oldestRunnableAgeMs: known(null),
      queueDepth: known(2),
      recoveryCount: unknown('runtime_does_not_report_recovery_count'),
    },
    database: {
      activeConnections: known(2),
      activeTransactions: known(1),
      indexGrowthBytes24h: unknown('insufficient_index_history'),
      indexSizeBytes: known(1024),
      oldestTransactionMs: known(null),
      poolIdle: known(1),
      poolTotal: known(2),
      poolWaiting: known(0),
      slowQueries: unknown('pg_stat_statements_not_installed'),
      workspaceLockOldestWaitMs: known(null),
      workspaceLockWaiters: known(0, 'advisory_workspace_locks'),
    },
    worker: {
      activeJobs: known(1),
      cpuUtilizationPercent: known(12.5),
      eventLoopLagMs: known(2),
      heartbeatAt: known('2026-07-11T00:00:00.000Z'),
      heapUsedBytes: known(512),
      mediaAverageDurationMs: unknown('no_media_events_in_window'),
      rssBytes: known(2048),
    },
    runner: {
      deferredCount: known(1),
      failuresByKind: known({ media: 1 }),
      outcomeCounts: known({
        completed: 2,
        dead_letter: 0,
        deferred: 1,
        retry: 1,
        threw: 0,
      }),
      recoveredFailureCount: known(1),
      windowMinutes: 30,
    },
    moduleRevisions: {
      publishedLast30Days: known(2),
      retiredLast30Days: unknown('schema_unavailable'),
      rolledBackLast30Days: known(1),
    },
  });

  assert.deepEqual(view?.queue.recoveryCount, {
    reason: 'runtime_does_not_report_recovery_count',
    status: 'unknown',
  });
  assert.deepEqual(view?.database.workspaceLockWaiters, {
    scope: 'advisory_workspace_locks',
    status: 'known',
    value: 0,
  });
  assert.deepEqual(view?.worker.cpuUtilizationPercent, {
    status: 'known',
    value: 12.5,
  });
  assert.equal(view?.runner.windowMinutes, 30);
});

test('turns missing or malformed metric evidence into unknown instead of zero', () => {
  const view = normalizeOperationalMetrics({
    capturedAt: '2026-07-11T00:00:00.000Z',
    queue: { queueDepth: { status: 'known', value: '2' } },
    database: {},
    worker: {},
    runner: {},
    moduleRevisions: {},
  });

  assert.deepEqual(view?.queue.queueDepth, {
    reason: 'invalid_metric_evidence',
    status: 'unknown',
  });
  assert.deepEqual(view?.database.poolWaiting, {
    reason: 'invalid_metric_evidence',
    status: 'unknown',
  });
  assert.deepEqual(view?.worker.rssBytes, {
    reason: 'invalid_metric_evidence',
    status: 'unknown',
  });
});
