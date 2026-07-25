import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MemoryProStudioEntitlementRepository,
  ProStudioEntitlementApplicationService,
} from './entitlement.js';

const owner = {
  userId: 'owner-1',
  workspaceId: 'workspace-1',
  role: 'owner' as const,
  correlationId: 'correlation-1',
};
const operator = {
  ...owner,
  userId: 'operator-1',
  role: 'operator' as const,
};

function service() {
  return new ProStudioEntitlementApplicationService(
    new MemoryProStudioEntitlementRepository(),
    {
      offer: {
        id: 'pro-studio-v1',
        priceLabel: '¥299/月',
        description: '无限画布、精修、TTS/音效与画布 Agent',
        demoUrl: '/pro-studio/demo',
        purchasePath: '/settings/billing/pro-studio',
      },
      billing: {
        async verifyPaidEvent(input) {
          return input.paymentEventId.startsWith('payment-')
            ? {
                status: 'paid' as const,
                eventId: input.paymentEventId,
                offerId: input.offerId,
                workspaceId: input.workspaceId,
              }
            : { status: 'not_paid' as const };
        },
      },
      clock: () => new Date('2026-07-16T10:00:00.000Z'),
    },
  );
}

test('an unpurchased workspace receives a useful introduction instead of a dead link', async () => {
  const entitlements = service();

  assert.deepEqual(await entitlements.getEntry(operator), {
    status: 'locked',
    offer: {
      id: 'pro-studio-v1',
      priceLabel: '¥299/月',
      description: '无限画布、精修、TTS/音效与画布 Agent',
      demoUrl: '/pro-studio/demo',
      purchasePath: '/settings/billing/pro-studio',
      canPurchase: false,
    },
  });
});

test('a cold projection refuses entry — the gate never reads absence as active', async () => {
  const entitlements = service();

  await assert.rejects(
    () => entitlements.assertCanEnter(owner),
    (error: Error & { code?: string }) =>
      error.code === 'PRO_STUDIO_ENTITLEMENT_REQUIRED',
  );
  assert.equal(
    await entitlements.isActionAllowed(owner, 'pro_studio.enter'),
    false,
  );
});

test('only the workspace owner can purchase the add-on', async () => {
  const entitlements = service();

  await assert.rejects(
    entitlements.purchase(operator, {
      offerId: 'pro-studio-v1',
      paymentEventId: 'payment-1',
      idempotencyKey: 'purchase-1',
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'OWNER_REQUIRED',
  );
});

test('purchase unlocks entry and generation immediately for workspace members', async () => {
  const entitlements = service();
  const purchased = await entitlements.purchase(owner, {
    offerId: 'pro-studio-v1',
    paymentEventId: 'payment-1',
    idempotencyKey: 'purchase-1',
  });
  assert.equal(purchased.status, 'active');

  assert.deepEqual(await entitlements.getEntry(operator), {
    status: 'active',
    offerId: 'pro-studio-v1',
    activatedAt: '2026-07-16T10:00:00.000Z',
  });
  await entitlements.assertCanEnter(operator);
  await entitlements.assertCanGenerate(operator);
});

test('a browser supplied payment id cannot unlock without verified billing evidence', async () => {
  const entitlements = service();

  await assert.rejects(
    entitlements.purchase(owner, {
      offerId: 'pro-studio-v1',
      paymentEventId: 'browser-invented-event',
      idempotencyKey: 'purchase-unverified',
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'PAYMENT_NOT_VERIFIED',
  );
  assert.equal(
    await entitlements.isActionAllowed(owner, 'pro_studio.enter'),
    false,
  );
});

test('purchase replay is idempotent and a reused key with another payment conflicts', async () => {
  const entitlements = service();
  const input = {
    offerId: 'pro-studio-v1',
    paymentEventId: 'payment-1',
    idempotencyKey: 'purchase-1',
  };
  const first = await entitlements.purchase(owner, input);
  const replay = await entitlements.purchase(owner, input);
  assert.deepEqual(replay, first);

  await assert.rejects(
    entitlements.purchase(owner, {
      ...input,
      paymentEventId: 'payment-2',
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'IDEMPOTENCY_CONFLICT',
  );
});

test('the add-on gate does not apply to existing Composer actions', async () => {
  const entitlements = service();
  assert.equal(
    await entitlements.isActionAllowed(operator, 'composer.edit'),
    true,
  );
  assert.equal(
    await entitlements.isActionAllowed(operator, 'pro_studio.generate'),
    false,
  );
});
