import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dualChannelActivationGateReady,
  toActivationEvidenceInput,
} from '../activation-evidence-input.js';
import {
  gradeMappingConfidence,
  mappingConfidenceMeetsActivationGate,
} from '../mapping-confidence.js';
import { TEXT_ROUTE_ATTEMPT_LIMIT } from '../types.js';
import {
  assertAttemptLimitContract,
  planTextRouteAttempts,
  runRecordedTextDualChannelConformance,
  runTextDualChannelConformance,
  selectTextRouteAttempts,
} from './dual-channel.js';
import {
  dualChannelTextFixtures,
  officialDirectTextFixture,
  upstreamResellerTextFixture,
} from './fixtures.js';
import {
  gatewayFingerprintConsistent,
  normalizeProviderError,
} from './normalize.js';
import { runTextChannelConformance } from './runner.js';

test('normalizeProviderError maps status codes to acceptance + retryable', () => {
  const auth = normalizeProviderError({ statusCode: 401, message: 'nope' });
  assert.equal(auth.acceptance, 'rejected_before_accept');
  assert.equal(auth.errorCode, 'auth_failed');
  assert.equal(auth.retryable, false);

  const rate = normalizeProviderError({ statusCode: 429 });
  assert.equal(rate.acceptance, 'rejected_before_accept');
  assert.equal(rate.errorCode, 'rate_limited');
  assert.equal(rate.retryable, true);

  const five = normalizeProviderError({ statusCode: 503 });
  assert.equal(five.acceptance, 'acceptance_unknown');
  assert.equal(five.errorCode, 'upstream_5xx');
  assert.equal(five.retryable, true);
});

test('gatewayFingerprint is consistent per channel kind', () => {
  assert.equal(
    gatewayFingerprintConsistent({
      channelKind: 'official_direct',
      fingerprint: { product: 'official_native' },
    }),
    true
  );
  assert.equal(
    gatewayFingerprintConsistent({
      channelKind: 'official_direct',
      fingerprint: { product: 'new_api' },
    }),
    false
  );
  assert.equal(
    gatewayFingerprintConsistent({
      channelKind: 'upstream_reseller',
      fingerprint: { product: 'new_api' },
    }),
    true
  );
  assert.equal(
    gatewayFingerprintConsistent({
      channelKind: 'upstream_reseller',
      fingerprint: { product: 'official_native' },
    }),
    false
  );
});

test('mapping confidence grades exact / compatible / inferred / unknown', () => {
  assert.equal(
    gradeMappingConfidence({
      providerModel: 'doubao-seed-2-0-mini-260428',
      catalogModelId: 'llm-doubao-seed-mini',
      catalogStableModelName: 'doubao-seed-2-0-mini-260428',
      channelKind: 'official_direct',
      gatewayFingerprint: { product: 'official_native' },
      declaredAlias: {
        providerModel: 'doubao-seed-2-0-mini-260428',
        catalogModelId: 'llm-doubao-seed-mini',
        mappingRevision: 'map-v1',
      },
    }),
    'exact'
  );

  assert.equal(
    gradeMappingConfidence({
      providerModel: 'gemini-3-flash-preview',
      catalogModelId: 'llm-gemini-flash',
      channelKind: 'upstream_reseller',
      gatewayFingerprint: { product: 'new_api' },
      protocolFamily: 'openai_compatible',
    }),
    'compatible'
  );

  assert.equal(
    gradeMappingConfidence({
      providerModel: 'seed-mini-exp',
      catalogModelId: 'llm-x',
      catalogStableModelName: 'seed-mini',
      channelKind: 'official_direct',
      gatewayFingerprint: { product: 'none' },
    }),
    'inferred'
  );

  assert.equal(
    gradeMappingConfidence({
      providerModel: '',
      catalogModelId: 'llm-x',
      channelKind: 'official_direct',
      gatewayFingerprint: { product: 'none' },
    }),
    'unknown'
  );

  assert.equal(mappingConfidenceMeetsActivationGate('exact'), true);
  assert.equal(mappingConfidenceMeetsActivationGate('inferred'), false);
});

test('两候选 route attempt ceiling is slice(0,2) / attemptLimit:2 — not copy candidates', () => {
  const planned = planTextRouteAttempts([
    { deploymentId: 'a', channelKind: 'official_direct' },
    { deploymentId: 'b', channelKind: 'upstream_reseller' },
    { deploymentId: 'c', channelKind: 'upstream_reseller' },
  ]);
  assert.equal(planned.attemptLimit, 2);
  assert.equal(TEXT_ROUTE_ATTEMPT_LIMIT, 2);
  assert.equal(planned.attempts.length, 2);
  assert.deepEqual(
    planned.attempts.map((attempt) => attempt.deploymentId),
    ['a', 'b']
  );
  assert.deepEqual(selectTextRouteAttempts([1, 2, 3, 4]), [1, 2]);
  // Explicitly not asserting three copy candidates here — different dimension.
});

test('official_direct fixture path passes text channel conformance', async () => {
  const fixture = officialDirectTextFixture();
  const result = await runTextChannelConformance({
    fixture,
    port: fixture.port,
    injectErrorProbe: (scenario) => fixture.setScenario(scenario),
    errorProbeScenario: 'rate_limit_429',
    evidenceKind: 'recorded',
  });
  assert.equal(result.channelKind, 'official_direct');
  assert.equal(result.gatewayFingerprint.product, 'official_native');
  assert.equal(result.passed, true);
  assert.equal(result.mappingConfidence, 'exact');
  assert.ok(result.usage && result.usage.source === 'observed_usage');
  assert.ok(result.protocol?.hasCopyCandidates);
  assert.ok(
    result.checks.every((check) => check.passed),
    result.checks
      .filter((check) => !check.passed)
      .map((check) => check.checkId)
      .join(',')
  );
});

test('upstream_reseller fixture path passes text channel conformance', async () => {
  const fixture = upstreamResellerTextFixture();
  const result = await runTextChannelConformance({
    fixture,
    port: fixture.port,
    injectErrorProbe: (scenario) => fixture.setScenario(scenario),
    errorProbeScenario: 'auth_401',
    evidenceKind: 'recorded',
  });
  assert.equal(result.channelKind, 'upstream_reseller');
  assert.equal(result.gatewayFingerprint.product, 'new_api');
  assert.equal(result.passed, true);
  assert.equal(result.mappingConfidence, 'exact');
  assert.ok(result.normalizedError?.errorCode === 'auth_failed');
  assert.equal(result.normalizedError?.retryable, false);
});

test('recorded dual-channel suite produces activation evidence inputs for publish gates', async () => {
  const dual = await runRecordedTextDualChannelConformance({
    operation: 'copy.generate',
    observedAt: '2026-07-20T12:00:00.000Z',
  });

  assert.equal(dual.attemptLimit, 2);
  assert.equal(dual.channels.length, 2);
  assert.equal(dual.dualChannelReady, true);
  assertAttemptLimitContract(dual);

  const kinds = new Set(dual.channels.map((channel) => channel.channelKind));
  assert.ok(kinds.has('official_direct'));
  assert.ok(kinds.has('upstream_reseller'));

  assert.equal(dual.activationEvidenceInputs.length, 2);
  for (const input of dual.activationEvidenceInputs) {
    assert.equal(input.status, 'recorded');
    assert.ok(input.evidenceRef.startsWith('provider-conformance:'));
    assert.equal(input.conformance.passed, true);
    assert.equal(input.conformance.operation, 'copy.generate');
    assert.ok(input.conformance.checkIds.includes('protocol_completion'));
    assert.ok(input.conformance.checkIds.includes('gateway_fingerprint'));
    assert.ok(input.conformance.checkIds.includes('mapping_confidence'));
    assert.ok(input.conformance.failedCheckIds.length === 0);
  }

  assert.equal(dualChannelActivationGateReady(dual.activationEvidenceInputs), true);
  assert.equal(
    dualChannelActivationGateReady(dual.activationEvidenceInputs, {
      requireLiveVerified: true,
    }),
    false
  );

  const single = toActivationEvidenceInput(dual, dual.channels[0]!);
  assert.equal(single.deploymentId, dual.channels[0]!.deploymentId);
});

test('usage_missing scenario fails usage_evidence check', async () => {
  const fixture = officialDirectTextFixture();
  fixture.setScenario('usage_missing');
  const result = await runTextChannelConformance({
    fixture,
    port: fixture.port,
    // Skip error probe so primary path stays usage_missing.
    evidenceKind: 'recorded',
  });
  // Without inject, error checks are skipped-as-pass for completed path —
  // but usage_missing still fails usage_evidence.
  const usageCheck = result.checks.find(
    (check) => check.checkId === 'usage_evidence'
  );
  assert.ok(usageCheck);
  assert.equal(usageCheck!.passed, false);
  assert.equal(result.passed, false);
});

test('dual-channel run rejects claiming ready when one channel fails', async () => {
  const fixtures = dualChannelTextFixtures();
  // Force reseller success path to fail usage by scenario before run —
  // use a port that always returns failure.
  const alwaysFailPort = {
    async execute() {
      return {
        kind: 'failure' as const,
        acceptance: 'rejected_before_accept' as const,
        errorCode: 'auth_failed',
        retryable: false,
        message: 'forced',
        providerCost: { amount: 0, currency: 'USD' as const, usage: {} },
      };
    },
  };

  const dual = await runTextDualChannelConformance({
    officialDirect: {
      fixture: fixtures.officialDirect,
      port: fixtures.officialDirect.port,
    },
    upstreamReseller: {
      fixture: fixtures.upstreamReseller,
      port: alwaysFailPort,
    },
    runErrorProbes: false,
    evidenceKind: 'recorded',
  });

  assert.equal(dual.dualChannelReady, false);
  assert.equal(dual.channels[0]?.passed, true);
  assert.equal(dual.channels[1]?.passed, false);
  assert.equal(
    dualChannelActivationGateReady(dual.activationEvidenceInputs),
    false
  );
});

test('copy.adapt and text.respond operations are supported by fixtures', async () => {
  for (const operation of ['copy.adapt', 'text.respond'] as const) {
    const fixture = officialDirectTextFixture();
    const result = await runTextChannelConformance({
      fixture,
      port: fixture.port,
      operation,
      injectErrorProbe: (scenario) => fixture.setScenario(scenario),
      errorProbeScenario: 'server_5xx',
    });
    assert.equal(result.passed, true, operation);
    assert.equal(result.operation, operation);
    if (operation === 'copy.adapt') {
      assert.equal(result.protocol?.hasPlatformVariants, true);
    } else {
      assert.equal(result.protocol?.hasText, true);
    }
  }
});
