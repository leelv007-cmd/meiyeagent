import assert from 'node:assert/strict';
import test from 'node:test';

import {
  controllerWindowDecision,
  evaluateDeleteWindow,
  evaluateStableDeleteWindow,
  formatDeleteWindow,
} from './issue-257-delete-window.mjs';

const openComment = {
  body: '主控通告：#257 删除窗口现已开启',
  createdAt: '2026-07-29T09:52:00Z',
};

test('non-controller comments never open the delete window', () => {
  assert.deepEqual(
    controllerWindowDecision([
      { body: 'agent says the window is open', createdAt: 'later' },
    ]),
    { commentCreatedAt: null, state: 'missing' },
  );
});

test('the pre-window controller handoff stays closed', () => {
  assert.deepEqual(
    controllerWindowDecision([
      {
        body: '主控裁决：在此之前维持待命。',
        createdAt: '2026-07-29T02:25:24Z',
      },
    ]),
    { commentCreatedAt: '2026-07-29T02:25:24Z', state: 'closed' },
  );
});

test('the controller batch-boundary announcement opens the window', () => {
  assert.deepEqual(controllerWindowDecision([openComment]), {
    commentCreatedAt: openComment.createdAt,
    state: 'open',
  });
});

test('a later controller close overrides an earlier open', () => {
  assert.deepEqual(
    controllerWindowDecision([
      openComment,
      {
        body: '主控裁决：删除窗口已关闭。',
        createdAt: '2026-07-29T10:00:00Z',
      },
    ]),
    { commentCreatedAt: '2026-07-29T10:00:00Z', state: 'closed' },
  );
});

test('a later ordinary comment does not override the controller window', () => {
  assert.deepEqual(
    controllerWindowDecision([
      openComment,
      { body: '交底/新受阻', createdAt: '2026-07-29T10:11:34Z' },
    ]),
    { commentCreatedAt: openComment.createdAt, state: 'open' },
  );
});

test('the gate-contract correction authorizes immediate work', () => {
  assert.deepEqual(
    controllerWindowDecision([
      {
        body: '主控裁决（gate 合同修正）：修完即开工。',
        createdAt: '2026-07-29T10:12:55Z',
      },
    ]),
    { commentCreatedAt: '2026-07-29T10:12:55Z', state: 'open' },
  );
});

test('READY requires an open controller window, clean lane, and latest main', () => {
  const result = evaluateDeleteWindow({
    candidateClean: true,
    candidateContainsMain: true,
    controllerDecision: controllerWindowDecision([openComment]),
  });
  assert.equal(result.ready, true);
  assert.deepEqual(result.blockers, []);
});

test('a dirty Issue 257 lane blocks the window', () => {
  const result = evaluateDeleteWindow({
    candidateClean: false,
    candidateContainsMain: true,
    controllerDecision: controllerWindowDecision([openComment]),
  });
  assert.deepEqual(
    result.blockers.map((entry) => entry.code),
    ['candidate_dirty'],
  );
});

test('a candidate that does not contain latest main blocks the window', () => {
  const result = evaluateDeleteWindow({
    candidateClean: true,
    candidateContainsMain: false,
    controllerDecision: controllerWindowDecision([openComment]),
  });
  assert.deepEqual(
    result.blockers.map((entry) => entry.code),
    ['candidate_stale'],
  );
});

test('stability fails closed when main moves', () => {
  const ready = evaluateDeleteWindow({
    candidateClean: true,
    candidateContainsMain: true,
    controllerDecision: controllerWindowDecision([openComment]),
  });
  const result = evaluateStableDeleteWindow({
    first: { candidateHead: 'candidate', mainHead: 'main-a', result: ready },
    second: { candidateHead: 'candidate', mainHead: 'main-b', result: ready },
  });
  assert.deepEqual(
    result.blockers.map((entry) => entry.code),
    ['main_changed'],
  );
});

test('human output reports the controller state and blockers', () => {
  const result = evaluateDeleteWindow({
    candidateClean: false,
    candidateContainsMain: false,
    controllerDecision: { commentCreatedAt: null, state: 'missing' },
  });
  assert.match(formatDeleteWindow(result), /Issue 257 delete window: BLOCKED/u);
  assert.match(formatDeleteWindow(result), /\[controller_window\] missing/u);
  assert.match(formatDeleteWindow(result), /\[candidate_dirty\]/u);
  assert.match(formatDeleteWindow(result), /\[candidate_stale\]/u);
});
