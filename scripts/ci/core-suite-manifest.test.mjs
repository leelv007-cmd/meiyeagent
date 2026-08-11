import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  buildCoreSuiteManifest,
  coreSuiteManifestViolations,
  currentCoreSuiteManifest,
  filesForOwner,
} from './core-suite-manifest.mjs';

const manifestScript = fileURLToPath(
  new URL('./core-suite-manifest.mjs', import.meta.url),
);
const ownerAssertionScript = fileURLToPath(
  new URL('./assert-core-suite-owners.mjs', import.meta.url),
);

const contract = {
  schemaVersion: 1,
  trackedPathPrefix: 'apps/core/src/',
  owners: {
    core: { requiredJob: 'core', categories: ['unit'] },
    'core-persistence': { requiredJob: 'core-persistence', categories: ['pg', 'dbos'] },
  },
  classifications: [
    {
      category: 'dbos',
      owner: 'core-persistence',
      suffixes: ['.smoke.test.ts', '.dbos.postgres.test.ts'],
    },
    { category: 'pg', owner: 'core-persistence', suffixes: ['.postgres.test.ts'] },
    { category: 'unit', owner: 'core', suffixes: [] },
  ],
};

test('the workspace Core suite manifest gives every test exactly one required owner', async () => {
  const { manifest } = await currentCoreSuiteManifest();
  assert.deepEqual(coreSuiteManifestViolations(manifest, contract), []);

  const postgres = manifest.workspaceFiles.filter((file) =>
    file.endsWith('.postgres.test.ts'),
  );
  const smoke = manifest.workspaceFiles.filter((file) => file.endsWith('.smoke.test.ts'));
  assert.ok(postgres.length > 0, 'workspace PostgreSQL suites must not disappear');
  assert.ok(smoke.length > 0, 'workspace DBOS smoke suites must not disappear');
  assert.deepEqual(
    [...filesForOwner(manifest, 'core-persistence')].sort(),
    [...postgres, ...smoke].sort(),
  );
  assert.ok(
    filesForOwner(manifest, 'core').every(
      (file) =>
        !file.endsWith('.postgres.test.ts') && !file.endsWith('.smoke.test.ts'),
    ),
    'ordinary Core must never also own a PostgreSQL or DBOS smoke suite',
  );
  assert.ok(
    manifest.workspaceFiles.includes(
      'apps/core/src/p1/harness/postgres-carrier-settlement-coordinator.postgres.test.ts',
    ),
    'non-ignored carrier PG worktree tests must be owned before they are tracked',
  );
});

test('the manifest reports missing, duplicate, and orphan suite entries together', () => {
  const trackedFiles = [
    'apps/core/src/ordinary.test.ts',
    'apps/core/src/durable.postgres.test.ts',
    'apps/core/src/dbos-registration.smoke.test.ts',
  ];
  const manifest = buildCoreSuiteManifest({ trackedFiles, contract });
  manifest.suites.find((suite) => suite.id === 'core-persistence-pg').files = [];
  manifest.suites.find((suite) => suite.id === 'core-unit').files.push(
    'apps/core/src/ordinary.test.ts',
  );
  manifest.suites.find((suite) => suite.id === 'core-persistence-dbos').files.push(
    'apps/core/src/orphan.smoke.test.ts',
  );

  const violations = coreSuiteManifestViolations(manifest, contract).join('\n');
  assert.match(violations, /missing owners:/u);
  assert.match(violations, /durable\.postgres\.test\.ts/u);
  assert.match(violations, /missing workspace pg suite files/u);
  assert.match(violations, /duplicate owners:/u);
  assert.match(violations, /ordinary\.test\.ts/u);
  assert.match(violations, /orphan suite entries:/u);
  assert.match(violations, /orphan\.smoke\.test\.ts/u);
});

test('the manifest CLI emits the workspace persistence suite as JSON', () => {
  const result = spawnSync(process.execPath, [manifestScript, '--owner', 'core-persistence'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(result.stdout);
  assert.ok(manifest.suites.every((suite) => suite.owner === 'core-persistence'));
  assert.ok(
    manifest.suites.some((suite) => suite.category === 'pg' && suite.files.length > 0),
  );
  assert.ok(
    manifest.suites.some((suite) => suite.category === 'dbos' && suite.files.length > 0),
  );
});

test('the package and persistence runner use their exclusive owners', () => {
  const result = spawnSync(process.execPath, [ownerAssertionScript], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Core suite owner contract passed/u);
});
