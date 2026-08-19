import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const cliPath = path.resolve('scripts/ci/persistence-evidence-instrument.mjs');
const sha = '0123456789abcdef0123456789abcdef01234567';

test('verify accepts a complete same-SHA fresh isolated pair with per-file evidence', async () => {
  const result = await runFixture({});

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(await readFile(result.outputPath, 'utf8'));
  assert.equal(output.verdict, 'pass');
  assert.deepEqual(output.summary, { files: 2, pass: 3, fail: 0, skip: 0 });
  assert.deepEqual(
    output.files.map((file) => [file.path, file.verdict]),
    [
      ['apps/core/src/a.postgres.test.ts', 'pass'],
      ['mkfast-template-main/src/b.postgres.test.ts', 'pass'],
    ]
  );
});

test('verify fails closed for a missing fresh isolated business/DBOS pair', async () => {
  const result = await runFixture({
    provision: { databasePair: { business: 'business-1' } },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /fresh isolated database pair/u);
});

test('verify catches a wrong DBOS pair on an individual file', async () => {
  const result = await runFixture({
    mutateResults(results) {
      results.files[1].databasePair.dbosSystem = 'dbos-wrong';
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DBOS pair mismatch.*b\.postgres\.test\.ts/u);
});

test('verify catches zero-test contribution and silent skip per file', async () => {
  const zero = await runFixture({
    mutateResults(results) {
      results.files[0].counts = { pass: 0, fail: 0, skip: 0 };
    },
  });
  assert.notEqual(zero.status, 0);
  assert.match(zero.stderr, /contributed 0 tests/u);

  const skipped = await runFixture({
    mutateResults(results) {
      results.files[0].counts = { pass: 0, fail: 0, skip: 1 };
    },
  });
  assert.notEqual(skipped.status, 0);
  assert.match(skipped.stderr, /unexpected skip/u);
});

async function runFixture(options) {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'meiye-persistence-evidence-')
  );
  const catalogPath = path.join(directory, 'catalog.json');
  const provisionPath = path.join(directory, 'provision.json');
  const resultsPath = path.join(directory, 'results.json');
  const outputPath = path.join(directory, 'verified.json');
  const catalog = {
    schemaVersion: 'journey-ownership/v1',
    entries: [
      persistenceEntry('apps/core/src/a.postgres.test.ts'),
      persistenceEntry('mkfast-template-main/src/b.postgres.test.ts'),
    ],
  };
  const provision = {
    schemaVersion: 'persistence-provision/v1',
    commitSha: sha,
    provisionId: 'provision-1',
    fresh: true,
    provisionedAt: '2026-08-19T12:00:00.000Z',
    databasePair: { business: 'business-1', dbosSystem: 'dbos-1' },
    ...options.provision,
  };
  const results = {
    schemaVersion: 'persistence-results/v1',
    commitSha: sha,
    provisionId: 'provision-1',
    files: catalog.entries.map((entry, index) => ({
      path: entry.path,
      commitSha: sha,
      provisionId: 'provision-1',
      databasePair: { business: 'business-1', dbosSystem: 'dbos-1' },
      counts: { pass: index + 1, fail: 0, skip: 0 },
      verdict: 'pass',
      artifact: `logs/${index}.tap`,
    })),
  };
  options.mutateResults?.(results);
  await Promise.all([
    writeFile(catalogPath, JSON.stringify(catalog)),
    writeFile(provisionPath, JSON.stringify(provision)),
    writeFile(resultsPath, JSON.stringify(results)),
  ]);

  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      'verify',
      '--catalog',
      catalogPath,
      '--provision',
      provisionPath,
      '--results',
      resultsPath,
      '--expected-sha',
      sha,
      '--output',
      outputPath,
    ],
    { encoding: 'utf8' }
  );
  return { ...result, outputPath };
}

function persistenceEntry(filePath) {
  return {
    path: filePath,
    kind: 'persistence',
    owner: 'persistence-owner',
    tier: 'persistence',
    env: 'fresh-postgres-pair',
    currentDecision: 'advisory',
    allowedSkip: false,
    artifact: 'output/ci/persistence/{basename}.json',
    ticket: 'CI-01B',
  };
}
