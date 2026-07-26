import { performance } from 'node:perf_hooks';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { JobRuntimeHandlerResult } from './job-contracts.js';

export type RunnerOutcome = JobRuntimeHandlerResult['status'] | 'threw';

export interface WorkerProcessSample {
  workerId: string;
  windowStartedAt: string;
  sampledAt: string;
  cpuUtilizationPercent: number | null;
  rssBytes: number;
  heapUsedBytes: number;
  eventLoopLagMs: number;
  activeJobs: number;
}

export interface RunnerEvent {
  workerId: string;
  kind: string;
  outcome: RunnerOutcome;
  recovered: boolean;
  durationMs: number;
  occurredAt: string;
}

export interface RunnerWindowAggregate {
  outcomeCounts: Record<RunnerOutcome, number>;
  failuresByKind: Record<string, number>;
  recoveredFailureCount: number;
  mediaAverageDurationMs: number | null;
  eventCount: number;
}

export interface IndexSizeSample {
  sampledAt: string;
  indexSizeBytes: number;
}

export interface OperationalTelemetryStore {
  recordWorkerSample(sample: WorkerProcessSample): Promise<void>;
  latestWorkerSample(): Promise<WorkerProcessSample | null>;
  recordRunnerEvent(event: RunnerEvent): Promise<void>;
  aggregateRunnerEvents(
    from: string,
    to: string
  ): Promise<RunnerWindowAggregate>;
  recordIndexSizeSample(sample: IndexSizeSample): Promise<void>;
  indexSizeBaseline(atOrBefore: string): Promise<IndexSizeSample | null>;
}

export interface PostgresOperationalTelemetryOptions {
  schema?: string;
  workerSamplesTable?: string;
  runnerEventsTable?: string;
  indexSamplesTable?: string;
}

interface WorkerSampleRow extends QueryResultRow {
  worker_id: string;
  window_started_at: Date;
  sampled_at: Date;
  cpu_utilization_percent: number | null;
  rss_bytes: string;
  heap_used_bytes: string;
  event_loop_lag_ms: number;
  active_jobs: number;
}

interface RunnerAggregateRow extends QueryResultRow {
  kind: string;
  outcome: RunnerOutcome;
  recovered: boolean;
  event_count: string;
  duration_sum_ms: number;
}

interface IndexSampleRow extends QueryResultRow {
  sampled_at: Date;
  index_size_bytes: string;
}

export class PostgresOperationalTelemetryStore
  implements OperationalTelemetryStore
{
  private readonly schema: string;
  private readonly workerSamplesTable: string;
  private readonly runnerEventsTable: string;
  private readonly indexSamplesTable: string;
  private migration?: Promise<void>;

  constructor(
    private readonly database: Pick<Pool, 'query'>,
    options: PostgresOperationalTelemetryOptions = {}
  ) {
    this.schema = identifier(options.schema ?? 'public', 'schema');
    this.workerSamplesTable = identifier(
      options.workerSamplesTable ?? 'p1_worker_metric_samples',
      'workerSamplesTable'
    );
    this.runnerEventsTable = identifier(
      options.runnerEventsTable ?? 'p1_runner_events',
      'runnerEventsTable'
    );
    this.indexSamplesTable = identifier(
      options.indexSamplesTable ?? 'p1_index_size_samples',
      'indexSamplesTable'
    );
  }

  async migrate(client?: PoolClient) {
    if (client) {
      await this.createSchema(client);
      this.migration = Promise.resolve();
      return;
    }
    this.migration ??= this.createSchema(this.database).catch((error) => {
      this.migration = undefined;
      throw error;
    });
    await this.migration;
  }

  async recordWorkerSample(sample: WorkerProcessSample) {
    validateWorkerSample(sample);
    await this.migrate();
    await this.database.query(
      `INSERT INTO ${this.workerSamples} (
         worker_id, window_started_at, sampled_at, cpu_utilization_percent,
         rss_bytes, heap_used_bytes, event_loop_lag_ms, active_jobs
       ) VALUES ($1, $2::timestamptz, $3::timestamptz, $4::float8, $5, $6, $7::float8, $8)`,
      [
        sample.workerId,
        sample.windowStartedAt,
        sample.sampledAt,
        sample.cpuUtilizationPercent,
        sample.rssBytes,
        sample.heapUsedBytes,
        sample.eventLoopLagMs,
        sample.activeJobs,
      ]
    );
  }

  async latestWorkerSample() {
    await this.migrate();
    const result = await this.database.query<WorkerSampleRow>(
      `SELECT * FROM ${this.workerSamples}
       ORDER BY sampled_at DESC, id DESC
       LIMIT 1`
    );
    const row = result.rows[0];
    return row ? mapWorkerSample(row) : null;
  }

  async recordRunnerEvent(event: RunnerEvent) {
    validateRunnerEvent(event);
    await this.migrate();
    await this.database.query(
      `INSERT INTO ${this.runnerEvents} (
         worker_id, kind, outcome, recovered, duration_ms, occurred_at
       ) VALUES ($1, $2, $3, $4, $5::float8, $6::timestamptz)`,
      [
        event.workerId,
        event.kind,
        event.outcome,
        event.recovered,
        event.durationMs,
        event.occurredAt,
      ]
    );
  }

  async aggregateRunnerEvents(from: string, to: string) {
    await this.migrate();
    const result = await this.database.query<RunnerAggregateRow>(
      `SELECT kind, outcome, recovered, count(*)::text AS event_count,
              COALESCE(sum(duration_ms), 0)::float8 AS duration_sum_ms
         FROM ${this.runnerEvents}
        WHERE occurred_at >= $1::timestamptz
          AND occurred_at < $2::timestamptz
        GROUP BY kind, outcome, recovered`,
      [from, to]
    );
    return aggregateRunnerRows(result.rows);
  }

  async recordIndexSizeSample(sample: IndexSizeSample) {
    validateTimestamp(sample.sampledAt, 'sampledAt');
    nonNegative(sample.indexSizeBytes, 'indexSizeBytes');
    await this.migrate();
    await this.database.query(
      `INSERT INTO ${this.indexSamples} (sampled_at, index_size_bytes)
       VALUES ($1::timestamptz, $2)`,
      [sample.sampledAt, sample.indexSizeBytes]
    );
  }

  async indexSizeBaseline(atOrBefore: string) {
    validateTimestamp(atOrBefore, 'atOrBefore');
    await this.migrate();
    const result = await this.database.query<IndexSampleRow>(
      `SELECT sampled_at, index_size_bytes
         FROM ${this.indexSamples}
        WHERE sampled_at <= $1::timestamptz
        ORDER BY sampled_at DESC, id DESC
        LIMIT 1`,
      [atOrBefore]
    );
    const row = result.rows[0];
    return row
      ? {
          sampledAt: row.sampled_at.toISOString(),
          indexSizeBytes: Number(row.index_size_bytes),
        }
      : null;
  }

  private createSchema(database: Pick<Pool, 'query'> | PoolClient) {
    return database
      .query(
        `CREATE TABLE IF NOT EXISTS ${this.workerSamples} (
           id bigserial PRIMARY KEY,
           worker_id text NOT NULL,
           window_started_at timestamptz NOT NULL,
           sampled_at timestamptz NOT NULL,
           cpu_utilization_percent double precision,
           rss_bytes bigint NOT NULL CHECK (rss_bytes >= 0),
           heap_used_bytes bigint NOT NULL CHECK (heap_used_bytes >= 0),
           event_loop_lag_ms double precision NOT NULL CHECK (event_loop_lag_ms >= 0),
           active_jobs integer NOT NULL CHECK (active_jobs >= 0)
         );
         CREATE INDEX IF NOT EXISTS ${this.quotedIndex(
           this.workerSamplesTable,
           'sampled_at_idx'
         )} ON ${this.workerSamples} (sampled_at DESC);

         CREATE TABLE IF NOT EXISTS ${this.runnerEvents} (
           id bigserial PRIMARY KEY,
           worker_id text NOT NULL,
           kind text NOT NULL,
           outcome text NOT NULL CHECK (
             outcome IN ('completed', 'retry', 'deferred', 'dead_letter', 'threw')
           ),
           recovered boolean NOT NULL,
           duration_ms double precision NOT NULL CHECK (duration_ms >= 0),
           occurred_at timestamptz NOT NULL
         );
         CREATE INDEX IF NOT EXISTS ${this.quotedIndex(
           this.runnerEventsTable,
           'occurred_at_idx'
         )} ON ${this.runnerEvents} (occurred_at DESC, kind, outcome);

         CREATE TABLE IF NOT EXISTS ${this.indexSamples} (
           id bigserial PRIMARY KEY,
           sampled_at timestamptz NOT NULL,
           index_size_bytes bigint NOT NULL CHECK (index_size_bytes >= 0)
         );
         CREATE INDEX IF NOT EXISTS ${this.quotedIndex(
           this.indexSamplesTable,
           'sampled_at_idx'
         )} ON ${this.indexSamples} (sampled_at DESC);`
      )
      .then(() => undefined);
  }

  private get workerSamples() {
    return `"${this.schema}"."${this.workerSamplesTable}"`;
  }

  private get runnerEvents() {
    return `"${this.schema}"."${this.runnerEventsTable}"`;
  }

  private get indexSamples() {
    return `"${this.schema}"."${this.indexSamplesTable}"`;
  }

  private quotedIndex(table: string, suffix: string) {
    return `"${table}_${suffix}"`;
  }
}

export class MemoryOperationalTelemetryStore
  implements OperationalTelemetryStore
{
  private readonly workerSamples: WorkerProcessSample[] = [];
  private readonly runnerEvents: RunnerEvent[] = [];
  private readonly indexSamples: IndexSizeSample[] = [];

  async recordWorkerSample(sample: WorkerProcessSample) {
    validateWorkerSample(sample);
    this.workerSamples.push(structuredClone(sample));
  }

  async latestWorkerSample() {
    const sample = [...this.workerSamples].sort((left, right) =>
      right.sampledAt.localeCompare(left.sampledAt)
    )[0];
    return sample ? structuredClone(sample) : null;
  }

  async recordRunnerEvent(event: RunnerEvent) {
    validateRunnerEvent(event);
    this.runnerEvents.push(structuredClone(event));
  }

  async aggregateRunnerEvents(from: string, to: string) {
    const rows = this.runnerEvents
      .filter((event) => event.occurredAt >= from && event.occurredAt < to)
      .map((event) => ({
        kind: event.kind,
        outcome: event.outcome,
        recovered: event.recovered,
        event_count: '1',
        duration_sum_ms: event.durationMs,
      }));
    return aggregateRunnerRows(rows);
  }

  async recordIndexSizeSample(sample: IndexSizeSample) {
    validateTimestamp(sample.sampledAt, 'sampledAt');
    nonNegative(sample.indexSizeBytes, 'indexSizeBytes');
    this.indexSamples.push(structuredClone(sample));
  }

  async indexSizeBaseline(atOrBefore: string) {
    const sample = this.indexSamples
      .filter((candidate) => candidate.sampledAt <= atOrBefore)
      .sort((left, right) => right.sampledAt.localeCompare(left.sampledAt))[0];
    return sample ? structuredClone(sample) : null;
  }
}

export interface WorkerOperationalTelemetryOptions {
  workerId: string;
  activeJobs: () => number;
  sampleIntervalMs?: number;
  clock?: () => Date;
  monotonicNow?: () => number;
  processResources?: () => {
    cpuUserMicros: number;
    cpuSystemMicros: number;
    rssBytes: number;
    heapUsedBytes: number;
  };
  measureEventLoopLag?: () => Promise<number>;
}

export class WorkerOperationalTelemetry {
  private readonly sampleIntervalMs: number;
  private readonly clock: () => Date;
  private readonly monotonicNow: () => number;
  private readonly processResources: NonNullable<
    WorkerOperationalTelemetryOptions['processResources']
  >;
  private readonly measureEventLoopLag: () => Promise<number>;
  private previousMonotonic: number;
  private previousSampledAt: string;
  private previousCpuUserMicros: number;
  private previousCpuSystemMicros: number;
  private timer?: ReturnType<typeof setInterval>;
  private inFlight?: Promise<void>;

  constructor(
    private readonly store: Pick<
      OperationalTelemetryStore,
      'recordWorkerSample'
    >,
    private readonly options: WorkerOperationalTelemetryOptions
  ) {
    if (!options.workerId.trim()) throw new Error('workerId is required.');
    this.sampleIntervalMs = positive(
      options.sampleIntervalMs ?? 5_000,
      'sampleIntervalMs'
    );
    this.clock = options.clock ?? (() => new Date());
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.processResources =
      options.processResources ??
      (() => {
        const cpu = process.cpuUsage();
        const memory = process.memoryUsage();
        return {
          cpuUserMicros: cpu.user,
          cpuSystemMicros: cpu.system,
          rssBytes: memory.rss,
          heapUsedBytes: memory.heapUsed,
        };
      });
    this.measureEventLoopLag =
      options.measureEventLoopLag ?? measureEventLoopLag;
    const initial = this.processResources();
    this.previousCpuUserMicros = initial.cpuUserMicros;
    this.previousCpuSystemMicros = initial.cpuSystemMicros;
    this.previousMonotonic = this.monotonicNow();
    this.previousSampledAt = this.clock().toISOString();
  }

  start() {
    if (this.timer) return;
    this.resetWindow();
    this.timer = setInterval(() => {
      void this.sampleNow().catch(() => undefined);
    }, this.sampleIntervalMs);
    this.timer.unref?.();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.inFlight?.catch(() => undefined);
  }

  sampleNow() {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.captureSample().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async captureSample() {
    const eventLoopLagMs = Math.max(0, await this.measureEventLoopLag());
    const sampledAt = this.clock().toISOString();
    const monotonic = this.monotonicNow();
    const resources = this.processResources();
    const elapsedMicros = (monotonic - this.previousMonotonic) * 1_000;
    const consumedMicros =
      resources.cpuUserMicros - this.previousCpuUserMicros +
      (resources.cpuSystemMicros - this.previousCpuSystemMicros);
    const cpuUtilizationPercent =
      elapsedMicros > 0
        ? Math.max(0, (consumedMicros / elapsedMicros) * 100)
        : null;
    await this.store.recordWorkerSample({
      workerId: this.options.workerId,
      windowStartedAt: this.previousSampledAt,
      sampledAt,
      cpuUtilizationPercent,
      rssBytes: resources.rssBytes,
      heapUsedBytes: resources.heapUsedBytes,
      eventLoopLagMs,
      activeJobs: this.options.activeJobs(),
    });
    this.previousCpuUserMicros = resources.cpuUserMicros;
    this.previousCpuSystemMicros = resources.cpuSystemMicros;
    this.previousMonotonic = monotonic;
    this.previousSampledAt = sampledAt;
  }

  private resetWindow() {
    const resources = this.processResources();
    this.previousCpuUserMicros = resources.cpuUserMicros;
    this.previousCpuSystemMicros = resources.cpuSystemMicros;
    this.previousMonotonic = this.monotonicNow();
    this.previousSampledAt = this.clock().toISOString();
  }
}

function aggregateRunnerRows(
  rows: Array<{
    kind: string;
    outcome: RunnerOutcome;
    recovered: boolean;
    event_count: string;
    duration_sum_ms: number;
  }>
): RunnerWindowAggregate {
  const outcomeCounts = emptyOutcomeCounts();
  const failuresByKind: Record<string, number> = {};
  let mediaDuration = 0;
  let mediaCount = 0;
  let eventCount = 0;
  let recoveredFailureCount = 0;
  for (const row of rows) {
    const count = Number(row.event_count);
    outcomeCounts[row.outcome] += count;
    eventCount += count;
    if (isFailureOutcome(row.outcome)) {
      failuresByKind[row.kind] = (failuresByKind[row.kind] ?? 0) + count;
      if (row.recovered) recoveredFailureCount += count;
    }
    if (row.kind === 'model.media-generation') {
      mediaDuration += Number(row.duration_sum_ms);
      mediaCount += count;
    }
  }
  return {
    outcomeCounts,
    failuresByKind,
    recoveredFailureCount,
    mediaAverageDurationMs:
      mediaCount > 0 ? mediaDuration / mediaCount : null,
    eventCount,
  };
}

function emptyOutcomeCounts(): Record<RunnerOutcome, number> {
  return {
    completed: 0,
    retry: 0,
    deferred: 0,
    dead_letter: 0,
    threw: 0,
  };
}

function isFailureOutcome(outcome: RunnerOutcome) {
  return outcome === 'retry' || outcome === 'dead_letter' || outcome === 'threw';
}

function mapWorkerSample(row: WorkerSampleRow): WorkerProcessSample {
  return {
    workerId: row.worker_id,
    windowStartedAt: row.window_started_at.toISOString(),
    sampledAt: row.sampled_at.toISOString(),
    cpuUtilizationPercent:
      row.cpu_utilization_percent === null
        ? null
        : Number(row.cpu_utilization_percent),
    rssBytes: Number(row.rss_bytes),
    heapUsedBytes: Number(row.heap_used_bytes),
    eventLoopLagMs: Number(row.event_loop_lag_ms),
    activeJobs: Number(row.active_jobs),
  };
}

function validateWorkerSample(sample: WorkerProcessSample) {
  if (!sample.workerId.trim()) throw new Error('workerId is required.');
  validateTimestamp(sample.windowStartedAt, 'windowStartedAt');
  validateTimestamp(sample.sampledAt, 'sampledAt');
  if (
    sample.cpuUtilizationPercent !== null &&
    (!Number.isFinite(sample.cpuUtilizationPercent) ||
      sample.cpuUtilizationPercent < 0)
  ) {
    throw new Error('cpuUtilizationPercent must be non-negative.');
  }
  nonNegative(sample.rssBytes, 'rssBytes');
  nonNegative(sample.heapUsedBytes, 'heapUsedBytes');
  nonNegative(sample.eventLoopLagMs, 'eventLoopLagMs');
  nonNegative(sample.activeJobs, 'activeJobs');
}

function validateRunnerEvent(event: RunnerEvent) {
  if (!event.workerId.trim() || !event.kind.trim()) {
    throw new Error('Runner workerId and kind are required.');
  }
  if (!Object.hasOwn(emptyOutcomeCounts(), event.outcome)) {
    throw new Error('Runner outcome is invalid.');
  }
  nonNegative(event.durationMs, 'durationMs');
  validateTimestamp(event.occurredAt, 'occurredAt');
}

function validateTimestamp(value: string, label: string) {
  if (Number.isNaN(Date.parse(value))) throw new Error(`${label} is invalid.`);
}

function nonNegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be non-negative.`);
  }
  return value;
}

function positive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be positive.`);
  }
  return value;
}

function identifier(value: string, label: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`${label} must be a PostgreSQL identifier.`);
  }
  return value;
}

async function measureEventLoopLag() {
  const started = performance.now();
  await new Promise<void>((resolve) => setImmediate(resolve));
  return Math.max(0, performance.now() - started);
}
