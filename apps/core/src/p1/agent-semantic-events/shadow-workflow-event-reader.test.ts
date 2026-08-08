/**
 * V31-03 shadow dual-write gate: agent_semantic_event_adapter_v1 hot-read.
 * flag off ⇒ zero projection writes; flag on ⇒ progress persists, token does not.
 * Consumer frames from the wrapped reader are byte-identical to the inner stream.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  WorkflowProgressEnvelope,
  WorkflowStateEnvelope,
  WorkflowTokenEnvelope,
} from '@meiye/contracts';

import type { HarnessWorkflowEventReader } from '../workflow-events.js';
import {
  HarnessWorkflowEventSource,
  WorkflowEventApplicationService,
} from '../workflow-events.js';
import { MemoryAgentSemanticEventStore } from './memory-semantic-event-store.js';
import {
  AgentSemanticEventProjector,
  resolveAgentSemanticEventAdapterEnabled,
  shadowThreadIdForWorkflow,
} from './semantic-event-projector.js';
import { ShadowSemanticWorkflowEventReader } from './shadow-workflow-event-reader.js';

const TS = '2026-08-08T18:00:00.000Z';
const WORKSPACE = 'workspace-shadow';
const WORKFLOW = 'task-shadow';

const progress: WorkflowProgressEnvelope = {
  eventId: 'task-shadow:1',
  message: '正在理解你的需求',
  occurredAt: TS,
  sequence: 1,
  stage: 'intent_naming',
  state: 'running',
  workflowId: WORKFLOW,
  workflowType: 'beauty_marketing',
};

const token: WorkflowTokenEnvelope = {
  eventId: 'task-shadow:token:2',
  workflowId: WORKFLOW,
  sequence: 2,
  candidateId: 'c01',
  channel: 'copy.body',
  delta: '正文片段',
  occurredAt: '2026-08-08T18:00:01.000Z',
};

const terminalState: WorkflowStateEnvelope = {
  occurredAt: '2026-08-08T18:00:02.000Z',
  snapshot: { packageId: 'package-shadow' },
  sourceRevision: 4,
  status: 'success',
  workflowId: WORKFLOW,
};

function fixedReader(
  events: Array<WorkflowProgressEnvelope | WorkflowTokenEnvelope>,
): HarnessWorkflowEventReader {
  return {
    async owns(workspaceId, workflowId) {
      return workspaceId === WORKSPACE && workflowId === WORKFLOW;
    },
    async *readEvents() {
      for (const event of events) yield event;
    },
    async readState() {
      return terminalState;
    },
  };
}

async function collectRaw(
  reader: HarnessWorkflowEventReader,
): Promise<Array<WorkflowProgressEnvelope | WorkflowTokenEnvelope>> {
  const out: Array<WorkflowProgressEnvelope | WorkflowTokenEnvelope> = [];
  for await (const event of reader.readEvents(
    WORKSPACE,
    WORKFLOW,
    new AbortController().signal,
  )) {
    out.push(event);
  }
  return out;
}

test('resolveAgentSemanticEventAdapterEnabled defaults off; only explicit true enables', async () => {
  assert.equal(
    await resolveAgentSemanticEventAdapterEnabled({
      async get() {
        return null;
      },
    }),
    false,
  );
  assert.equal(
    await resolveAgentSemanticEventAdapterEnabled({
      async get() {
        return { value: false };
      },
    }),
    false,
  );
  assert.equal(
    await resolveAgentSemanticEventAdapterEnabled({
      async get() {
        return { value: true };
      },
    }),
    true,
  );
});

test('flag off: shadow reader yields identical events and performs zero store writes', async () => {
  const store = new MemoryAgentSemanticEventStore();
  const projector = new AgentSemanticEventProjector(store);
  const inner = fixedReader([progress, token]);
  const shadowed = new ShadowSemanticWorkflowEventReader(
    inner,
    projector,
    false,
  );

  const frames = await collectRaw(shadowed);
  assert.deepEqual(frames, [progress, token]);
  assert.equal(store.writeCount, 0);
  assert.deepEqual(
    await store.listByThread({
      resourceId: WORKSPACE,
      threadId: shadowThreadIdForWorkflow(WORKFLOW),
    }),
    [],
  );
});

test('flag on: progress projects to store; token stays ephemeral (zero extra write)', async () => {
  const store = new MemoryAgentSemanticEventStore();
  const projector = new AgentSemanticEventProjector(store);
  let enabled = true;
  const shadowed = new ShadowSemanticWorkflowEventReader(
    fixedReader([progress, token, { ...progress, eventId: 'task-shadow:3', sequence: 3 }]),
    projector,
    () => enabled,
  );

  const frames = await collectRaw(shadowed);
  assert.equal(frames.length, 3);
  assert.equal(frames[0], progress);
  assert.equal(frames[1], token);

  assert.equal(store.writeCount, 2); // two progress frames only
  const projected = await store.listByThread({
    resourceId: WORKSPACE,
    threadId: shadowThreadIdForWorkflow(WORKFLOW),
  });
  assert.deepEqual(
    projected.map((event) => event.eventId),
    ['task-shadow:1', 'task-shadow:3'],
  );
  assert.equal(projected[0]?.eventType, 'activity.snapshot');
  assert.equal(projected[0]?.streamOffset, 1n);
  assert.equal(projected[1]?.streamOffset, 2n);
});

test('flag on does not alter HarnessWorkflowEventSource consumer frames', async () => {
  const store = new MemoryAgentSemanticEventStore();
  const projector = new AgentSemanticEventProjector(store);
  const source = new HarnessWorkflowEventSource(
    new ShadowSemanticWorkflowEventReader(
      fixedReader([progress, token]),
      projector,
      true,
    ),
  );
  const service = new WorkflowEventApplicationService([source]);
  const subscription = await service.subscribe({
    signal: new AbortController().signal,
    workflowId: WORKFLOW,
    workspaceId: WORKSPACE,
  });
  assert.ok(subscription);
  const frames = [];
  for await (const frame of subscription.frames) {
    frames.push(frame);
  }

  assert.deepEqual(
    frames.map((frame) => frame.event),
    ['workflow.progress', 'workflow.token', 'workflow.state'],
  );
  assert.equal(frames[0]?.event, 'workflow.progress');
  if (frames[0]?.event === 'workflow.progress') {
    assert.equal(frames[0].data.eventId, progress.eventId);
    assert.equal(frames[0].data.message, progress.message);
  }
  assert.equal(frames[1]?.event, 'workflow.token');
  if (frames[1]?.event === 'workflow.token') {
    assert.equal(frames[1].data.delta, token.delta);
  }
  // Shadow side-effect still landed for progress only.
  assert.equal(store.writeCount, 1);
});

test('shadow projection errors never break the consumer stream', async () => {
  const store = new MemoryAgentSemanticEventStore();
  const projector = new AgentSemanticEventProjector(store);
  const original = projector.projectWorkflowProgress.bind(projector);
  projector.projectWorkflowProgress = async () => {
    throw new Error('shadow store offline');
  };

  const shadowed = new ShadowSemanticWorkflowEventReader(
    fixedReader([progress, token]),
    projector,
    true,
  );
  const frames = await collectRaw(shadowed);
  assert.deepEqual(frames, [progress, token]);
  assert.equal(store.writeCount, 0);

  projector.projectWorkflowProgress = original;
});
