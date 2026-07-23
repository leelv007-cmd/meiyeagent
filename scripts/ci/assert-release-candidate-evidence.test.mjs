import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  assertReleaseCandidateEvidence,
  resolveEvidencePath,
  validateReleaseManifestArtifact,
} from './assert-release-candidate-evidence.mjs';

const commit = 'a'.repeat(40);
const now = new Date('2026-07-23T12:00:00.000Z');

function report(overrides = {}) {
  return {
    acceptanceMode: 'primary_connectivity',
    runNonce: 'rc-test-nonce',
    releaseRef: commit,
    environment: 'provider-live',
    configurationRevision: 'cfg-1',
    effectiveConfigurationSha256: 'e'.repeat(64),
    startedAt: '2026-07-23T10:00:00.000Z',
    completedAt: '2026-07-23T10:05:00.000Z',
    expiresAt: '2026-07-24T10:05:00.000Z',
    blockedChecks: [],
    skippedOperations: [],
    activationEvidence: [
      activation('copy.generate'),
      activation('image.generate'),
      activation('video.generate'),
    ],
    publishGates: [
      {
        operation: 'copy.generate',
        status: 'single_channel',
        publishAllowed: true,
        multiChannelReady: false,
        independentFaultDomainCount: 1,
        channelLabel: 'single-channel/no-fallback',
      },
      {
        operation: 'image.generate',
        status: 'single_channel',
        publishAllowed: true,
        multiChannelReady: false,
        independentFaultDomainCount: 1,
        channelLabel: 'single-channel/no-fallback',
      },
      {
        operation: 'video.generate',
        status: 'single_channel',
        publishAllowed: true,
        multiChannelReady: false,
        independentFaultDomainCount: 1,
        channelLabel: 'single-channel/no-fallback',
      },
    ],
    probes: [
      probe('copy.generate', 0.1),
      probe('image.generate', 0.4),
      probe('video.generate', 0.7),
    ],
    actualCost: {
      providerProbeCny: 1.2,
      externalEvidenceCny: 0,
      totalCny: 1.2,
      capCny: 5,
    },
    ...overrides,
  };
}

function activation(operation) {
  return {
    operation,
    activationStatus: 'live_verified',
    channelKind: 'official_direct',
    adapterExecuted: true,
    providerCallSucceeded: true,
    deploymentId: `dep-${operation}`,
    catalogModelId: `catalog-${operation}`,
    providerProfileId: 'provider-profile-1',
    evidenceRef: `provider-live:${operation}`,
    verifiedAt: '2026-07-23T10:05:00.000Z',
  };
}

function probe(operation, amount) {
  return {
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
    observedAt: '2026-07-23T10:05:00.000Z',
    lifecycle: { submitted: true },
    providerCost: { amount, currency: 'CNY' },
  };
}

const units = ['web', 'core', 'worker', 'canvas'].map((unit) => ({
  unit,
  commitSha: commit,
  artifactDigest: `sha256:${unit}-immutable`,
  configRevision: `staging-${unit}-config-1`,
}));

function manifest(overrides = {}) {
  return {
    schemaVersion: 1,
    releaseRef: commit,
    environment: 'staging',
    workflowRun: 'https://github.com/example/repo/actions/runs/1',
    startedAt: '2026-07-23T10:00:00.000Z',
    completedAt: '2026-07-23T10:05:00.000Z',
    capturedAt: '2026-07-23T10:05:00.000Z',
    expiresAt: '2026-07-24T10:05:00.000Z',
    result: 'pass',
    verification: {
      readinessEvidenceRef: 'staging:readiness:1',
      recoveryEvidenceRef: 'staging:recovery:1',
      journeyEvidenceRefs: {
        copy: 'staging:journey:copy:1',
        image: 'staging:journey:image:1',
        video: 'staging:journey:video:1',
      },
    },
    units,
    ...overrides,
  };
}

test('assertReleaseCandidateEvidence passes a bound single-channel live report', () => {
  const result = assertReleaseCandidateEvidence({
    expectedCommitSha: commit,
    providerLiveReport: report(),
    units,
    now,
  });
  assert.equal(result.ok, true, result.errors.join('; '));
});

test('assertReleaseCandidateEvidence fails closed without report or wrong commit', () => {
  assert.equal(
    assertReleaseCandidateEvidence({
      expectedCommitSha: commit,
      providerLiveReport: null,
      units,
      now,
    }).ok,
    false,
  );
  assert.equal(
    assertReleaseCandidateEvidence({
      expectedCommitSha: commit,
      providerLiveReport: report({ releaseRef: 'b'.repeat(40) }),
      units,
      now,
    }).ok,
    false,
  );
  assert.equal(
    assertReleaseCandidateEvidence({
      expectedCommitSha: commit,
      providerLiveReport: report({
        expiresAt: '2026-07-23T11:00:00.000Z',
      }),
      units,
      now,
    }).ok,
    false,
  );
});

test('CLI fails closed when evidence file is missing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rc-evidence-'));
  try {
    const result = spawnSync(
      process.execPath,
      [join(import.meta.dirname, 'assert-release-candidate-evidence.mjs')],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          RELEASE_COMMIT_SHA: commit,
          PROVIDER_LIVE_EVIDENCE_PATH: join(directory, 'missing.json'),
        },
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /fail closed|missing/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI fails closed when a green live report has no staging release manifest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rc-evidence-'));
  const evidencePath = join(directory, 'provider-live-gate.json');
  try {
    await writeFile(evidencePath, `${JSON.stringify(report())}\n`);
    const result = spawnSync(
      process.execPath,
      [join(import.meta.dirname, 'assert-release-candidate-evidence.mjs')],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          RELEASE_COMMIT_SHA: commit,
          PROVIDER_LIVE_EVIDENCE_PATH: evidencePath,
          RELEASE_CANDIDATE_NOW: now.toISOString(),
        },
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /RELEASE_MANIFEST_PATH.*fail closed/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI passes with green evidence and a concrete staging release manifest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rc-evidence-'));
  const evidencePath = join(directory, 'provider-live-gate.json');
  const manifestPath = join(directory, 'release-manifest.json');
  try {
    await writeFile(evidencePath, `${JSON.stringify(report())}\n`);
    await writeFile(manifestPath, `${JSON.stringify(manifest())}\n`);
    const result = spawnSync(
      process.execPath,
      [join(import.meta.dirname, 'assert-release-candidate-evidence.mjs')],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          RELEASE_COMMIT_SHA: commit,
          PROVIDER_LIVE_EVIDENCE_PATH: evidencePath,
          RELEASE_MANIFEST_PATH: manifestPath,
          RELEASE_CANDIDATE_NOW: now.toISOString(),
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /"status": "pass"/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('release manifest and evidence paths reject unauditable RC inputs', () => {
  assert.equal(
    resolveEvidencePath({ PROVIDER_LIVE_EVIDENCE_PATH: '/tmp/x.json' }),
    '/tmp/x.json',
  );
  assert.ok(
    validateReleaseManifestArtifact(
      manifest({ workflowRun: '', units: [] }),
      commit,
    ).errors.some((error) => /workflowRun|units/u.test(error)),
  );
  assert.equal(
    assertReleaseCandidateEvidence({
      expectedCommitSha: commit,
      providerLiveReport: report({ probes: [] }),
      units,
      now,
    }).ok,
    false,
  );
  assert.equal(
    assertReleaseCandidateEvidence({
      expectedCommitSha: commit,
      providerLiveReport: report({
        publishGates: [
          { ...report().publishGates[0], multiChannelReady: true },
          ...report().publishGates.slice(1),
        ],
      }),
      units,
      now,
    }).ok,
    false,
  );
  assert.equal(
    assertReleaseCandidateEvidence({
      expectedCommitSha: commit,
      providerLiveReport: report({
        blockedChecks: [{ operation: 'non-core.audit', status: 'blocked' }],
      }),
      units,
      now,
    }).ok,
    false,
  );
  assert.equal(
    assertReleaseCandidateEvidence({
      expectedCommitSha: commit,
      providerLiveReport: report({
        skippedOperations: ['non-core.audit'],
      }),
      units,
      now,
    }).ok,
    false,
  );
  assert.ok(
    validateReleaseManifestArtifact(
      manifest({ verification: { readinessEvidenceRef: 'only-one' } }),
      commit,
      now,
    ).errors.some((error) => /recovery|journey/u.test(error)),
  );
});
