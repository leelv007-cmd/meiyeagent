import assert from 'node:assert/strict';
import test from 'node:test';

import type { ComposerSessionPhase } from './composer-session';
import {
  isWorkbenchComposerSticky,
  isWorkbenchDualColumnEligible,
  resolveWorkbenchWidthMode,
  workbenchComposerStickyHostClass,
  workbenchShellMaxWidthClass,
  workbenchShellMaxWidthPx,
  WORKBENCH_CONVERSATION_MAX_WIDTH_PX,
  WORKBENCH_DUAL_COLUMN_MIN_WIDTH_PX,
  WORKBENCH_MEDIA_EXPAND_MAX_WIDTH_PX,
  WORKBENCH_MOBILE_NAV_HEIGHT,
  WORKBENCH_STICKY_COMPOSER_CLEARANCE_CLASS,
  WORKBENCH_STICKY_COMPOSER_SCROLL_MARGIN_CLASS,
} from './workbench-shell';

const ACTIVE_OR_DELIVERED: ComposerSessionPhase[] = [
  'submitting',
  'running',
  'awaiting_answer',
  'delivered',
];

/** Phases where Composer sticks (interrupt cards must stay clickable). */
const STICKY_IN_FLIGHT: ComposerSessionPhase[] = ['submitting', 'running'];

const IDLE_LIKE: ComposerSessionPhase[] = ['idle', 'cancelled', 'failed'];

test('P1-7: width contract is conversation 800 / media 1240', () => {
  assert.equal(WORKBENCH_CONVERSATION_MAX_WIDTH_PX, 800);
  assert.equal(WORKBENCH_MEDIA_EXPAND_MAX_WIDTH_PX, 1240);
  assert.equal(workbenchShellMaxWidthPx('conversation'), 800);
  assert.equal(workbenchShellMaxWidthPx('media'), 1240);
  assert.equal(workbenchShellMaxWidthClass('conversation'), 'max-w-[800px]');
  assert.equal(workbenchShellMaxWidthClass('media'), 'max-w-[1240px]');
});

test('P1-1: dual column only when width ≥1240 and Active/Delivered', () => {
  for (const phase of ACTIVE_OR_DELIVERED) {
    assert.equal(
      isWorkbenchDualColumnEligible(phase, WORKBENCH_DUAL_COLUMN_MIN_WIDTH_PX),
      true,
      `expected dual column for ${phase} at 1240`
    );
    assert.equal(
      isWorkbenchDualColumnEligible(phase, 1239),
      false,
      `expected no dual column for ${phase} below 1240`
    );
  }
  for (const phase of IDLE_LIKE) {
    assert.equal(
      isWorkbenchDualColumnEligible(phase, 1600),
      false,
      `expected no dual column for ${phase}`
    );
  }
});

test('P1-2: Composer unsticks for merchant answers and delivery', () => {
  for (const phase of STICKY_IN_FLIGHT) {
    assert.equal(isWorkbenchComposerSticky(phase), true, phase);
  }
  // Interrupt options must receive a real merchant click above the Composer.
  assert.equal(isWorkbenchComposerSticky('awaiting_answer'), false);
  // Delivered keeps dual-column but unsticks so 成品卡 is not under z-30 scrim.
  assert.equal(isWorkbenchComposerSticky('delivered'), false);
  for (const phase of IDLE_LIKE) {
    assert.equal(isWorkbenchComposerSticky(phase), false, phase);
  }
  assert.equal(isWorkbenchComposerSticky('idle'), false);
  const stickyClass = workbenchComposerStickyHostClass(true);
  assert.ok(stickyClass?.includes('sticky'));
  assert.ok(stickyClass?.includes('5.25rem'));
  assert.ok(stickyClass?.includes('bg-background/95'));
  assert.ok(stickyClass?.includes('backdrop-blur'));
  assert.equal(workbenchComposerStickyHostClass(false), undefined);
  assert.equal(WORKBENCH_MOBILE_NAV_HEIGHT, '4.25rem');
  // Delivery-card click path needs explicit clearance above sticky host.
  assert.match(WORKBENCH_STICKY_COMPOSER_CLEARANCE_CLASS, /16rem/u);
  assert.match(WORKBENCH_STICKY_COMPOSER_SCROLL_MARGIN_CLASS, /scroll-mb/u);
});

test('width mode: dual column or mediaExpanded → media shell', () => {
  assert.equal(
    resolveWorkbenchWidthMode({ dualColumn: false, mediaExpanded: false }),
    'conversation'
  );
  assert.equal(
    resolveWorkbenchWidthMode({ dualColumn: true, mediaExpanded: false }),
    'media'
  );
  assert.equal(
    resolveWorkbenchWidthMode({ dualColumn: false, mediaExpanded: true }),
    'media'
  );
});
