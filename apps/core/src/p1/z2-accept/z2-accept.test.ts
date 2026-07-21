/**
 * Z2-ACCEPT same-increment gates (MP vertical + publish gate).
 *
 * Gate 1 (capability skeleton) is asserted in web suite + contracts inventory.
 * Gate 2: tri-modal dual-channel recorded story 30 chain.
 * Gate 3: publish gate rejects multi_channel_ready with <2 qualified Deployments.
 * Unit dualChannelReady same-CatalogModel honesty is F-I-01 (FIXED).
 * Live I4 matrix remains env-gated — see docs/evidence/admin-supply-accept-gaps-2026-07-20.md.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { CAPABILITY_INVENTORY } from '@meiye/contracts';
import { dualChannelActivationGateReady } from '../model-supply/provider-conformance/activation-evidence-input.js';
import { runRecordedTextDualChannelConformance } from '../model-supply/provider-conformance/text/dual-channel.js';
import {
  assertDualChannelActivationPublishable,
  evaluateMultiChannelPublishGate,
} from './publish-gate.js';
import {
  runStory30RecordedChain,
  runStory30TriModalRecorded,
} from './story30-recorded-chain.js';

// ---------------------------------------------------------------------------
// Gate 1 (core half): inventory honest status coverage (no silent missing rows)
// ---------------------------------------------------------------------------

test('Z2-ACCEPT gate1: capability inventory has honest status + drilldown on every row', () => {
  assert.ok(CAPABILITY_INVENTORY.items.length >= 13);
  for (const item of CAPABILITY_INVENTORY.items) {
    assert.ok(item.id.length > 0, 'id required');
    assert.ok(item.purpose.length > 0, `${item.id} purpose`);
    assert.ok(item.owner.length > 0, `${item.id} owner`);
    assert.ok(item.drilldownKey.length > 0, `${item.id} drilldown`);
    assert.ok(
      [
        'instrumented',
        'stub',
        'not_instrumented',
        'not_in_scope_for_supply_v1',
      ].includes(item.status),
      `${item.id} status must be honest, got ${item.status}`,
    );
  }
  const audio = CAPABILITY_INVENTORY.items.find(
    (item) => item.id === 'generation_audio',
  );
  assert.ok(audio);
  assert.equal(audio.status, 'not_in_scope_for_supply_v1');
});

// ---------------------------------------------------------------------------
// Gate 2: tri-modal dual-channel recorded story 30 chain
// ---------------------------------------------------------------------------

test('Z2-ACCEPT gate2: story 30 recorded chain passes for text modality', async () => {
  const result = await runStory30RecordedChain('llm');
  assert.equal(result.operation, 'copy.generate');
  assert.equal(result.passed, true, JSON.stringify(result.steps, null, 2));
  assert.equal(result.dualChannelReady, true);
  assert.equal(result.multiChannelPublishAllowed, true);
  const stepIds = result.steps.map((s) => s.step);
  assert.deepEqual(stepIds, [
    'procurement',
    'credential',
    'conformance',
    'publish',
    'allocate',
    'task_ledger',
    'audit',
  ]);
});

test('Z2-ACCEPT gate2: story 30 recorded chain passes for image modality', async () => {
  const result = await runStory30RecordedChain('image');
  assert.equal(result.operation, 'image.generate');
  assert.equal(result.passed, true, JSON.stringify(result.steps, null, 2));
  assert.equal(result.dualChannelReady, true);
  assert.equal(result.multiChannelPublishAllowed, true);
});

test('Z2-ACCEPT gate2: story 30 recorded chain passes for video modality', async () => {
  const result = await runStory30RecordedChain('video');
  assert.equal(result.operation, 'video.generate');
  assert.equal(result.passed, true, JSON.stringify(result.steps, null, 2));
  assert.equal(result.dualChannelReady, true);
  assert.equal(result.multiChannelPublishAllowed, true);
});

test('Z2-ACCEPT gate2: tri-modal recorded suite all green', async () => {
  const suite = await runStory30TriModalRecorded();
  assert.equal(suite.results.length, 3);
  assert.equal(suite.allPassed, true);
  const ops = suite.results.map((r) => r.operation).sort();
  assert.deepEqual(ops, [
    'copy.generate',
    'image.generate',
    'video.generate',
  ]);
});

// ---------------------------------------------------------------------------
// Gate 3: publish gate — <2 qualified Deployments cannot mark multi-channel ready
// ---------------------------------------------------------------------------

test('Z2-ACCEPT gate3: multi_channel_ready rejected with fewer than 2 fault domains', () => {
  const rejected = evaluateMultiChannelPublishGate({
    operation: 'copy.generate',
    catalogModelId: 'model-text-seed',
    claim: 'multi_channel_ready',
    qualifiedDeployments: [
      {
        deploymentId: 'dep-only',
        channelKind: 'official_direct',
        faultDomainKey: 'provider-ark::official_direct',
        activationStatus: 'recorded',
      },
    ],
  });
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.independentFaultDomainCount, 1);
  assert.equal(rejected.requiresNoFallbackLabel, true);
  assert.match(rejected.surfaceLabel, /单渠道|无回退/);
  assert.equal(rejected.honestClaim, 'single_channel');
});

test('Z2-ACCEPT gate3: multi_channel_ready accepted with ≥2 independent fault domains', () => {
  const accepted = evaluateMultiChannelPublishGate({
    operation: 'image.generate',
    catalogModelId: 'model-image-seedream',
    claim: 'multi_channel_ready',
    qualifiedDeployments: [
      {
        deploymentId: 'dep-ark',
        channelKind: 'official_direct',
        faultDomainKey: 'provider-ark::official_direct',
        activationStatus: 'live_verified',
      },
      {
        deploymentId: 'dep-tuzi',
        channelKind: 'upstream_reseller',
        faultDomainKey: 'provider-tuzi::upstream_reseller',
        activationStatus: 'recorded',
      },
    ],
  });
  assert.equal(accepted.allowed, true);
  assert.ok(accepted.independentFaultDomainCount >= 2);
  assert.equal(accepted.requiresNoFallbackLabel, false);
  assert.equal(accepted.honestClaim, 'multi_channel_ready');
});

test('Z2-ACCEPT gate3: unhealthy / none activation deployments do not count as qualified', () => {
  const result = evaluateMultiChannelPublishGate({
    operation: 'video.generate',
    catalogModelId: 'model-video',
    claim: 'multi_channel_ready',
    qualifiedDeployments: [
      {
        deploymentId: 'dep-a',
        channelKind: 'official_direct',
        faultDomainKey: 'p-a::official_direct',
        activationStatus: 'live_verified',
        healthy: false,
      },
      {
        deploymentId: 'dep-b',
        channelKind: 'upstream_reseller',
        faultDomainKey: 'p-b::upstream_reseller',
        activationStatus: 'documented',
      },
      {
        deploymentId: 'dep-c',
        channelKind: 'official_direct',
        faultDomainKey: 'p-c::official_direct',
        activationStatus: 'recorded',
      },
    ],
  });
  assert.equal(result.allowed, false);
  assert.equal(result.qualifiedCount, 1);
  assert.equal(result.honestClaim, 'single_channel');
});

test('Z2-ACCEPT gate3: single-channel claim is allowed and labeled no-fallback', () => {
  const result = evaluateMultiChannelPublishGate({
    operation: 'image.generate',
    catalogModelId: 'model-image-single',
    claim: 'single_channel',
    qualifiedDeployments: [
      {
        deploymentId: 'dep-openai',
        channelKind: 'official_direct',
        faultDomainKey: 'provider-openai::official_direct',
        activationStatus: 'recorded',
      },
    ],
  });
  assert.equal(result.allowed, true);
  assert.equal(result.requiresNoFallbackLabel, true);
  assert.match(result.surfaceLabel, /单渠道|无回退/);
});

test('Z2-ACCEPT gate3: dual-channel activation evidence feeds publish gate', async () => {
  const dual = await runRecordedTextDualChannelConformance({
    operation: 'copy.generate',
  });
  assert.equal(dual.dualChannelReady, true);
  assert.equal(dualChannelActivationGateReady(dual.activationEvidenceInputs), true);

  const recorded = assertDualChannelActivationPublishable(
    dual.activationEvidenceInputs,
  );
  assert.equal(recorded.ready, true);

  // Live-verified is env-gated — recorded suite must not claim live readiness.
  const live = assertDualChannelActivationPublishable(
    dual.activationEvidenceInputs,
    { requireLiveVerified: true },
  );
  assert.equal(live.ready, false);
  assert.match(live.reason, /live_verified|env-gated/i);
});
