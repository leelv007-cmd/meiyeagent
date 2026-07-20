import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDefaultSupplyControlSnapshot } from './admin-supply-fixture';
import {
  buildSupplyOverviewView,
  projectDualChannelCoverage,
  projectOperationReadiness,
} from './admin-supply-overview-model';
import type { SupplyControlSnapshot } from './admin-supply-types';

test('tri-modal operation readiness covers text/image/video', () => {
  const view = buildSupplyOverviewView();
  assert.equal(view.operationReadiness.length, 3);
  const ops = view.operationReadiness.map((r) => r.operation).sort();
  assert.deepEqual(ops, [
    'copy.generate',
    'image.generate',
    'video.generate',
  ]);
  for (const row of view.operationReadiness) {
    assert.ok(row.modalityLabel.length > 0);
    assert.ok(row.label.length > 0);
    assert.ok(row.dualChannel);
  }
});

test('core featured models project multi-channel ready with independent fault domains', () => {
  const snapshot = buildDefaultSupplyControlSnapshot();
  for (const operation of [
    'copy.generate',
    'image.generate',
    'video.generate',
  ] as const) {
    const modelId = snapshot.featuredCoreModelIds[operation]!;
    const coverage = projectDualChannelCoverage({
      operation,
      catalogModelId: modelId,
      snapshot,
    });
    assert.equal(
      coverage.status,
      'multi_channel_ready',
      `${operation} should be multi_channel_ready`,
    );
    assert.equal(coverage.multiChannelReady, true);
    assert.ok(
      coverage.independentFaultDomainCount >= 2,
      `${operation} needs ≥2 fault domains`,
    );
    assert.ok(coverage.qualifiedDeployments.length >= 2);
    // Fixture uses shared ByteDance manufacturer → channel-level only.
    assert.equal(coverage.manufacturerIndependent, false);
    assert.match(coverage.note, /渠道级|制造商/);
  }
});

test('single-channel catalog model is no multi-channel ready', () => {
  const snapshot = buildDefaultSupplyControlSnapshot();
  const coverage = projectDualChannelCoverage({
    operation: 'image.generate',
    catalogModelId: 'model-image-single',
    snapshot,
  });
  assert.equal(coverage.status, 'single_channel');
  assert.equal(coverage.multiChannelReady, false);
  assert.equal(coverage.independentFaultDomainCount, 1);
  assert.match(coverage.label, /单渠道|无回退/);
});

test('missing model projects not_verified', () => {
  const snapshot = buildDefaultSupplyControlSnapshot();
  const coverage = projectDualChannelCoverage({
    operation: 'copy.generate',
    catalogModelId: null,
    snapshot,
  });
  assert.equal(coverage.status, 'not_verified');
  assert.equal(coverage.multiChannelReady, false);
});

test('health cooldown removes deployment from qualified dual-channel set', () => {
  const snapshot = buildDefaultSupplyControlSnapshot();
  // Cool down both text deployments → not_verified / blocked-ish.
  const cooled: SupplyControlSnapshot = {
    ...snapshot,
    healthOverlays: [
      {
        targetId: 'dep-text-ark',
        state: 'cooldown',
        reason: 'test',
        source: 'test',
        startedAt: snapshot.capturedAt,
      },
      {
        targetId: 'dep-text-tuzi',
        state: 'circuit_open',
        reason: 'test',
        source: 'test',
        startedAt: snapshot.capturedAt,
      },
    ],
  };
  const coverage = projectDualChannelCoverage({
    operation: 'copy.generate',
    catalogModelId: 'model-text-seed',
    snapshot: cooled,
  });
  assert.equal(coverage.qualifiedDeployments.length, 0);
  assert.equal(coverage.multiChannelReady, false);
  assert.ok(
    coverage.status === 'not_verified' || coverage.status === 'blocked',
  );
});

test('overview includes six-entity counts, pool/route revisions, lifecycle, audit, gateway deep-link only', () => {
  const view = buildSupplyOverviewView();
  assert.equal(view.sixEntityRelations.catalogModels, 4);
  assert.equal(view.sixEntityRelations.providerProfiles, 3);
  assert.equal(view.sixEntityRelations.deployments, 7);
  assert.ok(view.sixEntityRelations.supplyContracts >= 1);
  assert.ok(view.sixEntityRelations.credentialAccounts >= 1);
  assert.ok(view.sixEntityRelations.executionChannels >= 1);

  assert.ok(view.effectiveRevisions.some((r) => r.kind === 'pool'));
  assert.ok(view.effectiveRevisions.some((r) => r.kind === 'route_policy'));
  assert.ok(view.capacity.length >= 1);
  assert.ok(view.lifecycle.syncAttempts + view.lifecycle.asyncPoll >= 1);
  assert.ok(view.recentChanges.length >= 1);
  assert.equal(view.externalGatewayIsDeepLinkOnly, true);
  for (const link of view.gatewayDeepLinks) {
    assert.equal(link.evidenceOnly, true);
  }
  assert.ok(view.cost.unknownCostRunCount >= 0);
  // Unknown costs must not be painted as zero inventively when runs lack cost.
  if (view.cost.unknownCostRunCount > 0) {
    assert.ok(typeof view.cost.knownRunCostMicros === 'number');
  }
  assert.ok(view.affected.taskIds.length >= 1);
  assert.ok(view.health.blockingCount >= 0);
});

test('operation readiness joins published route policy revision', () => {
  const snapshot = buildDefaultSupplyControlSnapshot();
  const readiness = projectOperationReadiness('copy.generate', snapshot);
  assert.equal(
    readiness.publishedRoutePolicyRevisionId,
    'route-copy-generate:r3',
  );
  assert.ok(readiness.candidateCount >= 2);
  assert.equal(readiness.status, 'multi_channel_ready');
});
