/**
 * Token-stream intermediate state fixture tests (ADR-0007 / #99).
 * Stage announcements must not substitute for token-stream assertions.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  projectResultTokenStream,
  tokenStreamFixtureSteps,
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
