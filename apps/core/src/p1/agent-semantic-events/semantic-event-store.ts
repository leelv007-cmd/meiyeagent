/**
 * Agent semantic event persistence seam (V31-03).
 *
 * Authority: V3.1 §27 (three-layer events, streamOffset, contextRole),
 * §33.1 (p1_agent_semantic_events), ownership matrix writer
 * `AgentSemanticEventProjector` for `agent_semantic_event_stream_offset`.
 *
 * Contracts are consumed from @meiye/contracts (V31-01) and never redefined.
 * Ephemeral frames never enter this store (emitter-side transient; B2).
 */

import {
  AGENT_SEMANTIC_EVENT_SCHEMA_VERSION,
  agentSemanticEventSchema,
  type AgentSemanticEvent,
} from '@meiye/contracts';

/** Outbox candidate: domain fact ready for projection (no streamOffset yet). */
export type SemanticEventCandidate = {
  eventId: string;
  threadId: string;
  /** Tenant boundary for cross-resource isolation. */
  resourceId: string;
  contextRole: 'included' | 'excluded' | 'summarized';
  sourceDomain: string;
  sourceEntityId: string;
  sourceRevision: string;
  correlationId: string;
  causationId?: string;
  eventType: string;
  payload: unknown;
  occurredAt: string;
};

export type ProjectedSemanticEvent = {
  event: AgentSemanticEvent;
  /** True when an identical eventId was already projected (crash-window replay). */
  replayed: boolean;
};

export type ListSemanticEventsInput = {
  resourceId: string;
  threadId: string;
  /** Exclusive lower bound by streamOffset (numeric). */
  afterStreamOffset?: bigint;
  /**
   * Exclusive cursor by stable eventId. When set, replay starts after this id
   * in streamOffset order (V3.1 §27.6 lastEventId).
   */
  afterEventId?: string;
};

export type AgentSemanticEventStoreErrorCode =
  | 'AGENT_SEMANTIC_EVENT_NOT_FOUND'
  | 'AGENT_SEMANTIC_EVENT_CONFLICT'
  | 'AGENT_SEMANTIC_EVENT_THREAD_ISOLATION';

const ERROR_STATUSES: Record<AgentSemanticEventStoreErrorCode, number> = {
  AGENT_SEMANTIC_EVENT_NOT_FOUND: 404,
  AGENT_SEMANTIC_EVENT_CONFLICT: 409,
  AGENT_SEMANTIC_EVENT_THREAD_ISOLATION: 404,
};

export class AgentSemanticEventStoreError extends Error {
  readonly status: number;

  constructor(
    readonly code: AgentSemanticEventStoreErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AgentSemanticEventStoreError';
    this.status = ERROR_STATUSES[code];
  }
}

/**
 * Persistence for projected semantic events only.
 * Ephemeral / transient frames have no write method by design.
 */
export interface AgentSemanticEventStore {
  /**
   * Atomically assign the next per-thread streamOffset and append.
   * Sole streamOffset writer path (ownership: AgentSemanticEventProjector).
   * Idempotent on eventId: same candidate replays without a new offset.
   */
  appendProjected(candidate: SemanticEventCandidate): Promise<ProjectedSemanticEvent>;

  getByEventId(input: {
    resourceId: string;
    eventId: string;
  }): Promise<AgentSemanticEvent | null>;

  listByThread(input: ListSemanticEventsInput): Promise<AgentSemanticEvent[]>;

  latestStreamOffset(input: {
    resourceId: string;
    threadId: string;
  }): Promise<bigint | null>;

  /** Latest event for the thread (for StateSnapshot lastEventId). */
  latestEvent(input: {
    resourceId: string;
    threadId: string;
  }): Promise<AgentSemanticEvent | null>;
}

export function parseSemanticEvent(payload: unknown): AgentSemanticEvent {
  return agentSemanticEventSchema.parse(payload);
}

/**
 * Parse a durable candidate without asserting its static shape. Outbox rows
 * are untrusted JSON, so the schema is the sole boundary for candidate fields.
 */
export function parseSemanticEventCandidate(
  payload: unknown,
): SemanticEventCandidate {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Semantic event candidate must be an object.');
  }
  const record = Object.fromEntries(Object.entries(payload));
  const resourceId = record.resourceId;
  if (typeof resourceId !== 'string' || resourceId.trim() !== resourceId) {
    throw new Error('Semantic event candidate resourceId is invalid.');
  }
  const { resourceId: _resourceId, ...eventPayload } = record;
  const projected = agentSemanticEventSchema.parse({
    schemaVersion: AGENT_SEMANTIC_EVENT_SCHEMA_VERSION,
    streamOffset: 1n,
    ...eventPayload,
  });
  return {
    eventId: projected.eventId,
    threadId: projected.threadId,
    resourceId,
    contextRole: projected.contextRole,
    sourceDomain: projected.sourceDomain,
    sourceEntityId: projected.sourceEntityId,
    sourceRevision: projected.sourceRevision,
    correlationId: projected.correlationId,
    ...(projected.causationId !== undefined
      ? { causationId: projected.causationId }
      : {}),
    eventType: projected.eventType,
    payload: projected.payload,
    occurredAt: projected.occurredAt,
  };
}

export function buildProjectedEvent(
  candidate: SemanticEventCandidate,
  streamOffset: bigint,
): AgentSemanticEvent {
  return agentSemanticEventSchema.parse({
    schemaVersion: AGENT_SEMANTIC_EVENT_SCHEMA_VERSION,
    eventId: candidate.eventId,
    threadId: candidate.threadId,
    streamOffset,
    contextRole: candidate.contextRole,
    sourceDomain: candidate.sourceDomain,
    sourceEntityId: candidate.sourceEntityId,
    sourceRevision: candidate.sourceRevision,
    correlationId: candidate.correlationId,
    ...(candidate.causationId !== undefined
      ? { causationId: candidate.causationId }
      : {}),
    eventType: candidate.eventType,
    payload: candidate.payload,
    occurredAt: candidate.occurredAt,
  });
}

/**
 * Key-order-independent JSON, so a payload that came back through a jsonb column
 * compares equal to the in-memory value it was written from.
 */
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

/**
 * Refuse a replay that carries different content under an already-projected
 * eventId.
 *
 * The idempotent-on-eventId contract used to return the stored event without
 * looking at what the caller brought. That is silent for the one case it must
 * not be: a DBOS re-execution re-emitting an artifact revision whose content
 * differs from the first attempt's. The stored row wins, the caller believes its
 * own version was projected, and the artifact ends up a splice of two attempts
 * that nothing reports. A replay carrying identical content is still a plain
 * no-op — the normal crash-window case.
 */
export function assertProjectedReplayMatches(
  stored: AgentSemanticEvent,
  candidate: SemanticEventCandidate,
): void {
  if (canonicalJson(stored.payload) === canonicalJson(candidate.payload)) return;
  throw new AgentSemanticEventStoreError(
    'AGENT_SEMANTIC_EVENT_CONFLICT',
    `Semantic event ${candidate.eventId} was already projected with different content.`,
    { eventId: candidate.eventId, threadId: candidate.threadId },
  );
}

export function eventThreadIsolation(
  threadId: string,
  resourceId: string,
): AgentSemanticEventStoreError {
  return new AgentSemanticEventStoreError(
    'AGENT_SEMANTIC_EVENT_THREAD_ISOLATION',
    `Semantic event stream for thread ${threadId} is not visible to this resource.`,
    { threadId, resourceId },
  );
}
