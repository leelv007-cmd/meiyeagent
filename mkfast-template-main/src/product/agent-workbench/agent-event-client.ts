/**
 * Reconnect / live apply client — sole implementation of V3.1 §27.6 recovery:
 * session projection → snapshot → lastEventId replay → patch fail resync →
 * pending interrupt priority (via reducer) → explicit taskId never overwritten.
 */

import type { AgentSemanticEventWire } from '@meiye/contracts';

import type { AgentEventStore } from './agent-event-store';
import type {
  AgentWorkbenchClientState,
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
  /** Poll ticks must not flash the rail back to connecting. */
  quiet?: boolean;
}): Promise<void> {
  const { store, loadReplay } = input;
  if (!input.quiet) {
    store.dispatch({ type: 'set_connection', connection: 'connecting' });
  }

  const before = store.getState();
  const requestedResourceId =
    input.resourceId ??
    before.session?.resourceId ??
    before.identity.workspaceId ??
    undefined;
  const requestedThreadId =
    input.threadId ??
    before.session?.threadId ??
    before.identity.threadId ??
    undefined;
  const replayToken = {
    identity: before.identity,
    resourceId: requestedResourceId ?? null,
    threadId: requestedThreadId ?? null,
  };
  const changesThread = Boolean(
    input.threadId && input.threadId !== before.session?.threadId
  );
  // On resync after patch fail, always re-fetch from empty cursor
  const clientLastEventId =
    before.needsSnapshotResync || changesThread ? null : before.lastEventId;

  const pack = await loadReplay({
    clientLastEventId,
    explicitTaskId: before.explicitTaskId,
    resourceId: requestedResourceId,
    threadId: requestedThreadId,
  });

  store.dispatch({
    type: 'hydrate_replay',
    replayToken,
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
/** Composer turns live SSE off (53300). Replay is the only growth path. */
export const WORKBENCH_REPLAY_POLL_MS = 2_000;

export function startWorkbenchReplayPoll(input: {
  store: AgentEventStore;
  loadReplay: AgentReplayLoader;
  threadId: string;
  resourceId?: string;
  intervalMs?: number;
}): () => void {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      await reconnectAgentWorkbench({
        loadReplay: input.loadReplay,
        quiet: true,
        resourceId: input.resourceId,
        store: input.store,
        threadId: input.threadId,
      });
    } catch {
      // Next tick retries. A failed poll must not tear down the host.
    }
  };
  const handle = setInterval(() => {
    void tick();
  }, input.intervalMs ?? WORKBENCH_REPLAY_POLL_MS);
  void tick();
  return () => {
    stopped = true;
    clearInterval(handle);
  };
}

export function applyLiveSemanticEvent(
  store: AgentEventStore,
  event: AgentSemanticEventWire,
  expectedIdentity: AgentWorkbenchClientState['identity']
): LiveApplyResult {
  const result = store.dispatch({
    type: 'apply_semantic_event',
    event,
    expectedIdentity,
  });
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
