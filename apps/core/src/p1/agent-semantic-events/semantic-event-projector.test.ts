/**
 * V31-03 main seam: P1 projector actions + SSE frame stream.
 * Authority: V3.1 §27 — streamOffset, contextRole, ephemeral, snapshot+replay.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGENT_SEMANTIC_EVENT_TYPES,
  agentSemanticEventToWire,
  compareStreamOffsetWire,
  type AgentSemanticEvent,
  type WorkflowProgressEnvelope,
  type WorkflowTokenEnvelope,
} from '@meiye/contracts';

import {
  agentSemanticFrameId,
  encodeAgentSemanticSseFrame,
  isDurableFrame,
} from './agent-semantic-frames.js';
import {
  AG_UI_OUTPUT_EVENT_TYPES,
  isAgUiEnumString,
  toAgUiOutput,
} from './ag-ui-adapter.js';
import { MemoryAgentSemanticEventStore } from './memory-semantic-event-store.js';
import {
  AgentSemanticEventProjector,
  asWriteProbe,
} from './semantic-event-projector.js';
import {
  applyEventsInOrder,
  applySemanticEvent,
  emptyStateSnapshot,
  type WorkbenchSessionProjection,
} from './snapshot-replay.js';
import type { SemanticEventCandidate } from './semantic-event-store.js';

const RESOURCE = 'resource-projector';
const THREAD_A = 'thread-a';
const THREAD_B = 'thread-b';
const TS = '2026-08-08T10:00:00.000Z';

function candidate(
  overrides: Partial<SemanticEventCandidate> &
    Pick<SemanticEventCandidate, 'eventId' | 'threadId'>,
): SemanticEventCandidate {
  return {
    resourceId: RESOURCE,
    contextRole: 'included',
    sourceDomain: 'agent_run',
    sourceEntityId: 'run-1',
    sourceRevision: '1',
    correlationId: 'corr-1',
    eventType: 'run.started',
    payload: { ok: true },
    occurredAt: TS,
    ...overrides,
  };
}

function session(
  threadId: string,
  overrides: Partial<WorkbenchSessionProjection> = {},
): WorkbenchSessionProjection {
  return {
    resourceId: RESOURCE,
    threadId,
    sessionRevision: 1,
    ...overrides,
  };
}

test('projector assigns per-thread monotonic streamOffset (domain bigint / wire decimal)', async () => {
  const store = new MemoryAgentSemanticEventStore();
  const projector = new AgentSemanticEventProjector(store);

  const first = await projector.project(
    candidate({ eventId: 'evt-1', threadId: THREAD_A }),
  );
  const second = await projector.project(
    candidate({
      eventId: 'evt-2',
      threadId: THREAD_A,
      eventType: 'message.final',
      contextRole: 'included',
    }),
  );
  const otherThread = await projector.project(
    candidate({ eventId: 'evt-b1', threadId: THREAD_B }),
  );

  assert.equal(first.event.streamOffset, 1n);
  assert.equal(second.event.streamOffset, 2n);
  assert.equal(otherThread.event.streamOffset, 1n);
  assert.equal(first.replayed, false);

  const wire = agentSemanticEventToWire(second.event);
  assert.equal(wire.streamOffset, '2');
  assert.equal(compareStreamOffsetWire('9', '10'), -1);
  assert.equal(compareStreamOffsetWire('100', '20'), 1);
});

test('contextRole included|excluded|summarized is preserved on projection', async () => {
  const store = new MemoryAgentSemanticEventStore();
  const projector = new AgentSemanticEventProjector(store);

  for (const role of ['included', 'excluded', 'summarized'] as const) {
    const projected = await projector.project(
      candidate({
        eventId: `evt-role-${role}`,
        threadId: THREAD_A,
        contextRole: role,
        eventType: 'activity.snapshot',
      }),
    );
    assert.equal(projected.event.contextRole, role);
  }

  const snapshot = await projector.loadReplay({ session: session(THREAD_A) });
  assert.deepEqual(snapshot.snapshot.includedEventIds, ['evt-role-included']);
  assert.deepEqual(snapshot.snapshot.excludedEventIds, ['evt-role-excluded']);
  assert.deepEqual(snapshot.snapshot.summarizedEventIds, [
    'evt-role-summarized',
  ]);
});

test('eventId replay is idempotent and does not consume a new streamOffset', async () => {
  const store = new MemoryAgentSemanticEventStore();
  const projector = new AgentSemanticEventProjector(store);

  const first = await projector.project(
    candidate({ eventId: 'evt-idem', threadId: THREAD_A }),
  );
  const replay = await projector.project(
    candidate({ eventId: 'evt-idem', threadId: THREAD_A }),
  );
  const next = await projector.project(
    candidate({ eventId: 'evt-next', threadId: THREAD_A }),
  );

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.event.streamOffset, first.event.streamOffset);
  assert.equal(next.event.streamOffset, 2n);
  assert.equal(store.writeCount, 2);
});

test('an eventId cannot be replayed under another memory boundary', async () => {
  const store = new MemoryAgentSemanticEventStore();
  await store.appendProjected(candidate({ eventId: 'evt-boundary', threadId: THREAD_A }));

  await assert.rejects(
    store.appendProjected(
      candidate({
        eventId: 'evt-boundary',
        threadId: THREAD_B,
        resourceId: 'resource-foreign',
      }),
    ),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'AGENT_SEMANTIC_EVENT_CONFLICT',
  );
});

test('ephemeral token frames are transient and never increment store writes', async () => {
  const store = new MemoryAgentSemanticEventStore();
  const live: { frames: unknown[] } = { frames: [] };
  const projector = new AgentSemanticEventProjector(store, {
    publish(frame) {
      live.frames.push(frame);
    },
  });

  const writesBefore = store.writeCount;
  const token: WorkflowTokenEnvelope = {
    eventId: 'tok-1',
    workflowId: 'workflow-a',
    sequence: 1,
    candidateId: 'c01',
    channel: 'copy.body',
    delta: '你好',
    occurredAt: TS,
  };

  for (let i = 0; i < 20; i += 1) {
    const wire = projector.emitWorkflowToken({
      threadId: THREAD_A,
      runId: 'run-1',
      token: { ...token, eventId: `tok-${i}`, delta: `字${i}` },
    });
    assert.equal(wire.transient, true);
    assert.equal(wire.schemaVersion, 'agent-ephemeral-event/v1');
  }

  assert.equal(store.writeCount, writesBefore);
  assert.equal(asWriteProbe(store)?.writeCount, 0);
  assert.equal(live.frames.length, 20);
  assert.ok(
    live.frames.every(
      (frame) =>
        typeof frame === 'object' &&
        frame !== null &&
        (frame as { event: string }).event === 'agent.ephemeral',
    ),
  );

  // Semantic recovery path is empty — ephemeral never participated.
  const replay = await projector.loadReplay({ session: session(THREAD_A) });
  assert.equal(replay.snapshot.lastEventId, null);
  assert.deepEqual(replay.events, []);
});

test('snapshot+replay is equivalent under out-of-order and duplicate delivery', async () => {
  const store = new MemoryAgentSemanticEventStore();
  const projector = new AgentSemanticEventProjector(store);

  const projected: AgentSemanticEvent[] = [];
  for (const [id, type] of [
    ['e1', 'run.started'],
    ['e2', 'message.final'],
    ['e3', 'activity.snapshot'],
  ] as const) {
    const result = await projector.project(
      candidate({
        eventId: id,
        threadId: THREAD_A,
        eventType: type,
        contextRole: type === 'activity.snapshot' ? 'excluded' : 'included',
      }),
    );
    projected.push(result.event);
  }

  const sequential = applyEventsInOrder(
    emptyStateSnapshot(session(THREAD_A)),
    projected,
  );

  // Out-of-order: reverse arrival, plus a duplicate of e1.
  const shuffled = [projected[2]!, projected[0]!, projected[0]!, projected[1]!];
  const outOfOrder = applyEventsInOrder(
    emptyStateSnapshot(session(THREAD_A)),
    shuffled,
  );

  assert.deepEqual(outOfOrder.includedEventIds, sequential.includedEventIds);
  assert.deepEqual(outOfOrder.excludedEventIds, sequential.excludedEventIds);
  assert.equal(outOfOrder.lastEventId, sequential.lastEventId);
  assert.equal(outOfOrder.lastStreamOffset, sequential.lastStreamOffset);
  assert.equal(outOfOrder.revision, '3');

  const dup = applySemanticEvent(sequential, projected[1]!);
  assert.equal(dup.duplicate, true);
  assert.deepEqual(dup.snapshot, sequential);
});

test('cross-thread events are isolated on store reads and reducer apply', async () => {
  const store = new MemoryAgentSemanticEventStore();
  const projector = new AgentSemanticEventProjector(store);

  await projector.project(candidate({ eventId: 'a1', threadId: THREAD_A }));
  await projector.project(candidate({ eventId: 'b1', threadId: THREAD_B }));
  await projector.project(
    candidate({
      eventId: 'a2',
      threadId: THREAD_A,
      eventType: 'message.final',
    }),
  );

  const aEvents = await store.listByThread({
    resourceId: RESOURCE,
    threadId: THREAD_A,
  });
  const bEvents = await store.listByThread({
    resourceId: RESOURCE,
    threadId: THREAD_B,
  });
  assert.deepEqual(
    aEvents.map((e) => e.eventId),
    ['a1', 'a2'],
  );
  assert.deepEqual(
    bEvents.map((e) => e.eventId),
    ['b1'],
  );
  assert.equal(aEvents[0]?.streamOffset, 1n);
  assert.equal(bEvents[0]?.streamOffset, 1n);

  // Foreign resource cannot see the stream.
  assert.deepEqual(
    await store.listByThread({
      resourceId: 'resource-other',
      threadId: THREAD_A,
    }),
    [],
  );

  const snapA = emptyStateSnapshot(session(THREAD_A));
  const foreign = applySemanticEvent(snapA, bEvents[0]!);
  assert.equal(foreign.foreign, true);
  assert.deepEqual(foreign.snapshot, snapA);
});

test('reconnect chain: session → StateSnapshot → lastEventId replay via SSE frames', async () => {
  const store = new MemoryAgentSemanticEventStore();
  const projector = new AgentSemanticEventProjector(store);

  await projector.project(candidate({ eventId: 'r1', threadId: THREAD_A }));
  await projector.project(
    candidate({
      eventId: 'r2',
      threadId: THREAD_A,
      eventType: 'message.final',
    }),
  );
  await projector.project(
    candidate({
      eventId: 'r3',
      threadId: THREAD_A,
      eventType: 'work.delivered',
    }),
  );

  const frames: string[] = [];
  for await (const frame of projector.streamReplay({
    session: session(THREAD_A),
    lastEventId: 'r1',
  })) {
    frames.push(encodeAgentSemanticSseFrame(frame));
    if (frame.event === 'agent.semantic') {
      assert.equal(typeof frame.data.streamOffset, 'string');
      assert.match(frame.data.streamOffset, /^(0|[1-9]\d*)$/u);
      assert.ok(isDurableFrame(frame));
    }
  }

  assert.equal(frames.length, 3); // r2, r3, state
  assert.match(frames[0]!, /^id: r2\nevent: agent\.semantic\n/u);
  assert.match(frames[1]!, /^id: r3\nevent: agent\.semantic\n/u);
  assert.match(frames[2]!, /event: agent\.state\n/u);
  assert.equal(
    agentSemanticFrameId({
      event: 'agent.semantic',
      data: agentSemanticEventToWire(
        (await store.getByEventId({ resourceId: RESOURCE, eventId: 'r2' }))!,
      ),
    }),
    'r2',
  );

  const packageAfter = await projector.loadReplay({
    session: session(THREAD_A),
    clientLastEventId: 'r1',
  });
  assert.equal(packageAfter.snapshot.lastEventId, 'r3');
  assert.deepEqual(
    packageAfter.events.map((e) => e.eventId),
    ['r2', 'r3'],
  );
});

test('AG-UI is output adapter only; domain event types never use AG-UI enums', async () => {
  const store = new MemoryAgentSemanticEventStore();
  const projector = new AgentSemanticEventProjector(store);

  for (const eventType of AGENT_SEMANTIC_EVENT_TYPES) {
    assert.equal(isAgUiEnumString(eventType), false);
  }

  const projected = await projector.project(
    candidate({
      eventId: 'agui-1',
      threadId: THREAD_A,
      eventType: 'run.started',
    }),
  );
  assert.equal(isAgUiEnumString(projected.event.eventType), false);
  assert.equal(projected.event.eventType, 'run.started');

  const agui = toAgUiOutput(projected.event);
  assert.deepEqual(
    agui.map((e) => e.type),
    ['RUN_STARTED'],
  );
  assert.ok(AG_UI_OUTPUT_EVENT_TYPES.includes(agui[0]!.type));

  const message = await projector.project(
    candidate({
      eventId: 'agui-2',
      threadId: THREAD_A,
      eventType: 'message.final',
    }),
  );
  assert.deepEqual(
    toAgUiOutput(message.event).map((e) => e.type),
    ['TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END'],
  );
});

test('workflow.progress projects to durable activity; workflow.token stays ephemeral', async () => {
  const store = new MemoryAgentSemanticEventStore();
  const projector = new AgentSemanticEventProjector(store);

  const progress: WorkflowProgressEnvelope = {
    eventId: 'wf-progress-1',
    workflowId: 'task-a',
    workflowType: 'beauty_marketing',
    sequence: 1,
    stage: 'intent_naming',
    state: 'running',
    occurredAt: TS,
    message: '正在理解你的需求',
  };

  const semantic = await projector.projectWorkflowProgress({
    resourceId: RESOURCE,
    threadId: THREAD_A,
    progress,
  });
  assert.equal(semantic.event.eventType, 'activity.snapshot');
  assert.equal(semantic.event.contextRole, 'excluded');
  assert.equal(semantic.event.streamOffset, 1n);
  assert.equal(store.writeCount, 1);

  projector.emitWorkflowToken({
    threadId: THREAD_A,
    token: {
      eventId: 'wf-token-1',
      workflowId: 'task-a',
      sequence: 2,
      candidateId: 'c01',
      channel: 'copy.title',
      delta: '标题',
      occurredAt: TS,
    },
  });
  assert.equal(store.writeCount, 1);
});

test('shadow projector public surface stays on event/stream (no billing/task writers)', async () => {
  const mod = await import('./index.js');
  const surface = Object.keys(mod);
  assert.ok(surface.includes('AgentSemanticEventProjector'));
  assert.ok(surface.includes('toAgUiOutput'));
  assert.ok(!surface.some((key) => /billing|ledger|debit|TaskStore/i.test(key)));
});
