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
  type LiveExternalCostEvidence,
  type LiveProviderChannel,
  type LiveProviderLifecycleEvidence,
  type LiveProviderProbeEvidence,
  type LiveTransportFaultEvidence,
} from './live-provider-gate.js';

const fingerprint = 'a'.repeat(64);
const alternateFingerprint = 'b'.repeat(64);
const runNonce = 'provider-live-test-run-0001';

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
  const deploymentId =
    channel.deploymentId ??
    `live-${channel.model.modality}-${channel.model.channelKind}`;
  return {
    acceptance: 'accepted',
    adapterExecuted: true,
    adapterKind: channel.adapterKind,
    accountIdentityFingerprint: channel.accountIdentityFingerprint,
    endpointFingerprint: channel.endpointFingerprint,
    catalogModelId: channel.model.catalogModelId,
    channelKind: channel.model.channelKind,
    deploymentId,
    evidenceRef: `provider-live:test:${deploymentId}`,
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
    providerTaskRef: `provider-task-${deploymentId}`,
    providerCost: {
      amount: 0.005,
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
    return official
      ? {
          ...channel,
          model: {
            ...channel.model,
            ...(channel.model.channelKind === 'upstream_reseller'
              ? { catalogModelId: official.model.catalogModelId }
              : {}),
            catalogAlignment: 'channel_matrix_aligned',
          },
        }
      : channel;
  });
}

function secondaryProbesFor(
  configured: readonly LiveProviderChannel[],
  channelKind: LiveProviderChannel['model']['channelKind'] = 'official_direct',
): LiveProviderProbeEvidence[] {
  const operations = [
    ['copy.adapt', 'llm'],
    ['text.respond', 'llm'],
    ['image.edit', 'image'],
  ] as const;
  return operations.map(([operation, modality], index) => {
    const channel = configured.find(
      (candidate) =>
        candidate.model.channelKind === channelKind &&
        candidate.model.modality === modality,
    );
    assert.ok(channel, `missing ${channelKind} ${modality} channel`);
    return {
      ...successfulProbe(channel),
      operation,
      evidenceRef: `provider-live:test:secondary:${operation}`,
      observedAt: new Date().toISOString(),
      providerTaskRef: `provider-secondary-task-${operation}`,
      operationEvidence: {
        operation,
        runNonce,
        requestIdempotencyKeySha256: `${index + 1}`.repeat(64),
        requestPayloadSha256: `${index + 4}`.repeat(64),
        resultPayloadSha256: `${index + 7}`.repeat(64),
      },
    };
  });
}

function externalCostEvidence(): LiveExternalCostEvidence {
  return {
    source: 'provider_live_cost_ledger',
    runNonce,
    evidenceRef: 'provider-live:test:cost-ledger',
    observedAt: new Date().toISOString(),
    amountUsd: 0.035,
    currency: 'USD',
    components: [
      {
        kind: 'secondary_probe',
        amountUsd: 0.015,
        evidenceRef: 'provider-live:test:cost:secondary',
      },
      {
        kind: 'lifecycle_probe',
        amountUsd: 0.01,
        evidenceRef: 'provider-live:test:cost:lifecycle',
      },
      {
        kind: 'fault_injection',
        amountUsd: 0.01,
        evidenceRef: 'provider-live:test:cost:fault',
      },
    ],
  };
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
      runNonce,
      evidenceRef: `test:lifecycle:${channel.model.modality}:${channel.model.channelKind}`,
      observedAt: new Date().toISOString(),
      operation: channel.model.operation,
      modality: channel.model.modality,
      channelKind: channel.model.channelKind,
      catalogModelId: channel.model.catalogModelId,
      providerProfileId: channel.model.providerProfileId,
      deploymentId:
        channel.deploymentId ??
        `live-${channel.model.modality}-${channel.model.channelKind}`,
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
    const observedAt = new Date().toISOString();
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
      runNonce,
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

function completeGateInput(
  configured: readonly LiveProviderChannel[],
): Parameters<typeof runLiveProviderGate>[0] {
  return {
    channels: configured,
    costCapUsd: 1,
    externalEvidenceCostReservationUsd: 0.1,
    externalCostEvidence: externalCostEvidence(),
    runNonce,
    secondaryProbes: secondaryProbesFor(configured),
    lifecycleEvidence: lifecycleEvidenceFor(configured),
    transportFaultEvidence: transportFaultEvidenceFor(configured),
    probe: async (channel) => successfulProbe(channel),
  };
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
    'copy.adapt',
    'text.respond',
    'image.edit',
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
      ['copy.adapt', false],
      ['text.respond', false],
      ['image.edit', false],
    ],
  );
  assert.equal(report.liveMatrixReports.length, 0);
  assert.deepEqual(report.skippedOperations, [
    'copy.generate',
    'image.generate',
    'video.generate',
    'copy.adapt',
    'text.respond',
    'image.edit',
  ]);
  assert.equal(report.blockedChecks.length, 11);
  assert.equal(
    report.blockedChecks.filter(
      (check) => check.check === 'secondary_live_verification',
    ).length,
    3,
  );
});

test('primary connectivity mode publishes one live official channel per modality', async () => {
  const report = await runLiveProviderGate({
    acceptanceMode: 'primary_connectivity',
    channels: channels(),
    costCapUsd: 1,
    probe: async (channel) => successfulProbe(channel),
  });

  assert.equal(report.acceptanceMode, 'primary_connectivity');
  assert.equal(report.probes.length, 3);
  assert.ok(
    report.activationEvidence.every(
      (evidence) => evidence.activationStatus === 'live_verified',
    ),
  );
  assert.deepEqual(report.blockedChecks, []);
  assert.deepEqual(report.skippedOperations, []);
  assert.equal(report.publishGates.length, 3);
  assert.ok(
    report.publishGates.every(
      (gate) =>
        gate.status === 'single_channel' &&
        gate.publishAllowed &&
        !gate.multiChannelReady &&
        gate.channelLabel === 'single-channel/no-fallback',
    ),
  );
  assert.equal(report.liveMatrixReports.length, 0);
});

test('primary connectivity mode stays blocked when one official probe fails', async () => {
  const report = await runLiveProviderGate({
    acceptanceMode: 'primary_connectivity',
    channels: channels(),
    costCapUsd: 1,
    probe: async (channel) => {
      const evidence = successfulProbe(channel);
      return channel.model.operation === 'image.generate'
        ? { ...evidence, providerCallSucceeded: false }
        : evidence;
    },
  });

  assert.deepEqual(report.skippedOperations, ['image.generate']);
  assert.deepEqual(
    report.blockedChecks.map((check) => [check.operation, check.check]),
    [['image.generate', 'primary_live_verification']],
  );
});

test('catalog id override cannot disguise a matrix declared as misaligned', async () => {
  const configured = channels().map((channel) =>
    channel.model.operation === 'copy.generate'
      ? {
          ...channel,
          model: {
            ...channel.model,
            catalogModelId: 'forced-shared-catalog-id',
          },
        }
      : channel,
  );
  const report = await runLiveProviderGate({
    channels: configured,
    costCapUsd: 1,
    probe: async (channel) => successfulProbe(channel),
  });

  const textGate = report.publishGates.find(
    (gate) => gate.operation === 'copy.generate',
  );
  assert.equal(textGate?.multiChannelReady, false);
  assert.ok(
    report.blockedChecks.some(
      (check) =>
        check.operation === 'copy.generate' &&
        check.check === 'catalog_model_alignment',
    ),
  );
});

test('validated external lifecycle and transport evidence produces live matrix reports', async () => {
  const configured = alignedChannels();
  const report = await runLiveProviderGate(completeGateInput(configured));

  assert.deepEqual(report.blockedChecks, []);
  assert.deepEqual(report.skippedOperations, []);
  assert.ok(report.publishGates.slice(0, 3).every((gate) => gate.multiChannelReady));
  assert.ok(
    report.publishGates.slice(3).every(
      (gate) =>
        gate.status === 'single_channel' &&
        gate.publishAllowed &&
        !gate.multiChannelReady &&
        gate.channelLabel === 'single-channel/no-fallback',
    ),
  );
  assert.equal(report.liveMatrixReports.length, 3);
  assert.ok(Math.abs(report.actualCost.providerProbeUsd - 0.03) < 1e-9);
  assert.equal(report.actualCost.externalEvidenceUsd, 0.035);
  assert.ok(Math.abs(report.actualCost.totalUsd - 0.065) < 1e-9);
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

test('secondary live probe cannot be rebound to another provider identity', async () => {
  const configured = alignedChannels();
  const secondaryProbes = secondaryProbesFor(configured);
  secondaryProbes[0] = {
    ...secondaryProbes[0]!,
    accountIdentityFingerprint: alternateFingerprint,
  };
  let probeCalls = 0;
  await assert.rejects(
    runLiveProviderGate({
      ...completeGateInput(configured),
      secondaryProbes,
      probe: async (channel) => {
        probeCalls += 1;
        return successfulProbe(channel);
      },
    }),
    /provider_live_external_evidence_incomplete/,
  );
  assert.equal(probeCalls, 0);
});

test('secondary evidence cannot reuse a core provider task with only operation changed', async () => {
  const configured = alignedChannels();
  const secondaryProbes = secondaryProbesFor(configured);
  const officialText = configured.find(
    (channel) =>
      channel.model.modality === 'llm' &&
      channel.model.channelKind === 'official_direct',
  )!;
  secondaryProbes[0] = {
    ...successfulProbe(officialText),
    operation: 'copy.adapt',
    evidenceRef: 'provider-live:test:secondary:copied-core',
    observedAt: new Date().toISOString(),
  };
  let probeCalls = 0;
  await assert.rejects(
    runLiveProviderGate({
      ...completeGateInput(configured),
      secondaryProbes,
      probe: async (channel) => {
        probeCalls += 1;
        return successfulProbe(channel);
      },
    }),
    /provider_live_external_evidence_incomplete/,
  );
  assert.equal(probeCalls, 0);
});

test('secondary operations may use a reseller-only live channel', async () => {
  const configured = alignedChannels();
  const report = await runLiveProviderGate({
    ...completeGateInput(configured),
    secondaryProbes: secondaryProbesFor(configured, 'upstream_reseller'),
  });

  const secondaryGates = report.publishGates.slice(3);
  assert.ok(
    secondaryGates.every(
      (gate) =>
        gate.status === 'single_channel' &&
        gate.channelLabel === 'single-channel/no-fallback' &&
        gate.hasUpstreamReseller,
    ),
  );
});

test('secondary operations accept more than one independent probe per operation', async () => {
  const configured = alignedChannels();
  const secondaryProbes = secondaryProbesFor(configured);
  secondaryProbes.push({
    ...secondaryProbes[0]!,
    evidenceRef: 'provider-live:test:secondary:copy-adapt:alternate',
    providerTaskRef: 'provider-secondary-task-copy-adapt-alternate',
    operationEvidence: {
      operation: 'copy.adapt',
      runNonce,
      requestIdempotencyKeySha256: 'd'.repeat(64),
      requestPayloadSha256: 'e'.repeat(64),
      resultPayloadSha256: 'f'.repeat(64),
    },
  });
  const costEvidence = externalCostEvidence();
  costEvidence.components[0]!.amountUsd += 0.005;
  costEvidence.amountUsd += 0.005;
  const report = await runLiveProviderGate({
    ...completeGateInput(configured),
    secondaryProbes,
    externalCostEvidence: costEvidence,
  });

  assert.equal(
    report.activationEvidence.filter(
      (evidence) => evidence.operation === 'copy.adapt',
    ).length,
    2,
  );
  assert.equal(
    report.publishGates.find((gate) => gate.operation === 'copy.adapt')?.status,
    'single_channel',
  );
});

test('core gate accepts a third aligned channel when two independent domains pass', async () => {
  const configured = alignedChannels();
  const reseller = configured.find(
    (channel) =>
      channel.model.operation === 'video.generate' &&
      channel.model.channelKind === 'upstream_reseller',
  )!;
  configured.push({
    ...reseller,
    deploymentId: 'live-video-upstream_reseller-alt',
    accountIdentityFingerprint: 'c'.repeat(64),
    endpointFingerprint: 'd'.repeat(64),
    model: {
      ...reseller.model,
      providerProfileId: 'pp-tuzi-upstream-alt',
    },
  });
  const report = await runLiveProviderGate(completeGateInput(configured));

  const videoGate = report.publishGates.find(
    (gate) => gate.operation === 'video.generate',
  );
  assert.equal(videoGate?.multiChannelReady, true);
  assert.equal(videoGate?.qualifiedDeployments.length, 3);
  assert.ok(
    report.liveMatrixReports.some(
      (matrix) => matrix.operation === 'video.generate',
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
  let probeCalls = 0;
  await assert.rejects(
    runLiveProviderGate({
      ...completeGateInput(configured),
      lifecycleEvidence,
      transportFaultEvidence: transportEvidence,
      probe: async (channel) => {
        probeCalls += 1;
        return successfulProbe(channel);
      },
    }),
    /provider_live_external_evidence_incomplete/,
  );
  assert.equal(probeCalls, 0);
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
    { ...complete, evidenceRef: 'invalid' },
    { ...complete, observedAt: 'not-a-timestamp' },
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
        amount: 0.005,
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
        amount: 0.005,
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

test('actual provider and hook cost evidence fail closed against reservations', async () => {
  const videoChannels = alignedChannels().filter(
    (channel) => channel.model.operation === 'video.generate',
  );
  await assert.rejects(
    runLiveProviderGate({
      channels: videoChannels,
      costCapUsd: 1,
      probe: async (channel) => ({
        ...successfulProbe(channel),
        providerCost: {
          ...successfulProbe(channel).providerCost,
          amount: 0.02,
        },
      }),
    }),
    /provider_live_probe_reservation_exceeded/,
  );

  const configured = alignedChannels();
  const excessiveHookCost = externalCostEvidence();
  excessiveHookCost.amountUsd = 0.12;
  excessiveHookCost.components[0]!.amountUsd = 0.1;
  await assert.rejects(
    runLiveProviderGate({
      channels: configured,
      costCapUsd: 1,
      externalEvidenceCostReservationUsd: 0.1,
      externalCostEvidence: excessiveHookCost,
      runNonce,
      secondaryProbes: secondaryProbesFor(configured),
      lifecycleEvidence: lifecycleEvidenceFor(configured),
      transportFaultEvidence: transportFaultEvidenceFor(configured),
      probe: async (channel) => successfulProbe(channel),
    }),
    /provider_live_external_cost_reservation_exceeded/,
  );

  const unreconciledCost = externalCostEvidence();
  unreconciledCost.components[0]!.amountUsd = 0.01;
  unreconciledCost.amountUsd = 0.03;
  await assert.rejects(
    runLiveProviderGate({
      channels: configured,
      costCapUsd: 1,
      externalEvidenceCostReservationUsd: 0.1,
      externalCostEvidence: unreconciledCost,
      runNonce,
      secondaryProbes: secondaryProbesFor(configured),
      probe: async (channel) => successfulProbe(channel),
    }),
    /provider_live_secondary_cost_reconciliation_failed/,
  );

  await assert.rejects(
    runLiveProviderGate({
      channels: videoChannels,
      costCapUsd: 1,
      probe: async (channel) => ({
        ...successfulProbe(channel),
        providerCost: {
          ...successfulProbe(channel).providerCost,
          amount: 0.005,
          amountUsd: undefined,
          currency: 'CNY',
          fx: undefined,
        },
      }),
    }),
    /provider_live_probe_cost_unverifiable/,
  );
});
