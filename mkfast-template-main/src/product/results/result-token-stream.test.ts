/**
 * Token-stream intermediate state fixture tests
 * (ADR-0007 / #99 / P1-B2 / #151).
 * Stage announcements must not substitute for token-stream assertions.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  acceptWorkflowTokenDelta,
  calibrateTerminalRevision,
  projectResultTokenStream,
  projectTokenStreamA11y,
  projectTokenStreamReconnect,
  reduceExclusiveWorkflowTokens,
  tokenStreamFixtureSteps,
  type PartialCopyCandidate,
  type ResultTokenStreamCursor,
  type WorkflowTokenDelta,
} from './result-token-stream';

test('fixture steps: first token appears before full object completes', () => {
  const steps = tokenStreamFixtureSteps();
  assert.ok(steps.length >= 3);

  for (const step of steps) {
    const projection = projectResultTokenStream({
      workspaceKind: 'copy',
      progressState: 'running',
      partialCandidates: step.partialCandidates,
      loading: true,
    });

    assert.equal(
      projection.hasFirstToken,
      step.expectHasFirstToken,
      `step ${step.label} hasFirstToken`
    );
    assert.equal(projection.tokenStreaming, true);
    assert.equal(projection.showStreamPanel, true);
    assert.equal(projection.streamPhase, 'drafting');

    for (let i = 0; i < 3; i += 1) {
      assert.equal(
        projection.slots[i]?.hasToken,
        step.expectSlotTokens[i],
        `step ${step.label} slot ${i}`
      );
    }

    // Intermediate body text is preserved (token-level), not stage-only.
    if (step.label === 'body-continues') {
      assert.equal(projection.slots[0]?.body, '到店立减');
      assert.equal(projection.slots[0]?.title, '夏日美甲活动');
    }
  }
});

test('image_text uses the same token stream path as copy', () => {
  const projection = projectResultTokenStream({
    workspaceKind: 'image_text',
    progressState: 'running',
    partialCandidates: [{ title: '首 token' }],
    loading: true,
  });
  assert.equal(projection.tokenStreaming, true);
  assert.equal(projection.hasFirstToken, true);
  assert.equal(projection.slots[0]?.hasToken, true);
});

test('a11y stage announcement is aggregate-only and coexists with tokens', () => {
  const before = projectResultTokenStream({
    workspaceKind: 'copy',
    progressState: 'running',
    partialCandidates: [],
    loading: true,
  });
  assert.equal(before.hasFirstToken, false);
  assert.equal(before.a11yStageAnnouncement, '任务进行中');

  const after = projectResultTokenStream({
    workspaceKind: 'copy',
    progressState: 'running',
    partialCandidates: [{ title: '已有标题' }],
    loading: true,
  });
  assert.equal(after.hasFirstToken, true);
  assert.equal(after.a11yStageAnnouncement, '正在生成内容');
  // Token content remains the assertion surface — not only a11y text.
  assert.equal(after.slots[0]?.title, '已有标题');
});

test('suspended workflow announces awaiting_confirmation without inventing tokens', () => {
  const projection = projectResultTokenStream({
    workspaceKind: 'copy',
    progressState: 'suspended',
    partialCandidates: [],
    loading: false,
    interrupted: false,
  });
  assert.equal(projection.streamPhase, 'awaiting_confirmation');
  assert.equal(projection.hasFirstToken, false);
  // showStreamPanel false when not loading and no object/error/interrupt
  assert.equal(projection.showStreamPanel, false);
});

test('video / image workspaces do not claim token streaming', () => {
  for (const kind of ['video', 'image'] as const) {
    const projection = projectResultTokenStream({
      workspaceKind: kind,
      progressState: 'running',
      partialCandidates: [{ title: 'should-not-matter' }],
      loading: true,
    });
    assert.equal(projection.tokenStreaming, false);
    assert.equal(projection.hasFirstToken, false);
    assert.equal(projection.slots.length, 0);
    assert.equal(projection.a11yStageAnnouncement, '任务进行中');
  }
});

test('completed stream hides the intermediate panel', () => {
  const projection = projectResultTokenStream({
    workspaceKind: 'copy',
    progressState: 'success',
    partialCandidates: [{ title: '完成', body: '正文' }],
    completed: true,
    loading: false,
  });
  assert.equal(projection.showStreamPanel, false);
  assert.equal(projection.hasFirstToken, true);
});

test('error before first chunk still shows stream panel', () => {
  const projection = projectResultTokenStream({
    workspaceKind: 'copy',
    progressState: 'running',
    partialCandidates: [],
    hasError: true,
    loading: false,
  });
  assert.equal(projection.showStreamPanel, true);
  assert.equal(projection.hasFirstToken, false);
});

test('document face: primary expanded, alternatives separate', () => {
  const projection = projectResultTokenStream({
    workspaceKind: 'copy',
    progressState: 'running',
    partialCandidates: [
      { title: '主推荐', body: '正文 A', conversionHook: '预约' },
      { title: '备选', body: '正文 B' },
    ],
    loading: true,
  });
  assert.equal(projection.primary?.role, 'primary');
  assert.equal(projection.primary?.title, '主推荐');
  assert.equal(projection.alternatives.length, 1);
  assert.equal(projection.alternatives[0]?.role, 'alternative');
});

test('reconnecting preserves banner without clearing tokens', () => {
  const projection = projectResultTokenStream({
    workspaceKind: 'copy',
    progressState: 'running',
    partialCandidates: [{ title: '已到达', body: '不断线清空' }],
    loading: false,
    reconnecting: true,
  });
  assert.equal(projection.reconnecting, true);
  assert.equal(projection.reconnectBanner, '正在恢复连接');
  assert.equal(projection.hasFirstToken, true);
  assert.equal(projection.primary?.body, '不断线清空');
  assert.equal(projection.showStreamPanel, true);
  assert.equal(projection.a11yStageAnnouncement, '正在恢复连接');
});

test('Last-Event-ID cursor rejects replayed sequences and keeps event id', () => {
  let cursor: ResultTokenStreamCursor | undefined;
  const first: WorkflowTokenDelta = {
    eventId: 'task-a:token:2',
    sequence: 2,
    candidateId: 'c01',
    channel: 'copy.body',
    delta: '先写清',
  };
  const accepted = acceptWorkflowTokenDelta(cursor, first);
  assert.equal(accepted.accepted, true);
  cursor = accepted.cursor;
  assert.equal(cursor.lastEventId, 'task-a:token:2');
  assert.equal(cursor.sequence, 2);

  const replay = acceptWorkflowTokenDelta(cursor, first);
  assert.equal(replay.accepted, false);
  assert.equal(replay.cursor.sequence, 2);

  const next = acceptWorkflowTokenDelta(cursor, {
    ...first,
    eventId: 'task-a:token:3',
    sequence: 3,
    delta: '到店细节',
  });
  assert.equal(next.accepted, true);
  assert.equal(next.cursor.lastEventId, 'task-a:token:3');
});

test('exclusive workflow.token reduce never invents poll duplicates', () => {
  const tokens: WorkflowTokenDelta[] = [
    {
      eventId: 't:1',
      sequence: 1,
      candidateId: 'c01',
      channel: 'copy.title',
      delta: '夏日',
    },
    {
      eventId: 't:2',
      sequence: 2,
      candidateId: 'c01',
      channel: 'copy.body',
      delta: '到店',
    },
    {
      eventId: 't:3',
      sequence: 3,
      candidateId: 'c02',
      channel: 'copy.title',
      delta: '备选',
    },
  ];
  let cursor: ResultTokenStreamCursor | undefined;
  let candidates: PartialCopyCandidate[] = [];
  for (const token of tokens) {
    const step = acceptWorkflowTokenDelta(cursor, token);
    if (!step.accepted) continue;
    cursor = step.cursor;
    candidates = reduceExclusiveWorkflowTokens(candidates, token);
  }
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0]?.title, '夏日');
  assert.equal(candidates[0]?.body, '到店');
});

test('reconnect projection never clears arrived text', () => {
  const reconnect = projectTokenStreamReconnect({
    arrivedCandidates: [{ title: '已到达', body: '保留' }],
    cursor: { sequence: 4, lastEventId: 'task:token:4' },
    reconnecting: true,
  });
  assert.equal(reconnect.cleared, false);
  assert.equal(reconnect.candidates[0]?.body, '保留');
  assert.equal(reconnect.lastEventId, 'task:token:4');
  assert.equal(reconnect.reconnectBanner, '正在恢复连接');
});

test('terminal ContentPackage revision calibrates streamed display text', () => {
  const calibrated = calibrateTerminalRevision({
    streamed: { title: '流式标题', body: '流式正文' },
    terminal: {
      title: '终态标题',
      body: '终态正文',
      conversionHook: '预约',
      revisionId: 'rev-final',
    },
  });
  assert.equal(calibrated.kind, 'calibrated');
  assert.equal(calibrated.title, '终态标题');
  assert.equal(calibrated.body, '终态正文');
  assert.equal(calibrated.revisionId, 'rev-final');
  assert.equal(calibrated.matched, false);

  const matched = calibrateTerminalRevision({
    streamed: { title: '终态标题', body: '终态正文', conversionHook: '预约' },
    terminal: {
      title: '终态标题',
      body: '终态正文',
      conversionHook: '预约',
      revisionId: 'rev-final',
    },
  });
  assert.equal(matched.matched, true);
});

test('a11y throttles semantic paragraphs and announces complete once', () => {
  const first = projectTokenStreamA11y({
    previousAnnounced: null,
    previousCompleteAnnounced: false,
    primaryBody: '到店立减。',
    completed: false,
  });
  assert.ok(first.announcement);
  assert.equal(first.completeAnnounced, false);

  const midToken = projectTokenStreamA11y({
    previousAnnounced: first.nextAnnounced,
    previousCompleteAnnounced: false,
    primaryBody: '到店立减。再',
    completed: false,
  });
  assert.equal(midToken.announcement, null);

  const complete = projectTokenStreamA11y({
    previousAnnounced: first.nextAnnounced,
    previousCompleteAnnounced: false,
    primaryBody: '到店立减。再写一句。',
    completed: true,
  });
  assert.equal(complete.announcement, '文案生成完成');
  assert.equal(complete.completeAnnounced, true);

  const completeAgain = projectTokenStreamA11y({
    previousAnnounced: complete.nextAnnounced,
    previousCompleteAnnounced: true,
    primaryBody: '到店立减。再写一句。',
    completed: true,
  });
  assert.equal(completeAgain.announcement, null);
  assert.equal(completeAgain.completeAnnounced, true);
});
