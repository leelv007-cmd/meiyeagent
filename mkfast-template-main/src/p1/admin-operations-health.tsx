import { useQuery } from '@tanstack/react-query';
import { IconRefresh } from '@tabler/icons-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  p1_admin_health_captured_at,
  p1_admin_health_database_active_connections,
  p1_admin_health_database_active_transactions,
  p1_admin_health_database_index_growth,
  p1_admin_health_database_index_size,
  p1_admin_health_database_lock_waiters,
  p1_admin_health_database_oldest_lock_wait,
  p1_admin_health_database_oldest_transaction,
  p1_admin_health_database_pool_idle,
  p1_admin_health_database_pool_total,
  p1_admin_health_database_pool_waiting,
  p1_admin_health_database_slow_sql,
  p1_admin_health_invalid_description,
  p1_admin_health_invalid_title,
  p1_admin_health_load_error_description,
  p1_admin_health_load_error_title,
  p1_admin_health_loading,
  p1_admin_health_no_active_sample,
  p1_admin_health_no_failures,
  p1_admin_health_outcomes,
  p1_admin_health_queue_average_claim,
  p1_admin_health_queue_depth,
  p1_admin_health_queue_lease_expiry,
  p1_admin_health_queue_oldest_job,
  p1_admin_health_queue_recovery,
  p1_admin_health_queue_title,
  p1_admin_health_refresh,
  p1_admin_health_revision_published,
  p1_admin_health_revision_retired,
  p1_admin_health_revision_rolled_back,
  p1_admin_health_revision_title,
  p1_admin_health_runner_deferred,
  p1_admin_health_runner_failure_kinds,
  p1_admin_health_runner_recovered_failure,
  p1_admin_health_runner_title,
  p1_admin_health_scope,
  p1_admin_health_worker_active_jobs,
  p1_admin_health_worker_cpu,
  p1_admin_health_worker_event_loop,
  p1_admin_health_worker_heartbeat,
  p1_admin_health_worker_media_duration,
  p1_admin_health_worker_title,
} from '@/locale/paraglide/messages';
import { formatLocaleDateTime } from '@/lib/locale';
import { queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';

export type OperationalMetricView<T> =
  | { status: 'known'; value: T; scope?: string }
  | { status: 'unknown'; reason: string; scope?: string };

type RunnerOutcomeCounts = {
  completed: number;
  retry: number;
  deferred: number;
  dead_letter: number;
  threw: number;
};

export interface OperationalMetricsView {
  capturedAt: string;
  queue: {
    queueDepth: OperationalMetricView<number>;
    oldestRunnableAgeMs: OperationalMetricView<number | null>;
    averageClaimLatencyMs: OperationalMetricView<number | null>;
    leaseExpiryCount: OperationalMetricView<number>;
    recoveryCount: OperationalMetricView<number>;
  };
  database: {
    activeConnections: OperationalMetricView<number>;
    activeTransactions: OperationalMetricView<number>;
    oldestTransactionMs: OperationalMetricView<number | null>;
    workspaceLockWaiters: OperationalMetricView<number>;
    workspaceLockOldestWaitMs: OperationalMetricView<number | null>;
    poolTotal: OperationalMetricView<number>;
    poolIdle: OperationalMetricView<number>;
    poolWaiting: OperationalMetricView<number>;
    slowQueries: OperationalMetricView<number>;
    indexSizeBytes: OperationalMetricView<number>;
    indexGrowthBytes24h: OperationalMetricView<number>;
  };
  worker: {
    heartbeatAt: OperationalMetricView<string>;
    cpuUtilizationPercent: OperationalMetricView<number>;
    rssBytes: OperationalMetricView<number>;
    heapUsedBytes: OperationalMetricView<number>;
    eventLoopLagMs: OperationalMetricView<number>;
    activeJobs: OperationalMetricView<number>;
    mediaAverageDurationMs: OperationalMetricView<number>;
  };
  runner: {
    windowMinutes: number | null;
    outcomeCounts: OperationalMetricView<RunnerOutcomeCounts>;
    deferredCount: OperationalMetricView<number>;
    recoveredFailureCount: OperationalMetricView<number>;
    failuresByKind: OperationalMetricView<Record<string, number>>;
  };
  moduleRevisions: {
    publishedLast30Days: OperationalMetricView<number>;
    retiredLast30Days: OperationalMetricView<number>;
    rolledBackLast30Days: OperationalMetricView<number>;
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function nullableNumber(value: unknown) {
  return value === null ? null : finiteNumber(value);
}

function nonEmptyString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberRecord(value: unknown) {
  const source = record(value);
  if (!source) return undefined;
  const result: Record<string, number> = {};
  for (const [key, candidate] of Object.entries(source)) {
    const parsed = finiteNumber(candidate);
    if (parsed === undefined) return undefined;
    result[key] = parsed;
  }
  return result;
}

function outcomeCounts(value: unknown): RunnerOutcomeCounts | undefined {
  const parsed = numberRecord(value);
  if (!parsed) return undefined;
  const keys = [
    'completed',
    'retry',
    'deferred',
    'dead_letter',
    'threw',
  ] as const;
  if (keys.some((key) => parsed[key] === undefined)) return undefined;
  return {
    completed: parsed.completed!,
    retry: parsed.retry!,
    deferred: parsed.deferred!,
    dead_letter: parsed.dead_letter!,
    threw: parsed.threw!,
  };
}

function normalizeMetric<T>(
  value: unknown,
  parse: (input: unknown) => T | undefined
): OperationalMetricView<T> {
  const metric = record(value);
  const scope = nonEmptyString(metric?.scope);
  if (
    metric?.status === 'unknown' &&
    typeof metric.reason === 'string' &&
    metric.reason.length > 0
  ) {
    return {
      status: 'unknown',
      reason: metric.reason,
      ...(scope ? { scope } : {}),
    };
  }
  if (metric?.status === 'known') {
    const parsed = parse(metric.value);
    if (parsed !== undefined) {
      return {
        status: 'known',
        value: parsed,
        ...(scope ? { scope } : {}),
      };
    }
  }
  return { status: 'unknown', reason: 'invalid_metric_evidence' };
}

export function normalizeOperationalMetrics(
  value: unknown
): OperationalMetricsView | undefined {
  const root = record(value);
  if (typeof root?.capturedAt !== 'string') return undefined;
  const queue = record(root.queue) ?? {};
  const database = record(root.database) ?? {};
  const worker = record(root.worker) ?? {};
  const runner = record(root.runner) ?? {};
  const moduleRevisions = record(root.moduleRevisions) ?? {};
  return {
    capturedAt: root.capturedAt,
    queue: {
      averageClaimLatencyMs: normalizeMetric(
        queue.averageClaimLatencyMs,
        nullableNumber
      ),
      leaseExpiryCount: normalizeMetric(queue.leaseExpiryCount, finiteNumber),
      oldestRunnableAgeMs: normalizeMetric(
        queue.oldestRunnableAgeMs,
        nullableNumber
      ),
      queueDepth: normalizeMetric(queue.queueDepth, finiteNumber),
      recoveryCount: normalizeMetric(queue.recoveryCount, finiteNumber),
    },
    database: {
      activeConnections: normalizeMetric(
        database.activeConnections,
        finiteNumber
      ),
      activeTransactions: normalizeMetric(
        database.activeTransactions,
        finiteNumber
      ),
      indexGrowthBytes24h: normalizeMetric(
        database.indexGrowthBytes24h,
        finiteNumber
      ),
      indexSizeBytes: normalizeMetric(database.indexSizeBytes, finiteNumber),
      oldestTransactionMs: normalizeMetric(
        database.oldestTransactionMs,
        nullableNumber
      ),
      poolIdle: normalizeMetric(database.poolIdle, finiteNumber),
      poolTotal: normalizeMetric(database.poolTotal, finiteNumber),
      poolWaiting: normalizeMetric(database.poolWaiting, finiteNumber),
      slowQueries: normalizeMetric(database.slowQueries, finiteNumber),
      workspaceLockOldestWaitMs: normalizeMetric(
        database.workspaceLockOldestWaitMs,
        nullableNumber
      ),
      workspaceLockWaiters: normalizeMetric(
        database.workspaceLockWaiters,
        finiteNumber
      ),
    },
    worker: {
      activeJobs: normalizeMetric(worker.activeJobs, finiteNumber),
      cpuUtilizationPercent: normalizeMetric(
        worker.cpuUtilizationPercent,
        finiteNumber
      ),
      eventLoopLagMs: normalizeMetric(worker.eventLoopLagMs, finiteNumber),
      heartbeatAt: normalizeMetric(worker.heartbeatAt, nonEmptyString),
      heapUsedBytes: normalizeMetric(worker.heapUsedBytes, finiteNumber),
      mediaAverageDurationMs: normalizeMetric(
        worker.mediaAverageDurationMs,
        finiteNumber
      ),
      rssBytes: normalizeMetric(worker.rssBytes, finiteNumber),
    },
    runner: {
      deferredCount: normalizeMetric(runner.deferredCount, finiteNumber),
      failuresByKind: normalizeMetric(runner.failuresByKind, numberRecord),
      outcomeCounts: normalizeMetric(runner.outcomeCounts, outcomeCounts),
      recoveredFailureCount: normalizeMetric(
        runner.recoveredFailureCount,
        finiteNumber
      ),
      windowMinutes: finiteNumber(runner.windowMinutes) ?? null,
    },
    moduleRevisions: {
      publishedLast30Days: normalizeMetric(
        moduleRevisions.publishedLast30Days,
        finiteNumber
      ),
      retiredLast30Days: normalizeMetric(
        moduleRevisions.retiredLast30Days,
        finiteNumber
      ),
      rolledBackLast30Days: normalizeMetric(
        moduleRevisions.rolledBackLast30Days,
        finiteNumber
      ),
    },
  };
}

function metricText<T>(
  metric: OperationalMetricView<T>,
  format: (value: T) => string = String
) {
  return metric.status === 'known'
    ? format(metric.value)
    : `unknown (${metric.reason})`;
}

function duration(value: number | null) {
  return value === null
    ? p1_admin_health_no_active_sample()
    : `${Math.round(value)} ms`;
}

function bytes(value: number) {
  const sign = value < 0 ? '-' : '';
  return `${sign}${(Math.abs(value) / 1024 / 1024).toFixed(1)} MiB`;
}

function Metric<T>({
  label,
  metric,
  format,
}: {
  label: string;
  metric: OperationalMetricView<T>;
  format?: (value: T) => string;
}) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-lg font-semibold">
        {metricText(metric, format)}
      </dd>
      {metric.scope ? (
        <p className="mt-1 break-words text-[11px] text-muted-foreground">
          {p1_admin_health_scope({ scope: metric.scope })}
        </p>
      ) : null}
    </div>
  );
}

function formatOutcomes(value: RunnerOutcomeCounts) {
  return p1_admin_health_outcomes({
    completed: value.completed,
    deadLetter: value.dead_letter,
    deferred: value.deferred,
    retry: value.retry,
    threw: value.threw,
  });
}

function formatFailures(value: Record<string, number>) {
  const entries = Object.entries(value);
  return entries.length === 0
    ? p1_admin_health_no_failures()
    : entries.map(([kind, count]) => `${kind}: ${count}`).join(' · ');
}

export function AdminOperationsHealth() {
  const query = useQuery({
    queryKey: p1QueryKeys.request('job-runtime', 'observability'),
    queryFn: ({ signal }) =>
      queryP1<unknown>(
        'job-runtime',
        { action: 'observability', payload: {} },
        signal
      ),
    select: normalizeOperationalMetrics,
  });
  const snapshot = query.data;

  if (query.error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{p1_admin_health_load_error_title()}</AlertTitle>
        <AlertDescription>
          {p1_admin_health_load_error_description()}
        </AlertDescription>
      </Alert>
    );
  }
  if (query.isPending) {
    return (
      <p className="text-sm text-muted-foreground">
        {p1_admin_health_loading()}
      </p>
    );
  }
  if (!snapshot) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{p1_admin_health_invalid_title()}</AlertTitle>
        <AlertDescription>
          {p1_admin_health_invalid_description()}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {p1_admin_health_captured_at({
            time: formatLocaleDateTime(snapshot.capturedAt),
          })}
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <IconRefresh />
          {p1_admin_health_refresh()}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{p1_admin_health_queue_title()}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Metric
              label={p1_admin_health_queue_depth()}
              metric={snapshot.queue.queueDepth}
            />
            <Metric
              label={p1_admin_health_queue_oldest_job()}
              metric={snapshot.queue.oldestRunnableAgeMs}
              format={duration}
            />
            <Metric
              label={p1_admin_health_queue_average_claim()}
              metric={snapshot.queue.averageClaimLatencyMs}
              format={duration}
            />
            <Metric
              label={p1_admin_health_queue_lease_expiry()}
              metric={snapshot.queue.leaseExpiryCount}
            />
            <Metric
              label={p1_admin_health_queue_recovery()}
              metric={snapshot.queue.recoveryCount}
            />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>PostgreSQL</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Metric
              label={p1_admin_health_database_active_connections()}
              metric={snapshot.database.activeConnections}
            />
            <Metric
              label={p1_admin_health_database_active_transactions()}
              metric={snapshot.database.activeTransactions}
            />
            <Metric
              label={p1_admin_health_database_oldest_transaction()}
              metric={snapshot.database.oldestTransactionMs}
              format={duration}
            />
            <Metric
              label={p1_admin_health_database_lock_waiters()}
              metric={snapshot.database.workspaceLockWaiters}
            />
            <Metric
              label={p1_admin_health_database_oldest_lock_wait()}
              metric={snapshot.database.workspaceLockOldestWaitMs}
              format={duration}
            />
            <Metric
              label={p1_admin_health_database_pool_waiting()}
              metric={snapshot.database.poolWaiting}
            />
            <Metric
              label={p1_admin_health_database_pool_idle()}
              metric={snapshot.database.poolIdle}
            />
            <Metric
              label={p1_admin_health_database_pool_total()}
              metric={snapshot.database.poolTotal}
            />
            <Metric
              label={p1_admin_health_database_slow_sql()}
              metric={snapshot.database.slowQueries}
            />
            <Metric
              label={p1_admin_health_database_index_size()}
              metric={snapshot.database.indexSizeBytes}
              format={bytes}
            />
            <Metric
              label={p1_admin_health_database_index_growth()}
              metric={snapshot.database.indexGrowthBytes24h}
              format={bytes}
            />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{p1_admin_health_worker_title()}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
            <Metric
              label={p1_admin_health_worker_heartbeat()}
              metric={snapshot.worker.heartbeatAt}
              format={formatLocaleDateTime}
            />
            <Metric
              label={p1_admin_health_worker_cpu()}
              metric={snapshot.worker.cpuUtilizationPercent}
              format={(value) => `${value.toFixed(1)}%`}
            />
            <Metric
              label="RSS"
              metric={snapshot.worker.rssBytes}
              format={bytes}
            />
            <Metric
              label="Heap"
              metric={snapshot.worker.heapUsedBytes}
              format={bytes}
            />
            <Metric
              label={p1_admin_health_worker_event_loop()}
              metric={snapshot.worker.eventLoopLagMs}
              format={(value) => duration(value)}
            />
            <Metric
              label={p1_admin_health_worker_active_jobs()}
              metric={snapshot.worker.activeJobs}
            />
            <Metric
              label={p1_admin_health_worker_media_duration()}
              metric={snapshot.worker.mediaAverageDurationMs}
              format={(value) => duration(value)}
            />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {p1_admin_health_runner_title({
              minutes: snapshot.runner.windowMinutes ?? 'unknown',
            })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Handler outcomes"
              metric={snapshot.runner.outcomeCounts}
              format={formatOutcomes}
            />
            <Metric
              label={p1_admin_health_runner_deferred()}
              metric={snapshot.runner.deferredCount}
            />
            <Metric
              label={p1_admin_health_runner_recovered_failure()}
              metric={snapshot.runner.recoveredFailureCount}
            />
            <Metric
              label={p1_admin_health_runner_failure_kinds()}
              metric={snapshot.runner.failuresByKind}
              format={formatFailures}
            />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{p1_admin_health_revision_title()}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-3">
            <Metric
              label={p1_admin_health_revision_published()}
              metric={snapshot.moduleRevisions.publishedLast30Days}
            />
            <Metric
              label={p1_admin_health_revision_retired()}
              metric={snapshot.moduleRevisions.retiredLast30Days}
            />
            <Metric
              label={p1_admin_health_revision_rolled_back()}
              metric={snapshot.moduleRevisions.rolledBackLast30Days}
            />
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
