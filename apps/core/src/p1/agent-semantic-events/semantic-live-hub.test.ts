import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentSemanticEventProjector } from './semantic-event-projector.js';
import { AgentSemanticLiveHub } from './semantic-live-hub.js';
import { MemoryAgentSemanticEventStore } from './memory-semantic-event-store.js';

const TS = '2026-08-09T08:00:00.000Z';

test('streamReplay closes the backlog/live race and abort removes subscriber', async () => {
  const store = new MemoryAgentSemanticEventStore();
  const hub = new AgentSemanticLiveHub();
  const projector = new AgentSemanticEventProjector(store, hub);
  const abort = new AbortController();
  const stream = projector
    .streamReplay({ session: session('thread-a'), signal: abort.signal })
    [Symbol.asyncIterator]();

  const initial = await stream.next();
  assert.equal(initial.value?.event, 'agent.state');
  assert.equal(hub.subscriberCount, 1);

  await projector.project(candidate('event-a1', 'thread-a'));
  await projector.project(candidate('event-b1', 'thread-b'));
  const live = await stream.next();
  assert.equal(live.value?.event, 'agent.semantic');
  if (live.value?.event === 'agent.semantic') {
    assert.equal(live.value.data.eventId, 'event-a1');
  }

  abort.abort();
  assert.equal((await stream.next()).done, true);
  assert.equal(hub.subscriberCount, 0);
});

test('streamReplay continues from lastStreamOffset before staying live', async () => {
  const store = new MemoryAgentSemanticEventStore();
  const hub = new AgentSemanticLiveHub();
  const projector = new AgentSemanticEventProjector(store, hub);
  await projector.project(candidate('event-1', 'thread-a'));
  await projector.project(candidate('event-2', 'thread-a'));

  const abort = new AbortController();
  const stream = projector
    .streamReplay({
      session: session('thread-a'),
      lastStreamOffset: '1',
      signal: abort.signal,
    })
    [Symbol.asyncIterator]();
  const replayed = await stream.next();
  assert.equal(replayed.value?.event, 'agent.semantic');
  if (replayed.value?.event === 'agent.semantic') {
    assert.equal(replayed.value.data.eventId, 'event-2');
  }
  assert.equal((await stream.next()).value?.event, 'agent.state');
  abort.abort();
  assert.equal((await stream.next()).done, true);
});

function session(threadId: string) {
  return {
    resourceId: 'workspace-1',
    threadId,
    sessionRevision: 1,
  };
}

function candidate(eventId: string, threadId: string) {
  return {
    eventId,
    threadId,
    resourceId: 'workspace-1',
    contextRole: 'included' as const,
    sourceDomain: 'test',
    sourceEntityId: 'source-1',
    sourceRevision: '1',
    correlationId: 'corr-1',
    eventType: 'message.final',
    payload: { text: eventId },
    occurredAt: TS,
  };
}
