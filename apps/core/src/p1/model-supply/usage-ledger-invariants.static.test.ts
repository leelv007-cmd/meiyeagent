import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(here, '../../../../..');

const CANONICAL_PRODUCT_USAGE_SQL_WRITERS = [
  'apps/core/src/p1/product-billing/postgres-repository.ts',
] as const;

const CANONICAL_PRODUCT_USAGE_RESERVE_CALLERS = [
  'apps/core/src/p1/execution-spine/postgres-creation-submission-store.ts',
  'apps/core/src/p1/product-billing/quote-service.ts',
] as const;

const CANONICAL_GRANT_LOT_SQL_WRITERS = [
  'apps/core/src/p1/foundation/postgres-grant-lot.ts',
  'mkfast-template-main/src/routes/api/e2e/users.ts',
] as const;

const CANONICAL_GRANT_LOT_CONSUME_CALLERS = [
  'apps/core/src/p1/execution-spine/postgres-creation-submission-store.ts',
  'apps/core/src/p1/model-supply/foundation-ledger.ts',
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

test('ProductUsage SQL writes stay in the canonical billing repository', () => {
  assert.deepEqual(
    filesMatching(
      /\b(?:insert\s+into|update|delete\s+from)\s+(?:public\.)?p1_product_billing_usage\b/i,
    ),
    [...CANONICAL_PRODUCT_USAGE_SQL_WRITERS],
  );
});

test('ProductUsage reserve calls stay in the Coordinator billing chain', () => {
  assert.deepEqual(
    filesMatching(/\b(?:this\.)?usage\.reserve\s*\(/),
    [...CANONICAL_PRODUCT_USAGE_RESERVE_CALLERS],
  );
});

test('GrantLot writes and consume calls stay in the guarded billing chains', () => {
  assert.deepEqual(
    filesMatching(
      /\b(?:insert\s+into|update|delete\s+from)\s+(?:public\.)?p1_grant_lots\b/i,
    ),
    [...CANONICAL_GRANT_LOT_SQL_WRITERS],
  );
  assert.deepEqual(
    filesMatching(/\bgrantLots\.consume(?:WithClient)?\s*\(/),
    [...CANONICAL_GRANT_LOT_CONSUME_CALLERS],
  );
});

test('Harness media child jobs cannot consume ProductUsage or GrantLot twice', () => {
  const source = readFileSync(
    join(
      repositoryRoot,
      'apps/core/src/p1/harness/unified-media-stage-ports.ts',
    ),
    'utf8',
  );
  assert.match(source, /\bproductUsageQuantity:\s*0\b/u);
  assert.doesNotMatch(source, /\bproductUsageQuantity:\s*1\b/u);
  const exactTextVerifier = source.slice(
    source.indexOf('export class ModelSupplyImageExactTextVerifier'),
    source.indexOf('function assessImageExactText'),
  );
  assert.match(exactTextVerifier, /\bproductUsageQuantity:\s*0\b/u);
});
