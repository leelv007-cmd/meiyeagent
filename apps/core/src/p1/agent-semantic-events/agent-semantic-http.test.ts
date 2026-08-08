import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import {
  agentSemanticEventWireSchema,
  type DiagnosticRun,
} from '@meiye/contracts';

import type { DiagnosticRepository } from '../../diagnostics/repository.js';
import { createCoreServer } from '../../server.js';
import type { AgentSemanticFrame } from './agent-semantic-frames.js';

const diagnostics: DiagnosticRepository = {
  async create(run: DiagnosticRun) {
    return run;
  },
  async get() {
    return null;
  },
  async save(run: DiagnosticRun) {
    return run;
  },
};

const session = {
  resourceId: 'workspace-a',
  threadId: 'thread-a',
  sessionRevision: 2,
};
const event = agentSemanticEventWireSchema.parse({
  schemaVersion: 'agent-semantic-event/v1',
  threadId: 'thread-a',
  contextRole: 'included',
  sourceDomain: 'marketing_plan',
  sourceEntityId: 'plan-a',
  sourceRevision: '1',
  correlationId: 'run-a',
  payload: { planId: 'plan-a', revision: 1 },
  occurredAt: '2026-08-09T08:00:00.000Z',
  eventId: 'event-a-1',
  streamOffset: '1',
  eventType: 'plan.created',
});

test('Agent semantic replay and SSE require workspace auth and preserve cursors', async (t) => {
  const replayCursors: Array<string | undefined> = [];
  const streamCursors: Array<{
    lastEventId?: string;
    lastStreamOffset?: string;
  }> = [];
  const semanticFrame: AgentSemanticFrame = {
    event: 'agent.semantic',
    data: event,
  };
  const server = createCoreServer({
    agentSemanticEvents: {
      async resolveSession(input) {
        return input.workspaceId === session.resourceId &&
          input.threadId === session.threadId
          ? session
          : null;
      },
      async loadReplay(input) {
        replayCursors.push(input.clientLastEventId);
        return {
          session,
          snapshot: {
            schemaVersion: 'agent-state-snapshot/v1',
            threadId: session.threadId,
            resourceId: session.resourceId,
            revision: '1',
            lastEventId: event.eventId,
            lastStreamOffset: event.streamOffset,
            session,
            includedEventIds: [event.eventId],
            summarizedEventIds: [],
            excludedEventIds: [],
          },
          events: [event],
        };
      },
      async *streamReplay(input) {
        streamCursors.push({
          ...(input.lastEventId ? { lastEventId: input.lastEventId } : {}),
          ...(input.lastStreamOffset
            ? { lastStreamOffset: input.lastStreamOffset }
            : {}),
        });
        yield semanticFrame;
      },
    },
    diagnosticRepository: diagnostics,
    serviceToken: 'semantic-test-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const headers = {
    'x-service-token': 'semantic-test-token',
    'x-user-id': 'owner-a',
    'x-workspace-id': 'workspace-a',
    'x-workspace-role': 'owner',
  };
  const base = `http://127.0.0.1:${port}/v1/workspaces/workspace-a/p1/agent-threads/thread-a`;

  const unauthenticated = await fetch(`${base}/replay`);
  assert.equal(unauthenticated.status, 401);

  const replay = await fetch(`${base}/replay?lastEventId=event-a-0`, {
    headers,
  });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).data.events[0].eventId, 'event-a-1');
  assert.deepEqual(replayCursors, ['event-a-0']);

  const foreign = await fetch(
    `http://127.0.0.1:${port}/v1/workspaces/workspace-b/p1/agent-threads/thread-a/replay`,
    {
      headers: {
        ...headers,
        'x-workspace-id': 'workspace-b',
      },
    }
  );
  assert.equal(foreign.status, 404);
  assert.deepEqual(replayCursors, ['event-a-0']);

  const streamed = await fetch(`${base}/events?lastStreamOffset=7`, {
    headers,
  });
  const body = await streamed.text();
  assert.equal(streamed.status, 200);
  assert.equal(
    streamed.headers.get('x-meiye-stream-protocol'),
    'agent-semantic-events-v1'
  );
  assert.match(body, /id: event-a-1\nevent: agent\.semantic/u);
  assert.deepEqual(streamCursors, [{ lastStreamOffset: '7' }]);
});
