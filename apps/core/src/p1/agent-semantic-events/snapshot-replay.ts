/**
 * Snapshot + replay recovery chain (V3.1 §27.6).
 *
 * Order: session projection → latest StateSnapshot → replay from lastEventId.
 * Snapshots are rebuildable from the semantic event store (no separate table).
 * Ephemeral frames never participate in recovery correctness.
 */

import {
  agentSemanticEventToWire,
  compareStreamOffsetWire,
  type AgentSemanticEvent,
  type AgentSemanticEventWire,
} from '@meiye/contracts';

import type { AgentSemanticEventStore } from './semantic-event-store.js';

export const AGENT_STATE_SNAPSHOT_SCHEMA_VERSION =
  'agent-state-snapshot/v1' as const;

/** Minimal workbench session projection for reconnect (shadow; UI wires later). */
export type WorkbenchSessionProjection = {
  resourceId: string;
  threadId: string;
  sessionRevision: number;
  activeRunId?: string;
  title?: string;
};

export type AgentStateSnapshot = {
  schemaVersion: typeof AGENT_STATE_SNAPSHOT_SCHEMA_VERSION;
  threadId: string;
  resourceId: string;
  /** Monotonic rebuild counter: last streamOffset as decimal string, or "0". */
  revision: string;
  lastEventId: string | null;
  lastStreamOffset: string | null;
  session: WorkbenchSessionProjection;
  /**
   * Fold of contextRole=included event ids in stream order.
   * Used for equivalence assertions (not LLM context assembly).
   */
  includedEventIds: string[];
  summarizedEventIds: string[];
  excludedEventIds: string[];
};

export type ReplayPackage = {
  session: WorkbenchSessionProjection;
  snapshot: AgentStateSnapshot;
  /** Semantic events strictly after lastEventId, in streamOffset numeric order. */
  events: AgentSemanticEventWire[];
};

export type ApplySemanticEventResult = {
  snapshot: AgentStateSnapshot;
  /** True when eventId was already applied (duplicate). */
  duplicate: boolean;
  /** True when event belongs to another thread (ignored). */
  foreign: boolean;
};

/**
 * Build a StateSnapshot from the full durable stream (rebuildable).
 */
export async function buildStateSnapshot(input: {
  store: AgentSemanticEventStore;
  session: WorkbenchSessionProjection;
}): Promise<AgentStateSnapshot> {
  const events = await input.store.listByThread({
    resourceId: input.session.resourceId,
    threadId: input.session.threadId,
  });
  return foldEventsToSnapshot(input.session, events);
}

/**
 * Reconnect package: session → snapshot → events after lastEventId.
 * `clientLastEventId` is the client's cursor; when absent, full stream after
 * the rebuilt snapshot's lastEventId is empty (snapshot already complete).
 */
export async function loadReplayPackage(input: {
  store: AgentSemanticEventStore;
  session: WorkbenchSessionProjection;
  clientLastEventId?: string;
}): Promise<ReplayPackage> {
  const snapshot = await buildStateSnapshot({
    store: input.store,
    session: input.session,
  });

  // When client has no cursor, serve full snapshot and no delta events.
  // When client has a cursor, replay only events after that id.
  const afterEventId = input.clientLastEventId;
  const events = afterEventId
    ? await input.store.listByThread({
        resourceId: input.session.resourceId,
        threadId: input.session.threadId,
        afterEventId,
      })
    : [];

  return {
    session: input.session,
    snapshot,
    events: events.map(agentSemanticEventToWire),
  };
}

/**
 * Pure reducer apply for one event (out-of-order / duplicate / cross-thread).
 * Events with streamOffset ≤ snapshot.lastStreamOffset that are already
 * present in role lists are treated as duplicates when eventId matches;
 * out-of-order newer events are accepted and roles re-sorted by offset
 * only when applied through applyEventsInOrder.
 */
export function applySemanticEvent(
  snapshot: AgentStateSnapshot,
  event: AgentSemanticEvent,
): ApplySemanticEventResult {
  if (event.threadId !== snapshot.threadId) {
    return { snapshot, duplicate: false, foreign: true };
  }
  const seen = allEventIds(snapshot);
  if (seen.has(event.eventId)) {
    return { snapshot, duplicate: true, foreign: false };
  }

  const next: AgentStateSnapshot = {
    ...snapshot,
    includedEventIds: [...snapshot.includedEventIds],
    summarizedEventIds: [...snapshot.summarizedEventIds],
    excludedEventIds: [...snapshot.excludedEventIds],
  };
  pushRole(next, event);
  const offsetWire = event.streamOffset.toString();
  if (
    next.lastStreamOffset === null ||
    compareStreamOffsetWire(offsetWire, next.lastStreamOffset) > 0
  ) {
    next.lastStreamOffset = offsetWire;
    next.lastEventId = event.eventId;
    next.revision = offsetWire;
  }
  return { snapshot: next, duplicate: false, foreign: false };
}

/**
 * Apply a batch safely for out-of-order delivery: sort by streamOffset numeric
 * order, skip duplicates and foreign threads. Result matches sequential apply.
 */
export function applyEventsInOrder(
  snapshot: AgentStateSnapshot,
  events: readonly AgentSemanticEvent[],
): AgentStateSnapshot {
  const ordered = [...events].sort((left, right) => {
    if (left.streamOffset === right.streamOffset) return 0;
    return left.streamOffset < right.streamOffset ? -1 : 1;
  });
  let current = snapshot;
  for (const event of ordered) {
    current = applySemanticEvent(current, event).snapshot;
  }
  return current;
}

export function emptyStateSnapshot(
  session: WorkbenchSessionProjection,
): AgentStateSnapshot {
  return {
    schemaVersion: AGENT_STATE_SNAPSHOT_SCHEMA_VERSION,
    threadId: session.threadId,
    resourceId: session.resourceId,
    revision: '0',
    lastEventId: null,
    lastStreamOffset: null,
    session,
    includedEventIds: [],
    summarizedEventIds: [],
    excludedEventIds: [],
  };
}

function foldEventsToSnapshot(
  session: WorkbenchSessionProjection,
  events: readonly AgentSemanticEvent[],
): AgentStateSnapshot {
  return applyEventsInOrder(emptyStateSnapshot(session), events);
}

function pushRole(snapshot: AgentStateSnapshot, event: AgentSemanticEvent) {
  if (event.contextRole === 'included') {
    snapshot.includedEventIds.push(event.eventId);
  } else if (event.contextRole === 'summarized') {
    snapshot.summarizedEventIds.push(event.eventId);
  } else {
    snapshot.excludedEventIds.push(event.eventId);
  }
}

function allEventIds(snapshot: AgentStateSnapshot): Set<string> {
  return new Set([
    ...snapshot.includedEventIds,
    ...snapshot.summarizedEventIds,
    ...snapshot.excludedEventIds,
  ]);
}
