import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { JobPort } from '../foundation/ports.js';
import {
  fingerprintValue,
  JobRuntimeError,
  validateDurableJobInput,
  type DurableJobEnvelope,
  type DurableJobInput,
  type JobRuntimeHandlerContext,
  type JobRuntimeHandlerResult,
} from './job-contracts.js';

export type TracerJobStatus =
  | 'queued'
  | 'running'
  | 'unknown'
  | 'cancel_requested'
  | 'cancelled'
  | 'completed'
  | 'failed';
export type TracerAcceptance = 'rejected_before_accept' | 'accepted' | 'acceptance_unknown';

export interface TracerJobInput {
  workspaceId: string;
  jobId: string;
  kind: string;
  runAt?: string;
  payload: Record<string, unknown>;
}

export interface ResumeFailedTracerJobInput {
  workspaceId: string;
  jobId: string;
  expectedPayloadHash: string;
  payload: Record<string, unknown>;
}

export interface TracerJobRecord extends TracerJobInput {
  status: TracerJobStatus;
  acceptance: TracerAcceptance | null;
  effectIdempotencyKey: string;
  leaseExpiresAt: string | null;
  providerTaskRef: string | null;
  output: Record<string, unknown> | null;
  error: string | null;
  attempts: number;
  /** Wall time accumulated only while a fenced worker lease is active. */
  activeExecutionMs: number;
  payloadHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface TracerReservation {
  decision:
    | 'execute'
    | 'reconcile'
    | 'cancel'
    | 'in_progress'
    | 'cancelled'
    | 'completed'
    | 'failed';
  record: TracerJobRecord;
  leaseToken: string | null;
}

export interface TracerExternalRequest {
  workspaceId: string;
  jobId: string;
  kind: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  effectIdempotencyKey: string;
  providerTaskRef?: string;
  previousAcceptance?: TracerAcceptance;
  previousAttemptCount?: number;
}

export interface TracerExternalOutcome {
  acceptance: TracerAcceptance;
  delivery: 'pending' | 'completed' | 'failed' | 'unknown';
  taskRef?: string;
  output?: Record<string, unknown>;
  error?: string;
  retryable?: boolean;
}

export interface TracerExternalEffect {
  execute(request: TracerExternalRequest): Promise<TracerExternalOutcome>;
  reconcile(request: TracerExternalRequest): Promise<TracerExternalOutcome>;
  cancel?(request: TracerExternalRequest): Promise<{
    status?: 'cancelled' | 'pending';
    acceptance?: TracerAcceptance;
    taskRef?: string;
    output?: Record<string, unknown>;
    error?: string;
  }>;
}

export interface TracerJobRepository {
  submit(input: TracerJobInput): Promise<TracerJobRecord>;
  resumeFailed(input: ResumeFailedTracerJobInput): Promise<TracerJobRecord>;
  get(workspaceId: string, jobId: string): Promise<TracerJobRecord | null>;
  requestCancel(workspaceId: string, jobId: string): Promise<TracerJobRecord>;
  reserve(workspaceId: string, jobId: string): Promise<TracerReservation>;
  recordRejected(workspaceId: string, jobId: string, leaseToken: string, error: string): Promise<TracerJobRecord>;
  recordRejectedTerminal(
    workspaceId: string,
    jobId: string,
    leaseToken: string,
    error: string,
    output?: Record<string, unknown>,
    taskRef?: string,
  ): Promise<TracerJobRecord>;
  recordUnknown(
    workspaceId: string,
    jobId: string,
    leaseToken: string,
    error: string,
    taskRef?: string,
  ): Promise<TracerJobRecord>;
  recordAccepted(
    workspaceId: string,
    jobId: string,
    leaseToken: string,
    taskRef: string | undefined,
    delivery: TracerExternalOutcome['delivery'],
    error?: string
  ): Promise<TracerJobRecord>;
  complete(
    workspaceId: string,
    jobId: string,
    leaseToken: string,
    output: Record<string, unknown>,
    taskRef?: string
  ): Promise<TracerJobRecord>;
  fail(
    workspaceId: string,
    jobId: string,
    leaseToken: string,
    error: string,
    taskRef?: string
  ): Promise<TracerJobRecord>;
  recordCancelled(
    workspaceId: string,
    jobId: string,
    leaseToken: string,
    output?: Record<string, unknown>,
    taskRef?: string,
    acceptance?: TracerAcceptance,
  ): Promise<TracerJobRecord>;
  recordCancelledReconciliation(
    workspaceId: string,
    jobId: string,
    providerTaskRef: string,
    reconciliationKey: string,
    output: Record<string, unknown>,
  ): Promise<TracerJobRecord>;
}

export interface TransactionalJobPort extends JobPort {
  start?(): Promise<unknown>;
  enqueueInTransaction(input: DurableJobInput, client: PoolClient): Promise<void>;
  resumeInTransaction?(
    input: DurableJobInput,
    sequence: number,
    client: PoolClient,
  ): Promise<void>;
}

export class TracerJobApplicationService {
  constructor(private readonly repository: TracerJobRepository) {}

  submit(input: TracerJobInput) {
    validateDurableJobInput(input);
    return this.repository.submit(input);
  }

  resumeFailed(input: ResumeFailedTracerJobInput) {
    return this.repository.resumeFailed(input);
  }

  async get(workspaceId: string, jobId: string) {
    const record = await this.repository.get(workspaceId, jobId);
    if (!record) throw new JobRuntimeError('NOT_FOUND', 'Tracer job was not found.');
    return record;
  }

  find(workspaceId: string, jobId: string) {
    return this.repository.get(workspaceId, jobId);
  }

  cancel(workspaceId: string, jobId: string) {
    return this.repository.requestCancel(workspaceId, jobId);
  }

  recordCancelledReconciliation(
    workspaceId: string,
    jobId: string,
    providerTaskRef: string,
    reconciliationKey: string,
    output: Record<string, unknown>,
  ) {
    return this.repository.recordCancelledReconciliation(
      workspaceId,
      jobId,
      providerTaskRef,
      reconciliationKey,
      output,
    );
  }
}

/**
 * The handler deliberately exposes no transaction callback. Every repository
 * method is a short reserve/record/commit statement, so the provider effect is
 * invoked only after the database method has returned and released its lock.
 */
export class DurableTracerWorker {
  constructor(
    private readonly repository: TracerJobRepository,
    private readonly effect: TracerExternalEffect
  ) {}

  async handle(
    envelope: DurableJobEnvelope,
    _context?: JobRuntimeHandlerContext
  ): Promise<JobRuntimeHandlerResult> {
    const reservation = await this.repository.reserve(envelope.workspaceId, envelope.jobId);
    if (reservation.decision === 'completed') {
      return { status: 'completed', output: reservation.record.output ?? {} };
    }
    if (reservation.decision === 'failed') {
      return { status: 'dead_letter', output: { error: reservation.record.error ?? 'Tracer job failed.' } };
    }
    if (reservation.decision === 'cancelled') {
      return { status: 'completed', output: reservation.record.output ?? {} };
    }
    if (reservation.decision === 'in_progress') {
      return {
        status: 'deferred',
        deferForSeconds: secondsUntil(reservation.record.leaseExpiresAt),
        output: { lease: 'in_progress' },
      };
    }
    if (!reservation.leaseToken) {
      throw new JobRuntimeError('STALE_LEASE', 'Active tracer reservation is missing its lease token.');
    }
    const leaseToken = reservation.leaseToken;

    const request: TracerExternalRequest = {
      workspaceId: reservation.record.workspaceId,
      jobId: reservation.record.jobId,
      kind: reservation.record.kind,
      payload: structuredClone(reservation.record.payload),
      idempotencyKey: `${reservation.record.workspaceId}:${reservation.record.jobId}`,
      effectIdempotencyKey: reservation.record.effectIdempotencyKey,
      providerTaskRef: reservation.record.providerTaskRef ?? undefined,
      previousAcceptance: reservation.record.acceptance ?? undefined,
      previousAttemptCount: Math.max(0, reservation.record.attempts - 1),
    };

    if (reservation.decision === 'cancel') {
      let cancellation: Awaited<ReturnType<NonNullable<TracerExternalEffect['cancel']>>> = {};
      try {
        cancellation = this.effect.cancel
          ? await this.effect.cancel(request)
          : { taskRef: request.providerTaskRef };
      } catch (error) {
        await this.repository.recordUnknown(
          envelope.workspaceId,
          envelope.jobId,
          leaseToken,
          `Cancellation result is unknown: ${errorMessage(error)}`,
          request.providerTaskRef,
        );
        return {
          status: 'deferred',
          output: {
            cancellation: 'unknown',
            error: errorMessage(error),
            taskRef: request.providerTaskRef,
          },
        };
      }
      if (cancellation.status === 'pending') {
        await this.repository.recordAccepted(
          envelope.workspaceId,
          envelope.jobId,
          leaseToken,
          cancellation.taskRef ?? request.providerTaskRef,
          'pending',
          cancellation.error,
        );
        return {
          status: 'deferred',
          output: {
            cancellation: 'pending',
            taskRef: cancellation.taskRef ?? request.providerTaskRef,
          },
        };
      }
      const cancelled = await this.repository.recordCancelled(
        envelope.workspaceId,
        envelope.jobId,
        leaseToken,
        cancellation.output,
        cancellation.taskRef ?? request.providerTaskRef,
        cancellation.acceptance,
      );
      return { status: 'completed', output: cancelled.output ?? {} };
    }

    let outcome: TracerExternalOutcome;
    try {
      outcome =
        reservation.decision === 'execute'
          ? await this.effect.execute(request)
          : await this.effect.reconcile(request);
    } catch (error) {
      await this.repository.recordUnknown(
        envelope.workspaceId,
        envelope.jobId,
        leaseToken,
        `External result is unknown: ${errorMessage(error)}`,
        request.providerTaskRef,
      );
      return { status: 'deferred', output: { acceptance: 'acceptance_unknown' } };
    }

    if (outcome.acceptance === 'rejected_before_accept') {
      if (outcome.retryable === false) {
        const failed = await this.repository.recordRejectedTerminal(
          envelope.workspaceId,
          envelope.jobId,
          leaseToken,
          outcome.error ??
            'Provider explicitly rejected the request before accepting it.',
          outcome.output,
          outcome.taskRef,
        );
        return {
          status: 'dead_letter',
          output: { acceptance: failed.acceptance, error: failed.error },
        };
      }
      await this.repository.recordRejected(
        envelope.workspaceId,
        envelope.jobId,
        leaseToken,
        outcome.error ?? 'Provider explicitly rejected the request before accepting it.'
      );
      return { status: 'retry', output: { acceptance: outcome.acceptance } };
    }

    if (outcome.acceptance === 'acceptance_unknown') {
      await this.repository.recordUnknown(
        envelope.workspaceId,
        envelope.jobId,
        leaseToken,
        outcome.error ?? 'Provider acceptance is unknown; recovery must reconcile before another submit.',
        outcome.taskRef,
      );
      return { status: 'deferred', output: { acceptance: outcome.acceptance } };
    }

    if (outcome.delivery === 'completed') {
      if (!outcome.output) {
        await this.repository.recordUnknown(
          envelope.workspaceId,
          envelope.jobId,
          leaseToken,
          'Provider reported completion without a visible result.'
        );
        return { status: 'deferred', output: { acceptance: outcome.acceptance, delivery: 'unknown' } };
      }
      const completed = await this.repository.complete(
        envelope.workspaceId,
        envelope.jobId,
        leaseToken,
        outcome.output,
        outcome.taskRef
      );
      return { status: 'completed', output: completed.output ?? {} };
    }

    if (outcome.delivery === 'failed') {
      const failed = await this.repository.fail(
        envelope.workspaceId,
        envelope.jobId,
        leaseToken,
        outcome.error ?? 'Provider accepted the request but delivery failed.',
        outcome.taskRef
      );
      return { status: 'dead_letter', output: { error: failed.error ?? 'Provider delivery failed.' } };
    }

    await this.repository.recordAccepted(
      envelope.workspaceId,
      envelope.jobId,
      leaseToken,
      outcome.taskRef,
      outcome.delivery,
      outcome.error
    );

    return {
      status: 'deferred',
      output: { acceptance: outcome.acceptance, delivery: outcome.delivery, taskRef: outcome.taskRef },
    };
  }
}

export class MemoryTracerJobRepository implements TracerJobRepository {
  private readonly records = new Map<string, TracerJobRecord>();
  private readonly leases = new Map<
    string,
    { token: string; startedAt: string; expiresAt: string }
  >();
  private readonly leaseDurationMs: number;
  private mutationTail: Promise<void> = Promise.resolve();
  mutationActive = false;

  constructor(
    private readonly queue: JobPort,
    private readonly clock: () => Date = () => new Date(),
    options: { leaseDurationMs?: number } = {},
  ) {
    this.leaseDurationMs = positiveDuration(
      options.leaseDurationMs ?? DEFAULT_TRACER_LEASE_DURATION_MS,
      'leaseDurationMs',
    );
  }

  async submit(input: TracerJobInput) {
    return this.mutate(async () => {
      validateDurableJobInput(input);
      const key = recordKey(input.workspaceId, input.jobId);
      const hash = payloadHash(input);
      const existing = this.records.get(key);
      if (existing) {
        assertPayloadHash(existing.payloadHash, hash);
        await this.queue.enqueue(toDurableInput(input));
        return cloneRecord(existing);
      }
      const now = this.clock().toISOString();
      const record: TracerJobRecord = {
        ...structuredClone(input),
        status: 'queued',
        acceptance: null,
        effectIdempotencyKey: providerEffectKey(input.workspaceId, input.jobId),
        leaseExpiresAt: null,
        providerTaskRef: null,
        output: null,
        error: null,
        attempts: 0,
        activeExecutionMs: 0,
        payloadHash: hash,
        createdAt: now,
        updatedAt: now,
      };
      this.records.set(key, record);
      await this.queue.enqueue(toDurableInput(input));
      return cloneRecord(record);
    });
  }

  async resumeFailed(input: ResumeFailedTracerJobInput) {
    return this.mutate(async () => {
      const key = recordKey(input.workspaceId, input.jobId);
      const record = this.requireRecord(input.workspaceId, input.jobId);
      assertPayloadHash(record.payloadHash, input.expectedPayloadHash);
      assertFailedResumeTarget(record);
      if (!this.queue.resume) {
        throw new JobRuntimeError(
          'RUNTIME_NOT_STARTED',
          'The configured job transport cannot enqueue a failed-job resume.',
        );
      }
      const resumedInput: TracerJobInput = {
        workspaceId: record.workspaceId,
        jobId: record.jobId,
        kind: record.kind,
        runAt: record.runAt,
        payload: structuredClone(input.payload),
      };
      validateDurableJobInput(resumedInput);
      const previous = cloneRecord(record);
      record.payload = resumedInput.payload;
      record.payloadHash = payloadHash(resumedInput);
      record.status = 'queued';
      record.acceptance = null;
      record.providerTaskRef = null;
      record.output = null;
      record.error = null;
      record.leaseExpiresAt = null;
      record.updatedAt = this.clock().toISOString();
      this.leases.delete(key);
      try {
        await this.queue.resume(
          toDurableInput(resumedInput),
          failedResumeSequence(record),
        );
      } catch (error) {
        this.records.set(key, previous);
        throw error;
      }
      return cloneRecord(record);
    });
  }

  async get(workspaceId: string, jobId: string) {
    const record = this.records.get(recordKey(workspaceId, jobId));
    return record ? cloneRecord(record) : null;
  }

  requestCancel(workspaceId: string, jobId: string) {
    return this.mutate(async () => {
      const record = this.requireRecord(workspaceId, jobId);
      if (record.status === 'cancelled') return cloneRecord(record);
      if (record.status === 'completed' || record.status === 'failed') {
        throw new JobRuntimeError('INVALID_JOB', 'A terminal tracer job cannot be cancelled.');
      }
      record.status = 'cancel_requested';
      record.updatedAt = this.clock().toISOString();
      return cloneRecord(record);
    });
  }

  reserve(workspaceId: string, jobId: string) {
    return this.mutate(async () => {
      const record = this.requireRecord(workspaceId, jobId);
      if (record.status === 'completed') {
        return { decision: 'completed', record: cloneRecord(record), leaseToken: null } as const;
      }
      if (record.status === 'failed') {
        return { decision: 'failed', record: cloneRecord(record), leaseToken: null } as const;
      }
      if (record.status === 'cancelled') {
        return { decision: 'cancelled', record: cloneRecord(record), leaseToken: null } as const;
      }
      const key = recordKey(workspaceId, jobId);
      const activeLease = this.leases.get(key);
      const now = this.clock();
      if (
        activeLease &&
        Date.parse(activeLease.expiresAt) > now.getTime()
      ) {
        return {
          decision: 'in_progress',
          record: cloneRecord(record),
          leaseToken: null,
        } as const;
      }
      if (activeLease) {
        record.activeExecutionMs += elapsedMilliseconds(
          activeLease.startedAt,
          new Date(
            Math.min(now.getTime(), Date.parse(activeLease.expiresAt)),
          ),
        );
      }
      const decision =
        record.status === 'queued'
          ? 'execute'
          : record.status === 'cancel_requested'
            ? 'cancel'
            : 'reconcile';
      const leaseToken = randomUUID();
      const leaseExpiresAt = new Date(
        now.getTime() + this.leaseDurationMs,
      ).toISOString();
      this.leases.set(key, {
        token: leaseToken,
        startedAt: now.toISOString(),
        expiresAt: leaseExpiresAt,
      });
      record.leaseExpiresAt = leaseExpiresAt;
      record.status = decision === 'execute' ? 'running' : record.status;
      record.attempts += 1;
      record.updatedAt = now.toISOString();
      return { decision, record: cloneRecord(record), leaseToken } as TracerReservation;
    });
  }

  recordRejected(workspaceId: string, jobId: string, leaseToken: string, error: string) {
    return this.update(workspaceId, jobId, leaseToken, (record) => {
      if (record.status !== 'cancel_requested') record.status = 'queued';
      record.acceptance = 'rejected_before_accept';
      record.error = error;
    });
  }

  recordRejectedTerminal(
    workspaceId: string,
    jobId: string,
    leaseToken: string,
    error: string,
    output?: Record<string, unknown>,
    taskRef?: string,
  ) {
    return this.update(workspaceId, jobId, leaseToken, (record) => {
      record.status = 'failed';
      record.acceptance = 'rejected_before_accept';
      record.providerTaskRef = taskRef ?? record.providerTaskRef;
      record.output = output ? structuredClone(output) : record.output;
      record.error = error;
    });
  }

  recordUnknown(
    workspaceId: string,
    jobId: string,
    leaseToken: string,
    error: string,
    taskRef?: string,
  ) {
    return this.update(workspaceId, jobId, leaseToken, (record) => {
      if (record.status !== 'cancel_requested') record.status = 'unknown';
      record.acceptance = 'acceptance_unknown';
      record.providerTaskRef = taskRef ?? record.providerTaskRef;
      record.error = error;
    });
  }

  recordAccepted(
    workspaceId: string,
    jobId: string,
    leaseToken: string,
    taskRef: string | undefined,
    delivery: TracerExternalOutcome['delivery'],
    error?: string
  ) {
    return this.update(workspaceId, jobId, leaseToken, (record) => {
      if (record.status !== 'cancel_requested') {
        record.status = delivery === 'unknown' ? 'unknown' : 'running';
      }
      record.acceptance = 'accepted';
      record.providerTaskRef = taskRef ?? record.providerTaskRef;
      record.error = error ?? null;
    });
  }

  complete(
    workspaceId: string,
    jobId: string,
    leaseToken: string,
    output: Record<string, unknown>,
    taskRef?: string
  ) {
    return this.update(workspaceId, jobId, leaseToken, (record) => {
      record.status = 'completed';
      record.acceptance = 'accepted';
      record.providerTaskRef = taskRef ?? record.providerTaskRef;
      record.output = structuredClone(output);
      record.error = null;
    });
  }

  fail(workspaceId: string, jobId: string, leaseToken: string, error: string, taskRef?: string) {
    return this.update(workspaceId, jobId, leaseToken, (record) => {
      record.status = 'failed';
      record.acceptance = 'accepted';
      record.providerTaskRef = taskRef ?? record.providerTaskRef;
      record.error = error;
    });
  }

  recordCancelled(
    workspaceId: string,
    jobId: string,
    leaseToken: string,
    output?: Record<string, unknown>,
    taskRef?: string,
    acceptance?: TracerAcceptance,
  ) {
    return this.update(workspaceId, jobId, leaseToken, (record) => {
      if (record.status !== 'cancel_requested') {
        throw new JobRuntimeError('STALE_LEASE', 'Tracer cancellation is no longer current.');
      }
      record.status = 'cancelled';
      record.acceptance = acceptance ?? record.acceptance;
      record.providerTaskRef = taskRef ?? record.providerTaskRef;
      record.output = output ? structuredClone(output) : record.output;
      record.error = null;
    });
  }

  recordCancelledReconciliation(
    workspaceId: string,
    jobId: string,
    providerTaskRef: string,
    reconciliationKey: string,
    output: Record<string, unknown>,
  ) {
    return this.mutate(async () => {
      const record = this.requireRecord(workspaceId, jobId);
      assertCancelledReconciliationTarget(
        record,
        providerTaskRef,
        reconciliationKey,
      );
      if (cancelledReconciliationKey(record.output) === reconciliationKey) {
        return cloneRecord(record);
      }
      record.output = {
        ...(record.output ? structuredClone(record.output) : {}),
        ...structuredClone(output),
      };
      record.updatedAt = this.clock().toISOString();
      return cloneRecord(record);
    });
  }

  private async update(
    workspaceId: string,
    jobId: string,
    leaseToken: string,
    updater: (record: TracerJobRecord) => void
  ) {
    return this.mutate(async () => {
      const record = this.requireRecord(workspaceId, jobId);
      const key = recordKey(workspaceId, jobId);
      if (
        this.leases.get(key)?.token !== leaseToken ||
        record.status === 'completed' ||
        record.status === 'failed' ||
        record.status === 'cancelled'
      ) {
        throw new JobRuntimeError('STALE_LEASE', 'Tracer result belongs to a stale worker lease.');
      }
      updater(record);
      const now = this.clock();
      const lease = this.leases.get(key);
      record.activeExecutionMs += lease
        ? elapsedMilliseconds(lease.startedAt, now)
        : 0;
      record.updatedAt = now.toISOString();
      record.leaseExpiresAt = null;
      this.leases.delete(key);
      return cloneRecord(record);
    });
  }

  private requireRecord(workspaceId: string, jobId: string) {
    const record = this.records.get(recordKey(workspaceId, jobId));
    if (!record) throw new JobRuntimeError('NOT_FOUND', 'Tracer job was not found.');
    return record;
  }

  private async mutate<T>(action: () => Promise<T>) {
    const previous = this.mutationTail;
    let release!: () => void;
    this.mutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    this.mutationActive = true;
    try {
      return await action();
    } finally {
      this.mutationActive = false;
      release();
    }
  }
}

export interface PostgresTracerRepositoryOptions {
  schema?: string;
  table?: string;
  clock?: () => Date;
  leaseDurationMs?: number;
}

export class PostgresTracerJobRepository implements TracerJobRepository {
  private readonly schema: string;
  private readonly table: string;
  private readonly clock: () => Date;
  private readonly leaseDurationMs: number;
  private migration?: Promise<void>;

  constructor(
    private readonly pool: Pick<Pool, 'connect' | 'query'>,
    private readonly queue: TransactionalJobPort,
    options: PostgresTracerRepositoryOptions = {}
  ) {
    this.schema = validateIdentifier(options.schema ?? 'public', 'schema');
    this.table = validateIdentifier(options.table ?? 'p1_job_tracer', 'table');
    this.clock = options.clock ?? (() => new Date());
    this.leaseDurationMs = positiveDuration(
      options.leaseDurationMs ?? DEFAULT_TRACER_LEASE_DURATION_MS,
      'leaseDurationMs',
    );
  }

  async migrate(client?: PoolClient) {
    if (!this.migration) {
      this.migration = (client ?? this.pool)
        .query(
          `CREATE TABLE IF NOT EXISTS ${this.qualifiedTable} (
             workspace_id text NOT NULL,
             job_id text NOT NULL,
             kind text NOT NULL,
             run_at timestamptz,
             payload jsonb NOT NULL,
             payload_hash text NOT NULL,
             status text NOT NULL CHECK (status IN ('queued', 'running', 'unknown', 'cancel_requested', 'cancelled', 'completed', 'failed')),
             acceptance text CHECK (acceptance IS NULL OR acceptance IN ('rejected_before_accept', 'accepted', 'acceptance_unknown')),
             provider_task_ref text,
             output jsonb,
             error text,
             attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
             active_execution_ms bigint NOT NULL DEFAULT 0 CHECK (active_execution_ms >= 0),
             lease_token text,
             lease_started_at timestamptz,
             lease_expires_at timestamptz,
             effect_idempotency_key text NOT NULL,
             created_at timestamptz NOT NULL,
             updated_at timestamptz NOT NULL,
             PRIMARY KEY (workspace_id, job_id)
           );
           ALTER TABLE ${this.qualifiedTable} ADD COLUMN IF NOT EXISTS lease_token text;
           ALTER TABLE ${this.qualifiedTable} ADD COLUMN IF NOT EXISTS lease_started_at timestamptz;
           ALTER TABLE ${this.qualifiedTable} ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
           ALTER TABLE ${this.qualifiedTable} ADD COLUMN IF NOT EXISTS active_execution_ms bigint NOT NULL DEFAULT 0;
           ALTER TABLE ${this.qualifiedTable} ADD COLUMN IF NOT EXISTS effect_idempotency_key text;
           UPDATE ${this.qualifiedTable}
              SET effect_idempotency_key = 'provider-effect:v1:' || length(workspace_id)::text || ':' || workspace_id || ':' || job_id
            WHERE effect_idempotency_key IS NULL;
           ALTER TABLE ${this.qualifiedTable} ALTER COLUMN effect_idempotency_key SET NOT NULL;
           ALTER TABLE ${this.qualifiedTable}
             DROP CONSTRAINT IF EXISTS ${this.quotedConstraint('status_check')};
           ALTER TABLE ${this.qualifiedTable}
             ADD CONSTRAINT ${this.quotedConstraint('status_check')}
             CHECK (status IN ('queued', 'running', 'unknown', 'cancel_requested', 'cancelled', 'completed', 'failed'));
           CREATE INDEX IF NOT EXISTS ${this.quotedIndex('status_run_at_idx')}
             ON ${this.qualifiedTable} (status, run_at, updated_at);`
        )
        .then(() => undefined)
        .catch((error) => {
          this.migration = undefined;
          throw error;
        });
    }
    await this.migration;
  }

  async submit(input: TracerJobInput) {
    validateDurableJobInput(input);
    await this.migrate();
    await this.queue.start?.();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await this.select(client, input.workspaceId, input.jobId, true);
      const hash = payloadHash(input);
      if (existing) {
        assertPayloadHash(existing.payloadHash, hash);
      } else {
        const now = this.clock();
        await client.query(
          `INSERT INTO ${this.qualifiedTable} (
             workspace_id, job_id, kind, run_at, payload, payload_hash, status,
             acceptance, provider_task_ref, output, error, attempts,
             effect_idempotency_key, lease_expires_at, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'queued', NULL, NULL, NULL, NULL, 0, $7, NULL, $8, $8)`,
          [
            input.workspaceId,
            input.jobId,
            input.kind,
            input.runAt ? new Date(input.runAt) : null,
            JSON.stringify(input.payload),
            hash,
            providerEffectKey(input.workspaceId, input.jobId),
            now,
          ]
        );
      }
      await this.queue.enqueueInTransaction(toDurableInput(input), client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return this.require(input.workspaceId, input.jobId);
  }

  async resumeFailed(input: ResumeFailedTracerJobInput) {
    await this.migrate();
    await this.queue.start?.();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const record = await this.select(
        client,
        input.workspaceId,
        input.jobId,
        true,
      );
      if (!record) {
        throw new JobRuntimeError('NOT_FOUND', 'Tracer job was not found.');
      }
      assertPayloadHash(record.payloadHash, input.expectedPayloadHash);
      assertFailedResumeTarget(record);
      if (!this.queue.resumeInTransaction) {
        throw new JobRuntimeError(
          'RUNTIME_NOT_STARTED',
          'The configured job transport cannot resume inside the tracer transaction.',
        );
      }
      const resumedInput: TracerJobInput = {
        workspaceId: record.workspaceId,
        jobId: record.jobId,
        kind: record.kind,
        runAt: record.runAt,
        payload: structuredClone(input.payload),
      };
      validateDurableJobInput(resumedInput);
      const result = await client.query<TracerRow>(
        `UPDATE ${this.qualifiedTable}
         SET payload = $3::jsonb,
             payload_hash = $4,
             status = 'queued',
             acceptance = NULL,
             provider_task_ref = NULL,
             output = NULL,
             error = NULL,
             lease_token = NULL,
             lease_started_at = NULL,
             lease_expires_at = NULL,
             updated_at = $5
         WHERE workspace_id = $1 AND job_id = $2
           AND status = 'failed'
           AND payload_hash = $6
           AND provider_task_ref IS NULL
         RETURNING *`,
        [
          input.workspaceId,
          input.jobId,
          JSON.stringify(resumedInput.payload),
          payloadHash(resumedInput),
          this.clock(),
          input.expectedPayloadHash,
        ],
      );
      if (!result.rows[0]) {
        throw new JobRuntimeError(
          'IDEMPOTENCY_CONFLICT',
          'Failed tracer resume no longer matches its expected terminal state.',
        );
      }
      await this.queue.resumeInTransaction(
        toDurableInput(resumedInput),
        failedResumeSequence(record),
        client,
      );
      await client.query('COMMIT');
      return mapRow(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async get(workspaceId: string, jobId: string) {
    await this.migrate();
    const result = await this.pool.query<TracerRow>(
      `SELECT * FROM ${this.qualifiedTable} WHERE workspace_id = $1 AND job_id = $2`,
      [workspaceId, jobId]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async requestCancel(workspaceId: string, jobId: string) {
    await this.migrate();
    const result = await this.pool.query<TracerRow>(
      `UPDATE ${this.qualifiedTable}
       SET status = 'cancel_requested', updated_at = $3
       WHERE workspace_id = $1 AND job_id = $2
         AND status NOT IN ('completed', 'failed', 'cancelled')
       RETURNING *`,
      [workspaceId, jobId, this.clock()],
    );
    if (result.rows[0]) return mapRow(result.rows[0]);
    const current = await this.get(workspaceId, jobId);
    if (!current) throw new JobRuntimeError('NOT_FOUND', 'Tracer job was not found.');
    if (current.status === 'cancelled') return current;
    throw new JobRuntimeError('INVALID_JOB', 'A terminal tracer job cannot be cancelled.');
  }

  async reserve(workspaceId: string, jobId: string) {
    await this.migrate();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const record = await this.select(client, workspaceId, jobId, true);
      if (!record) throw new JobRuntimeError('NOT_FOUND', 'Tracer job was not found.');
      if (
        record.status === 'completed' ||
        record.status === 'failed' ||
        record.status === 'cancelled'
      ) {
        await client.query('COMMIT');
        return { decision: record.status, record, leaseToken: null } as TracerReservation;
      }
      const now = this.clock();
      if (
        record.leaseExpiresAt &&
        Date.parse(record.leaseExpiresAt) > now.getTime()
      ) {
        await client.query('COMMIT');
        return {
          decision: 'in_progress',
          record,
          leaseToken: null,
        } as TracerReservation;
      }
      const decision =
        record.status === 'queued'
          ? 'execute'
          : record.status === 'cancel_requested'
            ? 'cancel'
            : 'reconcile';
      const leaseToken = randomUUID();
      const leaseExpiresAt = new Date(
        now.getTime() + this.leaseDurationMs,
      );
      const result = await client.query<TracerRow>(
        `UPDATE ${this.qualifiedTable}
         SET status = CASE WHEN $3 = 'execute' THEN 'running' ELSE status END,
             attempts = attempts + 1,
             active_execution_ms = active_execution_ms + CASE
               WHEN lease_started_at IS NOT NULL
                 AND lease_expires_at IS NOT NULL
                 AND lease_expires_at <= $4
               THEN GREATEST(
                 0,
                 FLOOR(
                   EXTRACT(
                     EPOCH FROM (
                       LEAST($4::timestamptz, lease_expires_at) -
                       lease_started_at
                     )
                   ) * 1000
                 )
               )::bigint
               ELSE 0
             END,
             updated_at = $4,
             lease_token = $5,
             lease_started_at = $4,
             lease_expires_at = $6
         WHERE workspace_id = $1 AND job_id = $2
         RETURNING *`,
        [workspaceId, jobId, decision, now, leaseToken, leaseExpiresAt]
      );
      await client.query('COMMIT');
      return { decision, record: mapRow(result.rows[0]!), leaseToken } as TracerReservation;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  recordRejected(workspaceId: string, jobId: string, leaseToken: string, error: string) {
    return this.update(workspaceId, jobId, {
      status: 'queued',
      acceptance: 'rejected_before_accept',
      error,
      leaseToken,
    });
  }

  recordRejectedTerminal(
    workspaceId: string,
    jobId: string,
    leaseToken: string,
    error: string,
    output?: Record<string, unknown>,
    taskRef?: string,
  ) {
    return this.update(workspaceId, jobId, {
      status: 'failed',
      acceptance: 'rejected_before_accept',
      providerTaskRef: taskRef,
      output,
      error,
      leaseToken,
    });
  }

  recordUnknown(
    workspaceId: string,
    jobId: string,
    leaseToken: string,
    error: string,
    taskRef?: string,
  ) {
    return this.update(workspaceId, jobId, {
      status: 'unknown',
      acceptance: 'acceptance_unknown',
      providerTaskRef: taskRef,
      error,
      leaseToken,
    });
  }

  recordAccepted(
    workspaceId: string,
    jobId: string,
    leaseToken: string,
    taskRef: string | undefined,
    delivery: TracerExternalOutcome['delivery'],
    error?: string
  ) {
    return this.update(workspaceId, jobId, {
      status: delivery === 'unknown' ? 'unknown' : 'running',
      acceptance: 'accepted',
      providerTaskRef: taskRef,
      error: error ?? null,
      leaseToken,
    });
  }

  complete(
    workspaceId: string,
    jobId: string,
    leaseToken: string,
    output: Record<string, unknown>,
    taskRef?: string
  ) {
    return this.update(workspaceId, jobId, {
      status: 'completed',
      acceptance: 'accepted',
      providerTaskRef: taskRef,
      output,
      error: null,
      leaseToken,
    });
  }

  fail(workspaceId: string, jobId: string, leaseToken: string, error: string, taskRef?: string) {
    return this.update(workspaceId, jobId, {
      status: 'failed',
      acceptance: 'accepted',
      providerTaskRef: taskRef,
      error,
      leaseToken,
    });
  }

  recordCancelled(
    workspaceId: string,
    jobId: string,
    leaseToken: string,
    output?: Record<string, unknown>,
    taskRef?: string,
    acceptance?: TracerAcceptance,
  ) {
    return this.update(workspaceId, jobId, {
      status: 'cancelled',
      acceptance,
      providerTaskRef: taskRef,
      output,
      error: null,
      leaseToken,
      requiredCurrentStatus: 'cancel_requested',
    });
  }

  async recordCancelledReconciliation(
    workspaceId: string,
    jobId: string,
    providerTaskRef: string,
    reconciliationKey: string,
    output: Record<string, unknown>,
  ) {
    await this.migrate();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const record = await this.select(client, workspaceId, jobId, true);
      if (!record) {
        throw new JobRuntimeError('NOT_FOUND', 'Tracer job was not found.');
      }
      assertCancelledReconciliationTarget(
        record,
        providerTaskRef,
        reconciliationKey,
      );
      if (cancelledReconciliationKey(record.output) === reconciliationKey) {
        await client.query('COMMIT');
        return record;
      }
      const mergedOutput = {
        ...(record.output ? structuredClone(record.output) : {}),
        ...structuredClone(output),
      };
      const updated = await client.query<TracerRow>(
        `UPDATE ${this.qualifiedTable}
         SET output = $3::jsonb, updated_at = $4
         WHERE workspace_id = $1 AND job_id = $2 AND status = 'cancelled'
         RETURNING *`,
        [workspaceId, jobId, JSON.stringify(mergedOutput), this.clock()],
      );
      if (!updated.rows[0]) {
        throw new JobRuntimeError(
          'STALE_LEASE',
          'Cancelled tracer reconciliation is no longer current.',
        );
      }
      await client.query('COMMIT');
      return mapRow(updated.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async update(
    workspaceId: string,
    jobId: string,
    patch: {
      status: TracerJobStatus;
      acceptance?: TracerAcceptance;
      providerTaskRef?: string;
      output?: Record<string, unknown>;
      error?: string | null;
      leaseToken: string;
      requiredCurrentStatus?: TracerJobStatus;
    }
  ) {
    await this.migrate();
    const now = this.clock();
    const result = await this.pool.query<TracerRow>(
      `UPDATE ${this.qualifiedTable}
       SET status = CASE
             WHEN status = 'cancel_requested'
               AND $3 IN ('queued', 'running', 'unknown')
             THEN status
             ELSE $3
           END,
           acceptance = COALESCE($4, acceptance),
           provider_task_ref = COALESCE($5, provider_task_ref),
           output = COALESCE($6::jsonb, output),
           error = $7,
           updated_at = $8,
           active_execution_ms = active_execution_ms + COALESCE(
             GREATEST(
               0,
               FLOOR(EXTRACT(EPOCH FROM ($8 - lease_started_at)) * 1000)
             )::bigint,
             0
           ),
           lease_token = NULL,
           lease_started_at = NULL,
           lease_expires_at = NULL
       WHERE workspace_id = $1 AND job_id = $2
         AND lease_token = $9
         AND status NOT IN ('completed', 'failed', 'cancelled')
         AND ($10::text IS NULL OR status = $10)
       RETURNING *`,
      [
        workspaceId,
        jobId,
        patch.status,
        patch.acceptance,
        patch.providerTaskRef ?? null,
        patch.output ? JSON.stringify(patch.output) : null,
        patch.error ?? null,
        now,
        patch.leaseToken,
        patch.requiredCurrentStatus ?? null,
      ]
    );
    if (!result.rows[0]) {
      throw new JobRuntimeError('STALE_LEASE', 'Tracer result belongs to a stale worker lease.');
    }
    return mapRow(result.rows[0]);
  }

  private async require(workspaceId: string, jobId: string) {
    const record = await this.get(workspaceId, jobId);
    if (!record) throw new JobRuntimeError('NOT_FOUND', 'Tracer job was not found.');
    return record;
  }

  private async select(client: PoolClient, workspaceId: string, jobId: string, forUpdate: boolean) {
    const result = await client.query<TracerRow>(
      `SELECT * FROM ${this.qualifiedTable}
       WHERE workspace_id = $1 AND job_id = $2${forUpdate ? ' FOR UPDATE' : ''}`,
      [workspaceId, jobId]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  private get qualifiedTable() {
    return `"${this.schema}"."${this.table}"`;
  }

  private quotedIndex(suffix: string) {
    // PostgreSQL places an unqualified index in the table's schema and rejects
    // a schema-qualified name in CREATE INDEX.
    return `"${this.table}_${suffix}"`;
  }


  private quotedConstraint(suffix: string) {
    return `"${this.table}_${suffix}"`;
  }
}

interface TracerRow extends QueryResultRow {
  workspace_id: string;
  job_id: string;
  kind: string;
  run_at: Date | null;
  payload: Record<string, unknown>;
  payload_hash: string;
  status: TracerJobStatus;
  acceptance: TracerAcceptance | null;
  effect_idempotency_key: string;
  active_execution_ms: string | number;
  lease_expires_at: Date | null;
  provider_task_ref: string | null;
  output: Record<string, unknown> | null;
  error: string | null;
  attempts: number;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: TracerRow): TracerJobRecord {
  return {
    workspaceId: row.workspace_id,
    jobId: row.job_id,
    kind: row.kind,
    runAt: row.run_at?.toISOString(),
    payload: structuredClone(row.payload),
    payloadHash: row.payload_hash,
    status: row.status,
    acceptance: row.acceptance,
    effectIdempotencyKey: row.effect_idempotency_key,
    leaseExpiresAt: row.lease_expires_at?.toISOString() ?? null,
    providerTaskRef: row.provider_task_ref,
    output: row.output ? structuredClone(row.output) : null,
    error: row.error,
    attempts: Number(row.attempts),
    activeExecutionMs: Number(row.active_execution_ms),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toDurableInput(input: TracerJobInput): DurableJobInput {
  return {
    workspaceId: input.workspaceId,
    jobId: input.jobId,
    kind: input.kind,
    runAt: input.runAt,
    payload: structuredClone(input.payload),
  };
}

function payloadHash(input: TracerJobInput) {
  return fingerprintValue({
    workspaceId: input.workspaceId,
    jobId: input.jobId,
    kind: input.kind,
    runAt: input.runAt ? new Date(input.runAt).toISOString() : undefined,
    payload: input.payload,
  });
}

function assertPayloadHash(existing: string, requested: string) {
  if (existing !== requested) {
    throw new JobRuntimeError('IDEMPOTENCY_CONFLICT', 'Tracer job id was reused with a different payload.');
  }
}

function assertFailedResumeTarget(record: TracerJobRecord) {
  if (record.status !== 'failed') {
    throw new JobRuntimeError(
      'INVALID_JOB',
      'Only a failed tracer job can be resumed.',
    );
  }
  if (record.providerTaskRef) {
    throw new JobRuntimeError(
      'INVALID_JOB',
      'A failed tracer job with an active provider task cannot be resumed.',
    );
  }
}

function failedResumeSequence(record: TracerJobRecord) {
  if (!Number.isInteger(record.attempts) || record.attempts < 1) {
    throw new JobRuntimeError(
      'INVALID_JOB',
      'A failed tracer job must record an attempt before it can resume.',
    );
  }
  return record.attempts;
}

function cancelledReconciliationKey(
  output: Record<string, unknown> | null,
) {
  const terminal = output?.cancelledProviderTerminal;
  if (!terminal || typeof terminal !== 'object' || Array.isArray(terminal)) {
    return undefined;
  }
  const key = Reflect.get(terminal, 'reconciliationKey');
  return typeof key === 'string' ? key : undefined;
}

function assertCancelledReconciliationTarget(
  record: TracerJobRecord,
  providerTaskRef: string,
  reconciliationKey: string,
) {
  if (record.status !== 'cancelled') {
    throw new JobRuntimeError(
      'INVALID_JOB',
      'Late provider terminal reconciliation requires a cancelled tracer job.',
    );
  }
  if (!record.providerTaskRef || record.providerTaskRef !== providerTaskRef) {
    throw new JobRuntimeError(
      'INVALID_JOB',
      'Late provider terminal task reference does not match the cancelled job.',
    );
  }
  const existingKey = cancelledReconciliationKey(record.output);
  if (existingKey && existingKey !== reconciliationKey) {
    throw new JobRuntimeError(
      'IDEMPOTENCY_CONFLICT',
      'Cancelled tracer already records a different provider terminal fact.',
    );
  }
}

function recordKey(workspaceId: string, jobId: string) {
  return `${workspaceId}\u0000${jobId}`;
}

const DEFAULT_TRACER_LEASE_DURATION_MS = 15 * 60 * 1_000;

function providerEffectKey(workspaceId: string, jobId: string) {
  return `provider-effect:v1:${workspaceId.length}:${workspaceId}:${jobId}`;
}

function positiveDuration(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new JobRuntimeError('INVALID_JOB', `${label} must be positive.`);
  }
  return value;
}

function elapsedMilliseconds(startedAt: string, endedAt: Date) {
  return Math.max(0, endedAt.getTime() - Date.parse(startedAt));
}

function secondsUntil(value: string | null) {
  if (!value) return 1;
  return Math.max(1, Math.ceil((Date.parse(value) - Date.now()) / 1_000));
}

function cloneRecord(record: TracerJobRecord) {
  return structuredClone(record);
}

function validateIdentifier(value: string, label: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new JobRuntimeError('INVALID_JOB', `${label} must be a PostgreSQL identifier.`);
  }
  return value;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
