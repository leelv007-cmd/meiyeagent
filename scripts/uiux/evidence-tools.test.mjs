import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeBundleEntries,
  CORE_SCHEMA_SOURCE_FILES,
  findSecretFindings,
  isSecretScanTextPath,
  readExistingTextFiles,
  readSecretScanFiles,
} from './evidence-tools.mjs';

test('secret scan includes tracked and ignored environment file names', () => {
  assert.equal(isSecretScanTextPath('.env'), true);
  assert.equal(isSecretScanTextPath('.env.production'), true);
  assert.equal(isSecretScanTextPath('mkfast-template-main/.env.example'), true);
  assert.equal(isSecretScanTextPath('public/logo.png'), false);
});

test('secret scan reads the index when a tracked file is absent from the worktree', () => {
  const files = readSecretScanFiles({
    trackedPaths: ['present.md', 'removed.md'],
    worktreePaths: [],
    readIndexText: (path) =>
      path === 'removed.md' ? 'indexed text' : 'safe text',
    readWorktreeText: () => {
      throw new Error('tracked files must be read from the index');
    },
  });

  assert.deepEqual(files, [
    { path: 'present.md', text: 'safe text' },
    { path: 'removed.md', text: 'indexed text' },
  ]);
});

test('secret scan skips a concurrently removed untracked file', () => {
  const files = readSecretScanFiles({
    trackedPaths: [],
    worktreePaths: ['removed.md'],
    readIndexText: () => {
      throw new Error('untracked files do not have an index blob');
    },
    readWorktreeText: () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    },
  });

  assert.deepEqual(files, []);
});

test('secret scan surfaces non-missing file read failures', () => {
  assert.throws(
    () =>
      readExistingTextFiles(['private.md'], () => {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      }),
    /denied/
  );
});

test('schema evidence covers every runtime migrator source', () => {
  assert.deepEqual(
    CORE_SCHEMA_SOURCE_FILES,
    [...CORE_SCHEMA_SOURCE_FILES].sort()
  );
  for (const path of [
    'apps/core/src/p1/cutover/execution-service.ts',
    'apps/core/src/p1/foundation/postgres-repository.ts',
    'apps/core/src/p1/integrations/postgres-repository.ts',
    'apps/core/src/p1/job-runtime/operational-telemetry.ts',
    'apps/core/src/p1/job-runtime/tracer-worker.ts',
    'apps/core/src/p1/model-supply/postgres-repository.ts',
    'apps/core/src/p1/operations/postgres-repository.ts',
    'apps/core/src/product/postgres-repository.ts',
    'apps/core/src/product/relational-product-repository.ts',
  ]) {
    assert.ok(CORE_SCHEMA_SOURCE_FILES.includes(path), path);
  }
});

test('secret findings report location and rule without echoing the secret', () => {
  const secret = `sk-${'a'.repeat(24)}`;
  const findings = findSecretFindings([
    { path: 'src/example.ts', text: `const key = '${secret}';\n` },
  ]);

  assert.deepEqual(findings, [
    { path: 'src/example.ts', line: 1, rule: 'api-key' },
  ]);
  assert.doesNotMatch(JSON.stringify(findings), new RegExp(secret));
});

test('secret findings ignore an explicit all-x documentation placeholder', () => {
  assert.deepEqual(
    findSecretFindings([
      {
        path: 'docs/example.md',
        text: `OPENAI_API_KEY="sk-${'x'.repeat(40)}"`,
      },
    ]),
    []
  );
});

test('secret findings allow only the audited invalid credential fixtures', () => {
  const realLookingKey = `sk-${'b'.repeat(24)}`;
  const findings = findSecretFindings([
    {
      path: 'apps/core/src/p1/supply-registry/credential-account.test.ts',
      text: [
        "const fixture = 'sk-live-secret-version-one';",
        `const real = '${realLookingKey}';`,
      ].join('\n'),
    },
  ]);

  assert.deepEqual(findings, [
    {
      path: 'apps/core/src/p1/supply-registry/credential-account.test.ts',
      line: 2,
      rule: 'api-key',
    },
  ]);
});

test('bundle analysis reports the initial shell budgets', () => {
  const report = analyzeBundleEntries([
    { name: 'main-fixture.js', gzipBytes: 349_000 },
    { name: 'styles-fixture.css', gzipBytes: 79_000 },
  ]);

  assert.deepEqual(report, {
    initialCssGzipBytes: 79_000,
    initialJsGzipBytes: 349_000,
    passed: true,
  });
});

test('bundle analysis fails when an initial budget is exceeded', () => {
  assert.equal(
    analyzeBundleEntries([
      { name: 'main-fixture.js', gzipBytes: 350_001 },
      { name: 'styles-fixture.css', gzipBytes: 80_000 },
    ]).passed,
    false
  );
});
