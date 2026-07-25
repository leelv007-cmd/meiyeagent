/**
 * R-08 / #211 — the entitlement truth has exactly one source.
 *
 * "Composer 未读取 entitlement 时静态 seed 默认显示 active" was the defect. A
 * behavioural test cannot prove the *absence* of a second source, so this is a
 * static assertion門 (testing decision 9): the canonical read path lives in one
 * module, and the seed carries no entitlement verdict.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const SRC = fileURLToPath(new URL('../../', import.meta.url));

function read(file: string) {
  return readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
}

function sourceFiles() {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((entry) => /\.tsx?$/u.test(entry))
    .filter((entry) => !/\.test\.tsx?$/u.test(entry))
    .filter((entry) => !entry.includes('routeTree.gen'));
}

test('only the canonical module reads the entitlement projection endpoint', () => {
  const readers = sourceFiles().filter((file) =>
    readFileSync(`${SRC}${file}`, 'utf8').includes('/api/pro-studio/entry')
  );
  assert.deepEqual(
    readers.sort(),
    ['lib/pro-studio-entitlement.ts', 'routes/api/pro-studio/entry.ts'],
    'a new caller must go through lib/pro-studio-entitlement, not refetch the endpoint'
  );
});

test('the Pro Studio seed carries no entitlement verdict', () => {
  const seeds = read('./tool-entry-seeds.ts');
  const proStudioSeed = seeds.slice(seeds.indexOf("id: 'tool.pro_studio'"));
  assert.doesNotMatch(
    proStudioSeed.slice(0, proStudioSeed.indexOf('];')),
    /entitlementLocked/u,
    'the banner seed must not answer an entitlement question'
  );
});

test('the banner projection has no static fallback verdict', () => {
  const tools = read('./composer-tools.ts');
  assert.doesNotMatch(
    tools,
    /entitlementLocked \? 'locked' : 'active'/u,
    'R-08: the seed default that showed active is gone and stays gone'
  );
  assert.match(tools, /input\.proStudioStatus \?\? 'unknown'/u);
  // Presentation reuses the gate predicate rather than re-deciding.
  assert.match(tools, /canEnter: canEnterProStudio\(status\)/u);
});

test('the workbench entry and the catalog both read the canonical projection', () => {
  assert.match(
    read('./composer-home.tsx'),
    /proStudioStatus=\{proStudioEntitlement\.projection\.state\}/u
  );
  assert.match(
    read('./catalog-live-page.tsx'),
    /proStudioStatus: entitlement\.projection\.state/u
  );
});

test('the route gate page renders launch only on the canonical active state', () => {
  const gate = read('../../routes/pro-studio.tsx');
  assert.match(gate, /readProStudioEntitlementProjection/u);
  assert.match(gate, /entry\.state === 'active'/u);
  assert.doesNotMatch(
    gate,
    /status: 'active'/u,
    'the page must not keep a private copy of the entry contract'
  );
});
