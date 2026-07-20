import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { AdminEntitlementStatus } from './admin-entitlement-status';
import { buildEntitlementStatusView } from './admin-entitlement-status-model';

test('SSR renders missing entitlement reporters as unknown instead of zero', () => {
  const html = renderToStaticMarkup(
    <AdminEntitlementStatus view={buildEntitlementStatusView()} />
  );

  assert.match(html, /unknown \(entitlement_policy_reporter_not_wired\)/);
  assert.match(html, /unknown \(account_allocation_reporter_not_wired\)/);
  assert.match(html, /unknown \(supply_pool_snapshot_not_available\)/);
  assert.doesNotMatch(html, /已发布策略 0/);
  assert.doesNotMatch(html, /生效分配 0/);
});

test('SSR renders explicit empty reporters as known zero', () => {
  const html = renderToStaticMarkup(
    <AdminEntitlementStatus
      view={buildEntitlementStatusView({
        allocations: [],
        policies: [],
        pools: [],
      })}
    />
  );

  assert.match(html, /已发布策略 0/);
  assert.match(html, /生效分配 0/);
  assert.match(html, /SupplyPool 0/);
});
