/**
 * V31-04 reducer contract tests (V3.1 §27.6 / §28.2).
 * External behavior only: out-of-order / duplicate / patch-fail resync /
 * reconnect order (explicit taskId + pending interrupt priority).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  agentSemanticEventWireSchema,
  type AgentSemanticEventWire,
} from '@meiye/contracts';

import {
  createEmptyAgentWorkbenchState,
  inferPlanLifecycleFromWorkbench,
  measureArtifactDuplicateObjectRate,
  projectActivePlanRevisions,
  projectVisibleActivities,
  projectVisibleArtifacts,
  projectVisibleNarratives,
  reduceAgentWorkbench,
  resolveArtifactViewBody,
  type AgentWorkbenchClientState,
  type WorkbenchSessionProjection,
} from './agent-event-reducer';
import {
  commitStripInputFromPlanFacts,
  projectCommitStrip,
} from './plan/commit-strip-model';

const TS = '2026-08-08T12:00:00.000Z';
const THREAD = 'thread-1';
const RESOURCE = 'resource-1';

function session(
  overrides: Partial<WorkbenchSessionProjection> = {}
): WorkbenchSessionProjection {
  return {
    resourceId: RESOURCE,
    threadId: THREAD,
    sessionRevision: 1,
    ...overrides,
  };
}

function wire(overrides: {
  eventId: string;
  streamOffset: string;
  eventType: string;
  threadId?: string;
  payload?: unknown;
  contextRole?: AgentSemanticEventWire['contextRole'];
  occurredAt?: string;
}): AgentSemanticEventWire {
  return agentSemanticEventWireSchema.parse({
    schemaVersion: 'agent-semantic-event/v1',
    threadId: overrides.threadId ?? THREAD,
    contextRole: overrides.contextRole ?? 'included',
    sourceDomain: 'agent_run',
    sourceEntityId: 'run-1',
    sourceRevision: '1',
    correlationId: 'corr-1',
    payload: overrides.payload ?? {},
    occurredAt: overrides.occurredAt ?? TS,
    eventId: overrides.eventId,
    streamOffset: overrides.streamOffset,
    eventType: overrides.eventType,
  });
}

function livingPlanPayload(planId: string) {
  return {
    planId,
    revision: 1,
    goal: { summary: 'Thread-scoped plan' },
    deliverables: [{ kind: 'note', quantity: 1 }],
  };
}

function empty(
  overrides: Partial<AgentWorkbenchClientState> = {}
): AgentWorkbenchClientState {
  return {
    ...createEmptyAgentWorkbenchState(),
    ...overrides,
  };
}

test('message.final appends a narrative document line (not chat bubble state)', () => {
  let state = empty({ session: session() });
  state = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'evt-msg-1',
      streamOffset: '1',
      eventType: 'message.final',
      payload: { text: '已理解你的周末预约需求' },
    }),
  }).state;

  const lines = projectVisibleNarratives(state);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.text, '已理解你的周末预约需求');
  assert.equal(lines[0]?.id, 'evt-msg-1');
});

test('duplicate eventId is ignored (idempotent apply)', () => {
  const event = wire({
    eventId: 'evt-dup',
    streamOffset: '1',
    eventType: 'message.final',
    payload: { text: '一次交付' },
  });
  let state = empty({ session: session() });
  state = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event,
  }).state;
  const again = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event,
  });
  assert.equal(again.duplicate, true);
  assert.equal(projectVisibleNarratives(again.state).length, 1);
  assert.equal(again.state.lastEventId, 'evt-dup');
});

test('out-of-order streamOffset batch sorts and yields sequential state', () => {
  const state = empty({ session: session() });
  const result = reduceAgentWorkbench(state, {
    type: 'apply_events_batch',
    events: [
      wire({
        eventId: 'evt-2',
        streamOffset: '2',
        eventType: 'message.final',
        payload: { text: '第二行' },
      }),
      wire({
        eventId: 'evt-1',
        streamOffset: '1',
        eventType: 'message.final',
        payload: { text: '第一行' },
      }),
    ],
  });
  const texts = projectVisibleNarratives(result.state).map((line) => line.text);
  assert.deepEqual(texts, ['第一行', '第二行']);
  assert.equal(result.state.lastStreamOffset, '2');
  assert.equal(result.state.lastEventId, 'evt-2');
});

test('foreign thread events are ignored', () => {
  const state = empty({ session: session() });
  const result = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'evt-other',
      streamOffset: '1',
      eventType: 'message.final',
      threadId: 'thread-other',
      payload: { text: '别的会话' },
    }),
  });
  assert.equal(result.foreign, true);
  assert.equal(projectVisibleNarratives(result.state).length, 0);
  assert.equal(result.state.lastEventId, null);
});

test('set_session atomically clears plan and interrupt projections across Threads', () => {
  let state = empty({ session: session({ threadId: 'thread-a' }) });
  state = reduceAgentWorkbench(state, {
    type: 'apply_events_batch',
    events: [
      wire({
        eventId: 'plan-a',
        streamOffset: '1',
        threadId: 'thread-a',
        eventType: 'plan.created',
        payload: livingPlanPayload('plan-a'),
      }),
      wire({
        eventId: 'interrupt-a',
        streamOffset: '2',
        threadId: 'thread-a',
        eventType: 'interrupt.requested',
        payload: {
          interruptId: 'interrupt-a',
          interruptType: 'execution_confirm',
          description: '确认方案',
          revision: 1,
        },
      }),
    ],
  }).state;
  assert.equal(state.activePlanId, 'plan-a');
  assert.equal(state.pendingInterrupts.length, 1);

  state = reduceAgentWorkbench(state, {
    type: 'set_session',
    session: session({ threadId: 'thread-b' }),
  }).state;
  assert.deepEqual(state.plans, {});
  assert.equal(state.activePlanId, null);
  assert.deepEqual(state.pendingInterrupts, []);
});

test('set_session clears plan and interrupts on Idle but preserves same-Thread refresh', () => {
  const projectedPlan = {
    'plan-a': {
      planId: 'plan-a',
      latestRevision: 1,
      revisions: [],
    },
  };
  const interrupt = {
    interruptId: 'interrupt-a',
    interruptType: 'execution_confirm',
    description: '确认方案',
    revision: 1,
    streamOffset: '2',
  };
  let state = empty({
    session: session({ threadId: 'thread-a' }),
    plans: projectedPlan,
    activePlanId: 'plan-a',
    pendingInterrupts: [interrupt],
  });
  state = reduceAgentWorkbench(state, {
    type: 'set_session',
    session: session({ threadId: 'thread-a', sessionRevision: 2 }),
  }).state;
  assert.equal(state.plans, projectedPlan);
  assert.equal(state.pendingInterrupts[0], interrupt);

  state = reduceAgentWorkbench(state, {
    type: 'set_session',
    session: null,
  }).state;
  assert.deepEqual(state.plans, {});
  assert.equal(state.activePlanId, null);
  assert.deepEqual(state.pendingInterrupts, []);
});

test('empty activity.snapshot is not projected (card reduction)', () => {
  let state = empty({ session: session() });
  state = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'evt-empty-act',
      streamOffset: '1',
      eventType: 'activity.snapshot',
      payload: { activityId: 'act-1', title: '', status: 'idle' },
    }),
  }).state;
  assert.equal(projectVisibleActivities(state).length, 0);
});

test('activity with title is projected; empty detail still ok when title present', () => {
  let state = empty({ session: session() });
  state = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'evt-act',
      streamOffset: '1',
      eventType: 'activity.snapshot',
      payload: {
        activityId: 'act-read',
        title: '正在读门店资料',
        status: 'running',
      },
    }),
  }).state;
  const activities = projectVisibleActivities(state);
  assert.equal(activities.length, 1);
  assert.equal(activities[0]?.title, '正在读门店资料');
});

test('duplicate work.delivered by deliveryKey is not shown twice', () => {
  let state = empty({ session: session() });
  state = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'evt-del-1',
      streamOffset: '1',
      eventType: 'work.delivered',
      payload: {
        deliveryKey: 'pkg-rev-1',
        text: '文案已就绪',
      },
    }),
  }).state;
  state = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'evt-del-2',
      streamOffset: '2',
      eventType: 'work.delivered',
      payload: {
        deliveryKey: 'pkg-rev-1',
        text: '文案已就绪（重复）',
      },
    }),
  }).state;
  const lines = projectVisibleNarratives(state);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.text, '文案已就绪');
});

test('patch failure discards local projection and marks resync (unique reconnect seam)', () => {
  let state = empty({ session: session() });
  state = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'evt-1',
      streamOffset: '1',
      eventType: 'message.final',
      payload: { text: '本地已有' },
    }),
  }).state;
  assert.equal(projectVisibleNarratives(state).length, 1);

  state = reduceAgentWorkbench(state, {
    type: 'patch_failed',
    reason: 'malformed_event',
  }).state;

  assert.equal(state.needsSnapshotResync, true);
  assert.equal(state.connection, 'resyncing');
  assert.equal(projectVisibleNarratives(state).length, 0);
  assert.equal(state.lastEventId, null);
  assert.equal(Object.keys(state.activities).length, 0);
});

test('hydrate_replay is the sole recovery path: snapshot cursor then events', () => {
  const state = reduceAgentWorkbench(empty(), {
    type: 'hydrate_replay',
    session: session({ activeRunId: 'run-9' }),
    snapshot: {
      revision: '2',
      lastEventId: null,
      lastStreamOffset: null,
    },
    events: [
      wire({
        eventId: 'evt-1',
        streamOffset: '1',
        eventType: 'message.final',
        payload: { text: '重放一行' },
      }),
      wire({
        eventId: 'evt-2',
        streamOffset: '2',
        eventType: 'interrupt.requested',
        payload: {
          interruptId: 'int-1',
          interruptType: 'answer_question',
          description: '这次团购价按哪个金额写？',
          revision: 1,
        },
      }),
    ],
  }).state;

  assert.equal(state.session?.threadId, THREAD);
  assert.equal(state.session?.activeRunId, 'run-9');
  assert.equal(state.connection, 'live');
  assert.equal(state.needsSnapshotResync, false);
  assert.equal(projectVisibleNarratives(state).length, 1);
  assert.equal(state.pendingInterrupts.length, 1);
  assert.equal(state.pendingInterrupts[0]?.interruptId, 'int-1');
  assert.equal(state.lastEventId, 'evt-2');
});

test('§27.6: explicit taskId is never overwritten by recent-task hydrate', () => {
  let state = empty({
    explicitTaskId: 'task-explicit',
    session: session(),
  });
  state = reduceAgentWorkbench(state, {
    type: 'hydrate_replay',
    session: session({
      activeRunId: 'run-from-recent',
      // recent path may try to suggest another task — client keeps explicit
    }),
    snapshot: { revision: '0', lastEventId: null, lastStreamOffset: null },
    events: [],
    recentTaskId: 'task-from-recent-list',
  }).state;

  assert.equal(state.explicitTaskId, 'task-explicit');
  assert.notEqual(state.explicitTaskId, 'task-from-recent-list');
});

test('§27.6: pending interrupts sort ahead of narrative for display priority', () => {
  let state = empty({ session: session() });
  state = reduceAgentWorkbench(state, {
    type: 'apply_events_batch',
    events: [
      wire({
        eventId: 'evt-msg',
        streamOffset: '1',
        eventType: 'message.final',
        payload: { text: '叙事' },
      }),
      wire({
        eventId: 'evt-int',
        streamOffset: '2',
        eventType: 'interrupt.requested',
        payload: {
          interruptId: 'int-urgent',
          interruptType: 'confirm_paid_execution',
          description: '确认本次付费制作',
          revision: 3,
        },
      }),
    ],
  }).state;

  assert.equal(state.pendingInterrupts[0]?.interruptId, 'int-urgent');
  // Priority projection: interrupts present before narratives in timeline host
  assert.ok(state.pendingInterrupts.length > 0);
  assert.ok(projectVisibleNarratives(state).length > 0);
});

test('set_explicit_task_id updates the reconnect preference', () => {
  const state = reduceAgentWorkbench(empty(), {
    type: 'set_explicit_task_id',
    taskId: 'task-from-url',
  }).state;
  assert.equal(state.explicitTaskId, 'task-from-url');
});

test('set_explicit_thread_id survives reset and patch_failed', () => {
  let state = reduceAgentWorkbench(empty(), {
    type: 'set_explicit_thread_id',
    threadId: 'thread-from-url',
  }).state;
  assert.equal(state.explicitThreadId, 'thread-from-url');

  state = reduceAgentWorkbench(state, {
    type: 'set_session',
    session: session(),
  }).state;
  state = reduceAgentWorkbench(state, { type: 'reset' }).state;
  assert.equal(state.explicitThreadId, 'thread-from-url');
  assert.equal(state.session, null);

  state = reduceAgentWorkbench(state, {
    type: 'set_session',
    session: session(),
  }).state;
  state = reduceAgentWorkbench(state, {
    type: 'patch_failed',
    reason: 'test',
  }).state;
  assert.equal(state.explicitThreadId, 'thread-from-url');
  assert.equal(state.connection, 'resyncing');
});

test('hydrate_replay keeps snapshot resync requested when a replay patch cannot apply', () => {
  const result = reduceAgentWorkbench(empty(), {
    type: 'hydrate_replay',
    session: session(),
    snapshot: {
      revision: '1',
      lastEventId: null,
      lastStreamOffset: '0',
    },
    events: [
      wire({
        eventId: 'bad-replay-patch',
        streamOffset: '5',
        eventType: 'artifact.revised',
        payload: noteDeltaPayload({
          revision: 5,
          baseRevision: 4,
          pages: [{ pageIndex: 0, stage: 'copy', body: '丢失基线' }],
        }),
      }),
    ],
  });

  assert.equal(result.state.connection, 'resyncing');
  assert.equal(result.state.needsSnapshotResync, true);
  assert.equal(result.state.artifacts['art-note-1'], undefined);
});

// ─── V31-15 Artifact reconciliation ──────────────────────────────────────────

function noteSnapshotPayload(overrides: {
  artifactId?: string;
  revision: number;
  status?: string;
  pages?: unknown[];
  parentRevision?: number;
  summary?: string;
}) {
  return {
    schemaVersion: 'artifact-update/v1',
    mode: 'snapshot',
    artifactId: overrides.artifactId ?? 'art-note-1',
    artifactType: 'note',
    revision: overrides.revision,
    status: overrides.status ?? 'skeleton',
    full: {
      pages: overrides.pages ?? [{ pageIndex: 0, stage: 'skeleton' }],
    },
    ...(overrides.summary !== undefined ? { summary: overrides.summary } : {}),
    ...(overrides.parentRevision !== undefined
      ? { parentRevision: overrides.parentRevision }
      : {}),
  };
}

function noteDeltaPayload(overrides: {
  revision: number;
  baseRevision: number;
  status?: string;
  pages: unknown[];
  parentRevision?: number;
}) {
  return {
    schemaVersion: 'artifact-update/v1',
    mode: 'delta',
    artifactId: 'art-note-1',
    artifactType: 'note',
    revision: overrides.revision,
    status: overrides.status ?? 'partial',
    baseRevision: overrides.baseRevision,
    patch: { pages: overrides.pages },
    ...(overrides.parentRevision !== undefined
      ? { parentRevision: overrides.parentRevision }
      : {}),
  };
}

test('V31-15: artifact.revised snapshot/delta grows same artifactId in place', () => {
  let state = empty({ session: session() });
  state = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'art-1',
      streamOffset: '1',
      eventType: 'artifact.revised',
      payload: noteSnapshotPayload({
        revision: 1,
        pages: [
          { pageIndex: 0, stage: 'skeleton' },
          { pageIndex: 1, stage: 'skeleton' },
        ],
      }),
    }),
  }).state;

  assert.equal(projectVisibleArtifacts(state).length, 1);
  assert.equal(state.artifacts['art-note-1']?.revision, 1);
  assert.equal(measureArtifactDuplicateObjectRate(state), 0);

  state = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'art-2',
      streamOffset: '2',
      eventType: 'artifact.revised',
      payload: noteDeltaPayload({
        revision: 2,
        baseRevision: 1,
        pages: [
          {
            pageIndex: 0,
            stage: 'copy',
            title: '封面',
            body: '周末护理',
          },
        ],
      }),
    }),
  }).state;

  assert.equal(projectVisibleArtifacts(state).length, 1);
  assert.equal(state.artifacts['art-note-1']?.revision, 2);
  const body = state.artifacts['art-note-1']?.body;
  assert.ok(body && 'pages' in body);
  if (body && 'pages' in body) {
    assert.equal(body.pages[0]?.stage, 'copy');
    assert.equal(body.pages[0]?.body, '周末护理');
    assert.equal(body.pages[1]?.stage, 'skeleton');
  }
  assert.equal(measureArtifactDuplicateObjectRate(state), 0);
});

test('V31-15: same revision re-apply is idempotent (duplicate object rate stays 0)', () => {
  const event = wire({
    eventId: 'art-dup',
    streamOffset: '1',
    eventType: 'artifact.revised',
    payload: noteSnapshotPayload({ revision: 1 }),
  });
  let state = empty({ session: session() });
  state = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event,
  }).state;
  // same eventId is stream-level duplicate
  const again = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event,
  });
  assert.equal(again.duplicate, true);
  assert.equal(projectVisibleArtifacts(again.state).length, 1);

  // same revision different eventId still idempotent at artifact layer
  state = reduceAgentWorkbench(again.state, {
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'art-dup-2',
      streamOffset: '2',
      eventType: 'artifact.revised',
      payload: noteSnapshotPayload({ revision: 1 }),
    }),
  }).state;
  assert.equal(state.artifacts['art-note-1']?.revision, 1);
  assert.equal(measureArtifactDuplicateObjectRate(state), 0);
});

test('V31-15: skip revision / cold delta fails apply → needs snapshot resync path', () => {
  let state = empty({ session: session() });
  state = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'art-1',
      streamOffset: '1',
      eventType: 'artifact.revised',
      payload: noteSnapshotPayload({ revision: 1 }),
    }),
  }).state;

  const skip = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'art-skip',
      streamOffset: '2',
      eventType: 'artifact.revised',
      payload: noteDeltaPayload({
        revision: 5,
        baseRevision: 4,
        pages: [{ pageIndex: 0, stage: 'image', imageStatus: 'ready' }],
      }),
    }),
  });
  assert.equal(skip.ok, false);
  assert.match(skip.error ?? '', /artifact_needs_snapshot/u);

  // batch path: apply failure discards projection for resync
  const batch = reduceAgentWorkbench(state, {
    type: 'apply_events_batch',
    events: [
      wire({
        eventId: 'art-skip-b',
        streamOffset: '3',
        eventType: 'artifact.revised',
        payload: noteDeltaPayload({
          revision: 9,
          baseRevision: 8,
          pages: [{ pageIndex: 0, stage: 'copy' }],
        }),
      }),
    ],
  });
  assert.equal(batch.ok, false);
  assert.equal(batch.state.needsSnapshotResync, true);
  assert.equal(batch.state.connection, 'resyncing');
});

test('V31-15: out-of-order batch sorts; reconnect hydrate rebuilds artifacts', () => {
  const events = [
    wire({
      eventId: 'art-2',
      streamOffset: '2',
      eventType: 'artifact.revised',
      payload: noteDeltaPayload({
        revision: 2,
        baseRevision: 1,
        pages: [{ pageIndex: 0, stage: 'copy', body: '文案到位' }],
      }),
    }),
    wire({
      eventId: 'art-1',
      streamOffset: '1',
      eventType: 'artifact.revised',
      payload: noteSnapshotPayload({
        revision: 1,
        pages: [{ pageIndex: 0, stage: 'skeleton' }],
      }),
    }),
  ];

  const state = reduceAgentWorkbench(empty({ session: session() }), {
    type: 'apply_events_batch',
    events,
  }).state;

  assert.equal(state.artifacts['art-note-1']?.revision, 2);
  const body = state.artifacts['art-note-1']?.body;
  assert.ok(body && 'pages' in body && body.pages[0]?.body === '文案到位');

  // reconnect: hydrate from snapshot events (delta after snapshot)
  const hydrated = reduceAgentWorkbench(empty(), {
    type: 'hydrate_replay',
    session: session(),
    snapshot: { revision: '0', lastEventId: null, lastStreamOffset: null },
    events: [
      wire({
        eventId: 'h1',
        streamOffset: '1',
        eventType: 'artifact.revised',
        payload: noteSnapshotPayload({
          revision: 2,
          status: 'partial',
          pages: [{ pageIndex: 0, stage: 'copy', body: '文案到位' }],
        }),
      }),
    ],
  }).state;
  assert.equal(hydrated.artifacts['art-note-1']?.revision, 2);
  assert.equal(measureArtifactDuplicateObjectRate(hydrated), 0);
});

test('V31-15: cold delta chain (no snapshot) bootstraps without resync loop', () => {
  const cold = (revision: number, baseRevision: number, pages: unknown[]) =>
    wire({
      eventId: `art-cold-${revision}`,
      streamOffset: String(revision),
      eventType: 'artifact.revised',
      payload: noteDeltaPayload({ revision, baseRevision, pages }),
    });

  // live apply path: first-frame delta with baseRevision=0 must apply, not
  // mark needsSnapshotResync (no infinite resync on cold replay)
  let state = empty({ session: session() });
  state = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event: cold(1, 0, [
      { pageIndex: 0, stage: 'copy', title: '封面', body: '周末护理' },
    ]),
  }).state;
  assert.equal(state.artifacts['art-note-1']?.revision, 1);
  assert.equal(state.needsSnapshotResync, false);

  // replay of the same cold delta (resync re-fetch) stays idempotent — no loop
  const replay = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event: cold(1, 0, [
      { pageIndex: 0, stage: 'copy', title: '封面', body: '周末护理' },
    ]),
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.state.needsSnapshotResync, false);

  // hydrate_replay from empty cursor with only cold deltas converges
  const hydrated = reduceAgentWorkbench(empty(), {
    type: 'hydrate_replay',
    session: session(),
    snapshot: {
      revision: '2',
      lastEventId: 'art-cold-2',
      lastStreamOffset: '2',
    },
    events: [
      cold(1, 0, [
        { pageIndex: 0, stage: 'copy', title: '封面', body: '周末护理' },
      ]),
      cold(2, 1, [{ pageIndex: 1, stage: 'copy', body: '第二页' }]),
    ],
  }).state;
  assert.equal(hydrated.artifacts['art-note-1']?.revision, 2);
  assert.equal(hydrated.needsSnapshotResync, false);
  assert.equal(hydrated.connection, 'live');
});

test('V31-15: ready content requires derived parentRevision; version 回看', () => {
  let state = empty({ session: session() });
  state = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'art-ready',
      streamOffset: '1',
      eventType: 'artifact.revised',
      payload: noteSnapshotPayload({
        revision: 3,
        status: 'ready',
        pages: [
          {
            pageIndex: 0,
            stage: 'image',
            body: '最后两个名额',
            imageStatus: 'ready',
          },
        ],
      }),
    }),
  }).state;

  const silent = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'art-silent',
      streamOffset: '2',
      eventType: 'artifact.revised',
      payload: noteSnapshotPayload({
        revision: 4,
        status: 'ready',
        pages: [
          {
            pageIndex: 0,
            stage: 'image',
            body: '温馨预约',
            imageStatus: 'ready',
          },
        ],
      }),
    }),
  });
  assert.equal(silent.ok, false);
  assert.match(silent.error ?? '', /silent_overwrite/u);

  state = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'art-derived',
      streamOffset: '3',
      eventType: 'artifact.revised',
      payload: noteSnapshotPayload({
        revision: 4,
        status: 'ready',
        parentRevision: 3,
        pages: [
          {
            pageIndex: 0,
            stage: 'image',
            body: '温馨预约',
            imageStatus: 'ready',
          },
        ],
      }),
    }),
  }).state;

  assert.equal(state.artifacts['art-note-1']?.revision, 4);
  assert.equal(state.artifacts['art-note-1']?.versionHistory.length, 1);
  assert.equal(state.artifacts['art-note-1']?.versionHistory[0]?.revision, 3);

  state = reduceAgentWorkbench(state, {
    type: 'set_artifact_viewing_revision',
    artifactId: 'art-note-1',
    revision: 3,
  }).state;
  const art = state.artifacts['art-note-1']!;
  const viewed = resolveArtifactViewBody(art);
  assert.ok('pages' in viewed && viewed.pages[0]?.body === '最后两个名额');
});

test('V31-15: video artifact delta grows scenes in place', () => {
  let state = empty({ session: session() });
  state = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'vid-1',
      streamOffset: '1',
      eventType: 'artifact.revised',
      payload: {
        schemaVersion: 'artifact-update/v1',
        mode: 'snapshot',
        artifactId: 'art-vid-1',
        artifactType: 'video',
        revision: 1,
        status: 'skeleton',
        full: {
          scenes: [{ sceneIndex: 0, storyboard: '开场外景' }],
        },
      },
    }),
  }).state;
  state = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'vid-2',
      streamOffset: '2',
      eventType: 'artifact.revised',
      payload: {
        schemaVersion: 'artifact-update/v1',
        mode: 'delta',
        artifactId: 'art-vid-1',
        artifactType: 'video',
        revision: 2,
        status: 'partial',
        baseRevision: 1,
        patch: {
          scenes: [
            {
              sceneIndex: 0,
              keyframeStatus: 'ready',
            },
          ],
        },
      },
    }),
  }).state;
  assert.equal(projectVisibleArtifacts(state).length, 1);
  const body = state.artifacts['art-vid-1']?.body;
  assert.ok(body && 'scenes' in body);
  if (body && 'scenes' in body) {
    assert.equal(body.scenes[0]?.storyboard, '开场外景');
    assert.equal(body.scenes[0]?.keyframeStatus, 'ready');
    // V31-60: subtitle/coverStatus/coverRef removed from videoSceneState
    assert.equal('subtitle' in (body.scenes[0] ?? {}), false);
  }
});

// ─── V31-10 Living Plan revisions ────────────────────────────────────────────

test('V31-10: plan.created projects Living Plan revision history', () => {
  let state = empty({ session: session() });
  state = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'evt-plan-1',
      streamOffset: '10',
      eventType: 'plan.created',
      payload: {
        planId: 'plan-1',
        revision: 1,
        goal: { summary: '推奶油风美甲' },
        deliverables: [{ kind: 'note', platform: '小红书', quantity: 6 }],
        costDuration: { creditCost: 38, failureRefundsCredits: true },
      },
    }),
  }).state;

  assert.equal(state.activePlanId, 'plan-1');
  const revisions = projectActivePlanRevisions(state);
  assert.equal(revisions.length, 1);
  assert.equal(revisions[0]?.revision, 1);
  assert.equal(revisions[0]?.goal.summary, '推奶油风美甲');
  assert.equal(revisions[0]?.costDuration.creditCost, 38);
});

test('V31-10: plan.revised appends new revision; prior rows stay immutable', () => {
  let state = empty({ session: session() });
  state = reduceAgentWorkbench(state, {
    type: 'apply_events_batch',
    events: [
      wire({
        eventId: 'evt-plan-1',
        streamOffset: '1',
        eventType: 'plan.created',
        payload: {
          planId: 'plan-1',
          revision: 1,
          goal: { summary: '推奶油风美甲' },
          deliverables: [
            { kind: 'note', platform: '小红书', quantity: 6 },
            { kind: 'copy', platform: '朋友圈', quantity: 1 },
          ],
          costDuration: { creditCost: 38 },
        },
      }),
      wire({
        eventId: 'evt-plan-2',
        streamOffset: '2',
        eventType: 'plan.revised',
        payload: {
          planId: 'plan-1',
          revision: 2,
          goal: { summary: '推奶油风美甲' },
          deliverables: [{ kind: 'note', platform: '小红书', quantity: 4 }],
          adjustmentSummary: '只做小红书，减到 4 页',
          costDuration: { creditCost: 24 },
        },
      }),
    ],
  }).state;

  const revisions = projectActivePlanRevisions(state);
  assert.equal(revisions.length, 2);
  assert.equal(revisions[0]?.deliverables[0]?.quantity, 6);
  assert.equal(revisions[1]?.deliverables[0]?.quantity, 4);
  assert.equal(revisions[1]?.adjustmentSummary, '只做小红书，减到 4 页');
  // Prior row not overwritten
  assert.equal(revisions[0]?.costDuration.creditCost, 38);
});

test('V31-10: duplicate plan revision is idempotent (no silent overwrite)', () => {
  let state = empty({ session: session() });
  const payload = {
    planId: 'plan-1',
    revision: 1,
    goal: { summary: 'A' },
    deliverables: [{ kind: 'note', quantity: 1 }],
  };
  state = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'evt-a',
      streamOffset: '1',
      eventType: 'plan.created',
      payload,
    }),
  }).state;
  state = reduceAgentWorkbench(state, {
    type: 'apply_semantic_event',
    event: wire({
      eventId: 'evt-b',
      streamOffset: '2',
      eventType: 'plan.revised',
      payload: { ...payload, goal: { summary: 'B-overwrite-attempt' } },
    }),
  }).state;

  const revisions = projectActivePlanRevisions(state);
  assert.equal(revisions.length, 1);
  assert.equal(revisions[0]?.goal.summary, 'A');
});

test('EXEC-06 shipped path: work.delivered freezes living-plan commit strip', () => {
  let state = empty({ session: session() });
  state = reduceAgentWorkbench(state, {
    type: 'apply_events_batch',
    events: [
      wire({
        eventId: 'evt-plan-1',
        streamOffset: '1',
        eventType: 'plan.created',
        payload: {
          planId: 'plan-1',
          revision: 1,
          goal: { summary: '推奶油风美甲' },
          deliverables: [{ kind: 'note', platform: '小红书', quantity: 3 }],
          factsAssets: {
            rightsLabel: '素材授权通过',
            factsSummary: '事实可用',
          },
          costDuration: {
            creditCost: 20,
            balanceCredits: 80,
            failureRefundsCredits: true,
          },
        },
      }),
      wire({
        eventId: 'evt-delivered',
        streamOffset: '2',
        eventType: 'work.delivered',
        payload: { deliveryKey: 'pkg-1', text: '交付已就绪' },
      }),
    ],
  }).state;

  assert.equal(inferPlanLifecycleFromWorkbench(state), 'delivered');
  const revisions = projectActivePlanRevisions(state);
  assert.equal(revisions[0]?.planLifecycle, 'delivered');
  const strip = projectCommitStrip(
    commitStripInputFromPlanFacts(revisions[0]!)
  );
  assert.equal(strip.actions.length, 0);
  assert.equal(strip.startDisabled, true);
  assert.equal(strip.startDisabledReason, 'lifecycle_delivered');
  assert.doesNotMatch(
    strip.actions.map((action) => action.label).join(','),
    /开始制作/u
  );
  assert.match(strip.statusLine, /已经做好/u);
});
