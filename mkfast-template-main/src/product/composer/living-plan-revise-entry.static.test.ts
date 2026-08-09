/**
 * Consumer end of the revise seam: the controller owns the "waiting for the
 * merchant's adjustment" fact, and the prompt bar's run lock has to read it.
 * `living-plan-revise-entry.interaction.test.tsx` proves the lock is what
 * disables the box; this proves the host actually lifts it.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const composerHome = readFileSync(
  new URL('./composer-home.tsx', import.meta.url),
  'utf8'
);
const controller = readFileSync(
  new URL('./use-living-plan-controller.ts', import.meta.url),
  'utf8'
);

test('composer-home lifts the run lock while the plan awaits the revise text', () => {
  const runningProp = composerHome.match(
    /\n {18}running=\{([\s\S]*?)\n {18}\}/u
  );
  assert.ok(runningProp, 'composer-home must pass a `running` prompt-bar prop');
  assert.match(runningProp[1]!, /!livingPlanController\.revising/u);
});

test('the controller publishes the revising fact the run lock reads', () => {
  assert.match(controller, /return \{ onCommitAction, revising, /u);
});
