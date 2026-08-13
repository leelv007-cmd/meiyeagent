/**
 * V31-83 server-boundary pin.
 *
 * The browser leak plants account A's threadId / workflowId in the next
 * account's tab. The BFF then forwards B's own workspace (never a client-chosen
 * one). This test is the server half: B authenticated as B, sending A's ids,
 * must 4xx. If any path returns 2xx with A's payload, that is a larger hole
 * than the sessionStorage leak.
 */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { agentSemanticEventWireSchema } from '@meiye/contracts';

import { createCoreServer } from '../../server.js';
import {
  WorkflowEventApplicationService,
  type WorkflowEventSource,
} from '../workflow-events.js';
import type { AgentSemanticFrame } from './agent-semantic-frames.js';

const ownerSession = {
  resourceId: 'workspace-a',
  threadId: 'thread-owned-by-a',
  sessionRevision: 2,
};
const ownerEvent = agentSemanticEventWireSchema.parse({
  schemaVersion: 'agent-semantic-event/v1',
  threadId: 'thread-owned-by-a',
  contextRole: 'included',
  sourceDomain: 'marketing_plan',
  sourceEntityId: 'plan-a',
  sourceRevision: '1',
  correlationId: 'run-a',
  payload: { planId: 'plan-a', revision: 1 },
  occurredAt: '2026-08-13T08:00:00.000Z',
  eventId: 'event-a-1',
  streamOffset: '1',
  eventType: 'plan.created',
});

test('V31-83: B with A threadId/workflowId is 404 on replay, events, and workflow stream', async (t) => {
  let replayLoads = 0;
  let streamReads = 0;
  const semanticFrame: AgentSemanticFrame = {
    event: 'agent.semantic',
    data: ownerEvent,
  };
  const workflowSource: WorkflowEventSource = {
    async owns(workspaceId, workflowId) {
      return (
        workspaceId === 'workspace-a' && workflowId === 'workflow-owned-by-a'
      );
    },
    async *stream() {
      streamReads += 1;
      yield {
        event: 'workflow.progress' as const,
        data: {
          eventId: 'workflow-owned-by-a:1',
          message: "A's in-flight copy",
          occurredAt: '2026-08-13T08:00:01.000Z',
          sequence: 1,
          stage: 'brief_compilation',
          state: 'running',
          workflowId: 'workflow-owned-by-a',
          workflowType: 'beauty_marketing',
        },
      };
    },
  };
  const server = createCoreServer({
    agentSemanticEvents: {
      async resolveSession(input) {
        return input.workspaceId === ownerSession.resourceId &&
          input.threadId === ownerSession.threadId
          ? ownerSession
          : null;
      },
      async loadReplay() {
        replayLoads += 1;
        return {
          session: ownerSession,
          snapshot: {
            schemaVersion: 'agent-state-snapshot/v1',
            threadId: ownerSession.threadId,
            resourceId: ownerSession.resourceId,
            revision: '1',
            lastEventId: ownerEvent.eventId,
            lastStreamOffset: ownerEvent.streamOffset,
            session: ownerSession,
            includedEventIds: [ownerEvent.eventId],
            summarizedEventIds: [],
            excludedEventIds: [],
          },
          events: [ownerEvent],
        };
      },
      async *streamReplay() {
        streamReads += 1;
        yield semanticFrame;
      },
    },
    serviceToken: 'v31-83-token',
    workflowEvents: new WorkflowEventApplicationService([workflowSource]),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const ownerHeaders = {
    'x-service-token': 'v31-83-token',
    'x-user-id': 'owner-a',
    'x-workspace-id': 'workspace-a',
    'x-workspace-role': 'owner',
  };
  const foreignHeaders = {
    'x-service-token': 'v31-83-token',
    'x-user-id': 'owner-b',
    'x-workspace-id': 'workspace-b',
    'x-workspace-role': 'owner',
  };

  const ownerReplay = await fetch(
    `http://127.0.0.1:${port}/v1/workspaces/workspace-a/p1/agent-threads/thread-owned-by-a/replay`,
    { headers: ownerHeaders }
  );
  assert.equal(ownerReplay.status, 200);
  assert.equal((await ownerReplay.json()).data.events[0].eventId, 'event-a-1');
  assert.equal(replayLoads, 1);

  const foreignReplay = await fetch(
    `http://127.0.0.1:${port}/v1/workspaces/workspace-b/p1/agent-threads/thread-owned-by-a/replay`,
    { headers: foreignHeaders }
  );
  assert.equal(foreignReplay.status, 404);
  assert.equal(replayLoads, 1);
  assert.match(
    await foreignReplay.text(),
    /Agent Thread was not found in this workspace/u
  );

  const foreignEvents = await fetch(
    `http://127.0.0.1:${port}/v1/workspaces/workspace-b/p1/agent-threads/thread-owned-by-a/events`,
    { headers: foreignHeaders }
  );
  assert.equal(foreignEvents.status, 404);
  assert.equal(streamReads, 0);

  const foreignWorkflow = await fetch(
    `http://127.0.0.1:${port}/v1/workspaces/workspace-b/p1/workflows/workflow-owned-by-a/events`,
    { headers: foreignHeaders }
  );
  assert.equal(foreignWorkflow.status, 404);
  assert.equal(streamReads, 0);
});
