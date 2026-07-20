import assert from 'node:assert/strict';
import test from 'node:test';

import {
  allocationStatusLabel,
  buildEntitlementStatusView,
  entitlementPolicyStageLabel,
} from './admin-entitlement-status-model';
import { buildDefaultSupplyControlSnapshot } from './admin-supply-fixture';

test('missing entitlement reporters stay honestly unknown without production fixtures', () => {
  const view = buildEntitlementStatusView();
  assert.deepEqual(view.policies, []);
  assert.deepEqual(view.allocations, []);
  assert.deepEqual(view.pools, []);
  assert.deepEqual(view.publishedPolicyCount, {
    status: 'unknown',
    reason: 'entitlement_policy_reporter_not_wired',
  });
  assert.deepEqual(view.activeAllocationCount, {
    status: 'unknown',
    reason: 'account_allocation_reporter_not_wired',
  });
  assert.deepEqual(view.supplyPoolCount, {
    status: 'unknown',
    reason: 'supply_pool_snapshot_not_available',
  });
  assert.match(view.dualTruthNote, /产品侧|上游/);
});

test('live supply snapshot projects entitlement policy and allocation reporters as known', () => {
  const snapshot = buildDefaultSupplyControlSnapshot();
  snapshot.entitlementPolicies = [
    {
      id: 'entitlement-policy:growth:r7',
      tier: 'growth',
      revision: 7,
      stage: 'published',
      revisionId: 'entitlement-policy:growth:r7',
      concurrencyLimit: 7,
      queuePriority: 9,
      supportLabel: 'priority',
      allowanceSummary: 'copy=100, image=20',
    },
  ];
  snapshot.accountAllocations = [];

  const view = buildEntitlementStatusView({ snapshot });

  assert.equal(view.policies[0]?.revisionId, 'entitlement-policy:growth:r7');
  assert.deepEqual(view.publishedPolicyCount, { status: 'known', value: 1 });
  assert.deepEqual(view.activeAllocationCount, { status: 'known', value: 0 });
});

test('pool projection carries revision and capacity without upstream secrets', () => {
  const view = buildEntitlementStatusView({
    pools: [
      {
        id: 'pool-live',
        kind: 'shared',
        displayName: 'Live pool',
        credentialAccountIds: ['credential-live'],
        deploymentIds: ['deployment-live'],
        revisionId: 'pool-live:r7',
        capacity: { supplyAccount: { concurrency: 4 } },
      },
    ],
  });
  const pool = view.pools[0];
  assert.ok(pool.revisionId.length > 0);
  assert.ok(pool.deploymentCount >= 1);
  assert.ok(
    pool.status === 'healthy' ||
      pool.status === 'constrained' ||
      pool.status === 'unknown'
  );
  const blob = JSON.stringify(view);
  assert.doesNotMatch(blob, /upstreamToken|providerApiKey|credentialSecret/);
});

test('stage and allocation labels are operator language', () => {
  assert.equal(entitlementPolicyStageLabel('published'), '已发布');
  assert.equal(entitlementPolicyStageLabel('draft'), '草稿');
  assert.equal(allocationStatusLabel('active'), '生效中');
  assert.equal(allocationStatusLabel('expired'), '已过期');
});

test('custom input overrides defaults', () => {
  const view = buildEntitlementStatusView({
    policies: [
      {
        id: 'p1',
        tier: 'enterprise',
        revision: 1,
        stage: 'published',
        revisionId: 'p1:r1',
        concurrencyLimit: 20,
        queuePriority: 90,
        supportLabel: 'priority',
        allowanceSummary: 'unlimited trial',
      },
    ],
    allocations: [],
    pools: [
      {
        id: 'pool-x',
        kind: 'shared',
        displayName: 'X',
        credentialAccountIds: [],
        deploymentIds: ['d1'],
        revisionId: 'pool-x:r1',
      },
    ],
  });
  assert.equal(view.policies.length, 1);
  assert.equal(view.allocations.length, 0);
  assert.equal(view.pools[0].id, 'pool-x');
  assert.equal(view.pools[0].status, 'unknown');
  assert.deepEqual(view.publishedPolicyCount, {
    status: 'known',
    value: 1,
  });
  assert.deepEqual(view.activeAllocationCount, {
    status: 'known',
    value: 0,
  });
  assert.deepEqual(view.supplyPoolCount, {
    status: 'known',
    value: 1,
  });
});
