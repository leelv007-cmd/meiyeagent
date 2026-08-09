import { agentSemanticEventWireSchema } from '@meiye/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentReplayLoader } from './agent-event-client';
import type { AgentLiveSubscriber } from './agent-event-transport';
import { createAgentEventStore } from './agent-event-store';
import {
  AGENT_LIVE_RECONNECT_BASE_DELAY_MS,
  AGENT_LIVE_RECONNECT_STABLE_MS,
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

  it('keeps backing off when a flapping stream delivers one event per attempt', async () => {
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

    const loadReplay: AgentReplayLoader = async () => ({
      session: {
        resourceId: 'workspace-1',
        threadId: 'thread-1',
        sessionRevision: 1,
      },
      snapshot: { revision: '0', lastEventId: null, lastStreamOffset: null },
      events: [],
    });
    let offset = 0;
    // Each attempt hands over exactly one usable event and then ends — the
    // shape a degraded stream has. Resetting the backoff on the event pinned
    // every retry at the base delay.
    const subscribeLive = vi.fn<AgentLiveSubscriber>(
      async ({ onEvent }) => {
        offset += 1;
        await onEvent(
          agentSemanticEventWireSchema.parse({
            schemaVersion: 'agent-semantic-event/v1',
            threadId: 'thread-1',
            contextRole: 'included',
            sourceDomain: 'agent_run',
            sourceEntityId: 'run-1',
            sourceRevision: String(offset),
            correlationId: 'corr-1',
            payload: { text: `第 ${offset} 条` },
            occurredAt: '2026-08-09T08:00:00.000Z',
            eventId: `event-${offset}`,
            streamOffset: String(offset),
            eventType: 'message.final',
          })
        );
      }
    );
    const controller = new AbortController();
    const loop = runAgentLiveReconnectLoop({
      store,
      loadReplay,
      subscribeLive,
      threadId: 'thread-1',
      signal: controller.signal,
    });

    await flushMicrotasks();
    expect(subscribeLive).toHaveBeenCalledTimes(1);
    // Attempt 2 after the base delay, attempt 3 only after twice that.
    await vi.advanceTimersByTimeAsync(AGENT_LIVE_RECONNECT_BASE_DELAY_MS);
    await flushMicrotasks();
    expect(subscribeLive).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(AGENT_LIVE_RECONNECT_BASE_DELAY_MS);
    await flushMicrotasks();
    expect(subscribeLive).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(AGENT_LIVE_RECONNECT_BASE_DELAY_MS);
    await flushMicrotasks();
    expect(subscribeLive).toHaveBeenCalledTimes(3);

    controller.abort();
    await loop;
  });

  it('resets the backoff after a subscription outlives the maximum delay', async () => {
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

    const loadReplay: AgentReplayLoader = async () => ({
      session: {
        resourceId: 'workspace-1',
        threadId: 'thread-1',
        sessionRevision: 1,
      },
      snapshot: { revision: '0', lastEventId: null, lastStreamOffset: null },
      events: [],
    });
    const subscribeLive = vi
      .fn()
      // Two quick failures push the delay to twice the base.
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      // Then a healthy connection that survives past the stable window.
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, AGENT_LIVE_RECONNECT_STABLE_MS + 1);
          })
      )
      .mockResolvedValue(undefined);
    const controller = new AbortController();
    const loop = runAgentLiveReconnectLoop({
      store,
      loadReplay,
      subscribeLive,
      threadId: 'thread-1',
      signal: controller.signal,
    });

    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(AGENT_LIVE_RECONNECT_BASE_DELAY_MS);
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(AGENT_LIVE_RECONNECT_BASE_DELAY_MS * 2);
    await flushMicrotasks();
    expect(subscribeLive).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(AGENT_LIVE_RECONNECT_STABLE_MS + 1);
    await flushMicrotasks();
    // The long connection ended; the next attempt is back at the base delay
    // rather than continuing to grow from where it left off.
    await vi.advanceTimersByTimeAsync(AGENT_LIVE_RECONNECT_BASE_DELAY_MS);
    await flushMicrotasks();
    expect(subscribeLive).toHaveBeenCalledTimes(4);

    controller.abort();
    await loop;
  });
});

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
