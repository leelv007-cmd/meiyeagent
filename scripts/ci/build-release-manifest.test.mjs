import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  DEFAULT_UNIT_ARTIFACT_DIRS,
  RELEASE_UNITS,
  buildReleaseCandidateManifest,
  digestDirectory,
} from './build-release-manifest.mjs';

const commit = 'a'.repeat(40);
const now = '2026-07-27T12:00:00.000Z';
const repositoryRoot = resolve(import.meta.dirname, '../..');

/**
 * Unit-test seam: the manifest gate's coverage hook spawns a Core tsx
 * subprocess against the real monorepo. Unit tests inject a no-op hook; the
 * end-to-end test below runs the real hook against the real repository.
 */
const noOpCoverage = { harnessCoverageCheck: () => ({ errors: [] }) };

function manifestOptions(overrides = {}) {
  return { now, ...noOpCoverage, ...overrides };
}

/** manifestOptions + a staged repo root (unit tests never spawn the real hook). */
async function stagedManifestOptions() {
  return manifestOptions({ root: await stagedRoot() });
}

function completeEnv(overrides = {}) {
  return {
    RELEASE_COMMIT_SHA: commit,
    RELEASE_CONFIG_REVISION: 'staging-config-42',
    RELEASE_JOURNEY_EVIDENCE_REF_COPY: 'staging:journey:copy:1',
    RELEASE_JOURNEY_EVIDENCE_REF_IMAGE: 'staging:journey:image:1',
    RELEASE_JOURNEY_EVIDENCE_REF_VIDEO: 'staging:journey:video:1',
    RELEASE_READINESS_EVIDENCE_REF: 'staging:readiness:1',
    RELEASE_RECOVERY_EVIDENCE_REF: 'staging:recovery:1',
    RELEASE_STARTED_AT: '2026-07-27T11:30:00.000Z',
    RELEASE_WORKFLOW_RUN: 'https://github.com/example/repo/actions/runs/1',
    ...overrides,
  };
}

/** Builds a temp tree with a Core runtime stub and one artifact file per unit. */
async function stagedRoot({ stubCommitSha = commit } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'meiye-release-manifest-'));
  await mkdir(join(root, 'apps/core/dist'), { recursive: true });
  await writeFile(
    join(root, 'apps/core/dist/release-manifest.core.json'),
    JSON.stringify({
      schemaVersion: 1,
      capturedAt: now,
      packageName: '@meiye/core',
      units: [
        { unit: 'core', commitSha: stubCommitSha },
        { unit: 'worker', commitSha: stubCommitSha },
      ],
    })
  );
  for (const unit of RELEASE_UNITS) {
    const directory = join(root, DEFAULT_UNIT_ARTIFACT_DIRS[unit]);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${unit}.bundle`), `${unit} artifact bytes`);
  }
  return root;
}

/** Minimal green provider-live report; fixture input, never a provider claim. */
function providerLiveReport() {
  const operations = ['copy.generate', 'image.generate', 'video.generate'];
  const capturedAt = Date.now();
  const startedAt = new Date(capturedAt - 120_000).toISOString();
  const completedAt = new Date(capturedAt - 60_000).toISOString();
  const expiresAt = new Date(capturedAt + 24 * 60 * 60 * 1000).toISOString();
  return {
    acceptanceMode: 'primary_connectivity',
    runNonce: 'rc-generator-test',
    releaseRef: commit,
    environment: 'provider-live',
    configurationRevision: 'cfg-1',
    effectiveConfigurationSha256: 'e'.repeat(64),
    startedAt,
    completedAt,
    expiresAt,
    blockedChecks: [],
    skippedOperations: [],
    activationEvidence: operations.map((operation) => ({
      operation,
      activationStatus: 'live_verified',
      channelKind: 'official_direct',
      adapterExecuted: true,
      providerCallSucceeded: true,
      deploymentId: `dep-${operation}`,
      catalogModelId: `catalog-${operation}`,
      providerProfileId: 'provider-profile-1',
      evidenceRef: `provider-live:${operation}`,
      verifiedAt: completedAt,
    })),
    probes: operations.map((operation) => ({
      operation,
      channelKind: 'official_direct',
      adapterExecuted: true,
      providerCallSucceeded: true,
      acceptance: 'accepted',
      deploymentId: `dep-${operation}`,
      catalogModelId: `catalog-${operation}`,
      providerProfileId: 'provider-profile-1',
      providerTaskRef: `task-${operation}`,
      evidenceRef: `provider-live:${operation}`,
      observedAt: '2026-07-27T11:05:00.000Z',
      lifecycle: { submitted: true },
      providerCost: { amount: 0.1, currency: 'CNY' },
    })),
    publishGates: operations.map((operation) => ({
      operation,
      status: 'single_channel',
      publishAllowed: true,
      multiChannelReady: false,
      independentFaultDomainCount: 1,
      channelLabel: 'single-channel/no-fallback',
    })),
    actualCost: {
      providerProbeCny: 0.3,
      externalEvidenceCny: 0,
      totalCny: 0.3,
      capCny: 5,
    },
  };
}

test('every RC input is required by name; nothing is defaulted into existence', () => {
  const { errors, manifest } = buildReleaseCandidateManifest({}, { now, ...noOpCoverage });
  assert.equal(manifest, undefined);
  for (const name of [
    'RELEASE_COMMIT_SHA',
    'RELEASE_WORKFLOW_RUN',
    'RELEASE_CONFIG_REVISION',
    'RELEASE_READINESS_EVIDENCE_REF',
    'RELEASE_RECOVERY_EVIDENCE_REF',
    'RELEASE_JOURNEY_EVIDENCE_REF_COPY',
    'RELEASE_JOURNEY_EVIDENCE_REF_IMAGE',
    'RELEASE_JOURNEY_EVIDENCE_REF_VIDEO',
    'RELEASE_STARTED_AT',
  ]) {
    assert.ok(
      errors.includes(`${name} is required.`),
      `${name} must be required: ${errors.join('; ')}`
    );
  }
});

test('the manifest carries four same-SHA units with digests and config revisions', async () => {
  const { errors, manifest } = buildReleaseCandidateManifest(
    completeEnv(),
    await stagedManifestOptions()
  );
  assert.deepEqual(errors, []);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.releaseRef, commit);
  assert.equal(manifest.environment, 'staging');
  assert.equal(manifest.result, 'pass');
  assert.deepEqual(
    manifest.units.map((unit) => unit.unit),
    ['web', 'core', 'worker']
  );
  assert.deepEqual(new Set(manifest.units.map((unit) => unit.commitSha)), new Set([commit]));
  for (const unit of manifest.units) {
    assert.match(unit.artifactDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(unit.configRevision, 'staging-config-42');
  }
  // Same package, two start commands: Core and Worker share one artifact digest.
  const digests = Object.fromEntries(
    manifest.units.map((unit) => [unit.unit, unit.artifactDigest])
  );
  assert.equal(digests.core, digests.worker);
  assert.notEqual(digests.core, digests.web);
  assert.ok(Date.parse(manifest.expiresAt) > Date.parse(manifest.completedAt));
});

test('a Core runtime stub from another commit or no stub at all fails closed', async () => {
  const drifted = await stagedRoot({ stubCommitSha: 'b'.repeat(40) });
  const driftedResult = buildReleaseCandidateManifest(
    completeEnv(),
    manifestOptions({ root: drifted })
  );
  assert.equal(driftedResult.manifest, undefined);
  assert.ok(
    driftedResult.errors.some((error) => /stub unit core was built at b{40}/u.test(error)),
    driftedResult.errors.join('; ')
  );

  const empty = await mkdtemp(join(tmpdir(), 'meiye-release-manifest-empty-'));
  const emptyResult = buildReleaseCandidateManifest(
    completeEnv(),
    manifestOptions({ root: empty })
  );
  assert.equal(emptyResult.manifest, undefined);
  assert.ok(
    emptyResult.errors.some((error) => /Core runtime stub is missing/u.test(error))
  );
  for (const unit of RELEASE_UNITS) {
    assert.ok(
      emptyResult.errors.some((error) =>
        error.startsWith(`Release unit ${unit} has no artifact`)
      ),
      `${unit} must report its missing artifact: ${emptyResult.errors.join('; ')}`
    );
  }
});

test('a declared deployment digest replaces the computed artifact digest', async () => {
  const { errors, manifest } = buildReleaseCandidateManifest(
    completeEnv({
      RELEASE_UNIT_ARTIFACT_DIGEST_WEB: 'sha256:worker-version-id',
      RELEASE_UNIT_CONFIG_REVISION_WEB: 'staging-web-config-7',
    }),
    await stagedManifestOptions()
  );
  assert.deepEqual(errors, []);
  const web = manifest.units.find((unit) => unit.unit === 'web');
  assert.equal(web.artifactDigest, 'sha256:worker-version-id');
  assert.equal(web.configRevision, 'staging-web-config-7');
});

test('an expired or non-staging manifest never reaches disk', async () => {
  const expired = buildReleaseCandidateManifest(
    completeEnv({ RELEASE_EXPIRES_AT: '2026-07-27T11:00:00.000Z' }),
    await stagedManifestOptions()
  );
  assert.equal(expired.manifest, undefined);
  assert.ok(expired.errors.some((error) => error.startsWith('self-check:')));

  const production = buildReleaseCandidateManifest(
    completeEnv({ RELEASE_ENVIRONMENT: 'production' }),
    await stagedManifestOptions()
  );
  assert.equal(production.manifest, undefined);
  assert.ok(
    production.errors.some((error) => /environment must be staging/u.test(error))
  );
});

test('the generated manifest satisfies the release-candidate gate end to end', async () => {
  const root = await stagedRoot();
  const manifestPath = join(root, 'output/release/release-manifest.json');
  const evidencePath = join(root, 'provider-live-gate.json');
  await writeFile(evidencePath, `${JSON.stringify(providerLiveReport())}\n`);

  const generate = spawnSync(
    process.execPath,
    [join(import.meta.dirname, 'build-release-manifest.mjs')],
    {
      cwd: root,
      encoding: 'utf8',
      // The subprocess uses the real clock, so the release window starts now.
      env: {
        ...process.env,
        ...completeEnv({
          RELEASE_STARTED_AT: new Date(Date.now() - 60_000).toISOString(),
        }),
        // Real coverage hook: minting must prove the real monorepo's harness
        // release seed is constructively covered (R-P0-07).
        RELEASE_HARNESS_COVERAGE_ROOT: repositoryRoot,
      },
    }
  );
  assert.equal(generate.status, 0, generate.stderr);
  assert.match(generate.stdout, /"status": "written"/);

  const written = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(written.releaseRef, commit);

  const gate = spawnSync(
    process.execPath,
    [join(repositoryRoot, 'scripts/ci/assert-release-candidate-evidence.mjs')],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PROVIDER_LIVE_EVIDENCE_PATH: evidencePath,
        RELEASE_COMMIT_SHA: commit,
        RELEASE_MANIFEST_PATH: manifestPath,
      },
    }
  );
  assert.equal(gate.status, 0, gate.stderr);
  assert.match(gate.stdout, /"status": "pass"/);
  assert.match(gate.stdout, /"web",\n\s+"core",\n\s+"worker"/);
});

test('directory digests are deterministic and content sensitive', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meiye-digest-'));
  await mkdir(join(root, 'nested'), { recursive: true });
  await writeFile(join(root, 'a.txt'), 'a');
  await writeFile(join(root, 'nested/b.txt'), 'b');
  const first = digestDirectory(root);
  assert.equal(first, digestDirectory(root));
  await writeFile(join(root, 'nested/b.txt'), 'c');
  assert.notEqual(first, digestDirectory(root));
});

test('a failing harness release coverage check blocks the manifest (R-P0-07)', async () => {
  const root = await stagedRoot();
  let invoked = 0;
  const result = buildReleaseCandidateManifest(
    completeEnv(),
    manifestOptions({
      harnessCoverageCheck: () => {
        invoked += 1;
        return { errors: ['harness release seed is missing a skill binding'] };
      },
    })
  );
  assert.equal(invoked, 1);
  assert.equal(result.manifest, undefined);
  assert.ok(
    result.errors.some((error) =>
      error.includes('harness release seed is missing a skill binding')
    ),
    result.errors.join('; ')
  );
});

test('a missing harness coverage script fails closed with the named path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meiye-no-coverage-script-'));
  // No injected hook → the default hook spawns from root; the script cannot
  // exist in a bare temp dir, so the gate must fail closed by name.
  const result = buildReleaseCandidateManifest(completeEnv(), {
    now,
    root,
  });
  assert.equal(result.manifest, undefined);
  assert.ok(
    result.errors.some((error) =>
      error.includes('constructive coverage script is missing')
    ),
    result.errors.join('; ')
  );
});

test('the real coverage hook runs against the monorepo seed and passes', async () => {
  const root = await stagedRoot();
  const result = buildReleaseCandidateManifest(completeEnv(), {
    now,
    root,
    // No injected hook → the default hook runs the real coverage script from
    // the real monorepo root (the same path CI uses).
    coverageRoot: repositoryRoot,
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.manifest?.releaseRef, commit);
});
