import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  WorkflowProgressEnvelope,
  WorkflowStateEnvelope,
  WorkflowTokenEnvelope,
} from '@meiye/contracts';

import {
  HarnessWorkflowEventSource,
  VideoWorkflowEventSource,
  WorkflowEventApplicationService,
  workflowEventFrameId,
} from './workflow-events.js';

const firstProgress: WorkflowProgressEnvelope = {
  eventId: 'task-a:1',
  message: '正在理解你的需求',
  occurredAt: '2026-07-18T08:00:00.000Z',
  sequence: 1,
  stage: 'intent_naming',
  state: 'running',
  workflowId: 'task-a',
  workflowType: 'beauty_marketing',
};
const secondProgress: WorkflowProgressEnvelope = {
  ...firstProgress,
  eventId: 'task-a:3',
  message: '正在组装可交付成品',
  sequence: 3,
  stage: 'assembly_delivery',
};
const firstToken: WorkflowTokenEnvelope = {
  eventId: 'task-a:token:2',
  workflowId: 'task-a',
  sequence: 2,
  sourceRevision: 4,
  candidateId: 'c01',
  channel: 'copy.body',
  delta: '正在写正文',
  occurredAt: '2026-07-18T08:00:01.000Z',
};
const terminalState: WorkflowStateEnvelope = {
  occurredAt: '2026-07-18T08:00:02.000Z',
  snapshot: { packageId: 'package-a' },
  sourceRevision: 4,
  status: 'success',
  workflowId: 'task-a',
};
const foreignToken: WorkflowTokenEnvelope = {
  ...firstToken,
  delta: '来自另一个任务的内容',
  eventId: 'task-b:token:999',
  sequence: 999,
  workflowId: 'task-b',
};

test('harness replay resumes after the stable event id and reads state after progress closes', async () => {
  const calls: string[] = [];
  const source = new HarnessWorkflowEventSource({
    async owns(workspaceId, workflowId) {
      calls.push(`owns:${workspaceId}:${workflowId}`);
      return workspaceId === 'workspace-a' && workflowId === 'task-a';
    },
    async *readEvents(_workspaceId, workflowId) {
      calls.push(`progress:${workflowId}`);
      yield firstProgress;
      yield foreignToken;
      yield firstToken;
      yield secondProgress;
    },
    async readState(_workspaceId, workflowId) {
      calls.push(`state:${workflowId}`);
      return terminalState;
    },
  });
  const service = new WorkflowEventApplicationService([source]);
  const subscription = await service.subscribe({
    lastEventId: firstProgress.eventId,
    signal: new AbortController().signal,
    workflowId: 'task-a',
    workspaceId: 'workspace-a',
  });

  assert.ok(subscription);
  const frames = await collect(subscription.frames);
  assert.deepEqual(
    frames.map(({ event }) => event),
    ['workflow.token', 'workflow.progress', 'workflow.state']
  );
  assert.equal(frames[0]?.event, 'workflow.token');
  if (frames[0]?.event !== 'workflow.token') {
    throw new Error('Expected a token frame.');
  }
  assert.equal(frames[0].data.delta, '正在写正文');
  assert.equal(workflowEventFrameId(frames[2]!), 'task-a:4:success');
  assert.deepEqual(calls, [
    'owns:workspace-a:task-a',
    'progress:task-a',
    'state:task-a',
  ]);
});

test('harness source never projects foreign workflow frames or state', async () => {
  const source = new HarnessWorkflowEventSource({
    async owns() {
      return true;
    },
    async *readEvents() {
      yield firstProgress;
      yield foreignToken;
    },
    async readState() {
      return { ...terminalState, workflowId: 'task-b' };
    },
  });

  const frames = await collect(
    source.stream({
      signal: new AbortController().signal,
      workflowId: 'task-a',
      workspaceId: 'workspace-a',
    })
  );

  assert.deepEqual(
    frames.map((frame) => frame.data.workflowId),
    ['task-a']
  );
  assert.equal(frames[0]?.event, 'workflow.progress');
});

test('video source emits a stable authoritative state snapshot and stops at terminal state', async () => {
  let reads = 0;
  const source = new VideoWorkflowEventSource(
    {
      async owns(workspaceId, workflowId) {
        return workspaceId === 'workspace-a' && workflowId === 'video-a';
      },
      async readSnapshot() {
        reads += 1;
        return {
          job: { status: 'completed' },
          workflow: {
            id: 'video-a',
            revision: 7,
            status: 'completed',
            updatedAt: '2026-07-18T08:00:07.000Z',
          },
        };
      },
    },
    { pollIntervalMs: 1 }
  );
  const service = new WorkflowEventApplicationService([source]);
  const subscription = await service.subscribe({
    lastEventId: 'video-a:6:running',
    signal: new AbortController().signal,
    workflowId: 'video-a',
    workspaceId: 'workspace-a',
  });

  assert.ok(subscription);
  const frames = await collect(subscription.frames);
  assert.equal(frames.length, 1);
  assert.equal(frames[0]?.event, 'workflow.state');
  assert.equal(workflowEventFrameId(frames[0]!), 'video-a:7:success');
  assert.equal(reads, 1);
});

test('foreign ownership returns not found before either event source is read', async () => {
  let harnessReads = 0;
  let videoReads = 0;
  const service = new WorkflowEventApplicationService([
    new HarnessWorkflowEventSource({
      async owns() {
        return false;
      },
      async *readEvents() {
        harnessReads += 1;
      },
      async readState() {
        harnessReads += 1;
        return terminalState;
      },
    }),
    new VideoWorkflowEventSource({
      async owns() {
        return false;
      },
      async readSnapshot() {
        videoReads += 1;
        throw new Error('must not read a foreign snapshot');
      },
    }),
  ]);

  const subscription = await service.subscribe({
    signal: new AbortController().signal,
    workflowId: 'foreign-workflow',
    workspaceId: 'workspace-a',
  });

  assert.equal(subscription, null);
  assert.equal(harnessReads, 0);
  assert.equal(videoReads, 0);
});

async function collect<T>(source: AsyncIterable<T>) {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}
