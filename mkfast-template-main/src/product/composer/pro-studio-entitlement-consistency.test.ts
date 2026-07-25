/**
 * R-08 / #211 — one projection, three consumers, no contradiction.
 *
 * The workbench entry banner, the fullscreen catalog and the route gate all
 * read the same canonical entitlement projection. This pins the journey
 * invariant: an entry that a merchant can see never promises more than the gate
 * will grant, in every one of the four situations.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canEnterProStudio,
  projectProStudioEntitlement,
  proStudioEntitlementReason,
  type ProStudioEntitlementProjection,
} from '@/lib/pro-studio-entitlement';

import { projectProStudioBanner } from './composer-tools';
import { listCatalogItems } from './fullscreen-catalog';

const SCENARIOS: Array<{
  name: string;
  projection: ProStudioEntitlementProjection;
  entersWorkspace: boolean;
}> = [
  {
    name: '冷启动：投影尚未读到',
    projection: projectProStudioEntitlement({ isPending: true }),
    entersWorkspace: false,
  },
  {
    name: '查询失败：投影读不到',
    projection: projectProStudioEntitlement({ isError: true }),
    entersWorkspace: false,
  },
  {
    name: '无权益：投影答 locked',
    projection: projectProStudioEntitlement({
      data: {
        launchUrl: 'https://canvas.test/launch',
        offer: {
          canPurchase: true,
          demoUrl: '/pro-studio#demo',
          description: '无限画布',
          id: 'pro-studio-v1',
          priceLabel: '¥299 一次性',
          purchasePath: '/api/pro-studio/checkout',
        },
        status: 'locked',
      },
    }),
    entersWorkspace: false,
  },
  {
    name: '有权益：投影答 active',
    projection: projectProStudioEntitlement({
      data: {
        activatedAt: '2026-07-16T10:00:00.000Z',
        launchUrl: 'https://canvas.test/launch',
        offerId: 'pro-studio-v1',
        status: 'active',
      },
    }),
    entersWorkspace: true,
  },
];

function catalogProStudioItem(projection: ProStudioEntitlementProjection) {
  const reason = proStudioEntitlementReason(projection);
  const item = listCatalogItems('tools', {
    proStudioStatus: projection.state,
    ...(reason ? { proStudioLockReason: reason } : {}),
  }).find((candidate) => candidate.toolEntryId === 'tool.pro_studio');
  assert.ok(item, 'Pro Studio keeps its catalog entry in every state');
  return item;
}

for (const scenario of SCENARIOS) {
  test(`${scenario.name} — entry presentation matches the gate verdict`, () => {
    const gateGrantsEntry = canEnterProStudio(scenario.projection.state);
    assert.equal(gateGrantsEntry, scenario.entersWorkspace);

    const reason = proStudioEntitlementReason(scenario.projection);
    const banner = projectProStudioBanner({
      viewport: 'desktop',
      proStudioStatus: scenario.projection.state,
      ...(reason ? { proStudioLockReason: reason } : {}),
    });
    assert.ok(banner, 'the frozen Pro Studio entry stays on the workbench');

    // The banner never claims more than the gate grants.
    assert.equal(banner.status, scenario.projection.state);
    assert.equal(banner.canEnter, gateGrantsEntry);
    assert.equal(
      banner.ctaLabel === '进入专业工作区',
      gateGrantsEntry,
      '只有真有权益时才承诺“进入专业工作区”'
    );
    if (!gateGrantsEntry) {
      assert.ok(banner.lockReason, '非 active 必须说明当前状态');
    } else {
      assert.equal(banner.lockReason, undefined);
    }

    // The catalog is the same truth, so the two entries cannot disagree.
    const item = catalogProStudioItem(scenario.projection);
    assert.equal(item.proStudioStatus, scenario.projection.state);
    assert.equal(item.locked, !gateGrantsEntry);
    assert.equal(item.publishedVisible, true, '冻结期入口保留');
    assert.equal(Boolean(item.lockReason), !gateGrantsEntry);
  });
}

test('R-08 regression: an unread projection never renders as active', () => {
  // No entitlement input at all — the situation that used to fall back to the
  // static seed and show "进入专业工作区" before the gate refused it.
  const banner = projectProStudioBanner({ viewport: 'desktop' });
  assert.ok(banner);
  assert.equal(banner.status, 'unknown');
  assert.equal(banner.canEnter, false);
  assert.notEqual(banner.ctaLabel, '进入专业工作区');

  const item = catalogProStudioItem({
    state: 'unknown',
    reason: 'projection_pending',
  });
  assert.equal(item.locked, true);
});

test('the entry always points at the canonical gate, never at Canvas', () => {
  for (const scenario of SCENARIOS) {
    const banner = projectProStudioBanner({
      viewport: 'mobile',
      proStudioStatus: scenario.projection.state,
    });
    assert.equal(banner?.href, '/pro-studio');
  }
});
