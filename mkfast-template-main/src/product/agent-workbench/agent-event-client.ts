/**
 * Reconnect / live apply client — sole implementation of V3.1 §27.6 recovery:
 * session projection → snapshot → lastEventId replay → patch fail resync →
 * pending interrupt priority (via reducer) → explicit taskId never overwritten.
 */

import type { AgentSemanticEventWire } from '@meiye/contracts';

import type { AgentEventStore } from './agent-event-store';
import type {
  ClientSnapshotCursor,
  WorkbenchSessionProjection,
} from './agent-event-reducer';

export type AgentReplayPackage = {
  session: WorkbenchSessionProjection;
  snapshot: ClientSnapshotCursor;
  events: readonly AgentSemanticEventWire[];
  recentTaskId?: string | null;
};

export type AgentReplayLoader = (input: {
  clientLastEventId: string | null;
  explicitTaskId: string | null;
  resourceId?: string;
  threadId?: string;
}) => Promise<AgentReplayPackage>;

/**
 * Unique reconnect entry. All recovery paths (cold load, disconnect, patch
 * failure) must call this — do not ad-hoc fold events outside it.
 */
export async function reconnectAgentWorkbench(input: {
  store: AgentEventStore;
  loadReplay: AgentReplayLoader;
  resourceId?: string;
  threadId?: string;
}): Promise<void> {
  const { store, loadReplay } = input;
  store.dispatch({ type: 'set_connection', connection: 'connecting' });

  const before = store.getState();
  const changesThread = Boolean(
    input.threadId && input.threadId !== before.session?.threadId
  );
  // On resync after patch fail, always re-fetch from empty cursor
  const clientLastEventId =
    before.needsSnapshotResync || changesThread ? null : before.lastEventId;

  const pack = await loadReplay({
    clientLastEventId,
    explicitTaskId: before.explicitTaskId,
    resourceId: input.resourceId ?? before.session?.resourceId,
    threadId: input.threadId ?? before.session?.threadId,
  });

  store.dispatch({
    type: 'hydrate_replay',
    incremental: clientLastEventId !== null,
    session: pack.session,
    snapshot: pack.snapshot,
    events: pack.events,
    recentTaskId: pack.recentTaskId ?? null,
  });
}

export type LiveApplyResult = {
  ok: boolean;
  duplicate: boolean;
  foreign: boolean;
  error?: string;
};

/**
 * Apply one live semantic frame. On failure, marks patch_failed so the host
 * must call reconnectAgentWorkbench (automatic resync).
 */
export function applyLiveSemanticEvent(
  store: AgentEventStore,
  event: AgentSemanticEventWire
): LiveApplyResult {
  const result = store.dispatch({ type: 'apply_semantic_event', event });
  if (!result.ok) {
    store.dispatch({
      type: 'patch_failed',
      reason: result.error ?? 'apply_failed',
    });
    return {
      ok: false,
      duplicate: false,
      foreign: false,
      error: result.error,
    };
  }
  return {
    ok: true,
    duplicate: result.duplicate,
    foreign: result.foreign,
  };
}
