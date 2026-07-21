import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CanonicalRouteSnapshot } from '@meiye/contracts';
import type { RouteSnapshot as FoundationRouteSnapshot } from './foundation/domain.js';
import type { StrictByokRouteSnapshot } from './integrations/contracts.js';
import type { RouteSnapshot as ModelSupplyRouteSnapshot } from './model-supply/route-contracts.js';
import type { ModelDeployment } from './model-supply/supply-contracts.js';
import {
  fromFoundationRouteSnapshot,
  fromModelSupplyRouteSnapshot,
  fromStrictByokRouteSnapshot,
  modelSupplyCheckpointToFoundationRoute,
  parseCanonicalRouteSnapshot,
  replayCanonicalRouteSnapshot,
  serializeCanonicalRouteSnapshot,
  strictByokLedgerRouteSnapshots,
  toCanonicalRouteSnapshot,
  toFoundationRouteCheckpoint,
} from './route-snapshot-normalize.js';

const CREATED_AT = '2026-07-20T00:00:00.000Z';

function foundationFixture(): FoundationRouteSnapshot {
  return {
    id: 'route-foundation-1',
    workspaceId: 'ws-1',
    catalogRevision: 'catalog-r3',
    policyRevision: 'policy-r2',
    priceRevision: 'price-r4',
    requestedCatalogModelId: 'gpt-image-2',
    selectionMode: 'fixed',
    dataClass: 'public',
    dataClasses: ['public'],
    fallbackConsent: true,
    allowedCandidates: [
      {
        catalogModelId: 'gpt-image-2',
        deploymentId: 'dep-primary',
        region: 'cn',
        credentialMode: 'platform',
        credentialVersion: 'cred-v3',
        executionChannelId: 'ch-cn-direct',
        endpointRevision: 'ep-v1',
        policyRevision: 'policy-r2',
        priceRevision: 'price-r4',
        unitPriceMicros: 1000,
        currency: 'CNY',
        unit: 'image',
        fallbackRank: 1,
      },
      {
        catalogModelId: 'gpt-image-2',
        deploymentId: 'dep-fallback',
        region: 'cn',
        credentialMode: 'platform',
        credentialVersion: 'cred-v3',
        executionChannelId: 'ch-cn-reseller',
        endpointRevision: 'ep-v2',
        policyRevision: 'policy-r2',
        priceRevision: 'price-r4',
        unitPriceMicros: 900,
        currency: 'CNY',
        unit: 'image',
        fallbackRank: 2,
      },
    ],
    retryOwner: 'product',
    providerRetryDisabled: true,
    createdAt: CREATED_AT,
  };
}

function modelSupplyFixture(): ModelSupplyRouteSnapshot {
  return {
    id: 'route-ms-1',
    maxAttempts: 2,
    fallbackAuthorized: true,
    catalogRevisionId: 'catalog-ms-9',
    requestedSelection: {
      mode: 'fixed',
      catalogModelId: 'seedance-pro',
      fallbackConsent: true,
    },
    candidateCatalogModelIds: ['seedance-pro'],
    actualCatalogModelId: 'seedance-pro',
    deploymentId: 'seedance-pro-direct',
    routePolicyRevisionId: 'route-policy-video-v7',
    dataPolicyRevisionId: 'data-policy-video-v3',
    runtimeExclusionReasons: [
      'seedance-pro-retired:health_overlay_blocking',
    ],
    policyRevision: 'policy-video-v1',
    priceRevision: 'price-video-v2',
    credentialMode: 'platform',
    credentialVersion: 'cred-ms-1',
    providerProfileId: 'pp-volc',
    executionChannelId: 'ch-volc-direct',
    providerModel: 'seedance-1.0-pro',
    endpointRevision: 'ep-ms-3',
    fallbackConsent: true,
    allowedCandidates: [
      {
        catalogModelId: 'seedance-pro',
        deploymentId: 'seedance-pro-direct',
        modelModality: 'video',
        modelOperations: ['video.generate'],
        modelDisplayName: 'Seedance Pro',
        modelQualityRank: 10,
        modelManufacturer: 'volcengine',
        modelCapabilities: null,
        providerProfileId: 'pp-volc',
        executionChannelId: 'ch-volc-direct',
        providerModel: 'seedance-1.0-pro',
        endpointRevision: 'ep-ms-3',
        apiCounterparty: 'volcengine',
        credentialOwner: 'platform',
        deploymentLifecycleRevision: 'life-1',
        apiFamily: 'media',
        channel: 'direct',
        region: 'domestic',
        deploymentStatus: 'active',
        allowedDataClasses: ['public'],
        stableModelName: 'seedance-pro',
        modelVersion: '1.0',
        credentialMode: 'platform',
        credentialVersion: 'cred-ms-1',
        accountIdentity: 'account-volc',
        endpointFingerprint: 'endpoint-volc',
        dataPolicyRevisionId: 'data-policy-video-v3',
        policyRevision: 'policy-video-v1',
        priceRevision: 'price-video-v2',
        unitPriceMicros: 50_000,
        currency: 'CNY',
        unit: 'second',
        fallbackRank: 1,
        activationStatus: 'live_verified',
      },
      {
        catalogModelId: 'seedance-pro',
        deploymentId: 'seedance-pro-managed',
        modelModality: 'video',
        modelOperations: ['video.generate'],
        modelDisplayName: 'Seedance Pro',
        modelQualityRank: 10,
        modelManufacturer: 'volcengine',
        modelCapabilities: null,
        providerProfileId: 'pp-gateway',
        executionChannelId: 'ch-gateway',
        providerModel: 'seedance-1.0-pro',
        endpointRevision: 'ep-ms-gw',
        apiCounterparty: 'new-api',
        credentialOwner: 'platform',
        deploymentLifecycleRevision: 'life-1',
        apiFamily: 'media',
        channel: 'managed',
        region: 'domestic',
        deploymentStatus: 'active',
        allowedDataClasses: ['public'],
        stableModelName: 'seedance-pro',
        modelVersion: '1.0',
        credentialMode: 'platform',
        credentialVersion: 'cred-ms-1',
        accountIdentity: 'account-gateway',
        endpointFingerprint: 'endpoint-gateway',
        dataPolicyRevisionId: 'data-policy-video-v4',
        policyRevision: 'policy-video-v1',
        priceRevision: 'price-video-v2',
        unitPriceMicros: 45_000,
        currency: 'CNY',
        unit: 'second',
        fallbackRank: 2,
      },
    ],
    reason: 'fixed_selection',
    dataClass: [],
    createdAt: CREATED_AT,
  };
}

function strictByokFixture(): StrictByokRouteSnapshot {
  return {
    id: 'idem-byok-1:route',
    workspaceId: 'ws-byok',
    endpointProfileId: 'openai-controlled',
    catalogModelId: 'copy-quality',
    credentialMode: 'byok_strict',
    credentialVersion: 7,
    fallbackConsent: false,
  };
}

function assertFrozenEvidenceStable(
  before: CanonicalRouteSnapshot,
  after: CanonicalRouteSnapshot,
) {
  assert.equal(after.id, before.id);
  assert.equal(after.catalogModelId, before.catalogModelId);
  assert.equal(after.deploymentId, before.deploymentId);
  assert.equal(after.actualDeploymentId, before.actualDeploymentId);
  assert.equal(after.credentialAccountVersion, before.credentialAccountVersion);
  assert.equal(after.policyRevisionId, before.policyRevisionId);
  assert.equal(after.priceRevisionId, before.priceRevisionId);
  assert.equal(after.endpointRevisionId, before.endpointRevisionId);
  assert.equal(after.dataPolicyRevisionId, before.dataPolicyRevisionId);
  assert.equal(after.sourceKind, before.sourceKind);
  assert.equal(after.fallbackConsent, before.fallbackConsent);
  assert.equal(after.maxAttempts, before.maxAttempts);
  assert.equal(after.fallbackAuthorized, before.fallbackAuthorized);
  assert.deepEqual(after.fallbackChain, before.fallbackChain);
  assert.deepEqual(after.runtimeExclusionReasons, before.runtimeExclusionReasons);
  assert.deepEqual(
    after.allowedCandidates.map((c) => ({
      catalogModelId: c.catalogModelId,
      deploymentId: c.deploymentId,
      rank: c.rank,
      accountIdentity: c.accountIdentity,
      endpointFingerprint: c.endpointFingerprint,
      dataPolicyRevisionId: c.dataPolicyRevisionId,
      exclusionReasons: c.exclusionReasons,
    })),
    before.allowedCandidates.map((c) => ({
      catalogModelId: c.catalogModelId,
      deploymentId: c.deploymentId,
      rank: c.rank,
      accountIdentity: c.accountIdentity,
      endpointFingerprint: c.endpointFingerprint,
      dataPolicyRevisionId: c.dataPolicyRevisionId,
      exclusionReasons: c.exclusionReasons,
    })),
  );
}

describe('RouteSnapshot four-shape normalization (S2b)', () => {
  it('foundation shape → canonical → serialize → replay keeps candidates/fallback chain', () => {
    const foundation = foundationFixture();
    const canonical = fromFoundationRouteSnapshot(foundation, {
      actualDeploymentId: 'dep-primary',
      sourceKind: 'official_direct',
      runtimeExclusionReasons: ['deployment_inactive:dep-retired'],
    });

    assert.equal(canonical.catalogModelId, 'gpt-image-2');
    assert.equal(canonical.actualDeploymentId, 'dep-primary');
    assert.equal(canonical.policyRevisionId, 'policy-r2');
    assert.equal(canonical.priceRevisionId, 'price-r4');
    assert.equal(canonical.credentialAccountVersion, 'cred-v3');
    assert.equal(canonical.endpointRevisionId, 'ep-v1');
    assert.equal(canonical.sourceKind, 'official_direct');
    assert.equal(canonical.fallbackConsent, true);
    assert.deepEqual(canonical.fallbackChain, ['dep-primary', 'dep-fallback']);
    assert.deepEqual(canonical.runtimeExclusionReasons, [
      'deployment_inactive:dep-retired',
    ]);
    assert.equal(canonical.allowedCandidates.length, 2);
    assert.equal(canonical.allowedCandidates[0]?.rank, 1);
    assert.equal(canonical.allowedCandidates[1]?.rank, 2);

    const replayed = replayCanonicalRouteSnapshot(canonical);
    assertFrozenEvidenceStable(canonical, replayed);
    assert.deepEqual(replayed, parseCanonicalRouteSnapshot(
      serializeCanonicalRouteSnapshot(canonical),
    ));

    // Later revision drift of live sources must not rewrite frozen evidence.
    const driftedLivePolicy = 'policy-r999-live';
    assert.notEqual(replayed.policyRevisionId, driftedLivePolicy);
    assert.equal(replayed.policyRevisionId, 'policy-r2');
  });

  it('model-supply rich shape → canonical preserves rank, sourceKind, and exclusion evidence', () => {
    const modelSupply = modelSupplyFixture();
    const canonical = fromModelSupplyRouteSnapshot(modelSupply);

    assert.equal(canonical.catalogModelId, 'seedance-pro');
    assert.equal(canonical.providerProfileId, 'pp-volc');
    assert.equal(canonical.executionChannelId, 'ch-volc-direct');
    assert.equal(canonical.deploymentId, 'seedance-pro-direct');
    assert.equal(canonical.actualDeploymentId, 'seedance-pro-direct');
    assert.equal(canonical.endpointRevisionId, 'ep-ms-3');
    assert.equal(canonical.policyRevisionId, 'route-policy-video-v7');
    assert.equal(canonical.dataPolicyRevisionId, 'data-policy-video-v3');
    assert.equal(canonical.sourceKind, 'official_direct');
    assert.equal(canonical.fallbackConsent, true);
    assert.equal(canonical.maxAttempts, 2);
    assert.equal(canonical.fallbackAuthorized, true);
    assert.deepEqual(canonical.fallbackChain, [
      'seedance-pro-direct',
      'seedance-pro-managed',
    ]);
    assert.equal(canonical.allowedCandidates[0]?.sourceKind, 'official_direct');
    assert.equal(canonical.allowedCandidates[1]?.sourceKind, 'upstream_reseller');
    assert.equal(canonical.allowedCandidates[0]?.accountIdentity, 'account-volc');
    assert.equal(canonical.allowedCandidates[1]?.accountIdentity, 'account-gateway');
    assert.equal(canonical.allowedCandidates[0]?.endpointFingerprint, 'endpoint-volc');
    assert.equal(canonical.allowedCandidates[1]?.endpointFingerprint, 'endpoint-gateway');
    assert.equal(canonical.allowedCandidates[0]?.dataPolicyRevisionId, 'data-policy-video-v3');
    assert.equal(canonical.allowedCandidates[1]?.dataPolicyRevisionId, 'data-policy-video-v4');
    assert.deepEqual(canonical.runtimeExclusionReasons, [
      'seedance-pro-retired:health_overlay_blocking',
    ]);

    const replayed = replayCanonicalRouteSnapshot(canonical);
    assertFrozenEvidenceStable(canonical, replayed);

    // Round-trip through foundation checkpoint keeps frozen candidate ranks.
    const checkpoint = toFoundationRouteCheckpoint(canonical);
    const back = fromFoundationRouteSnapshot({
      ...checkpoint,
      workspaceId: 'ws-ms',
      createdAt: CREATED_AT,
    });
    assert.deepEqual(
      back.allowedCandidates.map((c) => c.deploymentId),
      ['seedance-pro-direct', 'seedance-pro-managed'],
    );
    assert.deepEqual(back.fallbackChain, [
      'seedance-pro-direct',
      'seedance-pro-managed',
    ]);
    assert.equal(back.maxAttempts, 2);
    assert.equal(back.fallbackAuthorized, true);
    assert.equal(back.allowedCandidates[0]?.accountIdentity, 'account-volc');
    assert.equal(back.allowedCandidates[1]?.accountIdentity, 'account-gateway');
    assert.equal(back.allowedCandidates[0]?.endpointFingerprint, 'endpoint-volc');
    assert.equal(back.allowedCandidates[1]?.endpointFingerprint, 'endpoint-gateway');
    assert.equal(back.allowedCandidates[0]?.dataPolicyRevisionId, 'data-policy-video-v3');
    assert.equal(back.allowedCandidates[1]?.dataPolicyRevisionId, 'data-policy-video-v4');
    // F-S2-03: top-level dataPolicy/sourceKind survive foundation checkpoint round-trip.
    assert.equal(checkpoint.dataPolicyRevisionId, 'data-policy-video-v3');
    assert.equal(checkpoint.sourceKind, 'official_direct');
    assert.equal(back.dataPolicyRevisionId, 'data-policy-video-v3');
    assert.equal(back.sourceKind, 'official_direct');
  });

  it('F-S2-03 foundation top-level dataPolicyRevisionId + sourceKind round-trip', () => {
    const foundation = foundationFixture();
    foundation.dataPolicyRevisionId = 'data-policy-foundation-v1';
    foundation.sourceKind = 'upstream_reseller';

    const canonical = fromFoundationRouteSnapshot(foundation, {
      actualDeploymentId: 'dep-primary',
    });
    assert.equal(canonical.dataPolicyRevisionId, 'data-policy-foundation-v1');
    assert.equal(canonical.sourceKind, 'upstream_reseller');

    const checkpoint = toFoundationRouteCheckpoint(canonical);
    assert.equal(checkpoint.dataPolicyRevisionId, 'data-policy-foundation-v1');
    assert.equal(checkpoint.sourceKind, 'upstream_reseller');

    const back = fromFoundationRouteSnapshot({
      ...checkpoint,
      workspaceId: foundation.workspaceId,
      createdAt: foundation.createdAt,
    });
    assert.equal(back.dataPolicyRevisionId, 'data-policy-foundation-v1');
    assert.equal(back.sourceKind, 'upstream_reseller');

    const replayed = replayCanonicalRouteSnapshot(back);
    assert.equal(replayed.dataPolicyRevisionId, 'data-policy-foundation-v1');
    assert.equal(replayed.sourceKind, 'upstream_reseller');
  });

  it('strict BYOK shape preserves fallbackConsent=false, single candidate, no-fallback chain', () => {
    const byok = strictByokFixture();
    const canonical = fromStrictByokRouteSnapshot(byok, { region: 'global' });

    assert.equal(canonical.fallbackConsent, false);
    assert.equal(canonical.credentialMode, 'byok_strict');
    assert.equal(canonical.allowedCandidates.length, 1);
    assert.equal(
      canonical.allowedCandidates[0]?.deploymentId,
      'byok:openai-controlled:v7',
    );
    assert.deepEqual(canonical.fallbackChain, ['byok:openai-controlled:v7']);
    assert.equal(canonical.endpointProfileId, 'openai-controlled');
    assert.equal(canonical.policyRevisionId, 'byok-strict-no-fallback-v1');

    const replayed = replayCanonicalRouteSnapshot(canonical);
    assertFrozenEvidenceStable(canonical, replayed);
    assert.equal(replayed.fallbackConsent, false);
    assert.equal(replayed.allowedCandidates.length, 1);
    assert.deepEqual(replayed.fallbackChain, ['byok:openai-controlled:v7']);

    // Public + foundation ledger conversion stay aligned.
    const ledger = strictByokLedgerRouteSnapshots({
      idempotencyKey: 'idem-byok-1',
      workspaceId: 'ws-byok',
      endpointProfileId: 'openai-controlled',
      catalogModelId: 'copy-quality',
      credentialVersion: 7,
      region: 'global',
    });
    assert.equal(ledger.publicSnapshot.fallbackConsent, false);
    assert.equal(ledger.foundationCheckpoint.fallbackConsent, false);
    assert.equal(ledger.foundationCheckpoint.allowedCandidates.length, 1);
    assert.equal(
      ledger.foundationCheckpoint.allowedCandidates[0]?.fallbackRank,
      1,
    );
    assert.deepEqual(ledger.canonical.fallbackChain, [
      'byok:openai-controlled:v7',
    ]);
    assert.equal(ledger.canonical.allowedCandidates.length, 1);

    const foundationReplayed = fromFoundationRouteSnapshot({
      ...ledger.foundationCheckpoint,
      workspaceId: 'ws-byok',
      createdAt: CREATED_AT,
    });
    assert.equal(foundationReplayed.fallbackConsent, false);
    assert.equal(foundationReplayed.allowedCandidates.length, 1);
    assert.deepEqual(foundationReplayed.fallbackChain, [
      'byok:openai-controlled:v7',
    ]);
  });

  it('model-supply ledger converter (shape 4) writes foundation via canonical and replays', () => {
    const snapshot = modelSupplyFixture();
    const deployment: ModelDeployment = {
      id: 'seedance-pro-direct',
      catalogModelId: 'seedance-pro',
      providerProfileId: 'pp-volc',
      executionChannelId: 'ch-volc-direct',
      providerModel: 'seedance-1.0-pro',
      endpointRevision: 'ep-ms-3',
      apiFamily: 'media',
      channel: 'direct',
      region: 'domestic',
      status: 'active',
      policyRevision: 'policy-video-v1',
      priceRevision: 'price-video-v2',
      credentialMode: 'platform',
      credentialVersion: 'cred-ms-1',
      unitPrice: {
        amountMicros: 50_000,
        currency: 'CNY',
        unit: 'second',
      },
    };

    const checkpoint = modelSupplyCheckpointToFoundationRoute({
      snapshot,
      model: { id: 'seedance-pro' },
      deployment,
      submission: {
        selection: { mode: 'fixed', catalogModelId: 'seedance-pro' },
        dataClass: [],
      },
      ordinal: 1,
    });
    const fallbackCheckpoint = modelSupplyCheckpointToFoundationRoute({
      snapshot,
      model: { id: 'seedance-pro' },
      deployment: {
        ...deployment,
        id: 'seedance-pro-managed',
        providerProfileId: 'pp-gateway',
        executionChannelId: 'ch-gateway',
        endpointRevision: 'ep-ms-gw',
        channel: 'managed',
      },
      submission: {
        selection: { mode: 'fixed', catalogModelId: 'seedance-pro' },
        dataClass: [],
      },
      ordinal: 2,
    });

    assert.equal(checkpoint.id, 'route-ms-1');
    assert.equal(checkpoint.catalogRevision, 'catalog-ms-9');
    // F-S2-01: ledger prefers routePolicyRevisionId over deployment policyRevision.
    assert.equal(checkpoint.policyRevision, 'route-policy-video-v7');
    assert.equal(checkpoint.priceRevision, 'price-video-v2');
    assert.equal(checkpoint.fallbackConsent, true);
    assert.equal(checkpoint.allowedCandidates.length, 2);
    assert.equal(checkpoint.allowedCandidates[0]?.deploymentId, 'seedance-pro-direct');
    assert.equal(checkpoint.allowedCandidates[0]?.region, 'cn');
    assert.equal(checkpoint.allowedCandidates[0]?.fallbackRank, 1);
    assert.deepEqual(fallbackCheckpoint, checkpoint);

    const canonical = fromFoundationRouteSnapshot({
      ...checkpoint,
      workspaceId: 'ws-ledger',
      createdAt: CREATED_AT,
    });
    const replayed = replayCanonicalRouteSnapshot(canonical);
    assertFrozenEvidenceStable(canonical, replayed);
    assert.deepEqual(replayed.fallbackChain, [
      'seedance-pro-direct',
      'seedance-pro-managed',
    ]);
  });

  it('toCanonicalRouteSnapshot dispatches all three public shapes', () => {
    const foundation = toCanonicalRouteSnapshot({
      kind: 'foundation',
      snapshot: foundationFixture(),
    });
    const modelSupply = toCanonicalRouteSnapshot({
      kind: 'model_supply',
      snapshot: modelSupplyFixture(),
    });
    const byok = toCanonicalRouteSnapshot({
      kind: 'strict_byok',
      snapshot: strictByokFixture(),
      region: 'global',
    });

    assert.equal(foundation.id, 'route-foundation-1');
    assert.equal(modelSupply.id, 'route-ms-1');
    assert.equal(byok.id, 'idem-byok-1:route');
    assert.equal(byok.fallbackConsent, false);
    assert.equal(byok.allowedCandidates.length, 1);
  });

  it('no-fallback foundation snapshot freezes a single-hop chain', () => {
    const foundation = foundationFixture();
    foundation.fallbackConsent = false;
    const canonical = fromFoundationRouteSnapshot(foundation);
    assert.equal(canonical.fallbackConsent, false);
    assert.deepEqual(canonical.fallbackChain, ['dep-primary']);
    const replayed = replayCanonicalRouteSnapshot(canonical);
    assert.deepEqual(replayed.fallbackChain, ['dep-primary']);
  });
});
