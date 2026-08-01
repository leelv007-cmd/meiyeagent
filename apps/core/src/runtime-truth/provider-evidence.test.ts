import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertMerchantOnlyStates,
  projectMerchantCapabilities,
} from './merchant-capabilities.js';
import {
  judgeProviderLiveEvidence,
  projectCapabilityRecordsFromProviderEvidence,
  providerLiveEvidenceReadiness,
} from './provider-evidence.js';
import { assembleCapabilitiesFromEnv } from './capability-assembly.js';
import { evaluateReleaseCandidateAcceptance } from './release-candidate.js';
import type { P0ReleaseCandidateManifest } from './types.js';

const commit = 'c'.repeat(40);
const now = new Date('2026-07-23T12:00:00.000Z');

function baseReport(overrides: Record<string, unknown> = {}) {
  const completedAt = '2026-07-23T11:00:00.000Z';
  return {
    acceptanceMode: 'primary_connectivity',
    runNonce: 'run-nonce-001',
    releaseRef: commit,
    environment: 'provider-live',
    configurationRevision: 'cfg-primary-1',
    effectiveConfigurationSha256: 'e'.repeat(64),
    startedAt: '2026-07-23T10:55:00.000Z',
    completedAt,
    expiresAt: '2026-07-24T11:00:00.000Z',
    blockedChecks: [],
    skippedOperations: [],
    activationEvidence: [
      activation('copy.generate'),
      activation('image.generate'),
      activation('video.generate'),
    ],
    publishGates: [
      gate('copy.generate'),
      gate('image.generate'),
      gate('video.generate'),
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

function activation(operation: string) {
  return {
    operation,
    modality:
      operation === 'copy.generate'
        ? 'llm'
        : operation === 'image.generate'
          ? 'image'
          : 'video',
    channelKind: 'official_direct',
    activationStatus: 'live_verified',
    adapterExecuted: true,
    providerCallSucceeded: true,
    deploymentId: `dep-${operation}`,
    catalogModelId: `catalog-${operation}`,
    providerProfileId: 'pp-official',
    evidenceRef: `provider-live:${operation}`,
    verifiedAt: '2026-07-23T11:00:00.000Z',
  };
}

function gate(operation: string) {
  return {
    operation,
    status: 'single_channel',
    multiChannelReady: false,
    independentFaultDomainCount: 1,
    publishAllowed: true,
    channelLabel: 'single-channel/no-fallback',
  };
}

function probe(operation: string, amount: number) {
  return {
    operation,
    channelKind: 'official_direct',
    deploymentId: `dep-${operation}`,
    catalogModelId: `catalog-${operation}`,
    providerProfileId: 'pp-official',
    adapterExecuted: true,
    providerCallSucceeded: true,
    acceptance: 'accepted',
    providerTaskRef: `task-${operation}`,
    evidenceRef: `provider-live:${operation}`,
    observedAt: '2026-07-23T11:00:00.000Z',
    lifecycle: { submitted: true },
    providerCost: { amount, currency: 'CNY' },
  };
}

function stagingReleaseManifest(): P0ReleaseCandidateManifest {
  return {
    schemaVersion: 1,
    releaseRef: commit,
    environment: 'staging',
    workflowRun: 'https://github.com/example/repo/actions/runs/1',
    startedAt: '2026-07-23T10:55:00.000Z',
    completedAt: '2026-07-23T11:00:00.000Z',
    capturedAt: '2026-07-23T11:01:00.000Z',
    expiresAt: '2026-07-24T11:00:00.000Z',
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
    units: (['web', 'core', 'worker'] as const).map((unit) => ({
      unit,
      commitSha: commit,
      artifactDigest: `sha256:${unit}-immutable`,
      configRevision: `staging-${unit}-config-1`,
    })),
  };
}

test('live evidence bound to commit projects three single-channel verified capabilities', () => {
  const judgment = judgeProviderLiveEvidence({
    report: baseReport(),
    expectedCommitSha: commit,
    now,
  });
  assert.equal(judgment.valid, true);
  assert.equal(judgment.primaryConnectivityReady, true);
  assert.ok(judgment.operations.every((entry) => entry.liveVerified));
  assert.ok(
    judgment.operations.every(
      (entry) =>
        entry.channelMode === 'single_channel' &&
        entry.channelLabel === 'single-channel/no-fallback',
    ),
  );

  const records = projectCapabilityRecordsFromProviderEvidence({ judgment });
  const snapshot = projectMerchantCapabilities({
    records,
    release: { commitSha: commit },
  });
  assertMerchantOnlyStates(snapshot);
  assert.deepEqual(
    snapshot.capabilities.map((entry) => [
      entry.id,
      entry.state,
      entry.channelMode,
      entry.channelLabel,
    ]),
    [
      [
        'generation_copy',
        'verified',
        'single_channel',
        'single-channel/no-fallback',
      ],
      [
        'generation_image',
        'verified',
        'single_channel',
        'single-channel/no-fallback',
      ],
      [
        'generation_video',
        'verified',
        'single_channel',
        'single-channel/no-fallback',
      ],
    ],
  );
  assert.match(
    snapshot.capabilities[0]?.safeExplanation ?? '',
    /single-channel\/no-fallback/,
  );
  assert.equal(providerLiveEvidenceReadiness(judgment).status, 'pass');
});

test('recorded-only hints never become verified; stay assisted', () => {
  const judgment = judgeProviderLiveEvidence({
    report: null,
    expectedCommitSha: commit,
    now,
  });
  const records = projectCapabilityRecordsFromProviderEvidence({
    judgment,
    assisted: {
      recordedVerified: {
        generation_copy: true,
        generation_image: true,
        generation_video: true,
      },
    },
  });
  const snapshot = projectMerchantCapabilities({ records });
  assert.deepEqual(
    snapshot.capabilities.map((entry) => entry.state),
    ['assisted', 'assisted', 'assisted'],
  );
  assert.equal(
    records.every((record) => !record.evidence.includes('live_verified')),
    true,
  );
});

test('environment assembly preserves immutable release identity while using live config revision', () => {
  const assembly = assembleCapabilitiesFromEnv(
    {
      RELEASE_ARTIFACT_DIGEST: 'sha256:core-immutable',
      RELEASE_COMMIT_SHA: commit,
      RELEASE_CONFIG_REVISION: 'boot-config',
    },
    { now, reportOverride: baseReport() },
  );

  assert.deepEqual(assembly.release, {
    commitSha: commit,
    artifactDigest: 'sha256:core-immutable',
    configRevision: 'cfg-primary-1',
  });
});

test('wrong commit, expired evidence, and incomplete preflight all fail closed', () => {
  const wrongCommit = judgeProviderLiveEvidence({
    report: baseReport({ releaseRef: 'd'.repeat(40) }),
    expectedCommitSha: commit,
    now,
  });
  assert.equal(wrongCommit.valid, false);
  assert.match(wrongCommit.reason ?? '', /does not match commit/);

  const expired = judgeProviderLiveEvidence({
    report: baseReport({
      expiresAt: '2026-07-23T11:30:00.000Z',
    }),
    expectedCommitSha: commit,
    now,
  });
  assert.equal(expired.valid, false);
  assert.match(expired.reason ?? '', /expired/);

  const preflight = judgeProviderLiveEvidence({
    report: {
      complete: false,
      status: 'preflight_pending',
      releaseRef: commit,
    },
    expectedCommitSha: commit,
    now,
  });
  assert.equal(preflight.valid, false);
  assert.match(preflight.reason ?? '', /incomplete/);
});

test('missing configuration, provider identity, cost, or clean gate state fails closed', () => {
  const cases = [
    baseReport({ effectiveConfigurationSha256: 'not-a-fingerprint' }),
    baseReport({
      activationEvidence: [
        { ...activation('copy.generate'), providerProfileId: '' },
        activation('image.generate'),
        activation('video.generate'),
      ],
    }),
    baseReport({
      probes: [
        { ...probe('copy.generate', 0.1), providerCost: {} },
        probe('image.generate', 0.4),
        probe('video.generate', 0.7),
      ],
    }),
    baseReport({ blockedChecks: [{ operation: 'copy.generate', status: 'blocked' }] }),
    baseReport({
      blockedChecks: [{ operation: 'non-core.audit', status: 'blocked' }],
    }),
    baseReport({ skippedOperations: ['non-core.audit'] }),
    baseReport({
      publishGates: [
        { ...gate('copy.generate'), multiChannelReady: true },
        gate('image.generate'),
        gate('video.generate'),
      ],
    }),
    baseReport({
      actualCost: {
        providerProbeCny: 6,
        externalEvidenceCny: 0,
        totalCny: 6,
        capCny: 5,
      },
    }),
    baseReport({
      actualCost: {
        providerProbeCny: 1.2,
        externalEvidenceCny: 0,
        totalCny: 0.2,
        capCny: 5,
      },
    }),
  ];

  for (const report of cases) {
    assert.equal(
      judgeProviderLiveEvidence({ report, expectedCommitSha: commit, now }).valid,
      false,
    );
  }
});

test('multi-channel claim without two fault domains demotes to single-channel', () => {
  const judgment = judgeProviderLiveEvidence({
    report: baseReport({
      publishGates: [
        {
          operation: 'copy.generate',
          status: 'multi_channel_ready',
          multiChannelReady: true,
          independentFaultDomainCount: 1,
          publishAllowed: true,
          channelLabel: 'multi-channel ready',
        },
        gate('image.generate'),
        gate('video.generate'),
      ],
    }),
    expectedCommitSha: commit,
    now,
  });
  const copy = judgment.operations.find(
    (entry) => entry.operation === 'copy.generate',
  );
  assert.equal(copy?.liveVerified, true);
  assert.equal(copy?.channelMode, 'single_channel');
  assert.equal(copy?.channelLabel, 'single-channel/no-fallback');
});

test('secret-shaped payload is refused', () => {
  // Build key-shaped input at runtime so the repo secret-scan does not
  // treat the test fixture as a committed credential.
  const fakeKey = ['sk', 'abcdefghijklmnopqrstuvwxyz012345'].join('-');
  const judgment = judgeProviderLiveEvidence({
    report: baseReport({
      debug: { note: fakeKey },
    }),
    expectedCommitSha: commit,
    now,
  });
  assert.equal(judgment.valid, false);
  assert.match(judgment.reason ?? '', /secret pattern/);
});

test('release candidate acceptance fails closed without live evidence', () => {
  const missing = evaluateReleaseCandidateAcceptance({
    expectedCommitSha: commit,
    providerLiveReport: null,
    now,
  });
  assert.equal(missing.ok, false);
  assert.ok(
    missing.errors.some((error) => /Provider live evidence is required/u.test(error)),
  );

  const green = evaluateReleaseCandidateAcceptance({
    expectedCommitSha: commit,
    providerLiveReport: baseReport(),
    releaseManifest: stagingReleaseManifest(),
    now,
  });
  assert.equal(green.ok, true, green.errors.join('; '));
  assert.equal(green.merchantCapabilitiesOk, true);

  const manifestWithoutWorkerConfig = stagingReleaseManifest();
  const incompleteManifest = evaluateReleaseCandidateAcceptance({
    expectedCommitSha: commit,
    providerLiveReport: baseReport(),
    releaseManifest: {
      ...manifestWithoutWorkerConfig,
      units: manifestWithoutWorkerConfig.units.map((unit) =>
        unit.unit === 'worker' ? { ...unit, configRevision: undefined } : unit,
      ),
    },
    now,
  });
  assert.equal(incompleteManifest.ok, false);
  assert.ok(
    incompleteManifest.errors.some((error) => /configuration revision/u.test(error)),
  );
});
