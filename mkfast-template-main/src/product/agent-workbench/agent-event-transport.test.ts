import assert from 'node:assert/strict';
import test from 'node:test';

import { agentSemanticEventWireSchema } from '@meiye/contracts';

import {
  loadAgentWorkbenchReplay,
  subscribeAgentSemanticEvents,
} from './agent-event-transport';

const event = agentSemanticEventWireSchema.parse({
  schemaVersion: 'agent-semantic-event/v1',
  threadId: 'thread-1',
  contextRole: 'included',
  sourceDomain: 'marketing_plan',
  sourceEntityId: 'plan-1',
  sourceRevision: '1',
  correlationId: 'run-1',
  payload: {
    planId: 'plan-1',
    revision: 1,
    goal: { summary: '夏日护理' },
    deliverables: [{ kind: 'note', quantity: 4 }],
  },
  occurredAt: '2026-08-09T08:00:00.000Z',
  eventId: 'event-8',
  streamOffset: '8',
  eventType: 'plan.created',
});

test('authenticated replay transport forwards the Thread cursor', async () => {
  const previousFetch = globalThis.fetch;
  let request: Request | undefined;
  globalThis.fetch = async (input, init) => {
    request = new Request(new URL(String(input), 'http://localhost'), init);
    return Response.json({
      data: {
        session: {
          resourceId: 'workspace-1',
          threadId: 'thread-1',
          sessionRevision: 2,
          recent: { taskId: 'task-a', workId: 'work-a' },
        },
        snapshot: {
          revision: '8',
          lastEventId: 'event-8',
          lastStreamOffset: '8',
        },
        events: [event],
        recentTaskId: 'task-a',
      },
      meta: { correlationId: 'corr-replay' },
    });
  };
  try {
    const replay = await loadAgentWorkbenchReplay({
      clientLastEventId: 'event-7',
      explicitTaskId: null,
      threadId: 'thread-1',
    });
    assert.equal(
      request?.url,
      'http://localhost/api/core/p1/agent-threads/thread-1/replay?lastEventId=event-7'
    );
    assert.equal(replay.events[0]?.eventId, 'event-8');
    assert.equal(replay.recentTaskId, 'task-a');
    assert.equal(replay.session.recent?.taskId, 'task-a');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('live transport resumes from replay cursors and parses semantic SSE', async () => {
  const previousFetch = globalThis.fetch;
  let request: Request | undefined;
  globalThis.fetch = async (input, init) => {
    request = new Request(new URL(String(input), 'http://localhost'), init);
    const frame = `id: event-8\nevent: agent.semantic\ndata: ${JSON.stringify(event)}\n\n`;
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          const bytes = new TextEncoder().encode(frame);
          controller.enqueue(bytes.slice(0, 31));
          controller.enqueue(bytes.slice(31));
          controller.close();
        },
      }),
      { headers: { 'content-type': 'text/event-stream' }, status: 200 }
    );
  };
  const received: string[] = [];
  try {
    await subscribeAgentSemanticEvents({
      threadId: 'thread-1',
      lastEventId: 'event-7',
      lastStreamOffset: '7',
      signal: new AbortController().signal,
      onEvent: (candidate) => {
        received.push(candidate.eventId);
      },
    });
    assert.equal(
      request?.url,
      'http://localhost/api/core/p1/agent-threads/thread-1/events?lastEventId=event-7&lastStreamOffset=7'
    );
    assert.equal(request?.headers.get('last-event-id'), 'event-7');
    assert.deepEqual(received, ['event-8']);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
