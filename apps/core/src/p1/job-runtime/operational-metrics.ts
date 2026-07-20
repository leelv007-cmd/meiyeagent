import type { Pool } from 'pg';
import type { OperationalMetricEnvelope } from '@meiye/contracts';
import type { QueueRuntimeMetrics } from './job-contracts.js';
import type {
  OperationalTelemetryStore,
  RunnerOutcome,
  RunnerWindowAggregate,
  WorkerProcessSample,
} from './operational-telemetry.js';

/**
 * Job-runtime reporter reasons. Envelope shape is owned by contracts
 * (`OperationalMetricEnvelope`); this module is one reporter among others (S2a).
 */
export type OperationalMetricReason =
  | 'queue_metrics_unavailable'
  | 'runtime_does_not_report_recovery_count'
  | 'postgres_stats_permission_required'
  | 'pg_stat_statements_not_installed'
  | 'postgres_permission_denied'
  | 'schema_unavailable'
  | 'metric_query_failed'
  | 'no_worker_sample'
  | 'worker_sample_stale'
  | 'insufficient_cpu_window'
  | 'runner_events_unavailable'
  | 'no_media_events_in_window'
  | 'insufficient_index_history'
  | 'module_revision_history_unavailable';

export type OperationalMetric<T> = OperationalMetricEnvelope<
  T,
  OperationalMetricReason
>;

export interface OperationalMetricsSnapshot {
  capturedAt: string;
  queue: {
    queueDepth: OperationalMetric<number>;
    oldestRunnableAgeMs: OperationalMetric<number | null>;
    averageClaimLatencyMs: OperationalMetric<number | null>;
    leaseExpiryCount: OperationalMetric<number>;
    recoveryCount: OperationalMetric<number>;
  };
  database: {
    activeConnections: OperationalMetric<number>;
    activeTransactions: OperationalMetric<number>;
    oldestTransactionMs: OperationalMetric<number | null>;
    workspaceLockWaiters: OperationalMetric<number>;
    workspaceLockOldestWaitMs: OperationalMetric<number | null>;
    poolTotal: OperationalMetric<number>;
    poolIdle: OperationalMetric<number>;
    poolWaiting: OperationalMetric<number>;
    slowQueries: OperationalMetric<number>;
    indexSizeBytes: OperationalMetric<number>;
    indexGrowthBytes24h: OperationalMetric<number>;
  };
  worker: {
    heartbeatAt: OperationalMetric<string>;
    cpuUtilizationPercent: OperationalMetric<number>;
    rssBytes: OperationalMetric<number>;
    heapUsedBytes: OperationalMetric<number>;
    eventLoopLagMs: OperationalMetric<number>;
    activeJobs: OperationalMetric<number>;
    mediaAverageDurationMs: OperationalMetric<number>;
  };
  runner: {
    windowMinutes: number;
    outcomeCounts: OperationalMetric<Record<RunnerOutcome, number>>;
    deferredCount: OperationalMetric<number>;
    recoveredFailureCount: OperationalMetric<number>;
    failuresByKind: OperationalMetric<Record<string, number>>;
  };
  moduleRevisions: {
    publishedLast30Days: OperationalMetric<number>;
    retiredLast30Days: OperationalMetric<number>;
    rolledBackLast30Days: OperationalMetric<number>;
  };
}

export interface OperationalMetricsPort {
  collect(): Promise<OperationalMetricsSnapshot>;
}

interface QueueMetricsPort {
  getMetrics(): Promise<QueueRuntimeMetrics>;
}

interface ActivityRow {
  active_connections: string;
  active_transactions: string;
  workspace_lock_waiters: string;
  oldest_transaction_ms: number | null;
  workspace_lock_oldest_wait_ms: number | null;
}

interface ModuleRevisionRow {
  published_count: string;
  retired_count: string;
  rolled_back_count: string;
}

export interface PostgresOperationalMetricsCollectorOptions {
  clock?: () => Date;
  workerStaleAfterMs?: number;
  runnerWindowMs?: number;
  indexGrowthWindowMs?: number;
}

export class PostgresOperationalMetricsCollector
  implements OperationalMetricsPort
{
  private readonly clock: () => Date;
  private readonly workerStaleAfterMs: number;
  private readonly runnerWindowMs: number;
  private readonly indexGrowthWindowMs: number;

  constructor(
    private readonly pool: Pool,
    private readonly queue: QueueMetricsPort,
    private readonly telemetry: OperationalTelemetryStore,
    options: PostgresOperationalMetricsCollectorOptions = {}
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.workerStaleAfterMs = positive(
      options.workerStaleAfterMs ?? 30_000,
      'workerStaleAfterMs'
    );
    this.runnerWindowMs = positive(
      options.runnerWindowMs ?? 30 * 60_000,
      'runnerWindowMs'
    );
    this.indexGrowthWindowMs = positive(
      options.indexGrowthWindowMs ?? 24 * 60 * 60_000,
      'indexGrowthWindowMs'
    );
  }

  async collect(): Promise<OperationalMetricsSnapshot> {
    const capturedAt = this.clock();
    const [queue, database, workerSample, runner, moduleRevisions] =
      await Promise.all([
        this.collectQueue(),
        this.collectDatabase(capturedAt),
        this.collectWorkerSample(),
        this.collectRunner(capturedAt),
        this.collectModuleRevisions(),
      ]);
    return {
      capturedAt: capturedAt.toISOString(),
      queue,
      database,
      worker: this.workerView(workerSample, runner, capturedAt),
      runner: this.runnerView(runner),
      moduleRevisions,
    };
  }

  private async collectQueue(): Promise<OperationalMetricsSnapshot['queue']> {
    try {
      const queue = await this.queue.getMetrics();
      return {
        queueDepth: known(queue.queueDepth, 'configured_job_runtime'),
        oldestRunnableAgeMs: known(
          queue.oldestRunnableAgeMs,
          'configured_job_runtime'
        ),
        averageClaimLatencyMs: known(
          queue.averageClaimLatencyMs,
          'configured_job_runtime'
        ),
        leaseExpiryCount: known(
          queue.leaseExpiryCount,
          'configured_job_runtime_retained_jobs'
        ),
        recoveryCount:
          queue.recoveryCount === null
            ? unknown(
                'runtime_does_not_report_recovery_count',
                'configured_job_runtime'
              )
            : known(
                queue.recoveryCount,
                'configured_job_runtime_retained_jobs'
              ),
      };
    } catch {
      return unknownQueue('queue_metrics_unavailable');
    }
  }

  private async collectDatabase(
    capturedAt: Date
  ): Promise<OperationalMetricsSnapshot['database']> {
    const poolScope = 'core_api_process_pool';
    const base = {
      poolTotal: known(this.pool.totalCount, poolScope),
      poolIdle: known(this.pool.idleCount, poolScope),
      poolWaiting: known(this.pool.waitingCount, poolScope),
    };
    const [activity, slowQueries, index] = await Promise.all([
      this.collectActivity(),
      this.collectSlowQueries(),
      this.collectIndexMetrics(capturedAt),
    ]);
    return { ...activity, ...base, slowQueries, ...index };
  }

  private async collectActivity(): Promise<
    Pick<
      OperationalMetricsSnapshot['database'],
      | 'activeConnections'
      | 'activeTransactions'
      | 'oldestTransactionMs'
      | 'workspaceLockWaiters'
      | 'workspaceLockOldestWaitMs'
    >
  > {
    const transactionScope = 'current_database_all_sessions';
    const lockScope =
      'ungranted_postgres_advisory_locks; wait age approximated from query_start';
    try {
      const permission = await this.pool.query<{ allowed: boolean }>(`
        SELECT (
          COALESCE(
            (SELECT rolsuper FROM pg_roles WHERE rolname = current_user),
            false
          ) OR pg_has_role(current_user, 'pg_read_all_stats', 'member')
        ) AS allowed
      `);
      if (!permission.rows[0]?.allowed) {
        return unknownActivity(
          'postgres_stats_permission_required',
          transactionScope,
          lockScope
        );
      }
      const result = await this.pool.query<ActivityRow>(`
        WITH activity AS (
          SELECT
            count(*) FILTER (WHERE state <> 'idle')::text AS active_connections,
            count(*) FILTER (WHERE xact_start IS NOT NULL)::text AS active_transactions,
            max(extract(epoch FROM (clock_timestamp() - xact_start)) * 1000)
              FILTER (WHERE xact_start IS NOT NULL)::float8 AS oldest_transaction_ms
          FROM pg_stat_activity
          WHERE datname = current_database()
        ), advisory_waits AS (
          SELECT
            count(*)::text AS workspace_lock_waiters,
            max(extract(epoch FROM (clock_timestamp() - activity.query_start)) * 1000)::float8
              AS workspace_lock_oldest_wait_ms
          FROM pg_locks locks
          JOIN pg_stat_activity activity ON activity.pid = locks.pid
          WHERE locks.locktype = 'advisory'
            AND locks.granted = false
            AND activity.datname = current_database()
        )
        SELECT activity.*, advisory_waits.*
        FROM activity CROSS JOIN advisory_waits
      `);
      const row = result.rows[0];
      if (!row) {
        return unknownActivity(
          'metric_query_failed',
          transactionScope,
          lockScope
        );
      }
      return {
        activeConnections: known(
          Number(row.active_connections),
          transactionScope
        ),
        activeTransactions: known(
          Number(row.active_transactions),
          transactionScope
        ),
        oldestTransactionMs: known(
          row.oldest_transaction_ms,
          transactionScope
        ),
        workspaceLockWaiters: known(
          Number(row.workspace_lock_waiters),
          lockScope
        ),
        workspaceLockOldestWaitMs: known(
          row.workspace_lock_oldest_wait_ms,
          lockScope
        ),
      };
    } catch (error) {
      return unknownActivity(
        databaseReason(error),
        transactionScope,
        lockScope
      );
    }
  }

  private async collectSlowQueries(): Promise<OperationalMetric<number>> {
    const scope = 'pg_stat_statements_mean_exec_time_gte_250ms';
    try {
      const extension = await this.pool.query<{ installed: boolean }>(`
        SELECT EXISTS (
          SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'
        ) AS installed
      `);
      if (!extension.rows[0]?.installed) {
        return unknown('pg_stat_statements_not_installed', scope);
      }
      const result = await this.pool.query<{ count: string }>(`
        SELECT count(*)::text AS count
        FROM pg_stat_statements
        WHERE mean_exec_time >= 250
          AND dbid = (
            SELECT oid FROM pg_database WHERE datname = current_database()
          )
      `);
      return known(Number(result.rows[0]?.count ?? 0), scope);
    } catch (error) {
      return unknown(databaseReason(error), scope);
    }
  }

  private async collectIndexMetrics(capturedAt: Date): Promise<
    Pick<
      OperationalMetricsSnapshot['database'],
      'indexSizeBytes' | 'indexGrowthBytes24h'
    >
  > {
    const sizeScope = 'current_database_user_indexes';
    const growthScope = `persistent_index_samples_${Math.round(
      this.indexGrowthWindowMs / 3_600_000
    )}h`;
    let indexSizeBytes: number;
    try {
      const result = await this.pool.query<{ bytes: string }>(`
        SELECT COALESCE(sum(pg_relation_size(indexrelid)), 0)::text AS bytes
        FROM pg_stat_user_indexes
      `);
      indexSizeBytes = Number(result.rows[0]?.bytes ?? 0);
    } catch (error) {
      const reason = databaseReason(error);
      return {
        indexSizeBytes: unknown(reason, sizeScope),
        indexGrowthBytes24h: unknown(reason, growthScope),
      };
    }
    const sample = {
      sampledAt: capturedAt.toISOString(),
      indexSizeBytes,
    };
    try {
      const baseline = await this.telemetry.indexSizeBaseline(
        new Date(capturedAt.getTime() - this.indexGrowthWindowMs).toISOString()
      );
      await this.telemetry.recordIndexSizeSample(sample);
      return {
        indexSizeBytes: known(indexSizeBytes, sizeScope),
        indexGrowthBytes24h: baseline
          ? known(indexSizeBytes - baseline.indexSizeBytes, growthScope)
          : unknown('insufficient_index_history', growthScope),
      };
    } catch (error) {
      return {
        indexSizeBytes: known(indexSizeBytes, sizeScope),
        indexGrowthBytes24h: unknown(databaseReason(error), growthScope),
      };
    }
  }

  private async collectWorkerSample(): Promise<
    | { status: 'available'; sample: WorkerProcessSample }
    | { status: 'unavailable'; reason: OperationalMetricReason }
  > {
    try {
      const sample = await this.telemetry.latestWorkerSample();
      return sample
        ? { status: 'available', sample }
        : { status: 'unavailable', reason: 'no_worker_sample' };
    } catch (error) {
      return { status: 'unavailable', reason: databaseReason(error) };
    }
  }

  private async collectRunner(capturedAt: Date): Promise<
    | { status: 'available'; aggregate: RunnerWindowAggregate }
    | { status: 'unavailable'; reason: OperationalMetricReason }
  > {
    try {
      return {
        status: 'available',
        aggregate: await this.telemetry.aggregateRunnerEvents(
          new Date(capturedAt.getTime() - this.runnerWindowMs).toISOString(),
          capturedAt.toISOString()
        ),
      };
    } catch (error) {
      const reason = databaseReason(error);
      return {
        status: 'unavailable',
        reason:
          reason === 'metric_query_failed'
            ? 'runner_events_unavailable'
            : reason,
      };
    }
  }

  private workerView(
    worker:
      | { status: 'available'; sample: WorkerProcessSample }
      | { status: 'unavailable'; reason: OperationalMetricReason },
    runner:
      | { status: 'available'; aggregate: RunnerWindowAggregate }
      | { status: 'unavailable'; reason: OperationalMetricReason },
    capturedAt: Date
  ): OperationalMetricsSnapshot['worker'] {
    const processScope = 'independent_job_worker_latest_heartbeat';
    const mediaScope = `runner_events_last_${Math.round(
      this.runnerWindowMs / 60_000
    )}m`;
    const mediaAverageDurationMs =
      runner.status === 'unavailable'
        ? unknown<number>(runner.reason, mediaScope)
        : runner.aggregate.mediaAverageDurationMs === null
          ? unknown<number>('no_media_events_in_window', mediaScope)
          : known(runner.aggregate.mediaAverageDurationMs, mediaScope);
    if (worker.status === 'unavailable') {
      return {
        ...unknownWorker(worker.reason, processScope),
        mediaAverageDurationMs,
      };
    }
    const stale =
      capturedAt.getTime() - Date.parse(worker.sample.sampledAt) >
      this.workerStaleAfterMs;
    if (stale) {
      return {
        ...unknownWorker('worker_sample_stale', processScope),
        mediaAverageDurationMs,
      };
    }
    return {
      heartbeatAt: known(worker.sample.sampledAt, processScope),
      cpuUtilizationPercent:
        worker.sample.cpuUtilizationPercent === null
          ? unknown<number>('insufficient_cpu_window', processScope)
          : known(worker.sample.cpuUtilizationPercent, processScope),
      rssBytes: known(worker.sample.rssBytes, processScope),
      heapUsedBytes: known(worker.sample.heapUsedBytes, processScope),
      eventLoopLagMs: known(worker.sample.eventLoopLagMs, processScope),
      activeJobs: known(worker.sample.activeJobs, processScope),
      mediaAverageDurationMs,
    };
  }

  private runnerView(
    runner:
      | { status: 'available'; aggregate: RunnerWindowAggregate }
      | { status: 'unavailable'; reason: OperationalMetricReason }
  ): OperationalMetricsSnapshot['runner'] {
    const windowMinutes = Math.round(this.runnerWindowMs / 60_000);
    const scope = `p1_job_worker_handler_events_last_${windowMinutes}m`;
    if (runner.status === 'unavailable') {
      return {
        windowMinutes,
        outcomeCounts: unknown(runner.reason, scope),
        deferredCount: unknown(runner.reason, scope),
        recoveredFailureCount: unknown(runner.reason, scope),
        failuresByKind: unknown(runner.reason, scope),
      };
    }
    return {
      windowMinutes,
      outcomeCounts: known(runner.aggregate.outcomeCounts, scope),
      deferredCount: known(runner.aggregate.outcomeCounts.deferred, scope),
      recoveredFailureCount: known(
        runner.aggregate.recoveredFailureCount,
        scope
      ),
      failuresByKind: known(runner.aggregate.failuresByKind, scope),
    };
  }

  private async collectModuleRevisions(): Promise<
    OperationalMetricsSnapshot['moduleRevisions']
  > {
    const scope =
      'integration_tool_template_and_model_revision_events_last_30d';
    try {
      const result = await this.pool.query<ModuleRevisionRow>(`
        SELECT
          count(*) FILTER (WHERE action = 'published')::text AS published_count,
          count(*) FILTER (WHERE action = 'retired')::text AS retired_count,
          count(*) FILTER (WHERE action = 'rolled_back')::text AS rolled_back_count
        FROM (
          SELECT status AS action, published_at AS occurred_at
          FROM integration_tool_revisions
          WHERE status = 'published'
          UNION ALL
          SELECT payload->>'action' AS action, occurred_at
          FROM p1_template_version_lifecycle
          WHERE payload->>'action' IN ('published', 'retired')
          UNION ALL
          SELECT 'published' AS action, created_at AS occurred_at
          FROM model_catalog_revisions
          WHERE stage = 'published'
          UNION ALL
          SELECT 'rolled_back' AS action, created_at AS occurred_at
          FROM model_revision_rollback_audits
        ) revision_events
        WHERE occurred_at >= now() - interval '30 days'
      `);
      return {
        publishedLast30Days: known(
          Number(result.rows[0]?.published_count ?? 0),
          scope
        ),
        retiredLast30Days: known(
          Number(result.rows[0]?.retired_count ?? 0),
          scope
        ),
        rolledBackLast30Days: known(
          Number(result.rows[0]?.rolled_back_count ?? 0),
          scope
        ),
      };
    } catch (error) {
      const database = databaseReason(error);
      const reason =
        database === 'metric_query_failed'
          ? 'module_revision_history_unavailable'
          : database;
      return {
        publishedLast30Days: unknown(reason, scope),
        retiredLast30Days: unknown(reason, scope),
        rolledBackLast30Days: unknown(reason, scope),
      };
    }
  }
}

function known<T>(value: T, scope?: string): OperationalMetric<T> {
  return { status: 'known', value, ...(scope ? { scope } : {}) };
}

function unknown<T>(
  reason: OperationalMetricReason,
  scope?: string
): OperationalMetric<T> {
  return { status: 'unknown', reason, ...(scope ? { scope } : {}) };
}

function unknownQueue(
  reason: OperationalMetricReason
): OperationalMetricsSnapshot['queue'] {
  const scope = 'configured_job_runtime';
  return {
    queueDepth: unknown(reason, scope),
    oldestRunnableAgeMs: unknown(reason, scope),
    averageClaimLatencyMs: unknown(reason, scope),
    leaseExpiryCount: unknown(reason, scope),
    recoveryCount: unknown(reason, scope),
  };
}

function unknownActivity(
  reason: OperationalMetricReason,
  transactionScope: string,
  lockScope: string
): Pick<
  OperationalMetricsSnapshot['database'],
  | 'activeConnections'
  | 'activeTransactions'
  | 'oldestTransactionMs'
  | 'workspaceLockWaiters'
  | 'workspaceLockOldestWaitMs'
> {
  return {
    activeConnections: unknown(reason, transactionScope),
    activeTransactions: unknown(reason, transactionScope),
    oldestTransactionMs: unknown(reason, transactionScope),
    workspaceLockWaiters: unknown(reason, lockScope),
    workspaceLockOldestWaitMs: unknown(reason, lockScope),
  };
}

function unknownWorker(
  reason: OperationalMetricReason,
  scope: string
): Omit<
  OperationalMetricsSnapshot['worker'],
  'mediaAverageDurationMs'
> {
  return {
    heartbeatAt: unknown(reason, scope),
    cpuUtilizationPercent: unknown(reason, scope),
    rssBytes: unknown(reason, scope),
    heapUsedBytes: unknown(reason, scope),
    eventLoopLagMs: unknown(reason, scope),
    activeJobs: unknown(reason, scope),
  };
}

function databaseReason(error: unknown): OperationalMetricReason {
  const code = (error as { code?: string }).code;
  if (code === '42501') return 'postgres_permission_denied';
  if (code === '42P01' || code === '42703' || code === '3F000') {
    return 'schema_unavailable';
  }
  return 'metric_query_failed';
}

function positive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be positive.`);
  }
  return value;
}
