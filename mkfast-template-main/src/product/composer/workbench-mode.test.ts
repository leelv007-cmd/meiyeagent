import assert from 'node:assert/strict';
import test from 'node:test';

import type { ComposerSessionPhase } from './composer-session';
import { isWorkbenchShelfCollapsed } from './workbench-mode';

const ACTIVE_OR_DELIVERED: ComposerSessionPhase[] = [
  'submitting',
  'running',
  'awaiting_answer',
  'delivered',
];

const IDLE_LIKE: ComposerSessionPhase[] = ['idle', 'cancelled', 'failed'];

test('P0-1: Active/Delivered collapses the recommendation and continue shelf', () => {
  for (const phase of ACTIVE_OR_DELIVERED) {
    assert.equal(
      isWorkbenchShelfCollapsed(phase),
      true,
      `expected collapsed for ${phase}`
    );
  }
});

test('P0-1: Idle / terminal recovery keeps the shelf visible', () => {
  for (const phase of IDLE_LIKE) {
    assert.equal(
      isWorkbenchShelfCollapsed(phase),
      false,
      `expected expanded for ${phase}`
    );
  }
});
