import assert from 'node:assert/strict';
import test from 'node:test';
import { DUAL_CHANNEL_MATRIX_MODELS } from './fault-injection/matrix-models.js';
import type {
  FaultInjectionMatrixReport,
  FaultInjectionOperation,
  FaultInjectionScenarioResult,
} from './fault-injection/types.js';
import {
  isLiveVerifiedProbe,
  runLiveProviderGate,
  type LiveProviderChannel,
  type LiveProviderLifecycleEvidence,
  type LiveProviderProbeEvidence,
  type LiveTransportFaultEvidence,
} from './live-provider-gate.js';

const fingerprint = 'a'.repeat(64);
const alternateFingerprint = 'b'.repeat(64);

function channels(): LiveProviderChannel[] {
  return DUAL_CHANNEL_MATRIX_MODELS.map((model) => ({
    model,
    adapterKind:
      model.modality === 'llm'
        ? 'openai_compatible_llm'
        : model.channelKind === 'official_direct'
          ? 'ark_media'
          : 'tuzi_media',
    accountIdentityFingerprint:
      model.channelKind === 'official_direct'
        ? fingerprint
        : alternateFingerprint,
    endpointFingerprint:
      model.channelKind === 'official_direct'
        ? fingerprint
        : alternateFingerprint,
    maxProbeCostUsd: 0.01,
  }));
}

function successfulProbe(
  channel: LiveProviderChannel,
): LiveProviderProbeEvidence {
  return {
    acceptance: 'accepted',
    adapterExecuted: true,
    adapterKind: channel.adapterKind,
    accountIdentityFingerprint: channel.accountIdentityFingerprint,
    endpointFingerprint: channel.endpointFingerprint,
    catalogModelId: channel.model.catalogModelId,
    channelKind: channel.model.channelKind,
    deploymentId: `live-${channel.model.modality}-${channel.model.channelKind}`,
    evidenceRef: `provider-live:test:${channel.model.modality}:${channel.model.channelKind}`,
    lifecycle:
      channel.model.modality === 'llm'
        ? {
            downloaded: false,
            pollStatus: 'completed',
            recovered: true,
            submitted: true,
          }
        : {
            assetSha256: fingerprint,
            contentType:
              channel.model.modality === 'image'
                ? 'image/png'
                : 'video/mp4',
            downloaded: true,
            downloadedBytes: 1024,
            pollStatus: 'completed',
            recovered: true,
            submitted: true,
          },
    modality: channel.model.modality,
    observedAt: new Date(0).toISOString(),
    operation: channel.model.operation,
    providerCallSucceeded: true,
    providerProfileId: channel.model.providerProfileId,
    providerTaskRef: `provider-task-${channel.model.modality}-${channel.model.channelKind}`,
    providerCost: {
      amount: 1,
      currency: 'USD',
      usage:
        channel.model.modality === 'llm'
          ? { inputTokens: 10, outputTokens: 20 }
          : channel.model.modality === 'image'
            ? { mediaUnits: 1 }
            : { mediaUnits: 1, outputTokens: 100 },
    },
  };
}

function alignedChannels(): LiveProviderChannel[] {
  const resolved = channels();
  return resolved.map((channel) => {
    const official = resolved.find(
      (candidate) =>
        candidate.model.operation === channel.model.operation &&
        candidate.model.channelKind === 'official_direct',
    );
    return channel.model.channelKind === 'upstream_reseller' && official
      ? {
          ...channel,
          model: {
            ...channel.model,
            catalogModelId: official.model.catalogModelId,
          },
        }
      : channel;
  });
}

function lifecycleEvidenceFor(
  configured: readonly LiveProviderChannel[],
): LiveProviderLifecycleEvidence[] {
  return configured.map((channel) => {
    const checkIds =
      channel.model.modality === 'llm'
        ? [
            'protocol_completion',
            'error_normalization',
            'usage_evidence',
            'gateway_fingerprint',
            'mapping_confidence',
          ] as const
        : [
            'health_observation',
            'idempotent_submit',
            'cross_process_recover',
            'drain_without_restart',
            'cancel_confirmed',
            'late_terminal_reconciliation',
            'owned_asset_persistence',
          ] as const;
    return {
      source: 'provider_lifecycle_injector',
      evidenceRef: `test:lifecycle:${channel.model.modality}:${channel.model.channelKind}`,
      observedAt: new Date(0).toISOString(),
      operation: channel.model.operation,
      modality: channel.model.modality,
      channelKind: channel.model.channelKind,
      catalogModelId: channel.model.catalogModelId,
      providerProfileId: channel.model.providerProfileId,
      deploymentId: `live-${channel.model.modality}-${channel.model.channelKind}`,
      adapterKind: channel.adapterKind,
      accountIdentityFingerprint: channel.accountIdentityFingerprint,
      endpointFingerprint: channel.endpointFingerprint,
      checks: checkIds.map((checkId) => ({
        checkId,
        passed: true,
        evidenceRef: `test:check:${channel.model.modality}:${channel.model.channelKind}:${checkId}`,
      })),
    };
  });
}

function transportFaultEvidenceFor(
  configured: readonly LiveProviderChannel[],
): LiveTransportFaultEvidence[] {
  const operations = [
    ...new Set(configured.map((channel) => channel.model.operation)),
  ] as FaultInjectionOperation[];
  return operations.map((operation) => {
    const official = configured.find(
      (channel) =>
        channel.model.operation === operation &&
        channel.model.channelKind === 'official_direct',
    )!;
    const reseller = configured.find(
      (channel) =>
        channel.model.operation === operation &&
        channel.model.channelKind === 'upstream_reseller',
    )!;
    const officialDeploymentId = `live-${official.model.modality}-${official.model.channelKind}`;
    const resellerDeploymentId = `live-${reseller.model.modality}-${reseller.model.channelKind}`;
    const observedAt = new Date(0).toISOString();
    const scenarioBase = {
      operation,
      modality: official.model.modality,
      passed: true,
      detail: 'External transport injector test fixture',
      evidenceKind: 'live_provider' as const,
      observedAt,
    };
    const acceptedAttempt = (
      deploymentId: string,
      channelKind: 'official_direct' | 'upstream_reseller',
      rank: number,
    ) => ({
      rank,
      deploymentId,
      channelKind,
      acceptance: 'accepted' as const,
      providerTaskRef: `test-task-${rank}`,
      switched: rank > 1,
    });
    const snapshotId = `test-snapshot-${official.model.modality}`;
    const scenarios: FaultInjectionScenarioResult[] = [
      {
        ...scenarioBase,
        scenarioId: 'reject_before_accept_switch',
        disposition: 'switched_to_fallback',
        attempts: [
          {
            rank: 1,
            deploymentId: officialDeploymentId,
            channelKind: 'official_direct',
            acceptance: 'rejected_before_accept',
            errorCode: 'transport_injected_pre_accept',
            switched: true,
          },
          acceptedAttempt(resellerDeploymentId, 'upstream_reseller', 2),
        ],
      },
      {
        ...scenarioBase,
        scenarioId: 'accepted_no_resubmit',
        disposition: 'primary_succeeded',
        attempts: [
          acceptedAttempt(officialDeploymentId, 'official_direct', 1),
        ],
      },
      {
        ...scenarioBase,
        scenarioId: 'acceptance_unknown_reconcile',
        disposition: 'reconcile_no_resubmit',
        attempts: [
          {
            rank: 1,
            deploymentId: officialDeploymentId,
            channelKind: 'official_direct',
            acceptance: 'acceptance_unknown',
            errorCode: 'transport_injected_response_loss',
            switched: false,
          },
        ],
      },
      {
        ...scenarioBase,
        scenarioId: 'isolate_drain_new_task',
        disposition: 'fallback_only',
        attempts: [
          acceptedAttempt(resellerDeploymentId, 'upstream_reseller', 1),
        ],
      },
      {
        ...scenarioBase,
        scenarioId: 'route_snapshot_ledger_replay',
        disposition: 'primary_succeeded',
        attempts: [
          acceptedAttempt(officialDeploymentId, 'official_direct', 1),
        ],
        routeSnapshot: {
          id: snapshotId,
          catalogModelId: official.model.catalogModelId,
          deploymentId: officialDeploymentId,
          allowedCandidates: [
            {
              catalogModelId: official.model.catalogModelId,
              deploymentId: officialDeploymentId,
              rank: 1,
              sourceKind: 'official_direct',
            },
            {
              catalogModelId: reseller.model.catalogModelId,
              deploymentId: resellerDeploymentId,
              rank: 2,
              sourceKind: 'upstream_reseller',
            },
          ],
          actualDeploymentId: officialDeploymentId,
          fallbackChain: [officialDeploymentId, resellerDeploymentId],
          fallbackConsent: true,
          sourceKind: 'official_direct',
          createdAt: observedAt,
        },
        bilateralLedger: {
          productUsage: {
            id: `test-usage-${official.model.modality}`,
            status: 'settled',
            quantity: 1,
            resource:
              official.model.modality === 'llm'
                ? 'copy'
                : official.model.modality,
          },
          providerCost: {
            id: `test-cost-${official.model.modality}`,
            amount: 0.1,
            currency: 'USD',
            status: 'observed',
            attemptId: `test-attempt-${official.model.modality}`,
          },
          supplyFreeze: {
            id: `test-freeze-${official.model.modality}`,
            routeSnapshotRef: snapshotId,
            credentialAccountVersion: 'test-credential-v1',
            supplierRequestTaskId: 'test-supplier-task',
            supplyPoolId: 'test-supply-pool',
            frozenAt: observedAt,
          },
        } as FaultInjectionScenarioResult['bilateralLedger'],
      },
    ];
    const matrixReport: FaultInjectionMatrixReport = {
      id: `test-matrix-${official.model.modality}`,
      operation,
      modality: official.model.modality,
      scenarios,
      allPassed: true,
      dualChannelReady: true,
      channelMatrixAligned: true,
      observedAt,
      evidenceKind: 'live_provider',
    };
    return {
      source: 'provider_transport_injector',
      evidenceRef: `test:transport:${official.model.modality}`,
      observedAt,
      operation,
      catalogModelId: official.model.catalogModelId,
      officialDeploymentId,
      resellerDeploymentId,
      officialAccountIdentityFingerprint:
        official.accountIdentityFingerprint,
      officialEndpointFingerprint: official.endpointFingerprint,
      resellerAccountIdentityFingerprint:
        reseller.accountIdentityFingerprint,
      resellerEndpointFingerprint: reseller.endpointFingerprint,
      scenarios: scenarios.map((scenario) => ({
        scenarioId: scenario.scenarioId,
        transportInjectorExecuted: true,
        evidenceRefs: [
          `test:transport:${official.model.modality}:${scenario.scenarioId}`,
        ],
      })),
      matrixReport,
    };
  });
}

test('configured env never becomes live_verified when the real adapter probe fails', async () => {
  let probeCalls = 0;
  const report = await runLiveProviderGate({
    channels: channels(),
    costCapUsd: 1,
    probe: async (channel): Promise<LiveProviderProbeEvidence> => {
      probeCalls += 1;
      return {
        acceptance: 'rejected_before_accept',
        adapterExecuted: true,
        adapterKind: channel.adapterKind,
        accountIdentityFingerprint: channel.accountIdentityFingerprint,
        endpointFingerprint: channel.endpointFingerprint,
        catalogModelId: channel.model.catalogModelId,
        channelKind: channel.model.channelKind,
        deploymentId: `live-${channel.model.modality}-${channel.model.channelKind}`,
        evidenceRef: `provider-live:test:${channel.model.modality}:${channel.model.channelKind}`,
        lifecycle: {
          downloaded: false,
          recovered: false,
          submitted: false,
        },
        modality: channel.model.modality,
        observedAt: new Date(0).toISOString(),
        operation: channel.model.operation,
        providerCallSucceeded: false,
        providerProfileId: channel.model.providerProfileId,
        providerCost: { amount: 0, currency: 'USD' },
      };
    },
  });

  assert.equal(probeCalls, DUAL_CHANNEL_MATRIX_MODELS.length);
  assert.ok(
    report.activationEvidence.every(
      (evidence) => evidence.activationStatus !== 'live_verified',
    ),
  );
  assert.ok(report.publishGates.every((gate) => !gate.multiChannelReady));
  assert.equal(report.liveMatrixReports.length, 0);
});

test('missing channel configuration skips without fabricating evidence', async () => {
  let probeCalls = 0;
  const report = await runLiveProviderGate({
    channels: [],
    costCapUsd: 1,
    probe: async () => {
      probeCalls += 1;
      throw new Error('unreachable');
    },
  });

  assert.equal(probeCalls, 0);
  assert.equal(report.activationEvidence.length, 0);
  assert.equal(report.liveMatrixReports.length, 0);
  assert.deepEqual(report.skippedOperations, [
    'copy.generate',
    'image.generate',
    'video.generate',
  ]);
});

test('successful adapter probes do not clear unexecuted conformance checks', async () => {
  const report = await runLiveProviderGate({
    channels: channels(),
    costCapUsd: 1,
    probe: async (channel) => successfulProbe(channel),
  });

  assert.ok(
    report.activationEvidence.every(
      (evidence) => evidence.activationStatus === 'live_verified',
    ),
  );
  assert.deepEqual(
    report.publishGates.map((gate) => [gate.operation, gate.multiChannelReady]),
    [
      ['copy.generate', false],
      ['image.generate', false],
      ['video.generate', true],
    ],
  );
  assert.equal(report.liveMatrixReports.length, 0);
  assert.deepEqual(report.skippedOperations, [
    'copy.generate',
    'image.generate',
    'video.generate',
  ]);
  assert.equal(report.blockedChecks.length, 8);
});

test('validated external lifecycle and transport evidence produces live matrix reports', async () => {
  const configured = alignedChannels();
  const report = await runLiveProviderGate({
    channels: configured,
    costCapUsd: 1,
    externalEvidenceCostReservationUsd: 0.1,
    lifecycleEvidence: lifecycleEvidenceFor(configured),
    transportFaultEvidence: transportFaultEvidenceFor(configured),
    probe: async (channel) => successfulProbe(channel),
  });

  assert.deepEqual(report.blockedChecks, []);
  assert.deepEqual(report.skippedOperations, []);
  assert.ok(report.publishGates.every((gate) => gate.multiChannelReady));
  assert.equal(report.liveMatrixReports.length, 3);
  assert.ok(report.externalEvidenceRefs.length > 30);
  assert.ok(
    report.liveMatrixReports.every(
      (matrix) =>
        matrix.evidenceKind === 'live_provider' &&
        matrix.allPassed &&
        matrix.scenarios.length === 5,
    ),
  );
});

test('missing transport scenario or failed lifecycle check stays blocked', async () => {
  const configured = alignedChannels();
  const transportEvidence = transportFaultEvidenceFor(configured);
  transportEvidence[2] = {
    ...transportEvidence[2]!,
    scenarios: transportEvidence[2]!.scenarios.filter(
      (scenario) => scenario.scenarioId !== 'isolate_drain_new_task',
    ),
  };
  const lifecycleEvidence = lifecycleEvidenceFor(configured);
  lifecycleEvidence[0] = {
    ...lifecycleEvidence[0]!,
    checks: lifecycleEvidence[0]!.checks.map((check) =>
      check.checkId === 'protocol_completion'
        ? { ...check, passed: false }
        : check,
    ),
  };
  const report = await runLiveProviderGate({
    channels: configured,
    costCapUsd: 1,
    externalEvidenceCostReservationUsd: 0.1,
    lifecycleEvidence,
    transportFaultEvidence: transportEvidence,
    probe: async (channel) => successfulProbe(channel),
  });

  assert.deepEqual(
    report.liveMatrixReports.map((matrix) => matrix.operation),
    ['image.generate'],
  );
  assert.ok(report.skippedOperations.includes('copy.generate'));
  assert.ok(report.skippedOperations.includes('video.generate'));
  assert.ok(
    report.blockedChecks.some(
      (check) => check.check === 'complete_lifecycle_conformance',
    ),
  );
  assert.ok(
    report.blockedChecks.some(
      (check) => check.check === 'real_fault_injection',
    ),
  );
});

test('each required evidence field independently gates live_verified', () => {
  const complete: LiveProviderProbeEvidence = {
    acceptance: 'accepted',
    adapterExecuted: true,
    adapterKind: 'ark_media',
    accountIdentityFingerprint: fingerprint,
    endpointFingerprint: alternateFingerprint,
    catalogModelId: 'seedance-1-5-pro',
    channelKind: 'official_direct',
    deploymentId: 'live-video-official_direct',
    evidenceRef: 'provider-live:test:complete',
    lifecycle: {
      assetSha256: fingerprint,
      downloaded: true,
      downloadedBytes: 1024,
      pollStatus: 'completed',
      recovered: true,
      submitted: true,
    },
    modality: 'video',
    observedAt: new Date(0).toISOString(),
    operation: 'video.generate',
    providerCallSucceeded: true,
    providerProfileId: 'pp-volcengine-ark',
    providerTaskRef: 'provider-task',
    providerCost: {
      amount: 0.1,
      currency: 'USD',
      usage: { mediaUnits: 1, outputTokens: 100 },
    },
  };
  assert.equal(isLiveVerifiedProbe(complete), true);

  const mutations: LiveProviderProbeEvidence[] = [
    { ...complete, adapterExecuted: false },
    { ...complete, providerCallSucceeded: false },
    { ...complete, acceptance: 'acceptance_unknown' },
    { ...complete, providerTaskRef: undefined },
    { ...complete, accountIdentityFingerprint: 'missing' },
    { ...complete, endpointFingerprint: 'missing' },
    { ...complete, lifecycle: { ...complete.lifecycle, submitted: false } },
    { ...complete, lifecycle: { ...complete.lifecycle, recovered: false } },
    { ...complete, lifecycle: { ...complete.lifecycle, downloaded: false } },
    {
      ...complete,
      lifecycle: { ...complete.lifecycle, pollStatus: 'unknown' },
    },
    {
      ...complete,
      lifecycle: { ...complete.lifecycle, downloadedBytes: 0 },
    },
    {
      ...complete,
      lifecycle: { ...complete.lifecycle, assetSha256: 'invalid' },
    },
    {
      ...complete,
      providerCost: {
        ...complete.providerCost,
        usage: { mediaUnits: 0, outputTokens: 100 },
      },
    },
    {
      ...complete,
      providerCost: {
        ...complete.providerCost,
        usage: { mediaUnits: 1, outputTokens: 0 },
      },
    },
  ];
  for (const mutation of mutations) {
    assert.equal(isLiveVerifiedProbe(mutation), false);
  }
});

test('channel evidence cannot be rebound to a different provider identity', async () => {
  const videoChannels = channels().filter(
    (channel) => channel.model.operation === 'video.generate',
  );
  const report = await runLiveProviderGate({
    channels: videoChannels,
    costCapUsd: 1,
    probe: async (channel): Promise<LiveProviderProbeEvidence> => ({
      acceptance: 'accepted',
      adapterExecuted: true,
      adapterKind: channel.adapterKind,
      accountIdentityFingerprint: channel.accountIdentityFingerprint,
      endpointFingerprint: channel.endpointFingerprint,
      catalogModelId: channel.model.catalogModelId,
      channelKind: channel.model.channelKind,
      deploymentId: `live-${channel.model.modality}-${channel.model.channelKind}`,
      evidenceRef: `provider-live:test:binding:${channel.model.channelKind}`,
      lifecycle: {
        assetSha256: fingerprint,
        downloaded: true,
        downloadedBytes: 1024,
        pollStatus: 'completed',
        recovered: true,
        submitted: true,
      },
      modality: channel.model.modality,
      observedAt: new Date(0).toISOString(),
      operation: channel.model.operation,
      providerCallSucceeded: true,
      providerProfileId:
        channel.model.channelKind === 'upstream_reseller'
          ? 'spoofed-provider-profile'
          : channel.model.providerProfileId,
      providerTaskRef: 'provider-task',
      providerCost: {
        amount: 0.1,
        currency: 'USD',
        usage: { mediaUnits: 1, outputTokens: 100 },
      },
    }),
  });

  const videoGate = report.publishGates.find(
    (gate) => gate.operation === 'video.generate',
  );
  assert.equal(videoGate?.multiChannelReady, false);
  assert.equal(videoGate?.qualifiedDeployments.length, 1);
  assert.equal(
    report.activationEvidence.find(
      (evidence) => evidence.channelKind === 'upstream_reseller',
    )?.activationStatus,
    'documented',
  );
});

test('shared account or endpoint fingerprints cannot count as two fault domains', async () => {
  const videoChannels = channels().filter(
    (channel) => channel.model.operation === 'video.generate',
  );
  videoChannels[1] = {
    ...videoChannels[1]!,
    accountIdentityFingerprint:
      videoChannels[0]!.accountIdentityFingerprint,
  };
  const report = await runLiveProviderGate({
    channels: videoChannels,
    costCapUsd: 1,
    probe: async (channel): Promise<LiveProviderProbeEvidence> => ({
      acceptance: 'accepted',
      adapterExecuted: true,
      adapterKind: channel.adapterKind,
      accountIdentityFingerprint: channel.accountIdentityFingerprint,
      endpointFingerprint: channel.endpointFingerprint,
      catalogModelId: channel.model.catalogModelId,
      channelKind: channel.model.channelKind,
      deploymentId: `live-${channel.model.modality}-${channel.model.channelKind}`,
      evidenceRef: `provider-live:test:fault-domain:${channel.model.channelKind}`,
      lifecycle: {
        assetSha256: fingerprint,
        downloaded: true,
        downloadedBytes: 1024,
        pollStatus: 'completed',
        recovered: true,
        submitted: true,
      },
      modality: channel.model.modality,
      observedAt: new Date(0).toISOString(),
      operation: channel.model.operation,
      providerCallSucceeded: true,
      providerProfileId: channel.model.providerProfileId,
      providerTaskRef: 'provider-task',
      providerCost: {
        amount: 0.1,
        currency: 'USD',
        usage: { mediaUnits: 1, outputTokens: 100 },
      },
    }),
  });

  const videoGate = report.publishGates.find(
    (gate) => gate.operation === 'video.generate',
  );
  assert.equal(videoGate?.multiChannelReady, false);
  assert.ok(
    report.blockedChecks.some(
      (check) =>
        check.operation === 'video.generate' &&
        check.check === 'fault_domain_independence',
    ),
  );
});

test('reserved provider cost blocks every paid call before the cap is exceeded', async () => {
  let probeCalls = 0;
  await assert.rejects(
    runLiveProviderGate({
      channels: channels(),
      costCapUsd: 0.01,
      probe: async () => {
        probeCalls += 1;
        throw new Error('unreachable');
      },
    }),
    /provider_live_cost_cap_exceeded/,
  );
  assert.equal(probeCalls, 0);

  for (const invalidBudget of [Number.NaN, 0, -1]) {
    const invalidChannels = channels();
    invalidChannels[0] = {
      ...invalidChannels[0]!,
      maxProbeCostUsd: invalidBudget,
    };
    await assert.rejects(
      runLiveProviderGate({
        channels: invalidChannels,
        costCapUsd: 1,
        probe: async () => {
          probeCalls += 1;
          throw new Error('unreachable');
        },
      }),
      /provider_live_cost_cap_exceeded/,
    );
  }
  assert.equal(probeCalls, 0);

  const configured = alignedChannels();
  await assert.rejects(
    runLiveProviderGate({
      channels: configured,
      costCapUsd: 1,
      externalEvidenceCostReservationUsd: 0,
      lifecycleEvidence: lifecycleEvidenceFor(configured),
      probe: async () => {
        probeCalls += 1;
        throw new Error('unreachable');
      },
    }),
    /provider_live_cost_cap_exceeded/,
  );
  assert.equal(probeCalls, 0);
});
