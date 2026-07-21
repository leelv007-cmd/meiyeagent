import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDefaultSupplyControlSnapshot } from './admin-supply-fixture';
import {
  ASSOCIATION_VIEW_IDS,
  ASSOCIATION_VIEW_PATHS,
  buildAssociationViewPanel,
  buildSupplyRegistryIndexes,
  isAssociationViewId,
  listAssociationViewReachability,
  projectCounterpartyChannelForward,
  projectCounterpartyChannelReverse,
  projectCredentialForward,
  projectCredentialReverse,
  projectDeploymentForward,
  projectDeploymentReverse,
  projectModelForward,
  projectModelReverse,
  projectRouteForward,
  projectRouteReverse,
} from './admin-supply-association-views-model';

test('five association view ids and paths are stable', () => {
  assert.deepEqual(
    [...ASSOCIATION_VIEW_IDS],
    ['model', 'counterparty-channel', 'deployment', 'credential', 'route']
  );
  const reachability = listAssociationViewReachability();
  assert.equal(reachability.length, 5);
  for (const row of reachability) {
    assert.equal(row.path, ASSOCIATION_VIEW_PATHS[row.viewId]);
    assert.ok(row.path.startsWith('/admin/supply/views/'));
    assert.ok(isAssociationViewId(row.viewId));
  }
});

test('model view forward and reverse', () => {
  const snapshot = buildDefaultSupplyControlSnapshot();
  const indexes = buildSupplyRegistryIndexes(snapshot);
  const forward = projectModelForward(indexes, 'model-text-seed');
  assert.equal(forward.direction, 'forward');
  assert.equal(forward.view, 'model');
  assert.ok(forward.deployments.length >= 2);
  assert.ok(forward.providerProfileIds.includes('provider-ark'));
  assert.ok(forward.executionChannelIds.includes('channel-tuzi-reseller'));

  const reverse = projectModelReverse(indexes, 'dep-text-ark');
  assert.equal(reverse.direction, 'reverse');
  assert.equal(reverse.catalogModelId, 'model-text-seed');
  assert.equal(reverse.model?.id, 'model-text-seed');
});

test('counterparty-channel view forward and reverse', () => {
  const snapshot = buildDefaultSupplyControlSnapshot();
  const indexes = buildSupplyRegistryIndexes(snapshot);
  const forward = projectCounterpartyChannelForward(indexes, 'provider-ark');
  assert.ok(forward.channels.length >= 1);
  assert.ok(forward.deployments.length >= 1);
  assert.ok(forward.affectedCatalogModelIds.includes('model-text-seed'));

  const reverse = projectCounterpartyChannelReverse(
    indexes,
    'channel-tuzi-reseller'
  );
  assert.equal(reverse.provider?.id, 'provider-tuzi');
  assert.ok(reverse.deployments.length >= 1);
});

test('deployment view forward and reverse', () => {
  const snapshot = buildDefaultSupplyControlSnapshot();
  const indexes = buildSupplyRegistryIndexes(snapshot);
  const forward = projectDeploymentForward(indexes, 'dep-image-ark');
  assert.equal(forward.model?.id, 'model-image-seedream');
  assert.equal(forward.provider?.id, 'provider-ark');
  assert.equal(forward.channel?.id, 'channel-ark-direct');

  const reverse = projectDeploymentReverse(
    indexes,
    'model-image-seedream',
    'channel-ark-direct'
  );
  assert.ok(reverse.deployments.some((d) => d.id === 'dep-image-ark'));
});

test('credential view forward and reverse (metadata only)', () => {
  const snapshot = buildDefaultSupplyControlSnapshot();
  const indexes = buildSupplyRegistryIndexes(snapshot);
  const forward = projectCredentialForward(indexes, 'cred-provider-ark');
  assert.equal(forward.metadata?.status, 'active');
  assert.equal(forward.provider?.id, 'provider-ark');
  assert.ok(forward.deployments.length >= 1);
  // Secret material never appears on presentation projection.
  assert.equal(
    (forward.metadata as { secret?: string } | null)?.secret,
    undefined
  );

  const reverse = projectCredentialReverse(indexes, 'provider-tuzi');
  assert.ok(reverse.credentials.some((c) => c.id === 'cred-provider-tuzi'));
});

test('route view forward and reverse', () => {
  const snapshot = buildDefaultSupplyControlSnapshot();
  const indexes = buildSupplyRegistryIndexes(snapshot);
  const forward = projectRouteForward(
    indexes,
    'copy.generate',
    snapshot.routePolicies
  );
  assert.equal(forward.policy?.revisionId, 'route-copy-generate:r3');
  assert.ok(forward.candidateDeployments.length >= 2);

  const reverse = projectRouteReverse(
    indexes,
    'dep-text-ark',
    snapshot.routePolicies
  );
  assert.ok(reverse.operations.includes('copy.generate'));
});

test('buildAssociationViewPanel projects forward+reverse for every view id', () => {
  for (const viewId of ASSOCIATION_VIEW_IDS) {
    const panel = buildAssociationViewPanel(viewId);
    assert.equal(panel.viewId, viewId);
    assert.equal(panel.forward.view, viewId);
    assert.equal(panel.reverse.view, viewId);
    assert.equal(panel.forward.direction, 'forward');
    assert.equal(panel.reverse.direction, 'reverse');
    assert.equal(panel.path, ASSOCIATION_VIEW_PATHS[viewId]);
  }
});
