import { createHash } from 'node:crypto';
import { P1DomainError } from './domain.js';
import type { JobPort } from './ports.js';

export interface MemoryJobRecord {
  jobId: string;
  workspaceId: string;
  kind: string;
  runAt?: string;
  payload: Record<string, unknown>;
  scheduling?: {
    queuePriority: number;
    workspaceConcurrencyLimit: number;
  };
  sequence: number;
  status: 'queued' | 'cancelled';
}

function fingerprint(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class MemoryJobPort implements JobPort {
  private readonly records = new Map<string, { fingerprint: string; value: MemoryJobRecord }>();

  async enqueue(input: Omit<MemoryJobRecord, 'status' | 'sequence'>) {
    const key = initialTransportKey(input.workspaceId, input.jobId);
    const inputFingerprint = fingerprint(input);
    const existing = this.records.get(key);
    if (existing) {
      if (existing.fingerprint !== inputFingerprint) {
        throw new P1DomainError('IDEMPOTENCY_CONFLICT', 'Job id was reused with a different payload.');
      }
      return;
    }
    this.records.set(key, {
      fingerprint: inputFingerprint,
      value: structuredClone({ ...input, sequence: 0, status: 'queued' }),
    });
  }

  async resume(
    input: Omit<MemoryJobRecord, 'status' | 'sequence'>,
    sequence: number,
  ) {
    if (!Number.isInteger(sequence) || sequence < 1) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Job resume sequence must be a positive integer.',
      );
    }
    const key = continuationTransportKey(
      input.workspaceId,
      input.jobId,
      sequence,
    );
    const inputFingerprint = fingerprint(input);
    const existing = this.records.get(key);
    if (existing) {
      if (existing.fingerprint !== inputFingerprint) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'Job resume sequence was reused with a different payload.',
        );
      }
      return;
    }
    this.records.set(key, {
      fingerprint: inputFingerprint,
      value: structuredClone({ ...input, sequence, status: 'queued' }),
    });
  }

  async cancel(workspaceId: string, jobId: string) {
    const existing = this.findLatest(workspaceId, jobId);
    if (!existing) throw new P1DomainError('NOT_FOUND', 'Queued job was not found.');
    existing.value.status = 'cancelled';
  }

  async inspect(workspaceId: string, jobId: string) {
    const value = this.findLatest(workspaceId, jobId)?.value;
    return value ? structuredClone(value) : null;
  }

  async list(workspaceId: string) {
    return structuredClone(
      [...this.records.values()].map((item) => item.value).filter((item) => item.workspaceId === workspaceId)
    );
  }

  private findLatest(workspaceId: string, jobId: string) {
    return [...this.records.values()]
      .filter(
        ({ value }) =>
          value.workspaceId === workspaceId && value.jobId === jobId,
      )
      .sort((left, right) => right.value.sequence - left.value.sequence)[0];
  }
}

function initialTransportKey(workspaceId: string, jobId: string) {
  return `${workspaceId}:${jobId}`;
}

function continuationTransportKey(
  workspaceId: string,
  jobId: string,
  sequence: number,
) {
  return `${initialTransportKey(workspaceId, jobId)}:continuation:${sequence}`;
}
