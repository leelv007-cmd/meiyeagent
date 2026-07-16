import { createHash } from 'node:crypto';
import { PgBoss } from 'pg-boss';
import type {
  CommandResponse,
  ConstructorOptions,
  Db,
  GroupConcurrencyConfig,
  JobResult,
  JobWithMetadata,
  Queue,
  QueueResult,
  Schedule,
  ScheduleOptions,
  SendOptions,
  WorkOptions,
} from 'pg-boss';
import type { PoolClient } from 'pg';
import type { JobPort } from '../foundation/ports.js';
import {
  assertSameJobFingerprint,
  JobRuntimeError,
  makeDurableJobEnvelope,
  validateDurableJobInput,
  type DurableJobEnvelope,
  type DurableJobInput,
  type DurableJobInspection,
  type DurableJobStatus,
  type JobRuntimeHandler,
  type JobRuntimeHandlerContext,
  type QueueRuntimeMetrics,
  type RecurringJobInput,
} from './job-contracts.js';

export * from './job-contracts.js';

export interface PgBossClient {
  start(): Promise<unknown>;
  stop(options?: { close?: boolean; graceful?: boolean; timeout?: number }): Promise<void>;
  createQueue(name: string, options?: Omit<Queue, 'name'>): Promise<void>;
  send(name: string, data?: object | null, options?: SendOptions): Promise<string | null>;
  findJobs<T>(name: string, options?: { id?: string; key?: string; data?: object; queued?: boolean; db?: Db }): Promise<JobWithMetadata<T>[]>;
  cancel(name: string, id: string | string[], options?: { db?: Db }): Promise<CommandResponse>;
  retry(name: string, id: string | string[], options?: { db?: Db }): Promise<CommandResponse>;
  touch(name: string, id: string | string[], options?: { db?: Db }): Promise<CommandResponse>;
  redrive(name: string, options?: { destination?: string; sourceName?: string; limit?: number; db?: Db }): Promise<number>;
  schedule(name: string, cron: string, data?: object | null, options?: ScheduleOptions): Promise<void>;
  unschedule(name: string, key?: string): Promise<void>;
  getSchedules(name?: string, key?: string): Promise<Schedule[]>;
  getQueue(name: string): Promise<QueueResult | null>;
  work<T>(
    name: string,
    options: WorkOptions & { includeMetadata: true; perJobResults: true },
    handler: (jobs: JobWithMetadata<T>[]) => Promise<JobResult[]>
  ): Promise<string>;
  offWork(name: string, options?: { id?: string; wait?: boolean }): Promise<void>;
}

export interface PgBossJobPortOptions {
  queuePrefix?: string;
  retryLimit?: number;
  retryDelaySeconds?: number;
  retryDelayMaxSeconds?: number;
  expireInSeconds?: number;
  heartbeatSeconds?: number;
  retentionSeconds?: number;
  deleteAfterSeconds?: number;
  localConcurrency?: number;
  /** Product plan concurrency values available to pg-boss group tiers. */
  workspaceConcurrencyLimits?: readonly number[];
  clock?: () => Date;
}

export interface PgBossConnectionOptions extends PgBossJobPortOptions {
  connection: string | ConstructorOptions;
}

interface CommandResult extends CommandResponse {
  affected?: number;
}

const DEFAULTS = {
  queuePrefix: 'p1',
  retryLimit: 5,
  retryDelaySeconds: 2,
  retryDelayMaxSeconds: 300,
  expireInSeconds: 900,
  heartbeatSeconds: 30,
  retentionSeconds: 14 * 24 * 60 * 60,
  deleteAfterSeconds: 7 * 24 * 60 * 60,
  localConcurrency: 4,
} as const;

export class PgBossJobPort implements JobPort {
  readonly queueName: string;
  readonly deadLetterQueueName: string;

  private readonly retryLimit: number;
  private readonly retryDelaySeconds: number;
  private readonly retryDelayMaxSeconds: number;
  private readonly expireInSeconds: number;
  private readonly heartbeatSeconds: number;
  private readonly retentionSeconds: number;
  private readonly deleteAfterSeconds: number;
  private readonly localConcurrency: number;
  private readonly workspaceGroupConcurrency: GroupConcurrencyConfig;
  private readonly clock: () => Date;
  private startPromise?: Promise<void>;

  constructor(
    private readonly boss: PgBossClient,
    options: PgBossJobPortOptions = {}
  ) {
    const prefix = normalizeQueuePrefix(options.queuePrefix ?? DEFAULTS.queuePrefix);
    this.queueName = `${prefix}-jobs`;
    this.deadLetterQueueName = `${prefix}-jobs-dead`;
    this.retryLimit = positiveInteger(options.retryLimit ?? DEFAULTS.retryLimit, 'retryLimit');
    this.retryDelaySeconds = positiveInteger(options.retryDelaySeconds ?? DEFAULTS.retryDelaySeconds, 'retryDelaySeconds');
    this.retryDelayMaxSeconds = positiveInteger(
      options.retryDelayMaxSeconds ?? DEFAULTS.retryDelayMaxSeconds,
      'retryDelayMaxSeconds'
    );
    this.expireInSeconds = positiveInteger(options.expireInSeconds ?? DEFAULTS.expireInSeconds, 'expireInSeconds');
    this.heartbeatSeconds = positiveInteger(
      options.heartbeatSeconds ?? DEFAULTS.heartbeatSeconds,
      'heartbeatSeconds'
    );
    if (this.heartbeatSeconds < 10) {
      throw new JobRuntimeError('INVALID_JOB', 'heartbeatSeconds must be at least 10 for pg-boss.');
    }
    this.retentionSeconds = positiveInteger(
      options.retentionSeconds ?? DEFAULTS.retentionSeconds,
      'retentionSeconds'
    );
    this.deleteAfterSeconds = nonNegativeInteger(
      options.deleteAfterSeconds ?? DEFAULTS.deleteAfterSeconds,
      'deleteAfterSeconds'
    );
    this.localConcurrency = positiveInteger(
      options.localConcurrency ?? DEFAULTS.localConcurrency,
      'localConcurrency'
    );
    this.workspaceGroupConcurrency = groupConcurrencyConfig(
      options.workspaceConcurrencyLimits ?? [1]
    );
    this.clock = options.clock ?? (() => new Date());
  }

  static connect(options: PgBossConnectionOptions) {
    const { connection, ...runtimeOptions } = options;
    const boss = typeof connection === 'string' ? new PgBoss(connection) : new PgBoss(connection);
    return new PgBossJobPort(boss, runtimeOptions);
  }

  async start() {
    if (!this.startPromise) {
      this.startPromise = this.startRuntime().catch((error) => {
        this.startPromise = undefined;
        throw error;
      });
    }
    await this.startPromise;
    return this;
  }

  async stop(options: { close?: boolean; graceful?: boolean; timeout?: number } = { graceful: true }) {
    if (!this.startPromise) return;
    await this.boss.stop(options);
    this.startPromise = undefined;
  }

  async enqueue(input: DurableJobInput) {
    await this.enqueueInternal(input);
  }

  async enqueueInTransaction(input: DurableJobInput, client: PoolClient) {
    await this.enqueueInternal(input, new PgClientDatabase(client));
  }

  async cancel(workspaceId: string, jobId: string) {
    await this.start();
    const [mainJobs, deadJobs] = await Promise.all([
      this.findLogicalJobs(this.queueName, workspaceId, jobId),
      this.findLogicalJobs(this.deadLetterQueueName, workspaceId, jobId),
    ]);
    const cancellableMain = mainJobs.filter((job) => isPreTerminal(job.state));
    const cancellableDead = deadJobs.filter((job) => isPreTerminal(job.state));
    if (cancellableMain.length === 0 && cancellableDead.length === 0) {
      if (mainJobs.length === 0 && deadJobs.length === 0) {
        throw new JobRuntimeError('NOT_FOUND', 'Queued job was not found.');
      }
      return;
    }
    await Promise.all([
      cancellableMain.length
        ? this.boss.cancel(this.queueName, cancellableMain.map((job) => job.id))
        : Promise.resolve({}),
      cancellableDead.length
        ? this.boss.cancel(this.deadLetterQueueName, cancellableDead.map((job) => job.id))
        : Promise.resolve({}),
    ]);
  }

  async retry(workspaceId: string, jobId: string) {
    await this.start();
    const jobs = await this.findLogicalJobs(this.queueName, workspaceId, jobId);
    const failed = newest(jobs.filter((job) => job.state === 'failed'));
    if (!failed) throw new JobRuntimeError('NOT_FOUND', 'Retryable job was not found.');
    const result = (await this.boss.retry(this.queueName, failed.id)) as CommandResult;
    if (result.affected === 0) throw new JobRuntimeError('NOT_FOUND', 'Retryable job was not found.');
  }

  async renewLease(workspaceId: string, jobId: string) {
    await this.start();
    const jobs = await this.findLogicalJobs(this.queueName, workspaceId, jobId);
    const active = newest(jobs.filter((job) => job.state === 'active'));
    if (!active) throw new JobRuntimeError('NOT_FOUND', 'Active job lease was not found.');
    const result = (await this.boss.touch(this.queueName, active.id)) as CommandResult;
    if (result.affected === 0) throw new JobRuntimeError('NOT_FOUND', 'Active job lease was not found.');
  }

  async redrive(limit = 100) {
    await this.start();
    return this.boss.redrive(this.deadLetterQueueName, {
      destination: this.queueName,
      sourceName: this.queueName,
      limit: positiveInteger(limit, 'limit'),
    });
  }

  async scheduleRecurring(input: RecurringJobInput) {
    validateDurableJobInput({ ...input, jobId: input.scheduleId });
    await this.start();
    const envelope = makeDurableJobEnvelope(
      {
        jobId: input.scheduleId,
        workspaceId: input.workspaceId,
        kind: input.kind,
        payload: input.payload,
        scheduling: input.scheduling,
      },
      this.clock()
    );
    await this.boss.schedule(this.queueName, input.cron, envelope, {
      key: scheduleKey(input.workspaceId, input.scheduleId),
      tz: input.timezone ?? 'UTC',
      retryLimit: this.retryLimit,
      retryDelay: this.retryDelaySeconds,
      retryBackoff: true,
      retryDelayMax: this.retryDelayMaxSeconds,
      expireInSeconds: this.expireInSeconds,
      heartbeatSeconds: this.heartbeatSeconds,
      deadLetter: this.deadLetterQueueName,
      ...schedulingOptions(envelope),
    });
  }

  async unscheduleRecurring(workspaceId: string, scheduleId: string) {
    await this.start();
    await this.boss.unschedule(this.queueName, scheduleKey(workspaceId, scheduleId));
  }

  async listRecurring() {
    await this.start();
    return this.boss.getSchedules(this.queueName);
  }

  async inspect(workspaceId: string, jobId: string): Promise<DurableJobInspection | null> {
    await this.start();
    const mainJobs = await this.findLogicalJobs(this.queueName, workspaceId, jobId);
    const live = newest(mainJobs.filter((job) => isPreTerminal(job.state)));
    if (live) return inspectJob(live, false);
    const deadJobs = await this.findLogicalJobs(this.deadLetterQueueName, workspaceId, jobId);
    const dead = newest(deadJobs.filter((job) => isPreTerminal(job.state)));
    if (dead) return inspectJob(dead, true);
    const terminal = newest(mainJobs);
    return terminal ? inspectJob(terminal, false) : null;
  }

  async startWorker(handler: JobRuntimeHandler) {
    await this.start();
    const workId = await this.boss.work<DurableJobEnvelope>(
      this.queueName,
      {
        includeMetadata: true,
        perJobResults: true,
        batchSize: 1,
        localConcurrency: this.localConcurrency,
        groupConcurrency: this.workspaceGroupConcurrency,
        heartbeatRefreshSeconds: Math.max(1, Math.floor(this.heartbeatSeconds / 2)),
      },
      async (jobs) => {
        const results: JobResult[] = [];
        for (const job of jobs) {
          const context: JobRuntimeHandlerContext = {
            transportId: job.id,
            attempt: (job.data.sequence ?? 0) + job.retryCount + 1,
            recovered: isLeaseRecovery(job),
            claimedAt: dateOr(job.startedOn, this.clock()).toISOString(),
            renewLease: async () => {
              const response = (await this.boss.touch(this.queueName, job.id)) as CommandResult;
              if (response.affected === 0) throw new JobRuntimeError('NOT_FOUND', 'Active job lease was not found.');
            },
          };
          try {
            const result = await handler(job.data, context);
            if (result.status === 'deferred') {
              await this.enqueueContinuation(job.data, result.deferForSeconds);
            }
            results.push({
              id: job.id,
              status: result.status === 'retry' ? 'failed' : result.status === 'dead_letter' ? 'deadletter' : 'completed',
              output: result.output,
            });
          } catch (error) {
            results.push({ id: job.id, status: 'failed', output: serializeError(error) });
          }
        }
        return results;
      }
    );
    return {
      workId,
      stop: async () => this.boss.offWork(this.queueName, { id: workId, wait: true }),
    };
  }

  async getMetrics(): Promise<QueueRuntimeMetrics> {
    await this.start();
    const capturedAt = this.clock();
    const [queue, deadQueue, jobs] = await Promise.all([
      this.boss.getQueue(this.queueName),
      this.boss.getQueue(this.deadLetterQueueName),
      this.boss.findJobs<DurableJobEnvelope>(this.queueName),
    ]);
    if (!queue || !deadQueue) {
      throw new JobRuntimeError('RUNTIME_NOT_STARTED', 'Job queues are not available.');
    }
    const runnable = jobs.filter((job) => {
      return (job.state === 'created' || job.state === 'retry') && job.startAfter.getTime() <= capturedAt.getTime();
    });
    const claimLatencies = jobs.flatMap((job) => {
      if (job.state !== 'active' && job.completedOn === null) return [];
      const startedOn = job.startedOn instanceof Date ? job.startedOn : null;
      return startedOn ? [Math.max(0, startedOn.getTime() - job.startAfter.getTime())] : [];
    });
    const leaseExpiries = jobs
      .filter((job) => job.state === 'active')
      .map((job) => {
        const base = job.heartbeatOn ?? dateOr(job.startedOn, capturedAt);
        const seconds = job.heartbeatSeconds ?? job.expireInSeconds;
        return new Date(base.getTime() + seconds * 1_000);
      });
    const oldestRunnableAt = runnable.reduce<Date | null>((oldest, job) => {
      return !oldest || job.startAfter < oldest ? job.startAfter : oldest;
    }, null);
    return {
      queueDepth: queue.readyCount,
      deferredCount: queue.deferredCount,
      activeCount: queue.activeCount,
      failedCount: queue.failedCount,
      deadLetterDepth: deadQueue.readyCount,
      oldestRunnableAgeMs: oldestRunnableAt ? Math.max(0, capturedAt.getTime() - oldestRunnableAt.getTime()) : null,
      averageClaimLatencyMs: claimLatencies.length
        ? claimLatencies.reduce((sum, value) => sum + value, 0) / claimLatencies.length
        : null,
      maxClaimLatencyMs: claimLatencies.length ? Math.max(...claimLatencies) : null,
      leaseExpiryCount: leaseExpiries.filter((expiry) => expiry <= capturedAt).length,
      nextLeaseExpiryAt: leaseExpiries.length
        ? new Date(Math.min(...leaseExpiries.map((expiry) => expiry.getTime()))).toISOString()
        : null,
      attemptCount: jobs.reduce((sum, job) => sum + job.retryCount + (job.state === 'created' ? 0 : 1), 0),
      recoveryCount: jobs.filter(isLeaseRecovery).length,
      capturedAt: capturedAt.toISOString(),
    };
  }

  private async startRuntime() {
    await this.boss.start();
    await this.boss.createQueue(this.deadLetterQueueName, {
      retryLimit: 0,
      expireInSeconds: this.expireInSeconds,
      retentionSeconds: this.retentionSeconds,
      deleteAfterSeconds: this.deleteAfterSeconds,
    });
    await this.boss.createQueue(this.queueName, {
      retryLimit: this.retryLimit,
      retryDelay: this.retryDelaySeconds,
      retryBackoff: true,
      retryDelayMax: this.retryDelayMaxSeconds,
      expireInSeconds: this.expireInSeconds,
      heartbeatSeconds: this.heartbeatSeconds,
      retentionSeconds: this.retentionSeconds,
      deleteAfterSeconds: this.deleteAfterSeconds,
      deadLetter: this.deadLetterQueueName,
    });
  }

  private async enqueueInternal(input: DurableJobInput, db?: Db) {
    validateDurableJobInput(input);
    await this.start();
    const id = transportId(input.workspaceId, input.jobId);
    const existing = await this.boss.findJobs<DurableJobEnvelope>(this.queueName, { id, db });
    const envelope = makeDurableJobEnvelope(input, this.clock());
    if (existing[0]) {
      assertSameJobFingerprint(existing[0].data, envelope);
      return;
    }
    const inserted = await this.boss.send(this.queueName, envelope, {
      id,
      singletonKey: logicalJobKey(input.workspaceId, input.jobId),
      startAfter: input.runAt,
      db,
      retryLimit: this.retryLimit,
      retryDelay: this.retryDelaySeconds,
      retryBackoff: true,
      retryDelayMax: this.retryDelayMaxSeconds,
      expireInSeconds: this.expireInSeconds,
      heartbeatSeconds: this.heartbeatSeconds,
      deadLetter: this.deadLetterQueueName,
      ...schedulingOptions(envelope),
    });
    if (inserted) return;
    const raced = await this.boss.findJobs<DurableJobEnvelope>(this.queueName, { id, db });
    if (!raced[0]) throw new JobRuntimeError('INVALID_JOB', 'pg-boss did not persist the requested job.');
    assertSameJobFingerprint(raced[0].data, envelope);
  }

  private async enqueueContinuation(envelope: DurableJobEnvelope, deferForSeconds = this.retryDelaySeconds) {
    const sequence = (envelope.sequence ?? 0) + 1;
    const continuation: DurableJobEnvelope = {
      ...structuredClone(envelope),
      sequence,
      enqueuedAt: this.clock().toISOString(),
    };
    await this.boss.send(this.queueName, continuation, {
      id: continuationTransportId(envelope.workspaceId, envelope.jobId, sequence),
      startAfter: positiveInteger(deferForSeconds, 'deferForSeconds'),
      retryLimit: this.retryLimit,
      retryDelay: this.retryDelaySeconds,
      retryBackoff: true,
      retryDelayMax: this.retryDelayMaxSeconds,
      expireInSeconds: this.expireInSeconds,
      heartbeatSeconds: this.heartbeatSeconds,
      deadLetter: this.deadLetterQueueName,
      ...schedulingOptions(continuation),
    });
  }

  private async findLogicalJobs(queue: string, workspaceId: string, jobId: string, db?: Db) {
    const [byKey, byData] = await Promise.all([
      this.boss.findJobs<DurableJobEnvelope>(queue, {
        key: logicalJobKey(workspaceId, jobId),
        db,
      }),
      this.boss.findJobs<DurableJobEnvelope>(queue, {
        data: { workspaceId, jobId },
        db,
      }),
    ]);
    return [...new Map([...byKey, ...byData].map((job) => [job.id, job])).values()]
      .filter((job) => job.data.workspaceId === workspaceId && job.data.jobId === jobId);
  }
}

export class PgClientDatabase implements Db {
  constructor(private readonly client: Pick<PoolClient, 'query'>) {}

  async executeSql(text: string, values?: unknown[]) {
    const result = await this.client.query(text, values);
    return { rows: result.rows };
  }
}

function inspectJob(job: JobWithMetadata<DurableJobEnvelope>, deadLetter: boolean): DurableJobInspection {
  return {
    transportId: job.id,
    jobId: job.data.jobId,
    workspaceId: job.data.workspaceId,
    kind: job.data.kind,
    runAt: job.startAfter.toISOString(),
    status: deadLetter ? 'dead_letter' : mapStatus(job.state),
    attempt: (job.data.sequence ?? 0) + job.retryCount + (job.state === 'created' ? 0 : 1),
    recovered: isLeaseRecovery(job),
    payload: structuredClone(job.data.payload),
  };
}

function mapStatus(state: JobWithMetadata['state']): DurableJobStatus {
  if (state === 'created' || state === 'retry') return 'queued';
  if (state === 'active') return 'running';
  return state;
}

function transportId(workspaceId: string, jobId: string) {
  const bytes = Buffer.from(createHash('sha256').update(`${workspaceId}\u0000${jobId}`).digest().subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function continuationTransportId(workspaceId: string, jobId: string, sequence: number) {
  return transportId(workspaceId, `${jobId}\u0000continuation\u0000${sequence}`);
}

function logicalJobKey(workspaceId: string, jobId: string) {
  return `job-${transportId(workspaceId, jobId)}`;
}

function scheduleKey(workspaceId: string, scheduleId: string) {
  return `schedule-${transportId(workspaceId, scheduleId)}`;
}

function normalizeQueuePrefix(prefix: string) {
  const normalized = prefix.trim().toLowerCase().replace(/[^a-z0-9_.\-/]+/g, '-').replace(/^-+|-+$/g, '');
  if (!normalized) throw new JobRuntimeError('INVALID_JOB', 'queuePrefix must contain a queue-safe character.');
  return normalized;
}

function positiveInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value < 1) {
    throw new JobRuntimeError('INVALID_JOB', `${name} must be a positive integer.`);
  }
  return value;
}

function nonNegativeInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value < 0) {
    throw new JobRuntimeError('INVALID_JOB', `${name} must be a non-negative integer.`);
  }
  return value;
}

function workspaceConcurrencyTier(limit: number) {
  return `limit-${limit}`;
}

function groupConcurrencyConfig(
  limits: readonly number[]
): GroupConcurrencyConfig {
  const normalized = [...new Set(limits.map((limit) => positiveInteger(limit, 'workspaceConcurrencyLimit')))];
  return {
    default: 1,
    tiers: Object.fromEntries(
      normalized.map((limit) => [workspaceConcurrencyTier(limit), limit])
    ),
  };
}

function schedulingOptions(input: DurableJobInput) {
  if (!input.scheduling) return {};
  return {
    group: {
      id: input.workspaceId,
      tier: workspaceConcurrencyTier(
        input.scheduling.workspaceConcurrencyLimit
      ),
    },
    priority: input.scheduling.queuePriority,
  };
}

function isPreTerminal(state: JobWithMetadata['state']) {
  return state === 'created' || state === 'retry' || state === 'active';
}

function newest<T extends JobWithMetadata<DurableJobEnvelope>>(jobs: T[]) {
  return jobs.reduce<T | null>((selected, job) => {
    return !selected || job.createdOn > selected.createdOn ? job : selected;
  }, null);
}

function isLeaseRecovery(job: JobWithMetadata<DurableJobEnvelope>) {
  if (job.retryCount === 0) return false;
  const evidence = JSON.stringify(job.output ?? {}).toLowerCase();
  return evidence.includes('heartbeat timeout') || evidence.includes('job timed out') || evidence.includes('lease expired');
}

function dateOr(value: unknown, fallback: Date) {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : fallback;
}

function serializeError(error: unknown) {
  return error instanceof Error ? { name: error.name, message: error.message } : { name: 'Error', message: String(error) };
}
