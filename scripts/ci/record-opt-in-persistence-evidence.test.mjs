import assert from 'node:assert/strict';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  artifactDigestFromRepository,
  recordCalibration,
} from './record-opt-in-persistence-evidence.mjs';

const sha = '0123456789abcdef0123456789abcdef01234567';
const files = [
  'apps/core/src/p1/a.postgres.test.ts',
  'mkfast-template-main/src/payment/b.postgres.test.ts',
];

test('records only verified same-SHA per-file evidence into a redacted receipt', async () => {
  const output = await recordCalibration({
    artifactDigest: async (artifact) =>
      artifact.endsWith('/a.tap') ? 'a'.repeat(64) : 'b'.repeat(64),
    catalog: fixtureCatalog(),
    expectedSha: sha,
    ledger: fixtureLedger(),
    provision: fixtureProvision(),
    receiptPath: 'docs/ops/persistence-calibrations/fixture.json',
    results: fixtureResults(),
  });

  assert.equal(
    output.receipt.schemaVersion,
    'opt-in-persistence-calibration/v1'
  );
  assert.equal(output.receipt.commitSha, sha);
  assert.deepEqual(output.receipt.summary, {
    files: 2,
    pass: 3,
    fail: 0,
    skip: 0,
  });
  assert.deepEqual(
    output.receipt.files.map((file) => [file.path, file.artifact.sha256]),
    [
      [files[0], 'a'.repeat(64)],
      [files[1], 'b'.repeat(64)],
    ]
  );
  assert.doesNotMatch(JSON.stringify(output.receipt), /postgres(?:ql)?:\/\//iu);
  for (const file of files) {
    assert.equal(output.ledger.suites[file].status, 'green');
    assert.equal(output.ledger.suites[file].verifiedAt, sha);
    assert.equal(
      output.ledger.suites[file].receipt,
      'docs/ops/persistence-calibrations/fixture.json'
    );
  }
  assert.equal(output.ledger.suites[files[1]].ticket, 'V31-66');
});

test('refuses stale SHA, skips, and a ledger path that has not been registered', async () => {
  await assert.rejects(
    recordCalibration({
      artifactDigest: async () => 'digest',
      catalog: fixtureCatalog(),
      expectedSha: sha,
      ledger: fixtureLedger(),
      provision: fixtureProvision(),
      receiptPath: 'docs/ops/persistence-calibrations/fixture.json',
      results: fixtureResults({
        mutate(results) {
          results.files[0].counts.skip = 1;
          results.files[0].verdict = 'skip';
        },
      }),
    }),
    /unexpected skip/u
  );

  await assert.rejects(
    recordCalibration({
      artifactDigest: async () => 'digest',
      catalog: fixtureCatalog(),
      expectedSha: sha,
      ledger: { schemaVersion: 'opt-in-test-evidence/v1', suites: {} },
      provision: fixtureProvision(),
      receiptPath: 'docs/ops/persistence-calibrations/fixture.json',
      results: fixtureResults(),
    }),
    /missing canonical ledger entry/u
  );

  await assert.rejects(
    recordCalibration({
      artifactDigest: async () => 'digest',
      catalog: fixtureCatalog(),
      expectedSha: sha,
      ledger: fixtureLedger(),
      provision: fixtureProvision(),
      receiptPath: 'docs/ops/persistence-calibrations/fixture.json',
      results: fixtureResults({
        mutate(results) {
          results.commitSha = 'f'.repeat(40);
        },
      }),
    }),
    /results commit SHA mismatch/u
  );

  await assert.rejects(
    recordCalibration({
      artifactDigest: async () => 'not-a-sha256',
      catalog: fixtureCatalog(),
      expectedSha: sha,
      ledger: fixtureLedger(),
      provision: fixtureProvision(),
      receiptPath: 'docs/ops/persistence-calibrations/fixture.json',
      results: fixtureResults(),
    }),
    /SHA-256 digest/u
  );
});

test('hashes only clean TAP files from the current runner output directory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'meiye-receipt-artifact-'));
  const filesDirectory = path.join(root, 'output', 'ci', 'run-a', 'files');
  const otherDirectory = path.join(root, 'output', 'ci', 'run-b', 'files');
  await Promise.all([
    mkdir(filesDirectory, { recursive: true }),
    mkdir(otherDirectory, { recursive: true }),
  ]);
  await writeFile(path.join(root, 'AGENTS.md'), 'not a TAP artifact\n');
  await writeFile(path.join(root, 'outside.tap'), 'TAP version 13\n');
  await writeFile(
    path.join(filesDirectory, 'one.tap'),
    'TAP version 13\n1..1\n# tests 1\n# pass 1\n# fail 0\n# skipped 0\n'
  );
  await writeFile(path.join(filesDirectory, 'leak.tap'), 'postgres://user:secret@db/test\n');
  await writeFile(path.join(otherDirectory, 'two.tap'), 'TAP version 13\n');
  await symlink(
    path.join(root, 'outside.tap'),
    path.join(filesDirectory, 'symlink.tap')
  );

  const digest = await artifactDigestFromRepository(
    root,
    'output/ci/run-a/files/one.tap',
    filesDirectory
  );
  assert.match(digest, /^[a-f0-9]{64}$/u);
  await assert.rejects(
    artifactDigestFromRepository(
      root,
      'output/ci/../../AGENTS.md',
      filesDirectory
    ),
    /runner output directory/u
  );
  await assert.rejects(
    artifactDigestFromRepository(
      root,
      'output/ci/run-b/files/two.tap',
      filesDirectory
    ),
    /runner output directory/u
  );
  await assert.rejects(
    artifactDigestFromRepository(
      root,
      'output/ci/run-a/files/leak.tap',
      filesDirectory
    ),
    /credential-shaped content/u
  );
  await assert.rejects(
    artifactDigestFromRepository(
      root,
      'output/ci/run-a/files/one.tap',
      path.join(root, 'docs', 'pretend-run', 'files')
    ),
    /under output\/ci/u
  );
  await assert.rejects(
    artifactDigestFromRepository(
      root,
      'output/ci/run-a/files/symlink.tap',
      filesDirectory
    ),
    /symbolic link/u
  );
  await writeFile(
    path.join(filesDirectory, 'standalone-secret.tap'),
    'password=business-secret\n'
  );
  await assert.rejects(
    artifactDigestFromRepository(
      root,
      'output/ci/run-a/files/standalone-secret.tap',
      filesDirectory
    ),
    /credential-shaped content/u
  );
  await writeFile(
    path.join(filesDirectory, 'encoded-fragments.tap'),
    'user=encoded-user password=p@ss/word database=private-db\n'
  );
  await assert.rejects(
    artifactDigestFromRepository(
      root,
      'output/ci/run-a/files/encoded-fragments.tap',
      filesDirectory
    ),
    /credential-shaped content/u
  );
});

function fixtureCatalog() {
  return {
    schemaVersion: 'journey-ownership/v1',
    entries: files.map((path, index) => ({
      path,
      kind: 'persistence',
      owner: index === 0 ? 'core-persistence' : 'persistence-instrument',
      tier: index === 0 ? 'required' : 'advisory',
      env: 'fresh-business-db+dbos-system-db',
      currentDecision: index === 0 ? 'blocking' : 'advisory',
      allowedSkip: false,
      artifact: 'output/ci/persistence/{basename}.tap',
      producer: 'scripts/ci/run-persistence-evidence-instrument.mjs',
      ...(index === 1 ? { ticket: 'CI-01B' } : {}),
    })),
  };
}

function fixtureLedger() {
  return {
    schemaVersion: 'opt-in-test-evidence/v1',
    suites: {
      [files[0]]: {
        status: 'green',
        verifiedAt: 'a'.repeat(40),
      },
      [files[1]]: {
        status: 'known_red',
        verifiedAt: 'b'.repeat(40),
        ticket: 'V31-66',
      },
    },
  };
}

function fixtureProvision() {
  return {
    schemaVersion: 'persistence-provision/v1',
    provisioner: 'provision-persistence-instrument/v1',
    commitSha: sha,
    provisionId: 'provision-1',
    fresh: true,
    provisionedAt: '2026-08-20T12:00:00.000Z',
    databasePair: { business: 'business-1', dbosSystem: 'dbos-1' },
    databaseNames: { business: 'business_test', dbosSystem: 'dbos_test' },
  };
}

function fixtureResults({ mutate } = {}) {
  const results = {
    schemaVersion: 'persistence-results/v1',
    commitSha: sha,
    provisionId: 'provision-1',
    files: files.map((path, index) => ({
      path,
      commitSha: sha,
      provisionId: 'provision-1',
      databasePair: { business: 'business-1', dbosSystem: 'dbos-1' },
      counts: { pass: index + 1, fail: 0, skip: 0 },
      verdict: 'pass',
      artifact: `output/ci/files/${index === 0 ? 'a' : 'b'}.tap`,
    })),
  };
  mutate?.(results);
  return results;
}
