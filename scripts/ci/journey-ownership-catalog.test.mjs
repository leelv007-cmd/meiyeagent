import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const cliPath = path.resolve('scripts/ci/journey-ownership-catalog.mjs');

test('repository catalog follows canonical opt-in evidence and current browser producers', async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'meiye-current-ownership-')
  );
  const outputPath = path.join(directory, 'output.json');
  const result = spawnSync(
    process.execPath,
    [cliPath, 'validate', '--output', outputPath],
    { encoding: 'utf8' }
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.deepEqual(output.inventory, { playwright: 99, persistence: 101 });
  const browser = output.entries.filter((entry) => entry.kind === 'playwright');
  assert.deepEqual(
    Object.fromEntries(
      ['required', 'advisory', 'full-rc-local'].map((tier) => [
        tier,
        browser.filter((entry) => entry.tier === tier).length,
      ])
    ),
    { required: 10, advisory: 27, 'full-rc-local': 62 }
  );
  assert.equal(
    output.entries.filter(
      (entry) =>
        entry.path ===
          'apps/core/src/p1/model-supply/postgres-repository.test.ts' &&
        entry.owner === 'core-persistence' &&
        entry.currentDecision === 'blocking'
    ).length,
    1
  );
  const issue255 = output.entries.find(
    (entry) =>
      entry.path ===
      'apps/core/src/p1/harness/issue-255-safe-provision.postgres.test.ts'
  );
  assert.equal(issue255.currentDecision, 'blocking');
  assert.equal(issue255.allowedSkip, false);
  assert.equal(
    issue255.provisionStrategy,
    'issue-255-safe-provision/v1'
  );
  assert.equal(issue255.ticket, 'V31-67');
  assert.equal(
    output.entries.filter((entry) => entry.currentDecision === 'instrument')
      .length,
    1
  );
  for (const entry of browser) {
    assert.ok(entry.producer, `${entry.path} lacks a real producer`);
    if (
      entry.tier === 'full-rc-local' &&
      entry.currentDecision !== 'instrument'
    ) {
      assert.equal(
        entry.artifact,
        null,
        `${entry.path} fakes a local artifact`
      );
    } else {
      assert.equal(typeof entry.artifact, 'string');
      assert.notEqual(entry.artifact, '');
    }
  }
  const instrument = browser.find(
    (entry) => entry.currentDecision === 'instrument'
  );
  assert.equal(instrument.producer, 'scripts/ci/run-v31-instruments.sh');
  assert.equal(
    instrument.artifact,
    'output/ci/v31-browser-report/instruments/playwright-v31-82-stalled-image-work-timeout.log'
  );
});

test('validate emits resolved ownership and excludes advisory/instrument failures from release verdict', async () => {
  const result = await runFixture({
    results: {
      'browser/blocking.spec.ts': 'pass',
      'browser/advisory.spec.ts': 'fail',
      'browser/instrument.spec.ts': 'fail',
      'core/a.postgres.test.ts': 'pass',
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(await readFile(result.outputPath, 'utf8'));
  assert.equal(output.releaseVerdict, 'pass');
  assert.equal(output.entries.length, 4);
  for (const entry of output.entries) {
    for (const field of [
      'owner',
      'tier',
      'env',
      'currentDecision',
      'allowedSkip',
      'artifact',
    ]) {
      assert.ok(Object.hasOwn(entry, field), `${entry.path} lacks ${field}`);
    }
  }
});

test('release Playwright selection excludes instrument decisions', () => {
  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      'list-playwright',
      '--purpose',
      'release-verdict',
      '--relative-web',
    ],
    { encoding: 'utf8' }
  );

  assert.equal(result.status, 0, result.stderr);
  const files = result.stdout.trim().split(/\r?\n/u).filter(Boolean);
  assert.equal(files.length, 98);
  assert.equal(
    files.includes('tests/e2e/specs/v31-82-stalled-image-work-timeout.spec.ts'),
    false
  );
});

test('validate fails when inventory coverage is not exact', async () => {
  const result = await runFixture({
    addInventoryFile: 'browser/unowned.spec.ts',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unowned inventory file.*unowned\.spec\.ts/u);
});

test('validate fails when suite discovery finds an opt-in missing from canonical evidence', async () => {
  const result = await runFixture({
    unregisteredPersistence: ['core/unregistered.postgres.test.ts'],
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /opt-in suite is missing canonical evidence/u);
});

test('validate rejects known_red blocking and ownerless advisory entries', async () => {
  const blocking = await runFixture({
    mutateCatalog(catalog) {
      catalog.entries[0].currentDecision = 'known_red';
    },
  });
  assert.notEqual(blocking.status, 0);
  assert.match(blocking.stderr, /blocking.*known_red|known_red.*blocking/u);

  const advisory = await runFixture({
    mutateCatalog(catalog) {
      catalog.entries[1].owner = '';
      delete catalog.entries[1].ticket;
    },
  });
  assert.notEqual(advisory.status, 0);
  assert.match(advisory.stderr, /advisory.*owner.*ticket/u);
});

async function runFixture(options) {
  const directory = await mkdtemp(path.join(tmpdir(), 'meiye-ownership-'));
  const catalogPath = path.join(directory, 'catalog.json');
  const inventoryPath = path.join(directory, 'inventory.json');
  const resultsPath = path.join(directory, 'results.json');
  const outputPath = path.join(directory, 'output.json');
  const entries = [
    entry('browser/blocking.spec.ts', 'blocking'),
    { ...entry('browser/advisory.spec.ts', 'advisory'), ticket: 'CI-03' },
    { ...entry('browser/instrument.spec.ts', 'instrument'), ticket: 'V31-82' },
    {
      ...entry('core/a.postgres.test.ts', 'advisory'),
      kind: 'persistence',
      ticket: 'CI-01B',
    },
  ];
  const catalog = { schemaVersion: 'journey-ownership/v1', entries };
  options.mutateCatalog?.(catalog);
  const inventory = {
    trackedFiles: ['fixture-producer'],
    playwright: entries
      .filter((item) => item.kind === 'playwright')
      .map((item) => item.path),
    persistence: entries
      .filter((item) => item.kind === 'persistence')
      .map((item) => item.path),
    unregisteredPersistence: options.unregisteredPersistence ?? [],
  };
  if (options.addInventoryFile)
    inventory.playwright.push(options.addInventoryFile);
  await Promise.all([
    writeFile(catalogPath, JSON.stringify(catalog)),
    writeFile(inventoryPath, JSON.stringify(inventory)),
    writeFile(resultsPath, JSON.stringify(options.results ?? {})),
  ]);
  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      'validate',
      '--catalog',
      catalogPath,
      '--inventory',
      inventoryPath,
      '--results',
      resultsPath,
      '--output',
      outputPath,
    ],
    { encoding: 'utf8' }
  );
  return { ...result, outputPath };
}

function entry(filePath, currentDecision) {
  return {
    path: filePath,
    kind: 'playwright',
    owner: 'journey-owner',
    tier: 'fixture',
    env: 'fixture-provider-free',
    currentDecision,
    allowedSkip: false,
    artifact: 'output/ci/browser/{basename}.json',
    producer: 'fixture-producer',
  };
}
