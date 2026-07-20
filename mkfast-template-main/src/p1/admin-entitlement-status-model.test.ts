import assert from 'node:assert/strict';
import test from 'node:test';

import {
  allocationStatusLabel,
  buildEntitlementStatusView,
  entitlementPolicyStageLabel,
} from './admin-entitlement-status-model';

test('entitlement status surfaces policies, allocations, pools', () => {
  const view = buildEntitlementStatusView();
  assert.ok(view.policies.length >= 2);
  assert.ok(view.allocations.length >= 1);
  assert.ok(view.pools.length >= 1);
  assert.ok(view.publishedPolicyCount >= 1);
  assert.ok(view.activeAllocationCount >= 1);
  assert.match(view.dualTruthNote, /产品侧|上游/);
});

test('pool projection carries revision and capacity without upstream secrets', () => {
  const view = buildEntitlementStatusView();
  const pool = view.pools[0];
  assert.ok(pool.revisionId.length > 0);
  assert.ok(pool.deploymentCount >= 1);
  assert.ok(
    pool.status === 'healthy' ||
      pool.status === 'constrained' ||
      pool.status === 'unknown',
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
});
