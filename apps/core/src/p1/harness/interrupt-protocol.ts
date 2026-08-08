/**
 * Typed Interrupt protocol (V3.1 §27.6 / D-169① / V31-14).
 *
 * - Payload carries threadId/runId/workflowId/step/revision/schemaVersion.
 * - Resume by interruptId + revision CAS only (no list-position index).
 * - listPendingInterrupts({ resourceId, threadId? }) with workspace membership.
 * - duplicate resume / submit / replay are fully idempotent.
 */

import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  INTERRUPT_PAYLOAD_SCHEMA_VERSION,
  interruptPayloadSchema,
  listPendingInterruptsQuerySchema,
  resumeInterruptCommandSchema,
  type InterruptPayload,
  type ListPendingInterruptsQuery,
  type ResumeInterruptCommand,
} from '@meiye/contracts';

export type InterruptRecordStatus = 'pending' | 'resolved' | 'expired';

export type StoredInterrupt = {
  payload: InterruptPayload;
  status: InterruptRecordStatus;
  workspaceId: string;
  createdAt: string;
  resolvedAt?: string;
  /** Canonical resume fingerprint for idempotent replay. */
  resolvedFingerprint?: string;
  resolvedCommand?: ResumeInterruptCommand;
};

export type InterruptProtocolErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'STALE_REVISION'
  | 'ALREADY_RESOLVED'
  | 'EXPIRED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INVALID_COMMAND'
  | 'WORKSPACE_MISMATCH';

export class InterruptProtocolError extends Error {
  readonly status: number;

  constructor(
    readonly code: InterruptProtocolErrorCode,
    message: string,
    status = 409,
  ) {
    super(message);
    this.name = 'InterruptProtocolError';
    this.status = status;
  }
}

export type InterruptStore = {
  putPending(row: StoredInterrupt): Promise<StoredInterrupt>;
  getById(interruptId: string): Promise<StoredInterrupt | null>;
  /**
   * CAS: only transition pending → resolved when revision matches.
   * Returns 'applied' | 'replayed' | 'stale' | 'conflict' | 'missing'.
   */
  resolveCas(input: {
    interruptId: string;
    expectedRevision: number;
    command: ResumeInterruptCommand;
    fingerprint: string;
    resolvedAt: string;
  }): Promise<
    | { outcome: 'applied'; row: StoredInterrupt }
    | { outcome: 'replayed'; row: StoredInterrupt }
    | { outcome: 'stale'; row: StoredInterrupt }
    | { outcome: 'conflict'; row: StoredInterrupt }
    | { outcome: 'missing' }
    | { outcome: 'expired'; row: StoredInterrupt }
  >;
  listPending(input: {
    workspaceId: string;
    resourceId: string;
    threadId?: string;
  }): Promise<StoredInterrupt[]>;
};

export type InterruptMembershipPort = {
  hasMembership(userId: string, workspaceId: string): Promise<boolean>;
};

function resumeFingerprint(command: ResumeInterruptCommand): string {
  const payload = {
    interruptId: command.interruptId,
    revision: command.revision,
    type: command.type,
    args: command.args ?? null,
    idempotencyKey: command.idempotencyKey ?? null,
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export class MemoryInterruptStore implements InterruptStore {
  readonly #byId = new Map<string, StoredInterrupt>();

  async putPending(row: StoredInterrupt): Promise<StoredInterrupt> {
    const parsed = interruptPayloadSchema.parse(row.payload);
    const existing = this.#byId.get(parsed.interruptId);
    if (existing) {
      if (
        existing.status === 'pending' &&
        isDeepStrictEqual(existing.payload, parsed) &&
        existing.workspaceId === row.workspaceId
      ) {
        return existing;
      }
      if (
        existing.status === 'pending' &&
        existing.payload.revision === parsed.revision &&
        existing.workspaceId === row.workspaceId
      ) {
        // Same id+revision different payload → conflict
        throw new InterruptProtocolError(
          'IDEMPOTENCY_CONFLICT',
          `Interrupt ${parsed.interruptId}@${parsed.revision} already pending with different payload.`,
        );
      }
    }
    const stored: StoredInterrupt = {
      ...row,
      payload: parsed,
      status: 'pending',
    };
    this.#byId.set(parsed.interruptId, stored);
    return stored;
  }

  async getById(interruptId: string): Promise<StoredInterrupt | null> {
    return this.#byId.get(interruptId) ?? null;
  }

  async resolveCas(input: {
    interruptId: string;
    expectedRevision: number;
    command: ResumeInterruptCommand;
    fingerprint: string;
    resolvedAt: string;
  }) {
    const row = this.#byId.get(input.interruptId);
    if (!row) return { outcome: 'missing' as const };
    if (row.status === 'expired') {
      return { outcome: 'expired' as const, row };
    }
    if (row.status === 'resolved') {
      if (row.resolvedFingerprint === input.fingerprint) {
        return { outcome: 'replayed' as const, row };
      }
      if (
        row.resolvedCommand &&
        row.resolvedCommand.idempotencyKey &&
        input.command.idempotencyKey &&
        row.resolvedCommand.idempotencyKey === input.command.idempotencyKey
      ) {
        if (isDeepStrictEqual(row.resolvedCommand, input.command)) {
          return { outcome: 'replayed' as const, row };
        }
        return { outcome: 'conflict' as const, row };
      }
      return { outcome: 'conflict' as const, row };
    }
    if (row.payload.revision !== input.expectedRevision) {
      return { outcome: 'stale' as const, row };
    }
    const next: StoredInterrupt = {
      ...row,
      status: 'resolved',
      resolvedAt: input.resolvedAt,
      resolvedFingerprint: input.fingerprint,
      resolvedCommand: input.command,
    };
    this.#byId.set(input.interruptId, next);
    return { outcome: 'applied' as const, row: next };
  }

  async listPending(input: {
    workspaceId: string;
    resourceId: string;
    threadId?: string;
  }): Promise<StoredInterrupt[]> {
    const rows: StoredInterrupt[] = [];
    for (const row of this.#byId.values()) {
      if (row.status !== 'pending') continue;
      if (row.workspaceId !== input.workspaceId) continue;
      if (row.payload.resourceId !== input.resourceId) continue;
      if (input.threadId && row.payload.threadId !== input.threadId) continue;
      rows.push(row);
    }
    return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}

export class InterruptProtocolService {
  constructor(
    private readonly store: InterruptStore,
    private readonly membership: InterruptMembershipPort,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /**
   * Register a pending interrupt (idempotent on identical payload).
   */
  async request(input: {
    workspaceId: string;
    payload: InterruptPayload;
  }): Promise<{ record: StoredInterrupt; replayed: boolean }> {
    const payload = interruptPayloadSchema.parse(input.payload);
    if (payload.resourceId !== input.workspaceId && payload.resourceId) {
      // resourceId is the merchant resource; workspaceId is the auth boundary.
      // For v1 they share the workspace id in production wiring.
    }
    const existing = await this.store.getById(payload.interruptId);
    if (
      existing &&
      existing.status === 'pending' &&
      isDeepStrictEqual(existing.payload, payload) &&
      existing.workspaceId === input.workspaceId
    ) {
      return { record: existing, replayed: true };
    }
    const record = await this.store.putPending({
      payload,
      status: 'pending',
      workspaceId: input.workspaceId,
      createdAt: this.now(),
    });
    return { record, replayed: false };
  }

  /**
   * Resume by interruptId + revision CAS. Duplicate identical resume is replay.
   */
  async resume(input: {
    userId: string;
    workspaceId: string;
    command: ResumeInterruptCommand;
  }): Promise<{
    outcome: 'applied' | 'replayed';
    record: StoredInterrupt;
    command: ResumeInterruptCommand;
  }> {
    if (!(await this.membership.hasMembership(input.userId, input.workspaceId))) {
      throw new InterruptProtocolError(
        'FORBIDDEN',
        'Workspace membership required to resume interrupt.',
        403,
      );
    }
    const command = resumeInterruptCommandSchema.parse(input.command);
    const row = await this.store.getById(command.interruptId);
    if (!row || row.workspaceId !== input.workspaceId) {
      throw new InterruptProtocolError(
        'NOT_FOUND',
        `Interrupt ${command.interruptId} was not found in this workspace.`,
        404,
      );
    }
    if (
      row.payload.expiresAt &&
      Date.parse(row.payload.expiresAt) <= Date.parse(this.now()) &&
      row.status === 'pending'
    ) {
      throw new InterruptProtocolError(
        'EXPIRED',
        `Interrupt ${command.interruptId} expired at ${row.payload.expiresAt}.`,
      );
    }
    const fingerprint = resumeFingerprint(command);
    const result = await this.store.resolveCas({
      interruptId: command.interruptId,
      expectedRevision: command.revision,
      command,
      fingerprint,
      resolvedAt: this.now(),
    });
    switch (result.outcome) {
      case 'applied':
        return { outcome: 'applied', record: result.row, command };
      case 'replayed':
        return { outcome: 'replayed', record: result.row, command };
      case 'stale':
        throw new InterruptProtocolError(
          'STALE_REVISION',
          `Resume revision ${command.revision} does not match interrupt revision ${result.row.payload.revision}.`,
        );
      case 'conflict':
        throw new InterruptProtocolError(
          'IDEMPOTENCY_CONFLICT',
          `Interrupt ${command.interruptId} already resolved with a different resume payload.`,
        );
      case 'expired':
        throw new InterruptProtocolError(
          'EXPIRED',
          `Interrupt ${command.interruptId} is expired.`,
        );
      case 'missing':
        throw new InterruptProtocolError(
          'NOT_FOUND',
          `Interrupt ${command.interruptId} was not found.`,
          404,
        );
      default: {
        const _exhaustive: never = result;
        return _exhaustive;
      }
    }
  }

  /**
   * Workspace-authenticated list. threadId is an optional filter only —
   * callers must not use guessable threadId alone to read payloads.
   */
  async listPending(input: {
    userId: string;
    workspaceId: string;
    query: ListPendingInterruptsQuery;
  }): Promise<InterruptPayload[]> {
    if (!(await this.membership.hasMembership(input.userId, input.workspaceId))) {
      throw new InterruptProtocolError(
        'FORBIDDEN',
        'Workspace membership required to list pending interrupts.',
        403,
      );
    }
    const query = listPendingInterruptsQuerySchema.parse(input.query);
    // resourceId must be the workspace (or a resource owned by it). v1: equal.
    if (query.resourceId !== input.workspaceId) {
      // Still require membership on workspace; only return rows for the
      // requested resource when it matches workspace boundary.
    }
    const rows = await this.store.listPending({
      workspaceId: input.workspaceId,
      resourceId: query.resourceId,
      threadId: query.threadId,
    });
    return rows.map((row) => row.payload);
  }
}

export function buildInterruptPayload(
  input: Omit<InterruptPayload, 'schemaVersion'> & {
    schemaVersion?: typeof INTERRUPT_PAYLOAD_SCHEMA_VERSION;
  },
): InterruptPayload {
  return interruptPayloadSchema.parse({
    schemaVersion: INTERRUPT_PAYLOAD_SCHEMA_VERSION,
    ...input,
  });
}

export { resumeFingerprint };
