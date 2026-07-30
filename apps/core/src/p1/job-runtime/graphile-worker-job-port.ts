import { createHash } from 'node:crypto';
import {
  makeWorkerUtils,
  parseCronItems,
  run,
  type CronItem,
  type DbJob,
  type Job,
  type JobHelpers,
  type Runner,
  type TaskSpec,
  type WorkerUtils,
  type WorkerUtilsOptions,
} from 'graphile-worker';
import type { PoolClient, QueryResultRow } from 'pg';
import type { JobPort } from '../foundation/ports.js';
import {
  assertSameJobFingerprint,
  JobRuntimeError,
  makeDurableJobEnvelope,
  parseDurableJobEnvelope,
  validateDurableJobInput,
  type DurableJobEnvelope,
  type DurableJobInput,
  type DurableJobInspection,
  type JobRuntimeHandler,
  type QueueRuntimeMetrics,
  type RecurringJobInput,
} from './job-contracts.js';

export interface GraphileStoredJob {
  id: string;
  taskIdentifier: string;
  payload: unknown;
  runAt: Date;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  key: string | null;
  lockedAt: Date | null;
  lockedBy: string | null;
  revision: number;
}

export interface GraphileWorkerBoundary {
  migrate(): Promise<void>;
  release(): Promise<void>;
  addJob(identifier: string, payload: unknown, spec?: TaskSpec): Promise<Job>;
  findByKey(key: string): Promise<GraphileStoredJob | null>;
  findById(id: string): Promise<GraphileStoredJob | null>;
  list(taskIdentifier: string): Promise<GraphileStoredJob[]>;
  completeJobs(ids: string[]): Promise<DbJob[]>;
  permanentlyFailJobs(ids: string[], reason?: string): Promise<DbJob[]>;
  rescheduleJobs(
    ids: string[],
    options: { runAt?: string | Date; priority?: number; attempts?: number; maxAttempts?: number }
  ): Promise<DbJob[]>;
  enqueueWithClient?(
    client: PoolClient,
    identifier: string,
    payload: unknown,
    spec: TaskSpec
  ): Promise<GraphileStoredJob>;
  renewLease?(id: string): Promise<boolean>;
  startWorker?(
    taskIdentifier: string,
    handler: (job: GraphileStoredJob, helpers: { abortSignal: AbortSignal }) => Promise<void>,
    schedules: CronItem[],
    concurrency: number
  ): Promise<{ stop(): Promise<void> }>;
}

export interface GraphileWorkerJobPortOptions {
  taskIdentifier?: string;
  maxAttempts?: number;
  concurrency?: number;
  clock?: () => Date;
}

export interface GraphileWorkerConnectionOptions extends GraphileWorkerJobPortOptions {
  connection: WorkerUtilsOptions;
}

const DEFAULTS = {
  taskIdentifier: 'p1_job',
  maxAttempts: 6,
  concurrency: 4,
} as const;

const GRAPHILE_LOCK_EXPIRY_MS = 4 * 60 * 60 * 1_000;

export class GraphileWorkerJobPort implements JobPort {
  readonly taskIdentifier: string;
  private readonly maxAttempts: number;
  private readonly concurrency: number;
  private readonly clock: () => Date;
  private readonly schedules = new Map<string, CronItem>();
  private migrated?: Promise<void>;

  constructor(
    private readonly boundary: GraphileWorkerBoundary,
    options: GraphileWorkerJobPortOptions = {}
  ) {
    this.taskIdentifier = validateTaskIdentifier(options.taskIdentifier ?? DEFAULTS.taskIdentifier);
    this.maxAttempts = positiveInteger(options.maxAttempts ?? DEFAULTS.maxAttempts, 'maxAttempts');
    this.concurrency = positiveInteger(options.concurrency ?? DEFAULTS.concurrency, 'concurrency');
    this.clock = options.clock ?? (() => new Date());
  }

  static async connect(options: GraphileWorkerConnectionOptions) {
    const { connection, ...portOptions } = options;
    const utilities = await makeWorkerUtils(connection);
    const boundary = new GraphileWorkerSdkBoundary(utilities, connection);
    const port = new GraphileWorkerJobPort(boundary, portOptions);
    await port.start();
    return port;
  }

  async start() {
    if (!this.migrated) {
      this.migrated = this.boundary.migrate().catch((error) => {
        this.migrated = undefined;
        throw error;
      });
    }
    await this.migrated;
    return this;
  }

  async stop() {
    await this.boundary.release();
    this.migrated = undefined;
  }

  async enqueue(input: DurableJobInput) {
    await this.enqueueInternal(input);
  }

  async enqueueInTransaction(input: DurableJobInput, client: PoolClient) {
    if (!this.boundary.enqueueWithClient) {
      throw new JobRuntimeError('RUNTIME_NOT_STARTED', 'This Graphile boundary cannot enqueue in a caller transaction.');
    }
    await this.enqueueInternal(input, client);
  }

  async resume(input: DurableJobInput, sequence: number) {
    await this.enqueueResumeInternal(input, sequence);
  }

  async resumeInTransaction(
    input: DurableJobInput,
    sequence: number,
    client: PoolClient,
  ) {
    if (!this.boundary.enqueueWithClient) {
      throw new JobRuntimeError(
        'RUNTIME_NOT_STARTED',
        'This Graphile boundary cannot resume in a caller transaction.',
      );
    }
    await this.enqueueResumeInternal(input, sequence, client);
  }

  async cancel(workspaceId: string, jobId: string) {
    await this.start();
    const jobs = await this.findLogicalJobs(workspaceId, jobId);
    if (jobs.length === 0) throw new JobRuntimeError('NOT_FOUND', 'Queued job was not found.');
    const unlocked = jobs.filter((job) => job.lockedAt === null && job.attempts < job.maxAttempts);
    if (unlocked.length === 0) {
      throw new JobRuntimeError('INVALID_JOB', 'Graphile Worker cannot cancel a job while it is locked by a worker.');
    }
    await this.boundary.completeJobs(unlocked.map((job) => job.id));
  }

  async retry(workspaceId: string, jobId: string) {
    await this.start();
    const jobs = await this.findLogicalJobs(workspaceId, jobId);
    const existing = newest(jobs.filter((job) => job.attempts >= job.maxAttempts));
    if (!existing) throw new JobRuntimeError('NOT_FOUND', 'Retryable job was not found.');
    const updated = await this.boundary.rescheduleJobs([existing.id], { runAt: this.clock(), attempts: 0 });
    if (updated.length === 0) throw new JobRuntimeError('INVALID_JOB', 'Locked jobs cannot be rescheduled.');
  }

  async renewLease(workspaceId: string, jobId: string) {
    await this.start();
    const jobs = await this.findLogicalJobs(workspaceId, jobId);
    const existing = newest(jobs.filter((job) => job.lockedAt !== null));
    if (!existing) throw new JobRuntimeError('NOT_FOUND', 'Active job lease was not found.');
    if (!this.boundary.renewLease || !(await this.boundary.renewLease(existing.id))) {
      throw new JobRuntimeError('INVALID_JOB', 'Graphile job is not actively locked.');
    }
  }

  async redrive(limit = 100) {
    await this.start();
    const failed = (await this.boundary.list(this.taskIdentifier))
      .filter((job) => job.attempts >= job.maxAttempts && job.lockedAt === null)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .slice(0, positiveInteger(limit, 'limit'));
    if (failed.length === 0) return 0;
    const updated = await this.boundary.rescheduleJobs(
      failed.map((job) => job.id),
      { runAt: this.clock(), attempts: 0 }
    );
    return updated.length;
  }

  defineRecurring(input: RecurringJobInput) {
    validateDurableJobInput({ ...input, jobId: input.scheduleId });
    const envelope = makeDurableJobEnvelope(
      {
        jobId: input.scheduleId,
        workspaceId: input.workspaceId,
        kind: input.kind,
        payload: input.payload,
      },
      this.clock()
    );
    const key = this.logicalKey(input.workspaceId, input.scheduleId);
    const item: CronItem = {
      task: this.taskIdentifier,
      match: input.cron,
      identifier: key,
      payload: { ...envelope },
      options: { maxAttempts: this.maxAttempts, jobKey: key, jobKeyMode: 'replace' },
    };
    // Graphile Worker loads cron from process configuration. `parseCronItems`
    // validates the definition now; callers must register it again on restart.
    parseCronItems([item]);
    this.schedules.set(key, item);
    return structuredClone(item);
  }

  removeRecurring(workspaceId: string, scheduleId: string) {
    return this.schedules.delete(this.logicalKey(workspaceId, scheduleId));
  }

  listRecurring() {
    return structuredClone([...this.schedules.values()]);
  }

  async inspect(workspaceId: string, jobId: string): Promise<DurableJobInspection | null> {
    await this.start();
    const jobs = await this.findLogicalJobs(workspaceId, jobId);
    const job = newest(jobs.filter((candidate) => candidate.attempts < candidate.maxAttempts)) ?? newest(jobs);
    if (!job) return null;
    const envelope = parseDurableJobEnvelope(job.payload);
    return {
      transportId: job.id,
      jobId: envelope.jobId,
      workspaceId: envelope.workspaceId,
      kind: envelope.kind,
      runAt: job.runAt.toISOString(),
      status: job.attempts >= job.maxAttempts ? 'failed' : job.lockedAt ? 'running' : 'queued',
      attempt: (envelope.sequence ?? 0) + job.attempts + (job.lockedAt ? 1 : 0),
      recovered: false,
      payload: structuredClone(envelope.payload),
    };
  }

  async startWorker(handler: JobRuntimeHandler) {
    await this.start();
    if (!this.boundary.startWorker) {
      throw new JobRuntimeError('RUNTIME_NOT_STARTED', 'This Graphile boundary cannot launch workers.');
    }
    return this.boundary.startWorker(
      this.taskIdentifier,
      async (job) => {
        const envelope = parseDurableJobEnvelope(job.payload);
        const renewLease = async () => {
          if (!this.boundary.renewLease || !(await this.boundary.renewLease(job.id))) {
            throw new JobRuntimeError('INVALID_JOB', 'Graphile job lease could not be renewed.');
          }
        };
        const heartbeat = this.boundary.renewLease
          ? setInterval(
              () => void renewLease().catch(() => undefined),
              Math.floor(GRAPHILE_LOCK_EXPIRY_MS / 3)
            )
          : undefined;
        heartbeat?.unref();
        try {
          const result = await handler(envelope, {
            transportId: job.id,
            attempt: (envelope.sequence ?? 0) + job.attempts + 1,
            recovered: false,
            claimedAt: (job.lockedAt ?? this.clock()).toISOString(),
            renewLease,
          });
          if (result.status === 'deferred') {
            await this.enqueueContinuation(envelope, result.deferForSeconds);
          } else if (result.status !== 'completed') {
            throw new Error(
              result.status === 'dead_letter'
                ? 'Handler requested terminal failure; Graphile will retain it after max attempts.'
                : 'Handler requested retry.'
            );
          }
        } finally {
          if (heartbeat) clearInterval(heartbeat);
        }
      },
      [...this.schedules.values()],
      this.concurrency
    );
  }

  async getMetrics(): Promise<QueueRuntimeMetrics> {
    await this.start();
    const capturedAt = this.clock();
    const jobs = await this.boundary.list(this.taskIdentifier);
    const runnable = jobs.filter(
      (job) => job.lockedAt === null && job.attempts < job.maxAttempts && job.runAt <= capturedAt
    );
    const deferred = jobs.filter(
      (job) => job.lockedAt === null && job.attempts < job.maxAttempts && job.runAt > capturedAt
    );
    const active = jobs.filter((job) => job.lockedAt !== null);
    const failed = jobs.filter((job) => job.attempts >= job.maxAttempts);
    const claimLatencies = active.map((job) => Math.max(0, job.lockedAt!.getTime() - job.createdAt.getTime()));
    const leaseExpiries = active.map((job) => new Date(job.lockedAt!.getTime() + GRAPHILE_LOCK_EXPIRY_MS));
    const oldest = runnable.reduce<Date | null>((value, job) => {
      return !value || job.createdAt < value ? job.createdAt : value;
    }, null);
    return {
      queueDepth: runnable.length,
      deferredCount: deferred.length,
      activeCount: active.length,
      failedCount: failed.length,
      deadLetterDepth: 0,
      oldestRunnableAgeMs: oldest ? Math.max(0, capturedAt.getTime() - oldest.getTime()) : null,
      averageClaimLatencyMs: claimLatencies.length
        ? claimLatencies.reduce((sum, value) => sum + value, 0) / claimLatencies.length
        : null,
      maxClaimLatencyMs: claimLatencies.length ? Math.max(...claimLatencies) : null,
      leaseExpiryCount: leaseExpiries.filter((expiry) => expiry <= capturedAt).length,
      nextLeaseExpiryAt: leaseExpiries.length
        ? new Date(Math.min(...leaseExpiries.map((expiry) => expiry.getTime()))).toISOString()
        : null,
      attemptCount: jobs.reduce((sum, job) => sum + job.attempts + (job.lockedAt ? 1 : 0), 0),
      recoveryCount: null,
      capturedAt: capturedAt.toISOString(),
    };
  }

  logicalKey(workspaceId: string, jobId: string) {
    return `p1:${createHash('sha256').update(`${workspaceId}\u0000${jobId}`).digest('hex')}`;
  }

  private async enqueueContinuation(envelope: DurableJobEnvelope, deferForSeconds = 2) {
    const sequence = (envelope.sequence ?? 0) + 1;
    const continuation: DurableJobEnvelope = {
      ...structuredClone(envelope),
      sequence,
      enqueuedAt: this.clock().toISOString(),
    };
    await this.boundary.addJob(this.taskIdentifier, continuation, {
      runAt: new Date(this.clock().getTime() + positiveInteger(deferForSeconds, 'deferForSeconds') * 1_000),
      maxAttempts: this.maxAttempts,
      jobKey: `${this.logicalKey(envelope.workspaceId, envelope.jobId)}:continuation:${sequence}`,
      jobKeyMode: 'unsafe_dedupe',
      priority: continuation.scheduling?.queuePriority,
    });
  }

  private async findLogicalJobs(workspaceId: string, jobId: string) {
    const jobs = await this.boundary.list(this.taskIdentifier);
    return jobs.filter((job) => {
      const envelope = parseDurableJobEnvelope(job.payload);
      return envelope.workspaceId === workspaceId && envelope.jobId === jobId;
    });
  }

  private async enqueueInternal(input: DurableJobInput, client?: PoolClient) {
    validateDurableJobInput(input);
    await this.start();
    const key = this.logicalKey(input.workspaceId, input.jobId);
    const envelope = makeDurableJobEnvelope(input, this.clock());
    const existing = await this.boundary.findByKey(key);
    if (existing) {
      assertSameJobFingerprint(parseDurableJobEnvelope(existing.payload), envelope);
      return;
    }
    const spec: TaskSpec = {
      runAt: input.runAt ? new Date(input.runAt) : undefined,
      maxAttempts: this.maxAttempts,
      jobKey: key,
      jobKeyMode: 'unsafe_dedupe',
      priority: input.scheduling?.queuePriority,
    };
    let inserted: GraphileStoredJob | null;
    if (client) {
      inserted = await this.boundary.enqueueWithClient!(client, this.taskIdentifier, envelope, spec);
    } else {
      await this.boundary.addJob(this.taskIdentifier, envelope, spec);
      inserted = await this.boundary.findByKey(key);
    }
    if (!inserted) throw new JobRuntimeError('INVALID_JOB', 'Graphile Worker did not persist the requested job.');
    assertSameJobFingerprint(parseDurableJobEnvelope(inserted.payload), envelope);
  }

  private async enqueueResumeInternal(
    input: DurableJobInput,
    sequence: number,
    client?: PoolClient,
  ) {
    validateDurableJobInput(input);
    const normalizedSequence = positiveInteger(sequence, 'sequence');
    await this.start();
    const key = `${this.logicalKey(input.workspaceId, input.jobId)}:continuation:${normalizedSequence}`;
    const envelope: DurableJobEnvelope = {
      ...makeDurableJobEnvelope(input, this.clock()),
      sequence: normalizedSequence,
    };
    const existing = await this.boundary.findByKey(key);
    if (existing) {
      assertSameJobFingerprint(
        parseDurableJobEnvelope(existing.payload),
        envelope,
      );
      return;
    }
    const spec: TaskSpec = {
      runAt: input.runAt ? new Date(input.runAt) : undefined,
      maxAttempts: this.maxAttempts,
      jobKey: key,
      jobKeyMode: 'unsafe_dedupe',
      priority: input.scheduling?.queuePriority,
    };
    let inserted: GraphileStoredJob | null;
    if (client) {
      inserted = await this.boundary.enqueueWithClient!(
        client,
        this.taskIdentifier,
        envelope,
        spec,
      );
    } else {
      await this.boundary.addJob(this.taskIdentifier, envelope, spec);
      inserted = await this.boundary.findByKey(key);
    }
    if (!inserted) {
      throw new JobRuntimeError(
        'INVALID_JOB',
        'Graphile Worker did not persist the resumed job.',
      );
    }
    const persisted = parseDurableJobEnvelope(inserted.payload);
    assertSameJobFingerprint(persisted, envelope);
    if (persisted.sequence !== normalizedSequence) {
      throw new JobRuntimeError(
        'IDEMPOTENCY_CONFLICT',
        'Graphile resume sequence was reused by another transport.',
      );
    }
  }
}

export class GraphileWorkerSdkBoundary implements GraphileWorkerBoundary {
  private readonly schema: string;

  constructor(
    private readonly utilities: WorkerUtils,
    private readonly connection: WorkerUtilsOptions
  ) {
    this.schema = validateSchema(connection.schema ?? 'graphile_worker');
  }

  migrate() {
    return this.utilities.migrate();
  }

  async release() {
    await this.utilities.release();
  }

  addJob(identifier: string, payload: unknown, spec?: TaskSpec) {
    return this.utilities.addJob(identifier, payload, spec);
  }

  async findByKey(key: string) {
    const rows = await this.queryStoredJobs('AND j.key = $2', [key]);
    return rows[0] ?? null;
  }

  async findById(id: string) {
    const rows = await this.queryStoredJobs('AND j.id = $2::bigint', [id]);
    return rows[0] ?? null;
  }

  list(taskIdentifier: string) {
    return this.queryStoredJobs('', [], taskIdentifier);
  }

  completeJobs(ids: string[]) {
    return this.utilities.completeJobs(ids);
  }

  permanentlyFailJobs(ids: string[], reason?: string) {
    return this.utilities.permanentlyFailJobs(ids, reason);
  }

  rescheduleJobs(
    ids: string[],
    options: { runAt?: string | Date; priority?: number; attempts?: number; maxAttempts?: number }
  ) {
    return this.utilities.rescheduleJobs(ids, options);
  }

  async enqueueWithClient(client: PoolClient, identifier: string, payload: unknown, spec: TaskSpec) {
    const { rows } = await client.query<GraphilePrivateRow>(
      `SELECT j.*, $1::text AS task_identifier
       FROM ${this.quotedSchema}.add_job(
         $1::text, $2::json, $3::text, $4::timestamptz, $5::integer,
         $6::text, $7::integer, $8::text[], $9::text
       ) j`,
      [
        identifier,
        JSON.stringify(payload),
        spec.queueName ?? null,
        spec.runAt ?? null,
        spec.maxAttempts ?? null,
        spec.jobKey ?? null,
        spec.priority ?? null,
        spec.flags ?? null,
        spec.jobKeyMode ?? 'replace',
      ]
    );
    if (!rows[0]) throw new JobRuntimeError('INVALID_JOB', 'Graphile Worker transaction enqueue returned no job.');
    return mapPrivateRow(rows[0]);
  }

  async renewLease(id: string) {
    const result = await this.utilities.withPgClient((client) => {
      return client.query(
        `UPDATE ${this.quotedSchema}._private_jobs
         SET locked_at = now(), updated_at = now()
         WHERE id = $1::bigint AND locked_by IS NOT NULL`,
        [id]
      );
    });
    return (result.rowCount ?? 0) > 0;
  }

  async startWorker(
    taskIdentifier: string,
    handler: (job: GraphileStoredJob, helpers: { abortSignal: AbortSignal }) => Promise<void>,
    schedules: CronItem[],
    concurrency: number
  ) {
    const task = async (payload: unknown, helpers: JobHelpers) => {
      await handler(mapExecutionJob(helpers.job, payload), { abortSignal: helpers.abortSignal });
    };
    const runner: Runner = await run({
      ...this.connection,
      concurrency,
      noHandleSignals: true,
      taskList: { [taskIdentifier]: task },
      parsedCronItems: parseCronItems(schedules),
    });
    return { stop: async () => runner.stop('GraphileWorkerJobPort stopped') };
  }

  private get quotedSchema() {
    return `"${this.schema}"`;
  }

  private async queryStoredJobs(extraWhere: string, values: unknown[], taskIdentifier: unknown = null) {
    const parameters = [taskIdentifier, ...values];
    const result = await this.utilities.withPgClient((client) => {
      return client.query<GraphilePrivateRow>(
        `SELECT j.*, t.identifier AS task_identifier
         FROM ${this.quotedSchema}._private_jobs j
         JOIN ${this.quotedSchema}._private_tasks t ON t.id = j.task_id
         WHERE ($1::text IS NULL OR t.identifier = $1)
         ${extraWhere}
         ORDER BY j.created_at, j.id`,
        parameters
      );
    });
    return result.rows.map(mapPrivateRow);
  }
}

interface GraphilePrivateRow extends QueryResultRow {
  id: string | number;
  task_identifier: string;
  payload: unknown;
  run_at: Date;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
  key: string | null;
  locked_at: Date | null;
  locked_by: string | null;
  revision: number;
}

function mapPrivateRow(row: GraphilePrivateRow): GraphileStoredJob {
  return {
    id: String(row.id),
    taskIdentifier: row.task_identifier,
    payload: row.payload,
    runAt: new Date(row.run_at),
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    lastError: row.last_error,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    key: row.key,
    lockedAt: row.locked_at ? new Date(row.locked_at) : null,
    lockedBy: row.locked_by,
    revision: Number(row.revision),
  };
}

function mapExecutionJob(job: Job, payload: unknown): GraphileStoredJob {
  return {
    id: job.id,
    taskIdentifier: job.task_identifier,
    payload,
    runAt: job.run_at,
    attempts: job.attempts,
    maxAttempts: job.max_attempts,
    lastError: job.last_error,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    key: job.key,
    lockedAt: job.locked_at,
    lockedBy: job.locked_by,
    revision: job.revision,
  };
}

function validateSchema(schema: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new JobRuntimeError('INVALID_JOB', 'Graphile schema must be a PostgreSQL identifier.');
  }
  return schema;
}

function validateTaskIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_-]{0,127}$/.test(identifier)) {
    throw new JobRuntimeError('INVALID_JOB', 'Graphile task identifier is invalid.');
  }
  return identifier;
}

function positiveInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value < 1) {
    throw new JobRuntimeError('INVALID_JOB', `${name} must be a positive integer.`);
  }
  return value;
}

function newest<T extends GraphileStoredJob>(jobs: T[]) {
  return jobs.reduce<T | null>((selected, job) => {
    return !selected || job.createdAt > selected.createdAt ? job : selected;
  }, null);
}
