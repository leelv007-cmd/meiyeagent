import assert from 'node:assert/strict';
import test from 'node:test';

import { reconcileComposerCanonicalState } from './canonical-work-state';

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
