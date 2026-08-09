import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(here, '../../../../..');

// migrate()'s one-time resultSignals revision backfill (V31-19 quarantine)
// runs in the schema-migration path, not through the runtime adapter. It is
// the only authorized bypass; any new entry needs its own ruling.
const FROZEN_CONTENT_PACKAGE_WRITE_BYPASSES = [
  'apps/core/src/p1/operations/postgres-repository.ts',
] as const;

function childSourceRoots(parent: string): string[] {
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(parent, entry.name, 'src'))
    .filter((path) => existsSync(path));
}

const productionSourceRoots = [
  ...childSourceRoots(join(repositoryRoot, 'apps')),
  ...childSourceRoots(join(repositoryRoot, 'packages')),
  join(repositoryRoot, 'mkfast-template-main/src'),
];

function productionTypescriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionTypescriptFiles(path);
    if (
      (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) ||
      entry.name.endsWith('.test.ts') ||
      entry.name.endsWith('.test.tsx')
    ) {
      return [];
    }
    return [path];
  });
}

function filesMatching(pattern: RegExp) {
  return productionSourceRoots
    .flatMap((root) => productionTypescriptFiles(root))
    .filter((path) => pattern.test(readFileSync(path, 'utf8')))
    .map((path) => relative(repositoryRoot, path))
    .sort();
}

test('ContentPackage SQL writes stay in the canonical adapter plus the fixed FREEZE bypass', () => {
  const writers = filesMatching(
    /\b(?:insert\s+into|update|delete\s+from)\s+(?:public\.)?p1_content_packages\b/i,
  );
  assert.deepEqual(writers, [
    'apps/core/src/p1/operations/postgres-content-package-write-adapter.ts',
    ...FROZEN_CONTENT_PACKAGE_WRITE_BYPASSES,
  ]);
  assert.deepEqual(FROZEN_CONTENT_PACKAGE_WRITE_BYPASSES, [
    'apps/core/src/p1/operations/postgres-repository.ts',
  ]);
});

test('StoreFact SQL and semantic appends have one controlled path', () => {
  assert.deepEqual(
    filesMatching(
      /\b(?:insert\s+into|update|delete\s+from)\s+(?:public\.)?p1_store_fact_(?:heads|workspace_heads|revisions)\b/i,
    ),
    ['apps/core/src/p1/operations/postgres-store-fact-ledger.ts'],
  );
  assert.deepEqual(
    filesMatching(/\b(?:this\.)?(?:facts|ledger)\.append\s*\(/),
    ['apps/core/src/p1/operations/store-fact-semantic-mutation-policy.ts'],
  );
});

test('W01 browser proof cannot pre-seed the StoreFact projection under test', () => {
  const source = readFileSync(
    join(
      repositoryRoot,
      'mkfast-template-main/tests/e2e/specs/w01-storefact-wiring.spec.ts',
    ),
    'utf8',
  );
  for (const forbidden of [
    'seedConfirmedStore',
    'store_fact_append',
    'record_asset_intake_batch',
    'confirm_asset_intake_fact',
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  assert.doesNotMatch(
    source,
    /fetch\(\s*['"]\/api\/core\/p1\/commands['"]/u,
  );
});

test('Harness Result adoption emits the canonical command and does not infer adoption from currentVersionId', () => {
  // The Result route delegates to use-result-center-view; adoption consumption
  // lives in the hook since the A4 extraction.
  const route = readFileSync(
    join(
      repositoryRoot,
      'mkfast-template-main/src/product/results/use-result-center-view.tsx',
    ),
    'utf8',
  );
  assert.match(route, /'adopt_harness_candidate'/);
  assert.match(route, /resultContentPackageMutationFacts\(contentPackage\)/);
  assert.doesNotMatch(
    route,
    /hasAdoptedCandidate:\s*Boolean\(currentPackageVersion\)/,
  );
});
