/**
 * R-08 / #211 — the three-state entitlement truth.
 *
 * Four journey situations, one vocabulary: cold start (projection not read),
 * query failure, no entitlement, has entitlement. Only the last one may enter.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRO_STUDIO_ENTITLEMENT_STATES,
  canEnterProStudio,
  proStudioEntitlementReason,
  projectProStudioEntitlement,
  readProStudioEntitlementProjection,
} from './pro-studio-entitlement';

const lockedPayload = {
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
};

const activePayload = {
  activatedAt: '2026-07-16T10:00:00.000Z',
  launchUrl: 'https://canvas.test/launch',
  offerId: 'pro-studio-v1',
  status: 'active',
};

test('the entitlement vocabulary is exactly three states', () => {
  assert.deepEqual(
    [...PRO_STUDIO_ENTITLEMENT_STATES],
    ['unknown', 'locked', 'active']
  );
});

test('cold start — the projection has not been read yet, so the state is unknown', () => {
  const projection = projectProStudioEntitlement({ isPending: true });
  assert.deepEqual(projection, {
    state: 'unknown',
    reason: 'projection_pending',
  });
  assert.equal(canEnterProStudio(projection.state), false);
});

test('a settled query with no data yet is still unknown, never active', () => {
  assert.equal(
    projectProStudioEntitlement({ isPending: false, data: undefined }).state,
    'unknown'
  );
  assert.equal(
    projectProStudioEntitlement({ isPending: false, data: null }).state,
    'unknown'
  );
});

test('query failure reads as unknown, not as "not purchased" and not as active', () => {
  const projection = projectProStudioEntitlement({ isError: true });
  assert.deepEqual(projection, {
    state: 'unknown',
    reason: 'projection_unreachable',
  });
  assert.equal(canEnterProStudio(projection.state), false);
});

test('a payload that does not match the projection contract is unknown', () => {
  for (const payload of [
    {},
    { status: 'enabled' },
    { status: 'active' },
    { status: 'locked', launchUrl: 'https://canvas.test/launch' },
    'active',
  ]) {
    const projection = readProStudioEntitlementProjection(payload);
    assert.equal(projection.state, 'unknown', JSON.stringify(payload));
    assert.equal(canEnterProStudio(projection.state), false);
  }
});

test('no entitlement — the canonical projection says locked and the offer survives', () => {
  const projection = projectProStudioEntitlement({ data: lockedPayload });
  assert.equal(projection.state, 'locked');
  assert.equal(canEnterProStudio(projection.state), false);
  assert.equal(
    projection.state === 'locked' ? projection.offer.priceLabel : null,
    '¥299 一次性'
  );
});

test('has entitlement — the canonical projection says active and entry is granted', () => {
  const projection = projectProStudioEntitlement({ data: activePayload });
  assert.equal(projection.state, 'active');
  assert.equal(canEnterProStudio(projection.state), true);
  assert.equal(
    projection.state === 'active' ? projection.launchUrl : null,
    'https://canvas.test/launch'
  );
  assert.equal(proStudioEntitlementReason(projection), undefined);
});

test('a locked purchase reason speaks merchant language, not engineering codes', () => {
  const reasons = (
    [
      'activation_pending',
      'already_purchased',
      'owner_required',
      'unavailable',
    ] as const
  ).map((purchaseReason) =>
    proStudioEntitlementReason(
      readProStudioEntitlementProjection({
        ...lockedPayload,
        offer: { ...lockedPayload.offer, purchaseReason },
      })
    )
  );
  for (const reason of reasons) {
    assert.ok(reason && reason.length > 0);
    assert.doesNotMatch(reason, /[a-z]+_[a-z]+|projection|entitlement/u);
  }
  // Plain locked (no purchase reason) still explains itself.
  assert.ok(
    proStudioEntitlementReason(
      readProStudioEntitlementProjection(lockedPayload)
    )
  );
  // Unknown explains itself without claiming a verdict either way.
  assert.ok(
    proStudioEntitlementReason({
      state: 'unknown',
      reason: 'projection_unreachable',
    })
  );
});
