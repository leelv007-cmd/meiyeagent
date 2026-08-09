import type { AgentLiveSubscriber } from './agent-event-transport';
import {
  applyLiveSemanticEvent,
  reconnectAgentWorkbench,
  type AgentReplayLoader,
} from './agent-event-client';
import type { AgentEventStore } from './agent-event-store';

export const AGENT_LIVE_RECONNECT_BASE_DELAY_MS = 250;
export const AGENT_LIVE_RECONNECT_MAX_DELAY_MS = 8_000;

type OnlineEventTarget = Pick<
  EventTarget,
  'addEventListener' | 'removeEventListener'
>;

/**
 * Keep one Thread's durable semantic stream subscribed until the host unmounts.
 * Both transport errors and clean EOF are disconnects: replay first, then
 * resume SSE with the replayed Last-Event-ID and stream-offset cursor.
 */
export async function runAgentLiveReconnectLoop(input: {
  store: AgentEventStore;
  loadReplay: AgentReplayLoader;
  subscribeLive: AgentLiveSubscriber;
  resourceId?: string;
  threadId: string;
  signal: AbortSignal;
  onlineTarget?: OnlineEventTarget;
}) {
  let consecutiveDisconnects = 0;
  let reconnectBeforeSubscribe = false;

  while (!input.signal.aborted) {
    if (reconnectBeforeSubscribe) {
      input.store.dispatch({ type: 'set_connection', connection: 'offline' });
      const delay = Math.min(
        AGENT_LIVE_RECONNECT_MAX_DELAY_MS,
        AGENT_LIVE_RECONNECT_BASE_DELAY_MS *
          2 ** Math.max(0, consecutiveDisconnects - 1)
      );
      const shouldContinue = await waitForRetry({
        delay,
        signal: input.signal,
        onlineTarget: input.onlineTarget,
      });
      if (!shouldContinue) return;
      try {
        await reconnectAgentWorkbench({
          store: input.store,
          loadReplay: input.loadReplay,
          resourceId:
            input.store.getState().session?.resourceId ?? input.resourceId,
          threadId: input.threadId,
        });
      } catch {
        consecutiveDisconnects += 1;
        continue;
      }
    }

    const cursor = input.store.getState();
    try {
      await input.subscribeLive({
        threadId: input.threadId,
        lastEventId: cursor.lastEventId,
        lastStreamOffset: cursor.lastStreamOffset,
        signal: input.signal,
        onEvent: async (event) => {
          const applied = applyLiveSemanticEvent(input.store, event);
          if (applied.ok || input.signal.aborted) {
            if (applied.ok) consecutiveDisconnects = 0;
            return;
          }
          await reconnectAgentWorkbench({
            store: input.store,
            loadReplay: input.loadReplay,
            resourceId: input.store.getState().session?.resourceId,
            threadId: input.threadId,
          });
        },
      });
    } catch {
      // A rejected subscription and a clean EOF share the same recovery path.
    }
    if (input.signal.aborted) return;
    reconnectBeforeSubscribe = true;
    consecutiveDisconnects += 1;
  }
}

function waitForRetry(input: {
  delay: number;
  signal: AbortSignal;
  onlineTarget?: OnlineEventTarget;
}) {
  if (input.signal.aborted) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (shouldContinue: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal.removeEventListener('abort', onAbort);
      input.onlineTarget?.removeEventListener('online', onOnline);
      resolve(shouldContinue);
    };
    const onAbort = () => finish(false);
    const onOnline = () => finish(true);
    const timer = setTimeout(() => finish(true), input.delay);
    input.signal.addEventListener('abort', onAbort, { once: true });
    input.onlineTarget?.addEventListener('online', onOnline, { once: true });
  });
}
