import assert from 'node:assert/strict';
import test from 'node:test';

import {
  reconcileComposerCanonicalState,
  reconcileRestoredSessionPhase,
} from './canonical-work-state';

test('semantic first-version delivery cannot override a still-running work', () => {
  const reconciled = reconcileComposerCanonicalState({
    workStatus: 'running',
    semanticDelivered: true,
    sessionPhase: 'delivered',
  });
  assert.equal(reconciled.inspectorPhase, 'running');
  assert.equal(reconciled.sessionPhase, 'running');
  assert.deepEqual(reconciled.correction, {
    kind: 'semantic_delivery_without_terminal_work',
  });
});

test('a failed work wins over a premature delivery card', () => {
  const reconciled = reconcileComposerCanonicalState({
    workStatus: 'failed',
    semanticDelivered: true,
    sessionPhase: 'delivered',
  });
  assert.equal(reconciled.inspectorPhase, 'failed');
  assert.equal(reconciled.sessionPhase, 'failed');
  assert.equal(
    reconciled.correction?.kind,
    'semantic_delivery_without_terminal_work'
  );
});

test('matching terminal states do not invent a correction', () => {
  assert.equal(
    reconcileComposerCanonicalState({
      workStatus: 'completed',
      semanticDelivered: true,
      sessionPhase: 'delivered',
    }).correction,
    null
  );
  assert.equal(
    reconcileComposerCanonicalState({
      workStatus: 'running',
      semanticDelivered: false,
      sessionPhase: 'running',
    }).inspectorPhase,
    'running'
  );
});

test('a restored session whose task left the active list stops claiming a run', () => {
  assert.equal(
    reconcileRestoredSessionPhase({
      sessionPhase: 'running',
      taskPresentInActiveList: false,
      semanticDelivered: false,
    }),
    'cancelled'
  );
  assert.equal(
    reconcileRestoredSessionPhase({
      sessionPhase: 'submitting',
      taskPresentInActiveList: false,
      semanticDelivered: true,
    }),
    'delivered'
  );
});

test('a live run and an already-terminal session are both left alone', () => {
  assert.equal(
    reconcileRestoredSessionPhase({
      sessionPhase: 'running',
      taskPresentInActiveList: true,
      semanticDelivered: false,
    }),
    null
  );
  assert.equal(
    reconcileRestoredSessionPhase({
      sessionPhase: 'delivered',
      taskPresentInActiveList: false,
      semanticDelivered: true,
    }),
    null
  );
});
