import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  WorkflowProgressEnvelope,
  WorkflowTokenEnvelope,
} from '@meiye/contracts';

import {
  advanceWorkflowEventCursor,
  advanceWorkflowEventCursorForWorkflow,
  harnessCancellationFromState,
  harnessDeliveryFromState,
  harnessExperienceBasisFromProgress,
  harnessExperienceBasisFromState,
  parseWorkflowEventFrame,
  reduceWorkflowCopyTokens,
  videoWorkflowEnvelopeFromState,
  workflowEventFrameBelongsTo,
} from '@/product/use-workflow-event-stream';

const progress: WorkflowProgressEnvelope = {
  eventId: 'video-a:1',
  message: '正在生成分镜',
  occurredAt: '2026-07-18T08:00:00.000Z',
  sequence: 1,
  stage: 'execution_selection',
  state: 'running',
  workflowId: 'video-a',
  workflowType: 'video',
};

const experienceBasis = {
  taskId: 'video-a',
  contextBundleId: 'bundle-video-a',
  contextBundleRevision: 2,
  confirmedPreferences: [
    {
      sourceRef: 'preference:tone:r1',
      label: '少促销感',
      value: '少促销感',
    },
  ],
};

test('accepts current-task experience basis from running progress and terminal restore only', () => {
  const contextProgress = {
    ...progress,
    stage: 'context_injection' as const,
    state: 'success' as const,
    experienceBasis,
  };
  assert.deepEqual(
    harnessExperienceBasisFromProgress(contextProgress, 'video-a'),
    experienceBasis
  );
  assert.equal(
    harnessExperienceBasisFromProgress(contextProgress, 'task-other'),
    undefined
  );
  assert.equal(
    harnessExperienceBasisFromProgress(
      {
        ...contextProgress,
        experienceBasis: { ...experienceBasis, taskId: 'task-other' },
      },
      'video-a'
    ),
    undefined
  );

  const terminal = {
    occurredAt: '2026-08-02T01:00:03.000Z',
    snapshot: { experienceBasis },
    sourceRevision: 3,
    status: 'success' as const,
    workflowId: 'video-a',
  };
  assert.deepEqual(
    harnessExperienceBasisFromState(terminal, 'video-a'),
    experienceBasis
  );
  assert.equal(
    harnessExperienceBasisFromState(terminal, 'task-other'),
    undefined
  );
  assert.equal(
    harnessExperienceBasisFromState(
      {
        ...terminal,
        snapshot: {
          experienceBasis: { ...experienceBasis, taskId: 'task-other' },
        },
      },
      'video-a'
    ),
    undefined
  );
});

test('an older experience progress frame cannot replace the accepted basis', () => {
  const newestFrame = {
    data: {
      ...progress,
      eventId: 'video-a:4',
      sequence: 4,
      stage: 'context_injection' as const,
      state: 'success' as const,
      experienceBasis,
    },
    event: 'workflow.progress' as const,
  };
  const newest = advanceWorkflowEventCursorForWorkflow(
    undefined,
    'video-a',
    newestFrame
  );
  let current = harnessExperienceBasisFromProgress(newestFrame.data, 'video-a');
  const olderFrame = {
    ...newestFrame,
    data: {
      ...newestFrame.data,
      eventId: 'video-a:3',
      sequence: 3,
      experienceBasis: {
        ...experienceBasis,
        contextBundleRevision: 1,
        confirmedPreferences: [],
      },
    },
  };
  const older = advanceWorkflowEventCursorForWorkflow(
    newest.cursor,
    'video-a',
    olderFrame
  );
  if (older.accepted) {
    current = harnessExperienceBasisFromProgress(olderFrame.data, 'video-a');
  }

  assert.equal(older.accepted, false);
  assert.deepEqual(current, experienceBasis);
});

test('parses the three named SSE frame contracts without crossing their shapes', () => {
  const progressFrame = parseWorkflowEventFrame(
    'workflow.progress',
    JSON.stringify(progress)
  );
  const stateFrame = parseWorkflowEventFrame(
    'workflow.state',
    JSON.stringify({
      occurredAt: '2026-07-18T08:00:01.000Z',
      snapshot: {
        job: { status: 'running' },
        workflow: {
          id: 'video-a',
          revision: 3,
          status: 'running',
          updatedAt: '2026-07-18T08:00:01.000Z',
        },
      },
      sourceRevision: 3,
      status: 'running',
      workflowId: 'video-a',
    })
  );
  const tokenFrame = parseWorkflowEventFrame(
    'workflow.token',
    JSON.stringify({
      eventId: 'video-a:token:2',
      workflowId: 'video-a',
      sequence: 2,
      candidateId: 'c01',
      channel: 'copy.body',
      delta: '正在起草正文',
      occurredAt: '2026-07-18T08:00:00.500Z',
    })
  );

  assert.equal(progressFrame.event, 'workflow.progress');
  assert.equal(tokenFrame.event, 'workflow.token');
  assert.equal(stateFrame.event, 'workflow.state');
  assert.throws(() =>
    parseWorkflowEventFrame(
      'workflow.progress',
      JSON.stringify(stateFrame.data)
    )
  );
});

test('deduplicates replayed progress sequences and state revisions', () => {
  const first = advanceWorkflowEventCursor(undefined, {
    data: progress,
    event: 'workflow.progress',
  });
  const replay = advanceWorkflowEventCursor(first.cursor, {
    data: progress,
    event: 'workflow.progress',
  });
  const newerState = advanceWorkflowEventCursor(first.cursor, {
    data: {
      occurredAt: '2026-07-18T08:00:02.000Z',
      snapshot: {},
      sourceRevision: 4,
      status: 'running',
      workflowId: 'video-a',
    },
    event: 'workflow.state',
  });

  assert.equal(first.accepted, true);
  assert.equal(replay.accepted, false);
  assert.equal(newerState.accepted, true);
  assert.equal(newerState.cursor.sourceRevision, 4);
});

test('accepts only frames from the subscribed workflow', () => {
  const first = advanceWorkflowEventCursorForWorkflow(undefined, 'video-a', {
    data: progress,
    event: 'workflow.progress',
  });
  const foreign = advanceWorkflowEventCursorForWorkflow(
    first.cursor,
    'video-a',
    {
      data: {
        candidateId: 'candidate-b',
        channel: 'copy.body',
        delta: 'foreign token',
        eventId: 'task-b:token:999',
        occurredAt: '2026-07-18T08:00:03.000Z',
        sequence: 999,
        workflowId: 'task-b',
      },
      event: 'workflow.token',
    }
  );
  const next = advanceWorkflowEventCursorForWorkflow(
    foreign.cursor,
    'video-a',
    {
      data: { ...progress, eventId: 'video-a:2', sequence: 2 },
      event: 'workflow.progress',
    }
  );

  assert.equal(first.accepted, true);
  assert.equal(foreign.accepted, false);
  assert.equal(next.accepted, true);
  assert.equal(next.cursor.sequence, 2);
  assert.equal(
    workflowEventFrameBelongsTo(
      {
        data: {
          occurredAt: '2026-07-18T08:00:02.000Z',
          snapshot: {},
          sourceRevision: 4,
          status: 'success',
          workflowId: 'task-b',
        },
        event: 'workflow.state',
      },
      'video-a'
    ),
    false
  );
});

test('accepts prepared-attempt frames of the subscribed task and nothing else (V31-28)', () => {
  const frameWith = (workflowId: string) => ({
    data: { ...progress, eventId: `${workflowId}:1`, workflowId },
    event: 'workflow.progress' as const,
  });

  // The browser subscribes with the bare task id from the 202; a
  // merchant-confirmed prepared attempt stamps its frames with
  // `${taskId}:plan-r<N>` (composerPreparedAttemptId). Both belong.
  assert.equal(workflowEventFrameBelongsTo(frameWith('task-1'), 'task-1'), true);
  assert.equal(
    workflowEventFrameBelongsTo(frameWith('task-1:plan-r1'), 'task-1'),
    true
  );
  assert.equal(
    workflowEventFrameBelongsTo(frameWith('task-1:plan-r12'), 'task-1'),
    true
  );

  // Foreign tasks stay rejected — bare and prepared-attempt alike.
  assert.equal(
    workflowEventFrameBelongsTo(frameWith('task-2'), 'task-1'),
    false
  );
  assert.equal(
    workflowEventFrameBelongsTo(frameWith('task-2:plan-r1'), 'task-1'),
    false
  );
  // Prefix collision: task-1 must not adopt task-12's prepared attempt.
  assert.equal(
    workflowEventFrameBelongsTo(frameWith('task-12:plan-r1'), 'task-1'),
    false
  );

  // Exact revision shape only: a bare integer >= 1, nothing appended.
  for (const malformed of [
    'task-1:plan-r',
    'task-1:plan-r0',
    'task-1:plan-r01',
    'task-1:plan-rX',
    'task-1:plan-r1:carrier-xiaohongshu',
  ]) {
    assert.equal(
      workflowEventFrameBelongsTo(frameWith(malformed), 'task-1'),
      false,
      `${malformed} must not belong to task-1`
    );
  }
});

test('the replay cursor advances on accepted prepared-attempt frames (V31-28)', () => {
  const first = advanceWorkflowEventCursorForWorkflow(undefined, 'task-1', {
    data: {
      ...progress,
      eventId: 'task-1:plan-r1:1',
      workflowId: 'task-1:plan-r1',
    },
    event: 'workflow.progress',
  });
  const replay = advanceWorkflowEventCursorForWorkflow(first.cursor, 'task-1', {
    data: {
      ...progress,
      eventId: 'task-1:plan-r1:1',
      workflowId: 'task-1:plan-r1',
    },
    event: 'workflow.progress',
  });
  const foreign = advanceWorkflowEventCursorForWorkflow(
    replay.cursor,
    'task-1',
    {
      data: {
        ...progress,
        eventId: 'task-2:plan-r1:2',
        sequence: 2,
        workflowId: 'task-2:plan-r1',
      },
      event: 'workflow.progress',
    }
  );
  const token = advanceWorkflowEventCursorForWorkflow(
    foreign.cursor,
    'task-1',
    {
      data: {
        candidateId: 'c01',
        channel: 'copy.body' as const,
        delta: '先写清',
        eventId: 'task-1:plan-r1:token:2',
        occurredAt: '2026-08-12T08:00:00.000Z',
        sequence: 2,
        workflowId: 'task-1:plan-r1',
      },
      event: 'workflow.token',
    }
  );

  assert.equal(first.accepted, true);
  assert.equal(first.cursor.sequence, 1);
  // Dedup semantics are untouched: the same sequence replays as rejected.
  assert.equal(replay.accepted, false);
  assert.equal(foreign.accepted, false);
  // Token frames of the prepared attempt share the same cursor lane.
  assert.equal(token.accepted, true);
  assert.equal(token.cursor.sequence, 2);
});

test('token sequences share the replay cursor and reduce into isolated copy fields', () => {
  const body: WorkflowTokenEnvelope = {
    eventId: 'task-a:token:2',
    workflowId: 'task-a',
    sequence: 2,
    candidateId: 'c01',
    channel: 'copy.body',
    delta: '先写清',
    occurredAt: '2026-07-18T08:00:00.000Z',
  };
  const first = advanceWorkflowEventCursor(undefined, {
    data: body,
    event: 'workflow.token',
  });
  const replayAsProgress = advanceWorkflowEventCursor(first.cursor, {
    data: { ...progress, sequence: 2 },
    event: 'workflow.progress',
  });
  assert.equal(first.accepted, true);
  assert.equal(replayAsProgress.accepted, false);

  const reduced = [
    body,
    { ...body, eventId: 'task-a:token:3', sequence: 3, delta: '到店细节' },
    {
      ...body,
      eventId: 'task-a:token:4',
      sequence: 4,
      channel: 'copy.title' as const,
      delta: '真实到店记录',
    },
    {
      ...body,
      eventId: 'task-a:token:5',
      sequence: 5,
      candidateId: 'c02',
      delta: '另一条正文',
    },
  ].reduce(reduceWorkflowCopyTokens, []);

  assert.deepEqual(reduced, [
    {
      candidateId: 'c01',
      title: '真实到店记录',
      body: '先写清到店细节',
      conversionHook: '',
    },
    {
      candidateId: 'c02',
      title: '',
      body: '另一条正文',
      conversionHook: '',
    },
  ]);
});

test('accepts only a matching video envelope from a state snapshot', () => {
  const frame = parseWorkflowEventFrame(
    'workflow.state',
    JSON.stringify({
      occurredAt: '2026-07-18T08:00:01.000Z',
      snapshot: {
        job: null,
        workflow: {
          id: 'video-a',
          revision: 3,
          status: 'running',
          updatedAt: '2026-07-18T08:00:01.000Z',
        },
      },
      sourceRevision: 3,
      status: 'running',
      workflowId: 'video-a',
    })
  );
  assert.equal(frame.event, 'workflow.state');
  if (frame.event !== 'workflow.state')
    throw new Error('Expected state frame.');

  assert.equal(
    videoWorkflowEnvelopeFromState(frame.data)?.workflow.id,
    'video-a'
  );
  assert.equal(
    videoWorkflowEnvelopeFromState({
      ...frame.data,
      snapshot: { packageId: 'package-a' },
    }),
    undefined
  );
});

test('成品版本 is read off the terminal harness state frame (T31 / #225)', () => {
  // The harness workflow returns { delivery, deliveryLayer, recommendation,
  // trace } and the event reader publishes that whole result as the state
  // snapshot — so the third outbound seam message rides the stream the
  // conversation is already subscribed to, with no second fetch.
  const delivered = {
    occurredAt: '2026-07-25T08:00:00.000Z',
    snapshot: {
      delivery: {
        packageId: 'package-1',
        versionId: 'version-7',
        revision: 3,
      },
      deliveryLayer: 'copy',
    },
    sourceRevision: 3,
    status: 'success' as const,
    workflowId: 'task-1',
  };
  assert.deepEqual(harnessDeliveryFromState(delivered), {
    packageId: 'package-1',
    versionId: 'version-7',
    revision: 3,
  });

  // A failed run has no delivered revision to bind an action to.
  assert.equal(
    harnessDeliveryFromState({
      ...delivered,
      snapshot: { outcome: 'failed' },
      status: 'failed',
    }),
    undefined
  );
  // Neither does the video source's own snapshot shape.
  assert.equal(
    harnessDeliveryFromState({
      ...delivered,
      snapshot: {
        job: null,
        workflow: {
          id: 'video-a',
          revision: 3,
          status: 'running',
          updatedAt: '2026-07-18T08:00:01.000Z',
        },
      },
    }),
    undefined
  );
  // A malformed delivery must not bind either — a card pointed at a revision
  // we cannot verify is worse than a card with no action.
  assert.equal(
    harnessDeliveryFromState({
      ...delivered,
      snapshot: { delivery: { packageId: 'package-1' } },
    }),
    undefined
  );
});

test('hold expiry preserves the Core cancellation and refund message', () => {
  assert.deepEqual(
    harnessCancellationFromState({
      occurredAt: '2026-07-25T08:00:00.000Z',
      snapshot: {
        delivery: null,
        merchantMessage: '超时未选择，本次任务已取消，积分已退回',
        outcome: 'cancelled',
        resolutionSource: 'core_hold_expired',
      },
      sourceRevision: 0,
      status: 'success',
      workflowId: 'task-hold-expired',
    }),
    {
      merchantMessage: '超时未选择，本次任务已取消，积分已退回',
      outcome: 'cancelled',
      resolutionSource: 'core_hold_expired',
    }
  );
});

test('a reprice supersession terminal projects its own non-delivery outcome (V31-63)', () => {
  assert.deepEqual(
    harnessCancellationFromState({
      occurredAt: '2026-08-12T08:00:00.000Z',
      snapshot: {
        delivery: null,
        merchantMessage:
          '报价已更新，本次未执行也未扣费；新的确认卡已准备好，请确认最新方案后继续。',
        outcome: 'superseded_by_reprice',
        predecessorConfirmationRequestId: 'confirmation:old',
        successorTaskId: 'task-succ',
        successorConfirmationRequestId: 'confirmation:old:r:1',
      },
      sourceRevision: 0,
      status: 'success',
      workflowId: 'task-superseded',
    }),
    {
      merchantMessage:
        '报价已更新，本次未执行也未扣费；新的确认卡已准备好，请确认最新方案后继续。',
      outcome: 'superseded_by_reprice',
    }
  );
});
