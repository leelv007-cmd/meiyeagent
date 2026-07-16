import { createHash } from 'node:crypto';

export interface DurableJobInput {
  jobId: string;
  workspaceId: string;
  kind: string;
  runAt?: string;
  payload: Record<string, unknown>;
  scheduling?: JobSchedulingPolicy;
}

export interface JobSchedulingPolicy {
  queuePriority: number;
  workspaceConcurrencyLimit: number;
}

export interface RecurringJobInput extends Omit<DurableJobInput, 'jobId' | 'runAt'> {
  scheduleId: string;
  cron: string;
  timezone?: string;
}

export interface DurableJobEnvelope extends DurableJobInput {
  fingerprint: string;
  enqueuedAt: string;
  sequence?: number;
}

export type DurableJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'dead_letter';

export interface DurableJobInspection {
  transportId: string;
  jobId: string;
  workspaceId: string;
  kind: string;
  runAt: string;
  status: DurableJobStatus;
  attempt: number;
  recovered: boolean;
  payload: Record<string, unknown>;
}

export interface JobRuntimeHandlerContext {
  transportId: string;
  attempt: number;
  recovered: boolean;
  claimedAt: string;
  renewLease(): Promise<void>;
}

export interface JobRuntimeHandlerResult {
  status: 'completed' | 'retry' | 'deferred' | 'dead_letter';
  deferForSeconds?: number;
  output?: Record<string, unknown>;
}

export type JobRuntimeHandler = (
  envelope: DurableJobEnvelope,
  context: JobRuntimeHandlerContext
) => Promise<JobRuntimeHandlerResult>;

export interface QueueRuntimeMetrics {
  queueDepth: number;
  deferredCount: number;
  activeCount: number;
  failedCount: number;
  deadLetterDepth: number;
  oldestRunnableAgeMs: number | null;
  averageClaimLatencyMs: number | null;
  maxClaimLatencyMs: number | null;
  leaseExpiryCount: number;
  nextLeaseExpiryAt: string | null;
  attemptCount: number;
  recoveryCount: number | null;
  capturedAt: string;
}

export class JobRuntimeError extends Error {
  constructor(
    readonly code:
      | 'IDEMPOTENCY_CONFLICT'
      | 'NOT_FOUND'
      | 'INVALID_JOB'
      | 'RUNTIME_NOT_STARTED'
      | 'STALE_LEASE',
    message: string
  ) {
    super(message);
    this.name = 'JobRuntimeError';
  }
}

export function validateDurableJobInput(
  input: Pick<
    DurableJobInput,
    'jobId' | 'workspaceId' | 'kind' | 'runAt' | 'payload' | 'scheduling'
  >
) {
  if (!input.jobId.trim() || !input.workspaceId.trim() || !input.kind.trim()) {
    throw new JobRuntimeError('INVALID_JOB', 'jobId, workspaceId, and kind are required.');
  }
  if (!isPlainObject(input.payload)) {
    throw new JobRuntimeError('INVALID_JOB', 'Job payload must be a plain JSON object.');
  }
  if (input.runAt && Number.isNaN(new Date(input.runAt).getTime())) {
    throw new JobRuntimeError('INVALID_JOB', 'runAt must be an ISO date.');
  }
  if (
    input.scheduling &&
    (!Number.isInteger(input.scheduling.queuePriority) ||
      input.scheduling.queuePriority < 0 ||
      !Number.isInteger(input.scheduling.workspaceConcurrencyLimit) ||
      input.scheduling.workspaceConcurrencyLimit < 1)
  ) {
    throw new JobRuntimeError(
      'INVALID_JOB',
      'Job scheduling priority and workspace concurrency must be valid integers.'
    );
  }
  try {
    JSON.stringify(input.payload);
  } catch {
    throw new JobRuntimeError('INVALID_JOB', 'Job payload must be JSON serializable.');
  }
}

export function makeDurableJobEnvelope(input: DurableJobInput, enqueuedAt: Date): DurableJobEnvelope {
  validateDurableJobInput(input);
  const normalized: DurableJobInput = {
    jobId: input.jobId,
    workspaceId: input.workspaceId,
    kind: input.kind,
    runAt: input.runAt ? new Date(input.runAt).toISOString() : undefined,
    payload: structuredClone(input.payload),
    scheduling: input.scheduling
      ? structuredClone(input.scheduling)
      : undefined,
  };
  return {
    ...normalized,
    fingerprint: fingerprintValue(normalized),
    enqueuedAt: enqueuedAt.toISOString(),
  };
}

export function parseDurableJobEnvelope(value: unknown): DurableJobEnvelope {
  if (!isPlainObject(value)) {
    throw new JobRuntimeError('INVALID_JOB', 'Job payload is not a durable job envelope.');
  }
  const envelope = value as Partial<DurableJobEnvelope>;
  if (
    typeof envelope.jobId !== 'string' ||
    typeof envelope.workspaceId !== 'string' ||
    typeof envelope.kind !== 'string' ||
    typeof envelope.fingerprint !== 'string' ||
    typeof envelope.enqueuedAt !== 'string' ||
    !isPlainObject(envelope.payload) ||
    (envelope.sequence !== undefined && (!Number.isInteger(envelope.sequence) || envelope.sequence < 0))
  ) {
    throw new JobRuntimeError('INVALID_JOB', 'Job payload is missing durable job fields.');
  }
  validateDurableJobInput(envelope as DurableJobInput);
  return envelope as DurableJobEnvelope;
}

export function assertSameJobFingerprint(existing: DurableJobEnvelope, requested: DurableJobEnvelope) {
  if (existing.fingerprint !== requested.fingerprint) {
    throw new JobRuntimeError('IDEMPOTENCY_CONFLICT', 'Job id was reused with a different payload.');
  }
}

export function fingerprintValue(value: unknown) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
