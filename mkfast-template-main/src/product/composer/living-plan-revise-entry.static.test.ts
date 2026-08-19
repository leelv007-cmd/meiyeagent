/**
 * Consumer end of the revise seam: the controller owns the "waiting for the
 * merchant's adjustment" fact, and the prompt bar's run lock has to read it.
 * `living-plan-revise-entry.interaction.test.tsx` proves the lock is what
 * disables the box; this proves the host actually lifts it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  functionReturnKeys,
  jsxOf,
  parseProductionSource,
  parseSourceText,
  propertyAccesses,
} from '../../test-support/ast-boundary';

const composerHome = parseProductionSource(
  new URL('./composer-home.tsx', import.meta.url)
);
const controller = parseProductionSource(
  new URL('./use-living-plan-controller.ts', import.meta.url)
);

test('pre-fix running lock without revising fails the revise entry', () => {
  const preFix = parseSourceText(
    'pre-fix.tsx',
    'export function Bar() { return <ComposerPromptBar running={session.phase === "running"} />; }'
  );
  const running = jsxOf(preFix, 'ComposerPromptBar')[0]?.attrs.running ?? '';
  assert.equal(running.includes('livingPlanController.revising'), false);
});

test('composer-home lifts the run lock while the plan awaits the revise text', () => {
  const bars = jsxOf(composerHome, 'ComposerPromptBar');
  assert.ok(
    bars.length >= 1,
    'composer-home must pass a `running` prompt-bar prop'
  );
  const running = bars[0]?.attrs.running ?? '';
  assert.ok(
    running.includes('livingPlanController.revising') ||
      propertyAccesses(composerHome).includes('livingPlanController.revising')
  );
});

test('the controller publishes the revising fact the run lock reads', () => {
  const keys = functionReturnKeys(controller, 'useLivingPlanController');
  assert.ok(keys.includes('onCommitAction'));
  assert.ok(keys.includes('revising'));
});
