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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const COMPOSER_HOME = 'src/product/composer/composer-home.tsx';
const ROUTE = 'src/routes/dashboard/index.tsx';

function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

/**
 * Product inputs a route may legitimately hand ComposerHome. Every one of these
 * is reachable from a real merchant navigation — a deep link, a handoff, or a
 * revision the previous surface picked.
 */
const PRODUCT_INPUTS = [
  'initialAiCover',
  'initialRecipeRevisionId',
  'initialSessionIdentityId',
  'initialSurfaceRevisionId',
  'initialTaskId',
  'initialThreadId',
];

/** The single admitted test affordance. */
const TEST_AFFORDANCE = ['testHost'];

/**
 * Pull the member names declared directly inside a `export type X = { ... }`
 * block, ignoring anything nested one level deeper (`initialAiCover` has its
 * own object body, and its fields are not props).
 */
function topLevelMembers(source: string, typeName: string): string[] {
  const start = source.indexOf(`export type ${typeName} = {`);
  assert.notEqual(start, -1, `${typeName} was not found in ${COMPOSER_HOME}`);
  let depth = 0;
  let index = source.indexOf('{', start);
  const members: string[] = [];
  let line = '';
  const flush = () => {
    if (depth === 1) {
      const match = /^\s*([A-Za-z][A-Za-z0-9]*)\??\s*:/u.exec(line);
      if (match?.[1]) members.push(match[1]);
    }
    line = '';
  };
  for (; index < source.length; index += 1) {
    const character = source[index];
    if (character === '{') {
      // Flush before descending: `initialAiCover?: {` declares a prop AND opens
      // a nested body on one line, and resetting first loses the name.
      flush();
      depth += 1;
      continue;
    }
    if (character === '}') {
      depth -= 1;
      if (depth === 0) break;
      line = '';
      continue;
    }
    if (character === '\n') {
      flush();
      continue;
    }
    line += character;
  }
  assert.equal(depth, 0, `${typeName} braces did not balance`);
  return members.sort();
}

test('ComposerHomeProps is product inputs plus exactly one test host', () => {
  const source = readSource(COMPOSER_HOME);
  assert.deepEqual(
    topLevelMembers(source, 'ComposerHomeProps'),
    [...PRODUCT_INPUTS, ...TEST_AFFORDANCE].sort()
  );
});

test('the dashboard route hands ComposerHome no test host', () => {
  // The reason `testHost` can be named honestly instead of dressed up as a
  // seam: production supplies none of it. If that ever stops being true the
  // name is a lie and this fails before the lie ships.
  const route = readSource(ROUTE);
  assert.ok(
    route.includes('<ComposerHome'),
    `${ROUTE} no longer renders ComposerHome; this gate is pointed at nothing`
  );
  assert.doesNotMatch(route, /testHost/u, `${ROUTE} must not pass testHost`);
});

test('the retired escape hatches did not grow back', () => {
  // Both had zero passers when removed. A reappearance means someone re-added
  // an injection point without a caller — the exact shape that was deleted.
  // Matches the declaration form only. The docblock at the top of this file
  // names both in prose, and a substring check would fail on its own
  // explanation — which it did, the first time this gate ran.
  const source = readSource(COMPOSER_HOME);
  for (const retired of ['sessionStore', 'viralOpenCliBridge']) {
    assert.doesNotMatch(
      source,
      new RegExp(`\\b${retired}\\s*\\??\\s*:`, 'u'),
      `${retired} was removed as an unused injection point; do not re-add it`
    );
  }
});
