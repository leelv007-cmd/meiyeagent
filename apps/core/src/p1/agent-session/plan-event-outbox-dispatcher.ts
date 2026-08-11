/**
 * V31-40 / V31-46: dispatch canonical plan semantic-event outbox rows.
 *
 * A revision and its full SemanticEventCandidate commit together. Both the
 * compiler fast path and this recovery worker project that exact candidate;
 * neither path is allowed to rebuild an event from a revision later.
 */

import type { AgentSemanticEvent } from '@meiye/contracts';

import {
  AgentSemanticEventStoreError,
  parseSemanticEventCandidate,
  type SemanticEventCandidate,
} from '../agent-semantic-events/semantic-event-store.js';
import {
  planEventTypeForRevision,
  planSemanticEventId,
} from './plan-semantic-event.js';

export const PLAN_EVENT_OUTBOX_MAX_ATTEMPTS = 5;

export type PlanEventOutboxErrorCode =
  | 'PLAN_EVENT_OUTBOX_INVALID_CANDIDATE'
  | 'PLAN_EVENT_OUTBOX_CANDIDATE_CONFLICT';

/** Typed, terminal errors for a corrupt or divergent durable candidate. */
export class PlanEventOutboxError extends Error {
  constructor(
    readonly code: PlanEventOutboxErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PlanEventOutboxError';
  }
}

export type PlanEventOutboxRow = {
  eventId: string;
  planId: string;
  revision: number;
  threadId: string;
  workspaceId: string;
  eventType: string;
  /** Canonical SemanticEventCandidate JSON, not a reconstruction hint. */
  payload: unknown;
  leaseToken: string;
};

export type PlanEventOutboxPort = {
  claimPendingPlanEventOutbox(input: {
    limit: number;
    leaseMs?: number;
  }): Promise<PlanEventOutboxRow[]>;
  markPlanEventOutboxDispatched(input: {
    eventId: string;
    leaseToken: string;
  }): Promise<boolean>;
  recordPlanEventOutboxFailure(input: {
    eventId: string;
    leaseToken: string;
    error: string;
    terminal: boolean;
  }): Promise<'retry_scheduled' | 'dead_lettered' | 'stale'>;
};

export type PlanEventOutboxSemanticPorts = {
  project(
    candidate: SemanticEventCandidate,
  ): Promise<{ event: unknown; replayed: boolean }>;
  getByEventId(input: {
    resourceId: string;
    eventId: string;
  }): Promise<AgentSemanticEvent | null>;
};

export type PlanEventOutboxDispatchResult = {
  claimed: number;
  projected: number;
  alreadyProjected: number;
  dispatched: number;
  failed: number;
  retried: number;
  deadLettered: number;
  staleClaims: number;
};

/**
 * Parse a durable candidate and verify every duplicated outbox index column.
 * The database JSON is untrusted on recovery, so a malformed historical row
 * is a typed terminal failure rather than a reason to reconstruct it from a
 * mutable revision.
 */
export function parseCanonicalPlanEventOutboxCandidate(input: {
  eventId: string;
  planId: string;
  revision: number;
  threadId: string;
  workspaceId: string;
  eventType: string;
  payload: unknown;
}): SemanticEventCandidate {
  try {
    if (!input.workspaceId.trim()) {
      throw new Error('workspaceId is empty.');
    }
    if (!isRecord(input.payload)) {
      throw new Error('payload is not an object.');
    }
    const candidate = input.payload as Record<string, unknown>;
    const allowedKeys = new Set([
      'eventId',
      'threadId',
      'resourceId',
      'contextRole',
      'sourceDomain',
      'sourceEntityId',
      'sourceRevision',
      'correlationId',
      'causationId',
      'eventType',
      'payload',
      'occurredAt',
    ]);
    if (Object.keys(candidate).some((key) => !allowedKeys.has(key))) {
      throw new Error('payload contains fields outside SemanticEventCandidate.');
    }
    if (
      typeof candidate.resourceId !== 'string' ||
      !candidate.resourceId.trim() ||
      candidate.resourceId !== candidate.resourceId.trim()
    ) {
      throw new Error('candidate resourceId is invalid.');
    }

    // Contract schema validates event ids, timestamps, JSON payload, and all
    // remaining candidate fields without allocating a real stream offset.
    const parsed = parseSemanticEventCandidate(candidate);
    assertCanonicalPlanEventOutboxCandidateMatches({ ...input, candidate: parsed });
    return parsed;
  } catch (error) {
    if (error instanceof PlanEventOutboxError) throw error;
    throw new PlanEventOutboxError(
      'PLAN_EVENT_OUTBOX_INVALID_CANDIDATE',
      `Plan event outbox ${input.eventId} has an invalid canonical candidate: ${errorMessage(error)}`,
    );
  }
}

export function assertCanonicalPlanEventOutboxCandidateMatches(input: {
  eventId: string;
  planId: string;
  revision: number;
  threadId: string;
  workspaceId: string;
  eventType: string;
  candidate: SemanticEventCandidate;
}): void {
  const expectedEventId = planSemanticEventId(input.planId, input.revision);
  const expectedEventType = planEventTypeForRevision(input.revision);
  const candidate = input.candidate;
  if (
    candidate.eventId !== input.eventId ||
    candidate.eventId !== expectedEventId ||
    candidate.threadId !== input.threadId ||
    candidate.resourceId !== input.workspaceId ||
    candidate.eventType !== input.eventType ||
    candidate.eventType !== expectedEventType ||
    candidate.sourceDomain !== 'marketing_plan_revision' ||
    candidate.sourceEntityId !== input.planId ||
    candidate.sourceRevision !== String(input.revision)
  ) {
    throw new PlanEventOutboxError(
      'PLAN_EVENT_OUTBOX_CANDIDATE_CONFLICT',
      `Plan event outbox ${input.eventId} does not exactly match ${input.planId}@${input.revision}.`,
    );
  }
}

/** Exact replay check for a candidate already projected by the fast path. */
export function assertProjectedPlanEventMatchesCandidate(
  event: AgentSemanticEvent,
  candidate: SemanticEventCandidate,
): void {
  if (
    event.eventId === candidate.eventId &&
    event.threadId === candidate.threadId &&
    event.contextRole === candidate.contextRole &&
    event.sourceDomain === candidate.sourceDomain &&
    event.sourceEntityId === candidate.sourceEntityId &&
    event.sourceRevision === candidate.sourceRevision &&
    event.correlationId === candidate.correlationId &&
    event.causationId === candidate.causationId &&
    event.eventType === candidate.eventType &&
    event.occurredAt === candidate.occurredAt &&
    canonicalJson(event.payload) === canonicalJson(candidate.payload)
  ) {
    return;
  }
  throw new AgentSemanticEventStoreError(
    'AGENT_SEMANTIC_EVENT_CONFLICT',
    `Plan event ${candidate.eventId} was already projected with a different canonical candidate.`,
    { eventId: candidate.eventId, threadId: candidate.threadId },
  );
}

export function isTerminalPlanEventOutboxError(error: unknown): boolean {
  return (
    error instanceof PlanEventOutboxError ||
    (error instanceof AgentSemanticEventStoreError &&
      error.code === 'AGENT_SEMANTIC_EVENT_CONFLICT')
  );
}

export function describePlanEventOutboxError(error: unknown): string {
  const code =
    error instanceof PlanEventOutboxError ||
    error instanceof AgentSemanticEventStoreError
      ? error.code
      : 'PLAN_EVENT_OUTBOX_RETRYABLE';
  return `${code}: ${errorMessage(error)}`.slice(0, 2_000);
}

export class PlanEventOutboxDispatcher {
  constructor(
    private readonly outbox: PlanEventOutboxPort,
    private readonly semanticEvents: PlanEventOutboxSemanticPorts,
    private readonly options: { batchSize?: number; leaseMs?: number } = {},
  ) {}

  async runOnce(): Promise<PlanEventOutboxDispatchResult> {
    const limit = this.options.batchSize ?? 20;
    const rows = await this.outbox.claimPendingPlanEventOutbox({
      limit,
      ...(this.options.leaseMs !== undefined
        ? { leaseMs: this.options.leaseMs }
        : {}),
    });
    const result: PlanEventOutboxDispatchResult = {
      claimed: rows.length,
      projected: 0,
      alreadyProjected: 0,
      dispatched: 0,
      failed: 0,
      retried: 0,
      deadLettered: 0,
      staleClaims: 0,
    };
    for (const row of rows) {
      try {
        const outcome = await this.dispatchOne(row);
        if (outcome === 'projected') result.projected += 1;
        else result.alreadyProjected += 1;
        if (
          await this.outbox.markPlanEventOutboxDispatched({
            eventId: row.eventId,
            leaseToken: row.leaseToken,
          })
        ) {
          result.dispatched += 1;
        } else {
          result.staleClaims += 1;
        }
      } catch (error) {
        result.failed += 1;
        const state = await this.outbox.recordPlanEventOutboxFailure({
          eventId: row.eventId,
          leaseToken: row.leaseToken,
          error: describePlanEventOutboxError(error),
          terminal: isTerminalPlanEventOutboxError(error),
        });
        if (state === 'retry_scheduled') result.retried += 1;
        else if (state === 'dead_lettered') result.deadLettered += 1;
        else result.staleClaims += 1;
      }
    }
    return result;
  }

  private async dispatchOne(
    row: PlanEventOutboxRow,
  ): Promise<'projected' | 'already_projected'> {
    const candidate = parseCanonicalPlanEventOutboxCandidate(row);
    const existing = await this.semanticEvents.getByEventId({
      resourceId: candidate.resourceId,
      eventId: candidate.eventId,
    });
    if (existing) {
      assertProjectedPlanEventMatchesCandidate(existing, candidate);
      return 'already_projected';
    }
    const projected = await this.semanticEvents.project(candidate);
    return projected.replayed ? 'already_projected' : 'projected';
  }
}

/** Poll loop mirroring HarnessLangfuseOutboxLoop (pending recovery path). */
export class PlanEventOutboxLoop {
  private interval: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    private readonly worker: Pick<PlanEventOutboxDispatcher, 'runOnce'>,
    private readonly options: {
      onError?: (error: unknown) => void;
      pollMs?: number;
    } = {},
  ) {}

  start() {
    if (this.interval) return;
    this.interval = setInterval(
      () => void this.runOnce(),
      this.options.pollMs ?? 1_000,
    );
    this.interval.unref();
    void this.runOnce();
  }

  stop() {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = undefined;
  }

  async runOnce() {
    if (this.running) return false;
    this.running = true;
    try {
      await this.worker.runOnce();
      return true;
    } catch (error) {
      this.options.onError?.(error);
      return false;
    } finally {
      this.running = false;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
