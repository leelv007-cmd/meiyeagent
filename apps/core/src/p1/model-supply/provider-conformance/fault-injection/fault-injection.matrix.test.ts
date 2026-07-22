/**
 * MP-08 fault-injection matrix unit tests (I4).
 * Dual-channel fakes for text / image / video; official single-channel matrix.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adminChannelLabel,
  CHANNEL_LABEL,
  userSelectChannelLabel,
} from './channel-label.js';
import {
  createFaultInjectionHarnessForModality,
  createImageFaultInjectionHarness,
  createSingleChannelFaultInjectionHarness,
  createTextFaultInjectionHarness,
  createVideoFaultInjectionHarness,
} from './fakes.js';
import { runFaultInjectionMatrix } from './matrix.js';
import {
  DUAL_CHANNEL_MATRIX_MODELS,
  matrixModelsForOperation,
  SECONDARY_MATRIX_NOTES,
} from './matrix-models.js';
import { runSingleChannelFaultInjectionMatrix } from './single-channel-matrix.js';
import {
  FAULT_INJECTION_SCENARIOS,
  CORE_FAULT_INJECTION_OPERATIONS,
  SINGLE_CHANNEL_FAULT_INJECTION_SCENARIOS,
} from './types.js';
import {
  evaluateMultiChannelPublishGate,
  qualifiedDeployment,
} from './publish-gate.js';

for (const modality of ['llm', 'image', 'video'] as const) {
  test(`MP-08 ${modality} dual-channel fault-injection matrix passes all scenarios`, async () => {
    const harness = createFaultInjectionHarnessForModality(modality);
    const report = await runFaultInjectionMatrix(harness);

    assert.equal(report.modality, modality);
    assert.equal(report.scenarios.length, FAULT_INJECTION_SCENARIOS.length);
    assert.equal(report.allPassed, true, summarizeFailures(report));
    // Video shares seedance-1-5-pro → dualChannelReady; text/image are misaligned.
    const expectDualReady = modality === 'video';
    assert.equal(report.channelMatrixAligned, expectDualReady);
    assert.equal(report.dualChannelReady, expectDualReady);
    assert.equal(report.evidenceKind, 'recorded');

    for (const scenarioId of FAULT_INJECTION_SCENARIOS) {
      const scenario = report.scenarios.find((s) => s.scenarioId === scenarioId);
      assert.ok(scenario, `missing scenario ${scenarioId}`);
      assert.equal(
        scenario!.passed,
        true,
        `${modality}/${scenarioId}: ${scenario!.detail}`,
      );
    }

    const switchCase = report.scenarios.find(
      (s) => s.scenarioId === 'reject_before_accept_switch',
    )!;
    assert.equal(switchCase.disposition, 'switched_to_fallback');
    assert.equal(switchCase.attempts.length, 2);
    assert.equal(switchCase.attempts[0]?.acceptance, 'rejected_before_accept');
    assert.equal(switchCase.attempts[1]?.acceptance, 'accepted');

    const accepted = report.scenarios.find(
      (s) => s.scenarioId === 'accepted_no_resubmit',
    )!;
    assert.equal(accepted.disposition, 'primary_succeeded');
    assert.equal(accepted.attempts.length, 1);

    const unknown = report.scenarios.find(
      (s) => s.scenarioId === 'acceptance_unknown_reconcile',
    )!;
    assert.equal(unknown.disposition, 'reconcile_no_resubmit');
    assert.equal(
      unknown.bilateralLedger?.productUsage.status,
      'held_for_reconcile',
    );

    const isolate = report.scenarios.find(
      (s) => s.scenarioId === 'isolate_drain_new_task',
    )!;
    assert.equal(isolate.disposition, 'fallback_only');

    const replay = report.scenarios.find(
      (s) => s.scenarioId === 'route_snapshot_ledger_replay',
    )!;
    assert.ok(replay.routeSnapshot?.id);
    assert.equal(
      replay.bilateralLedger?.supplyFreeze.routeSnapshotRef,
      replay.routeSnapshot?.id,
    );
  });
}

test('core operations map to dual-channel matrix models with official + reseller', () => {
  for (const operation of CORE_FAULT_INJECTION_OPERATIONS) {
    const models = matrixModelsForOperation(operation);
    assert.equal(models.length, 2, operation);
    const kinds = new Set(models.map((m) => m.channelKind));
    assert.ok(kinds.has('official_direct'), operation);
    assert.ok(kinds.has('upstream_reseller'), operation);
  }
  assert.ok(DUAL_CHANNEL_MATRIX_MODELS.length >= 6);
  // Video is channel-level only (shared Seedance manufacturer) and aligned.
  const video = matrixModelsForOperation('video.generate');
  assert.ok(video.every((m) => m.independenceClaim === 'channel_level'));
  assert.ok(video.every((m) => m.catalogAlignment === 'channel_matrix_aligned'));
  assert.equal(
    new Set(video.map((m) => m.catalogModelId)).size,
    1,
    'video dual channels must share CatalogModel',
  );
  // Text/image official vs reseller use different CatalogModels.
  for (const operation of ['copy.generate', 'image.generate'] as const) {
    const models = matrixModelsForOperation(operation);
    assert.ok(
      models.every((m) => m.catalogAlignment === 'channel_matrix_misaligned'),
      operation,
    );
    assert.equal(
      new Set(models.map((m) => m.catalogModelId)).size,
      2,
      `${operation} must stay channel_matrix_misaligned`,
    );
  }
});

test('secondary ops are labeled single-channel/no-fallback', () => {
  for (const [op, note] of Object.entries(SECONDARY_MATRIX_NOTES)) {
    assert.equal(note.minLiveVerified, 1, op);
    assert.equal(note.channelLabel, CHANNEL_LABEL.singleChannelNoFallback);
  }
});

test('text harness channel kinds are official_direct + upstream_reseller', async () => {
  const harness = createTextFaultInjectionHarness('copy.generate');
  assert.equal(harness.primary.candidate.channelKind, 'official_direct');
  assert.equal(harness.fallback.candidate.channelKind, 'upstream_reseller');
  const report = await runFaultInjectionMatrix(harness);
  assert.equal(report.operation, 'copy.generate');
  assert.equal(report.allPassed, true, summarizeFailures(report));
});

test('image and video harnesses expose dual source kinds', () => {
  const image = createImageFaultInjectionHarness();
  const video = createVideoFaultInjectionHarness();
  assert.equal(image.primary.candidate.channelKind, 'official_direct');
  assert.equal(image.fallback.candidate.channelKind, 'upstream_reseller');
  assert.equal(video.primary.candidate.channelKind, 'official_direct');
  assert.equal(video.fallback.candidate.channelKind, 'upstream_reseller');
});

test('admin and user labels distinguish multi-channel vs single-channel', async () => {
  const harness = createTextFaultInjectionHarness();
  const report = await runFaultInjectionMatrix(harness);
  // Text official vs reseller use different CatalogModels → not dual-channel ready.
  assert.equal(report.channelMatrixAligned, false);
  assert.equal(report.dualChannelReady, false);
  assert.equal(report.allPassed, true, summarizeFailures(report));
  // Labels for single-channel secondary surface.
  assert.equal(
    CHANNEL_LABEL.singleChannelNoFallback,
    'single-channel/no-fallback',
  );
  assert.match(adminChannelLabel({
    operation: 'copy.adapt',
    catalogModelId: 'x',
    status: 'single_channel',
    multiChannelReady: false,
    independentFaultDomainCount: 1,
    faultDomainKind: 'none',
    manufacturerIndependent: false,
    hasOfficialDirect: true,
    hasUpstreamReseller: false,
    qualifiedDeployments: [],
    channelLabel: CHANNEL_LABEL.singleChannelNoFallback,
    reason: 'single',
    publishAllowed: true,
  }), /single-channel\/no-fallback/);
  assert.equal(
    userSelectChannelLabel({
      operation: 'copy.adapt',
      catalogModelId: 'x',
      status: 'single_channel',
      multiChannelReady: false,
      independentFaultDomainCount: 1,
      faultDomainKind: 'none',
      manufacturerIndependent: false,
      hasOfficialDirect: true,
      hasUpstreamReseller: false,
      qualifiedDeployments: [],
      channelLabel: CHANNEL_LABEL.singleChannelNoFallback,
      reason: 'single',
      publishAllowed: true,
    }),
    '单渠道 / 无回退',
  );
});

for (const modality of ['llm', 'image', 'video'] as const) {
  test(`MP-08 ${modality} official single-channel fault matrix passes all scenarios`, async () => {
    const harness = createSingleChannelFaultInjectionHarness(modality);
    const report = await runSingleChannelFaultInjectionMatrix(harness);

    assert.equal(report.modality, modality);
    assert.equal(report.channelMode, 'single_channel');
    assert.equal(report.channelLabel, 'single-channel/no-fallback');
    assert.equal(report.dualChannelReady, false);
    assert.equal(report.fallbackAvailable, false);
    assert.equal(report.evidenceKind, 'recorded');
    assert.equal(
      report.scenarios.length,
      SINGLE_CHANNEL_FAULT_INJECTION_SCENARIOS.length,
    );
    assert.equal(report.allPassed, true, summarizeFailures(report));

    for (const scenarioId of SINGLE_CHANNEL_FAULT_INJECTION_SCENARIOS) {
      const scenario = report.scenarios.find((s) => s.scenarioId === scenarioId);
      assert.ok(scenario, `missing scenario ${scenarioId}`);
      assert.equal(
        scenario!.passed,
        true,
        `${modality}/${scenarioId}: ${scenario!.detail}`,
      );
    }

    const reject = report.scenarios.find(
      (s) => s.scenarioId === 'reject_before_accept_fail_closed',
    )!;
    assert.equal(reject.disposition, 'failed_no_fallback');
    assert.equal(reject.attempts[0]?.acceptance, 'rejected_before_accept');

    const isolate = report.scenarios.find(
      (s) => s.scenarioId === 'isolate_unavailable_blocks_new_task',
    )!;
    assert.equal(isolate.disposition, 'unavailable_blocked');
    assert.equal(isolate.availability, 'unavailable');
    assert.equal(isolate.attempts.length, 0);

    const drain = report.scenarios.find(
      (s) => s.scenarioId === 'drain_unavailable_blocks_new_task',
    )!;
    assert.equal(drain.disposition, 'unavailable_blocked');
    assert.equal(drain.availability, 'unavailable');

    const rateLimit = report.scenarios.find(
      (s) => s.scenarioId === 'rate_limit_evidence',
    )!;
    assert.equal(rateLimit.faultEvidence?.errorCode, 'rate_limited');

    const timeout = report.scenarios.find(
      (s) => s.scenarioId === 'timeout_evidence',
    )!;
    assert.equal(timeout.faultEvidence?.errorCode, 'logical_timeout');

    const cost = report.scenarios.find(
      (s) => s.scenarioId === 'cost_convergence_evidence',
    )!;
    assert.equal(cost.faultEvidence?.costStatus, 'observed');
    assert.ok((cost.faultEvidence?.costAmount ?? 0) > 0);

    const replay = report.scenarios.find(
      (s) => s.scenarioId === 'route_snapshot_ledger_replay',
    )!;
    assert.equal(replay.routeSnapshot?.fallbackConsent, false);
    assert.equal(replay.routeSnapshot?.fallbackChain?.length, 1);
  });
}

test('official single-channel publishAllowed without multi-channel ready claim', () => {
  for (const operation of CORE_FAULT_INJECTION_OPERATIONS) {
    const catalogModelId =
      operation === 'copy.generate'
        ? 'llm-doubao-seed-mini'
        : operation === 'image.generate'
          ? 'seedream-5-pro'
          : 'seedance-1-5-pro';
    const gate = evaluateMultiChannelPublishGate({
      operation,
      catalogModelId,
      deployments: [
        qualifiedDeployment({
          deploymentId: `dep-${operation}-official`,
          catalogModelId,
          providerProfileId: 'pp-volcengine-ark',
          executionChannelId: 'ec-ark',
          channelKind: 'official_direct',
          activationStatus: 'live_verified',
          manufacturer: 'volcengine',
          accountIdentity: `acct-${operation}`,
          endpointFingerprint: `endpoint-${operation}`,
        }),
      ],
      requireLiveVerified: true,
    });
    assert.equal(gate.status, 'single_channel', operation);
    assert.equal(gate.publishAllowed, true, operation);
    assert.equal(gate.multiChannelReady, false, operation);
    assert.equal(gate.channelLabel, CHANNEL_LABEL.singleChannelNoFallback);
    assert.equal(gate.hasOfficialDirect, true);
    assert.equal(gate.hasUpstreamReseller, false);
  }
});

test('recorded single Deployment must not satisfy requireLiveVerified publish gate', () => {
  const gate = evaluateMultiChannelPublishGate({
    operation: 'copy.generate',
    catalogModelId: 'llm-doubao-seed-mini',
    deployments: [
      qualifiedDeployment({
        deploymentId: 'dep-recorded-only',
        catalogModelId: 'llm-doubao-seed-mini',
        providerProfileId: 'pp-volcengine-ark',
        executionChannelId: 'ec-ark',
        channelKind: 'official_direct',
        activationStatus: 'recorded',
        manufacturer: 'volcengine',
        accountIdentity: 'acct-recorded',
        endpointFingerprint: 'endpoint-recorded',
      }),
    ],
    requireLiveVerified: true,
  });
  assert.notEqual(gate.status, 'single_channel');
  assert.equal(gate.publishAllowed, false);
  assert.equal(gate.multiChannelReady, false);
  assert.equal(gate.qualifiedDeployments.length, 0);
});

function summarizeFailures(report: {
  scenarios: Array<{ scenarioId: string; passed: boolean; detail: string }>;
}): string {
  return report.scenarios
    .filter((s) => !s.passed)
    .map((s) => `${s.scenarioId}: ${s.detail}`)
    .join('; ');
}
