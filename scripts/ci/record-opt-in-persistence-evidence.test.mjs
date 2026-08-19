import assert from 'node:assert/strict';
import test from 'node:test';

import { recordCalibration } from './record-opt-in-persistence-evidence.mjs';

const sha = '0123456789abcdef0123456789abcdef01234567';
const files = [
  'apps/core/src/p1/a.postgres.test.ts',
  'mkfast-template-main/src/payment/b.postgres.test.ts',
];

test('records only verified same-SHA per-file evidence into a redacted receipt', async () => {
  const output = await recordCalibration({
    artifactDigest: async (artifact) => `digest:${artifact}`,
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
      [files[0], 'digest:output/ci/files/a.tap'],
      [files[1], 'digest:output/ci/files/b.tap'],
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
