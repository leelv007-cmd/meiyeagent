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
  assert.equal(output.releaseVerdict, null);
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

test('verify rejects an issue 255 file that claims the main pair instead of its actual provision receipt', async () => {
  const result = await runFixture({
    mutateCatalog(catalog) {
      catalog.entries[0].provisionStrategy =
        'issue-255-safe-provision/v1';
    },
    mutateResults(results) {
      results.files[0].provisionReceipt = issue255ProvisionReceipt();
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /business database pair mismatch.*a\.postgres\.test\.ts/u,
  );
});

test('verify accepts issue 255 only with a fresh self-drop receipt bound to the actual pair', async () => {
  const receipt = issue255ProvisionReceipt();
  const result = await runFixture({
    mutateCatalog(catalog) {
      catalog.entries[0].provisionStrategy =
        'issue-255-safe-provision/v1';
    },
    mutateResults(results) {
      Object.assign(results.files[0], {
        provisionId: receipt.provisionId,
        databasePair: receipt.databasePair,
        provisionReceipt: receipt,
      });
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(await readFile(result.outputPath, 'utf8'));
  assert.equal(
    output.files[0].provisionReceipt.schemaVersion,
    'persistence-file-provision/v1',
  );
  assert.equal(output.files[0].provisionReceipt.selfDropped, true);
});

test('verify rejects an issue 255 pair that swaps the main business and DBOS roles', async () => {
  const receipt = issue255ProvisionReceipt();
  receipt.databasePair = {
    business: 'dbos-1',
    dbosSystem: 'business-1',
  };
  const result = await runFixture({
    mutateCatalog(catalog) {
      catalog.entries[0].provisionStrategy =
        'issue-255-safe-provision/v1';
    },
    mutateResults(results) {
      Object.assign(results.files[0], {
        provisionId: receipt.provisionId,
        databasePair: receipt.databasePair,
        provisionReceipt: receipt,
      });
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /isolated from the main provision/u);
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
  options.mutateCatalog?.(catalog);
  const provision = {
    schemaVersion: 'persistence-provision/v1',
    provisioner: 'provision-persistence-instrument/v1',
    commitSha: sha,
    provisionId: 'provision-1',
    fresh: true,
    provisionedAt: '2026-08-19T12:00:00.000Z',
    databasePair: { business: 'business-1', dbosSystem: 'dbos-1' },
    databaseNames: { business: 'business_test', dbosSystem: 'dbos_test' },
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

function issue255ProvisionReceipt() {
  return {
    schemaVersion: 'persistence-file-provision/v1',
    provisioner: 'issue-255-safe-provision/v1',
    commitSha: sha,
    provisionId: 'issue255-provision-1',
    fresh: true,
    provisionedAt: '2026-08-20T12:01:00.000Z',
    databasePair: {
      business: 'issue255-business',
      dbosSystem: 'issue255-dbos',
    },
    databaseNames: {
      business: 'meiye_issue255',
      dbosSystem: 'meiye_issue255_dbos',
    },
    selfDropped: true,
    dropVerifiedAt: '2026-08-20T12:02:00.000Z',
  };
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
