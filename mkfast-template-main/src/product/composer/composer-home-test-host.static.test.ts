/**
 * ComposerHome's interface must stay product inputs plus one named test host.
 *
 * The 2026-08-16 architecture review found ComposerHomeProps carrying eleven
 * props, five of which existed only so tests could reach inside. Two of those
 * five (`sessionStore`, `viralOpenCliBridge`) had no passer at all — not the
 * route, not a test — so the interface was paying for substitutions nobody
 * made. They are gone; the other three moved into `testHost`.
 *
 * WHY A GATE AND NOT JUST THE REFACTOR: nothing about the collapsed shape
 * resists the next escape hatch. Adding prop twelve is one line and reviews as
 * harmless, and that is exactly how the first five arrived. deepEqual runs both
 * ways, so a new top-level prop fails here and has to argue for itself, and a
 * removed one fails too rather than leaving the list quietly stale.
 *
 * WHAT THIS DOES NOT CLAIM: that production and tests now run the same path.
 * They do not — `testHost.fixtureSubmit` still skips live create, and
 * `testHost.campaign` still substitutes the read. This narrows the interface
 * and names the substitution point; it does not remove the substitution.
 */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  jsxOf,
  parseProductionSource,
  typeMembers,
} from '../../test-support/ast-boundary';

const COMPOSER_HOME = resolve(
  process.cwd(),
  'src/product/composer/composer-home.tsx'
);
const ROUTE = resolve(process.cwd(), 'src/routes/dashboard/index.tsx');

const PRODUCT_INPUTS = [
  'accountId',
  'initialAiCover',
  'initialRecipeRevisionId',
  'initialSessionIdentityId',
  'initialSurfaceRevisionId',
  'initialTaskId',
  'initialThreadId',
];

const TEST_AFFORDANCE = ['testHost'];

test('ComposerHomeProps is product inputs plus exactly one test host', () => {
  const parsed = parseProductionSource(COMPOSER_HOME);
  assert.deepEqual(
    typeMembers(parsed, 'ComposerHomeProps'),
    [...PRODUCT_INPUTS, ...TEST_AFFORDANCE].sort()
  );
});

test('the dashboard route hands ComposerHome no test host', () => {
  const route = parseProductionSource(ROUTE);
  const mounts = jsxOf(route, 'ComposerHome');
  assert.ok(
    mounts.length >= 1,
    `${ROUTE} no longer renders ComposerHome; this gate is pointed at nothing`
  );
  assert.equal(
    Object.hasOwn(mounts[0]?.attrs ?? {}, 'testHost'),
    false,
    `${ROUTE} must not pass testHost`
  );
});

test('the retired escape hatches did not grow back', () => {
  const members = new Set(
    typeMembers(parseProductionSource(COMPOSER_HOME), 'ComposerHomeProps')
  );
  for (const retired of ['sessionStore', 'viralOpenCliBridge']) {
    assert.equal(
      members.has(retired),
      false,
      `${retired} was removed as an unused injection point; do not re-add it`
    );
  }
});
