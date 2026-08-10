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
import type { SemanticEventCandidate } from '../agent-semantic-events/index.js';

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
  /** Durable resume outbox state; CAS writes pending before bridge delivery. */
  resumeDeliveryStatus?: 'none' | 'pending' | 'sent';
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
  listUndelivered(limit: number): Promise<StoredInterrupt[]>;
  markResumeDelivered(input: {
    interruptId: string;
    fingerprint: string;
    deliveredAt: string;
  }): Promise<boolean>;
};

export type InterruptMembershipPort = {
  hasMembership(userId: string, workspaceId: string): Promise<boolean>;
};

/**
 * Resume delivery bridge (V31-14 P1-a closed loop).
 *
 * After a CAS-applied (or replay-recovered) resume, the service hands the
 * resolved interrupt back to the executing workflow. Implementations must be
 * idempotent (e.g. DBOS.send with a stable idempotency key) so a retry after
 * a failed delivery re-delivers without duplicate side effects.
 */
export type InterruptResumeBridgeInput = {
  workspaceId: string;
  payload: InterruptPayload;
  command: ResumeInterruptCommand;
  /**
   * Merchant who CAS-resolved the interrupt. Required so confirm_paid_execution
   * can write PlanConfirmationDecision before workflow admit (same authority
   * the Composer interaction card records via decide-before-resume).
   */
  actorId?: string;
};

export type InterruptResumeBridgePort = {
  deliver(input: InterruptResumeBridgeInput): Promise<void>;
};

export type InterruptSemanticEventPort = {
  project(candidate: SemanticEventCandidate): Promise<unknown>;
};

function interruptSemanticCandidate(input: {
  payload: InterruptPayload;
  eventType: 'interrupt.requested' | 'interrupt.resolved';
  occurredAt: string;
}): SemanticEventCandidate {
  const { payload, eventType, occurredAt } = input;
  return {
    eventId: `${payload.interruptId}:${eventType}:r${payload.revision}`,
    threadId: payload.threadId,
    resourceId: payload.resourceId,
    contextRole: 'excluded',
    sourceDomain: 'interrupt',
    sourceEntityId: payload.interruptId,
    sourceRevision: String(payload.revision),
    correlationId: payload.runId,
    causationId: payload.workflowId,
    eventType,
    payload: {
      interruptId: payload.interruptId,
      interruptType: payload.action,
      description: payload.description,
      revision: payload.revision,
      schemaVersion: payload.schemaVersion,
    },
    occurredAt,
  };
}

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
      resumeDeliveryStatus: 'none',
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
      resumeDeliveryStatus: 'pending',
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

  async listUndelivered(limit: number): Promise<StoredInterrupt[]> {
    return [...this.#byId.values()]
      .filter(
        (row) =>
          row.status === 'resolved' &&
          row.resumeDeliveryStatus === 'pending' &&
          row.resolvedCommand !== undefined,
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(0, limit);
  }

  async markResumeDelivered(input: {
    interruptId: string;
    fingerprint: string;
    deliveredAt: string;
  }): Promise<boolean> {
    const row = this.#byId.get(input.interruptId);
    if (
      !row ||
      row.status !== 'resolved' ||
      row.resolvedFingerprint !== input.fingerprint
    ) {
      return false;
    }
    this.#byId.set(input.interruptId, {
      ...row,
      resumeDeliveryStatus: 'sent',
    });
    return true;
  }
}

export class InterruptProtocolService {
  constructor(
    private readonly store: InterruptStore,
    private readonly membership: InterruptMembershipPort,
    private readonly now: () => string = () => new Date().toISOString(),
    /**
     * V31-14 P1-a: after the resume CAS applies, deliver the resume back into
     * the executing workflow (DBOS recv channel). Invoked for 'applied' and
     * 'replayed' alike so a failed delivery can be retried at-least-once.
     */
    private readonly resumeBridge?: InterruptResumeBridgePort,
    /** Canonical AgentThread projection; eventId makes replay repair idempotent. */
    private readonly semanticEvents?: InterruptSemanticEventPort,
  ) {}

  /**
   * Register a pending interrupt (idempotent on identical payload).
   */
  async request(input: {
    workspaceId: string;
    payload: InterruptPayload;
  }): Promise<{ record: StoredInterrupt; replayed: boolean }> {
    const payload = interruptPayloadSchema.parse(input.payload);
    if (payload.resourceId !== input.workspaceId) {
      throw new InterruptProtocolError(
        'FORBIDDEN',
        'Interrupt resource must match the authenticated workspace.',
        403,
      );
    }
    const existing = await this.store.getById(payload.interruptId);
    if (
      existing &&
      existing.status === 'pending' &&
      isDeepStrictEqual(existing.payload, payload) &&
      existing.workspaceId === input.workspaceId
    ) {
      await this.semanticEvents?.project(
        interruptSemanticCandidate({
          payload: existing.payload,
          eventType: 'interrupt.requested',
          occurredAt: existing.createdAt,
        }),
      );
      return { record: existing, replayed: true };
    }
    const record = await this.store.putPending({
      payload,
      status: 'pending',
      workspaceId: input.workspaceId,
      createdAt: this.now(),
    });
    await this.semanticEvents?.project(
      interruptSemanticCandidate({
        payload: record.payload,
        eventType: 'interrupt.requested',
        occurredAt: record.createdAt,
      }),
    );
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
      case 'replayed': {
        // At-least-once workflow delivery: 'replayed' keeps retrying after a
        // bridge failure because the CAS row is already resolved. Bridge
        // implementations dedup on the command idempotency key, so duplicate
        // resume remains side-effect free (V31-14 durable seam).
        await this.deliverResolved(result.row, command, input.userId);
        return { outcome: result.outcome, record: result.row, command };
      }
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

  /** Recover CAS-applied resumes even when the original HTTP process exited. */
  async recoverUndelivered(limit = 20): Promise<{
    delivered: number;
    failed: number;
  }> {
    const rows = await this.store.listUndelivered(limit);
    let delivered = 0;
    let failed = 0;
    for (const row of rows) {
      if (!row.resolvedCommand || !row.resolvedFingerprint) {
        failed += 1;
        continue;
      }
      try {
        await this.deliverResolved(row, row.resolvedCommand);
        delivered += 1;
      } catch {
        failed += 1;
      }
    }
    return { delivered, failed };
  }

  private async deliverResolved(
    row: StoredInterrupt,
    command: ResumeInterruptCommand,
    actorId?: string,
  ): Promise<void> {
    if (this.resumeBridge) {
      await this.resumeBridge.deliver({
        workspaceId: row.workspaceId,
        payload: row.payload,
        command,
        ...(actorId ? { actorId } : {}),
      });
    }
    const fingerprint = row.resolvedFingerprint ?? resumeFingerprint(command);
    const deliveredAt = this.now();
    const marked = await this.store.markResumeDelivered({
      interruptId: row.payload.interruptId,
      fingerprint,
      deliveredAt,
    });
    if (!marked) {
      throw new InterruptProtocolError(
        'IDEMPOTENCY_CONFLICT',
        `Interrupt ${row.payload.interruptId} resume delivery no longer matches its CAS result.`,
      );
    }
    await this.semanticEvents?.project(
      interruptSemanticCandidate({
        payload: row.payload,
        eventType: 'interrupt.resolved',
        occurredAt: row.resolvedAt ?? deliveredAt,
      }),
    );
  }

  /**
   * Workflow-side resolution sync (best-effort, never throws).
   *
   * The workflow may resolve a pending question through its own channels
   * (decision recv, core timeout, hold expiry, system default). Mark the
   * mirrored interrupt resolved so the home/mobile pending list stays honest.
   * Duplicate calls replay; a row resolved by an interrupt resume already
   * stays resolved. Missing/stale/expired rows are treated as no-ops.
   */
  async resolveByWorkflow(input: {
    workspaceId: string;
    interruptId: string;
    revision: number;
    source:
      | 'decision'
      | 'core_timeout'
      | 'core_hold_expired'
      | 'system_default'
      | 'reservation_released';
  }): Promise<'applied' | 'replayed'> {
    const row = await this.store.getById(input.interruptId);
    if (!row || row.workspaceId !== input.workspaceId) return 'replayed';
    const command = resumeInterruptCommandSchema.parse({
      schemaVersion: INTERRUPT_PAYLOAD_SCHEMA_VERSION,
      interruptId: input.interruptId,
      revision: input.revision,
      type: 'reject',
      args: { resolvedByWorkflow: input.source },
      idempotencyKey: `workflow-resolve:${input.source}:${input.interruptId}:${input.revision}`,
    });
    const fingerprint = resumeFingerprint(command);
    const result = await this.store.resolveCas({
      interruptId: input.interruptId,
      expectedRevision: input.revision,
      command,
      fingerprint,
      resolvedAt: this.now(),
    });
    if (result.outcome === 'applied' || result.outcome === 'replayed') {
      if (result.row.resolvedFingerprint) {
        await this.store.markResumeDelivered({
          interruptId: result.row.payload.interruptId,
          fingerprint: result.row.resolvedFingerprint,
          deliveredAt: this.now(),
        });
      }
      await this.semanticEvents?.project(
        interruptSemanticCandidate({
          payload: result.row.payload,
          eventType: 'interrupt.resolved',
          occurredAt: result.row.resolvedAt ?? this.now(),
        }),
      );
      return result.outcome;
    }
    // replayed / stale / conflict / expired / missing: nothing more to do.
    return 'replayed';
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
