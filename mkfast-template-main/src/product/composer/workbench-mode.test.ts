import assert from 'node:assert/strict';
import test from 'node:test';

import type { ComposerSessionPhase } from './composer-session';
import { isWorkbenchShelfCollapsed } from './workbench-mode';

const ACTIVE: ComposerSessionPhase[] = [
  'submitting',
  'running',
  'awaiting_answer',
];

const SHELF_VISIBLE: ComposerSessionPhase[] = [
  'idle',
  'delivered',
  'cancelled',
  'failed',
];

test('P0-1: Active collapses the recommendation and continue shelf', () => {
  for (const phase of ACTIVE) {
    assert.equal(
      isWorkbenchShelfCollapsed(phase),
      true,
      `expected collapsed for ${phase}`
    );
  }
});

test('P0-1: Idle and terminal phases keep the shelf visible', () => {
  for (const phase of SHELF_VISIBLE) {
    assert.equal(
      isWorkbenchShelfCollapsed(phase),
      false,
      `expected expanded for ${phase}`
    );
  }
});
