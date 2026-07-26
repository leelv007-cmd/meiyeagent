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
  return {
    acceptanceMode: 'primary_connectivity',
    runNonce: 'rc-generator-test',
    releaseRef: commit,
    environment: 'provider-live',
    configurationRevision: 'cfg-1',
    effectiveConfigurationSha256: 'e'.repeat(64),
    startedAt: '2026-07-27T11:00:00.000Z',
    completedAt: '2026-07-27T11:05:00.000Z',
    expiresAt: '2026-07-28T11:05:00.000Z',
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
      verifiedAt: '2026-07-27T11:05:00.000Z',
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
  const { errors, manifest } = buildReleaseCandidateManifest({}, { now });
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
  const root = await stagedRoot();
  const { errors, manifest } = buildReleaseCandidateManifest(completeEnv(), {
    now,
    root,
  });
  assert.deepEqual(errors, []);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.releaseRef, commit);
  assert.equal(manifest.environment, 'staging');
  assert.equal(manifest.result, 'pass');
  assert.deepEqual(
    manifest.units.map((unit) => unit.unit),
    ['web', 'core', 'worker', 'canvas']
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
  const driftedResult = buildReleaseCandidateManifest(completeEnv(), {
    now,
    root: drifted,
  });
  assert.equal(driftedResult.manifest, undefined);
  assert.ok(
    driftedResult.errors.some((error) => /stub unit core was built at b{40}/u.test(error)),
    driftedResult.errors.join('; ')
  );

  const empty = await mkdtemp(join(tmpdir(), 'meiye-release-manifest-empty-'));
  const emptyResult = buildReleaseCandidateManifest(completeEnv(), {
    now,
    root: empty,
  });
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
  const root = await stagedRoot();
  const { errors, manifest } = buildReleaseCandidateManifest(
    completeEnv({
      RELEASE_UNIT_ARTIFACT_DIGEST_WEB: 'sha256:worker-version-id',
      RELEASE_UNIT_CONFIG_REVISION_WEB: 'staging-web-config-7',
    }),
    { now, root }
  );
  assert.deepEqual(errors, []);
  const web = manifest.units.find((unit) => unit.unit === 'web');
  assert.equal(web.artifactDigest, 'sha256:worker-version-id');
  assert.equal(web.configRevision, 'staging-web-config-7');
});

test('an expired or non-staging manifest never reaches disk', async () => {
  const root = await stagedRoot();
  const expired = buildReleaseCandidateManifest(
    completeEnv({ RELEASE_EXPIRES_AT: '2026-07-27T11:00:00.000Z' }),
    { now, root }
  );
  assert.equal(expired.manifest, undefined);
  assert.ok(expired.errors.some((error) => error.startsWith('self-check:')));

  const production = buildReleaseCandidateManifest(
    completeEnv({ RELEASE_ENVIRONMENT: 'production' }),
    { now, root }
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
  assert.match(gate.stdout, /"web",\n\s+"core",\n\s+"worker",\n\s+"canvas"/);
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
