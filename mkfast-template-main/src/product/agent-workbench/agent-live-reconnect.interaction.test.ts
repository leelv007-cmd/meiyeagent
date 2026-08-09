import { agentSemanticEventWireSchema } from '@meiye/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentReplayLoader } from './agent-event-client';
import { createAgentEventStore } from './agent-event-store';
import {
  AGENT_LIVE_RECONNECT_BASE_DELAY_MS,
  runAgentLiveReconnectLoop,
} from './agent-live-reconnect';

afterEach(() => {
  vi.useRealTimers();
});

describe('Agent live reconnect loop', () => {
  it('backs off after error and clean EOF, wakes online, and resumes both cursors', async () => {
    vi.useFakeTimers();
    const store = createAgentEventStore();
    store.dispatch({
      type: 'set_session',
      session: {
        resourceId: 'workspace-1',
        threadId: 'thread-1',
        sessionRevision: 1,
      },
    });
    store.dispatch({ type: 'set_connection', connection: 'live' });
    store.dispatch({
      type: 'apply_semantic_event',
      event: agentSemanticEventWireSchema.parse({
        schemaVersion: 'agent-semantic-event/v1',
        threadId: 'thread-1',
        contextRole: 'included',
        sourceDomain: 'agent_run',
        sourceEntityId: 'run-1',
        sourceRevision: '1',
        correlationId: 'corr-1',
        payload: { text: '已连接' },
        occurredAt: '2026-08-09T08:00:00.000Z',
        eventId: 'event-7',
        streamOffset: '7',
        eventType: 'message.final',
      }),
    });

    const replayCursors: Array<string | null> = [];
    const loadReplay: AgentReplayLoader = async ({ clientLastEventId }) => {
      replayCursors.push(clientLastEventId);
      return {
        session: {
          resourceId: 'workspace-1',
          threadId: 'thread-1',
          sessionRevision: 1,
        },
        snapshot: {
          revision: '7',
          lastEventId: 'event-7',
          lastStreamOffset: '7',
        },
        events: [],
      };
    };
    const onlineTarget = new EventTarget();
    const subscribeLive = vi
      .fn()
      .mockRejectedValueOnce(new Error('network reset'))
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(
        ({ signal }: { signal: AbortSignal }) =>
          new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => resolve(), { once: true });
          })
      );
    const controller = new AbortController();
    const loop = runAgentLiveReconnectLoop({
      store,
      loadReplay,
      subscribeLive,
      threadId: 'thread-1',
      signal: controller.signal,
      onlineTarget,
    });

    await flushMicrotasks();
    expect(subscribeLive).toHaveBeenCalledTimes(1);
    expect(store.getState().connection).toBe('offline');

    await vi.advanceTimersByTimeAsync(AGENT_LIVE_RECONNECT_BASE_DELAY_MS - 1);
    expect(subscribeLive).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await flushMicrotasks();
    expect(subscribeLive).toHaveBeenCalledTimes(2);
    expect(store.getState().connection).toBe('offline');

    await vi.advanceTimersByTimeAsync(
      AGENT_LIVE_RECONNECT_BASE_DELAY_MS * 2 - 1
    );
    expect(subscribeLive).toHaveBeenCalledTimes(2);
    onlineTarget.dispatchEvent(new Event('online'));
    await flushMicrotasks();
    expect(subscribeLive).toHaveBeenCalledTimes(3);
    expect(replayCursors).toEqual(['event-7', 'event-7']);
    expect(subscribeLive).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lastEventId: 'event-7',
        lastStreamOffset: '7',
        threadId: 'thread-1',
      })
    );

    controller.abort();
    await loop;
  });
});

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
