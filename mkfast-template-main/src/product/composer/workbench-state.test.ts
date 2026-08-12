import assert from 'node:assert/strict';
import test from 'node:test';

import type { ComposerSessionPhase } from './composer-session';
import {
  isWorkbenchEngaged,
  isWorkbenchRunVisible,
  workbenchInspectorPhaseOf,
  workbenchStateOf,
} from './workbench-state';

const PHASES: ComposerSessionPhase[] = [
  'idle',
  'submitting',
  'running',
  'awaiting_answer',
  'delivered',
  'cancelled',
  'failed',
];

test('failed is a terminal inspector face, never running', () => {
  assert.equal(workbenchStateOf('failed'), 'failed');
  assert.equal(workbenchInspectorPhaseOf('failed'), 'failed');
  assert.equal(isWorkbenchEngaged('failed'), false);
  assert.equal(isWorkbenchRunVisible('failed'), true);
});

test('inspector phase never treats a failed session as 正在提交', () => {
  assert.notEqual(workbenchInspectorPhaseOf('failed'), 'running');
  assert.notEqual(workbenchInspectorPhaseOf('cancelled'), 'running');
  assert.equal(workbenchInspectorPhaseOf('submitting'), 'running');
  assert.equal(workbenchInspectorPhaseOf('idle'), 'idle');
});

test('every session phase has a named workbench state', () => {
  for (const phase of PHASES) {
    assert.ok(workbenchStateOf(phase));
    assert.ok(workbenchInspectorPhaseOf(phase));
  }
});
