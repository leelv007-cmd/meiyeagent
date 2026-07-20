import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ENVOY_BASE_EJECTION_TIME_SECONDS,
  ENVOY_CONSECUTIVE_5XX,
  ENVOY_INTERVAL_SECONDS,
  ENVOY_MAX_EJECTION_PERCENT,
  HEALTH_OVERLAY_CONSTANT_PROVENANCE,
  LITELLM_ALLOWED_FAILS,
  LITELLM_COOLDOWN_TIME_SECONDS,
} from './health-overlay-constants.js';
import {
  applyHealthFailureFact,
  healthOverlayIsolationTargetId,
  isHealthOverlayBlocking,
  MemoryHealthOverlayPort,
  resolveHealthOverlayRecord,
} from './health-overlay.js';

test('C6 constants match sourced LiteLLM and Envoy defaults with provenance', () => {
  assert.equal(LITELLM_COOLDOWN_TIME_SECONDS, 5);
  assert.equal(LITELLM_ALLOWED_FAILS, 3);
  assert.equal(ENVOY_CONSECUTIVE_5XX, 5);
  assert.equal(ENVOY_BASE_EJECTION_TIME_SECONDS, 30);
  assert.equal(ENVOY_MAX_EJECTION_PERCENT, 10);
  assert.equal(ENVOY_INTERVAL_SECONDS, 10);

  assert.equal(
    HEALTH_OVERLAY_CONSTANT_PROVENANCE.litellm.upstreamDefaults.cooldown_time,
    LITELLM_COOLDOWN_TIME_SECONDS,
  );
  assert.equal(
    HEALTH_OVERLAY_CONSTANT_PROVENANCE.litellm.upstreamDefaults.allowed_fails,
    LITELLM_ALLOWED_FAILS,
  );
  assert.match(
    HEALTH_OVERLAY_CONSTANT_PROVENANCE.litellm.sourceUrl,
    /github\.com\/BerriAI\/litellm/,
  );
  assert.match(
    HEALTH_OVERLAY_CONSTANT_PROVENANCE.litellm.docsUrl,
    /docs\.litellm\.ai/,
  );
  assert.equal(
    HEALTH_OVERLAY_CONSTANT_PROVENANCE.envoy.upstreamDefaults.consecutive_5xx,
    ENVOY_CONSECUTIVE_5XX,
  );
  assert.equal(
    HEALTH_OVERLAY_CONSTANT_PROVENANCE.envoy.upstreamDefaults
      .base_ejection_time_seconds,
    ENVOY_BASE_EJECTION_TIME_SECONDS,
  );
  assert.match(
    HEALTH_OVERLAY_CONSTANT_PROVENANCE.envoy.sourceUrl,
    /envoyproxy\.io.*outlier_detection/,
  );
});

test('overlay SM: rate_limited enters cooldown for LiteLLM cooldown_time', () => {
  const now = 1_000_000;
  const next = applyHealthFailureFact({
    previous: null,
    fact: {
      targetKind: 'deployment',
      targetId: 'ws:dep:cred',
      kind: 'rate_limited',
      reason: 'rate_limited',
      source: 'adapter',
    },
    nowMs: now,
  });
  assert.equal(next.record.state, 'cooldown');
  assert.equal(
    Date.parse(next.record.endsAt!),
    now + LITELLM_COOLDOWN_TIME_SECONDS * 1000,
  );
  assert.equal(isHealthOverlayBlocking(next.record.state), true);
});

test('overlay SM: consecutive server_error opens circuit at Envoy threshold', () => {
  let stored = null as ReturnType<typeof applyHealthFailureFact> | null;
  const now = 2_000_000;
  for (let i = 0; i < ENVOY_CONSECUTIVE_5XX; i += 1) {
    stored = applyHealthFailureFact({
      previous: stored,
      fact: {
        targetKind: 'deployment',
        targetId: 'dep-a',
        kind: 'server_error',
        reason: '5xx',
        source: 'probe',
      },
      nowMs: now + i,
    });
  }
  assert.equal(stored?.record.state, 'circuit_open');
  assert.equal(
    Date.parse(stored!.record.endsAt!),
    now + (ENVOY_CONSECUTIVE_5XX - 1) + ENVOY_BASE_EJECTION_TIME_SECONDS * 1000,
  );
});

test('overlay SM: degraded does not block new tasks; unavailable does', () => {
  const degraded = applyHealthFailureFact({
    previous: null,
    fact: {
      targetKind: 'execution_channel',
      targetId: 'ch-1',
      kind: 'manual_degraded',
      reason: 'canary',
      source: 'admin',
    },
    nowMs: 0,
  });
  assert.equal(degraded.record.state, 'degraded');
  assert.equal(isHealthOverlayBlocking(degraded.record.state), false);

  const unavailable = applyHealthFailureFact({
    previous: degraded,
    fact: {
      targetKind: 'execution_channel',
      targetId: 'ch-1',
      kind: 'probe_unavailable',
      reason: 'probe_failed',
      source: 'probe',
      auditRef: 'audit-1',
    },
    nowMs: 1,
  });
  assert.equal(unavailable.record.state, 'unavailable');
  assert.equal(unavailable.record.auditRef, 'audit-1');
  assert.equal(isHealthOverlayBlocking(unavailable.record.state), true);
});

test('overlay SM: expired cooldown resolves to healthy without mutating revision', () => {
  const started = 10_000;
  const cooled = applyHealthFailureFact({
    previous: null,
    fact: {
      targetKind: 'deployment',
      targetId: 'dep',
      kind: 'hard_failure',
      reason: 'accepted',
      source: 'gateway_poc',
    },
    nowMs: started,
  });
  const resolved = resolveHealthOverlayRecord(
    cooled.record,
    started + LITELLM_COOLDOWN_TIME_SECONDS * 1000 + 1,
  );
  assert.equal(resolved.state, 'healthy');
  assert.equal(cooled.record.state, 'cooldown');
});

test('MemoryHealthOverlayPort isolates workspace/credential scopes', async () => {
  let now = 50_000;
  const port = new MemoryHealthOverlayPort(() => now);
  const a = healthOverlayIsolationTargetId({
    workspaceId: 'ws-a',
    deploymentId: 'dep-1',
    credentialVersion: 'cred-a',
  });
  const b = healthOverlayIsolationTargetId({
    workspaceId: 'ws-b',
    deploymentId: 'dep-1',
    credentialVersion: 'cred-a',
  });
  await port.reportFact({
    targetKind: 'deployment',
    targetId: a,
    kind: 'rate_limited',
    reason: 'rate_limited',
    source: 'adapter',
  });
  assert.equal((await port.get('deployment', a))?.state, 'cooldown');
  assert.equal(await port.get('deployment', b), null);

  now += LITELLM_COOLDOWN_TIME_SECONDS * 1000 + 1;
  assert.equal((await port.get('deployment', a))?.state, 'healthy');
});

test('success fact clears counters back to healthy', () => {
  const degraded = applyHealthFailureFact({
    previous: null,
    fact: {
      targetKind: 'provider_profile',
      targetId: 'prov',
      kind: 'server_error',
      reason: '5xx',
      source: 'adapter',
    },
    nowMs: 0,
  });
  assert.equal(degraded.record.state, 'degraded');
  const cleared = applyHealthFailureFact({
    previous: degraded,
    fact: {
      targetKind: 'provider_profile',
      targetId: 'prov',
      kind: 'success',
      reason: 'recovered',
      source: 'adapter',
    },
    nowMs: 1,
  });
  assert.equal(cleared.record.state, 'healthy');
  assert.deepEqual(cleared.counters, {
    consecutiveFails: 0,
    consecutive5xx: 0,
  });
});
