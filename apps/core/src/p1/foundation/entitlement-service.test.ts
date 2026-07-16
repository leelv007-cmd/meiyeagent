import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { P1ApplicationService } from './application-service.js';
import {
  ProductEntitlementApplicationService,
  RecordedAutoTopUpPaymentPort,
} from './entitlement-service.js';
import { MemoryFoundationRepository } from './memory-repository.js';

const owner = {
  workspaceId: 'workspace-entitlement',
  userId: 'owner-entitlement',
  correlationId: 'corr-entitlement',
};

const growth = {
  revision: 'growth-2026-07',
  tier: 'growth' as const,
  periodId: '2026-07',
  periodStartsAt: '2026-07-01T00:00:00.000Z',
  periodEndsAt: '2026-08-01T00:00:00.000Z',
  allowance: { audio: 0, copy: 10, image: 4, video: 2 },
  concurrencyLimit: 2,
  queuePriority: 20,
  supportLabel: 'standard' as const,
};

const pro = {
  ...growth,
  revision: 'pro-2026-07',
  tier: 'pro' as const,
  allowance: { audio: 0, copy: 30, image: 12, video: 6 },
  concurrencyLimit: 6,
  queuePriority: 80,
  supportLabel: 'priority' as const,
};

function services() {
  const repository = new MemoryFoundationRepository();
  repository.grantOwner(owner.workspaceId, owner.userId);
  const foundation = new P1ApplicationService(repository);
  const payments = new RecordedAutoTopUpPaymentPort();
  const entitlements = new ProductEntitlementApplicationService(
    repository,
    payments,
  );
  return { entitlements, foundation, payments, repository };
}

describe('ProductEntitlementApplicationService', () => {
  it('projects Growth/Pro capacity, an image bucket and idempotent paid add-ons from append-only facts', async () => {
    const { entitlements } = services();

    await entitlements.activatePlan(
      owner,
      { paymentEventId: 'payment-growth', policy: growth },
      'activate-growth',
    );
    await entitlements.activatePlan(
      owner,
      { paymentEventId: 'payment-growth', policy: growth },
      'activate-growth-replayed-with-another-command-key',
    );
    const upgraded = await entitlements.activatePlan(
      owner,
      { paymentEventId: 'payment-pro', policy: pro },
      'upgrade-pro',
    );

    assert.equal(upgraded.plan?.tier, 'pro');
    assert.equal(upgraded.concurrencyLimit, 6);
    assert.equal(upgraded.queuePriority, 80);
    assert.equal(upgraded.supportLabel, 'priority');
    assert.deepEqual(await entitlements.resolve(owner.workspaceId), {
      addOns: [],
      allowance: pro.allowance,
      autoTopUp: {
        enabled: false,
        monthlyCapMicros: 0,
        spentThisMonthMicros: 0,
      },
      concurrencyLimit: pro.concurrencyLimit,
      queuePriority: pro.queuePriority,
      revision: pro.revision,
      supportLabel: pro.supportLabel,
      tier: pro.tier,
    });
    assert.equal(upgraded.usage.copy.allowance, 30);
    assert.equal(upgraded.usage.image.allowance, 12);
    assert.equal(upgraded.usage.video.allowance, 6);

    const addOn = {
      paymentEventId: 'payment-image-addon',
      purchaseId: 'image-addon-1',
      resource: 'image' as const,
      quantity: 8,
      amountMicros: 4_900_000,
      currency: 'CNY',
    };
    await entitlements.recordAddOnPurchase(owner, addOn, 'buy-image-addon');
    const replay = await entitlements.recordAddOnPurchase(
      owner,
      addOn,
      'duplicate-payment-webhook',
    );

    assert.equal(replay.usage.image.allowance, 20);
    assert.equal(replay.addOns.image, 8);
    assert.equal(replay.addOnPurchases.length, 1);
  });

  it('reconciles the first activated plan with a model-ledger opening without swallowing add-ons or manual adjustments', async () => {
    const { entitlements, foundation } = services();
    await foundation.appendUsageEvent(
      owner,
      {
        id: 'model-opening-copy',
        resource: 'copy',
        action: 'adjust',
        amount: 35,
        reason:
          'plan_opening:starter:starter-bootstrap;plan_allowance=30;addons=copy-addon;addon_quantity=5',
      },
      'model-opening-copy',
    );
    await foundation.appendUsageEvent(
      owner,
      {
        id: 'manual-copy-adjustment',
        resource: 'copy',
        action: 'adjust',
        amount: 7,
        reason: 'manual support adjustment',
      },
      'manual-copy-adjustment',
    );

    const activated = await entitlements.activatePlan(
      owner,
      {
        paymentEventId: 'payment-growth-after-opening',
        policy: {
          ...growth,
          allowance: { ...growth.allowance, copy: 100 },
        },
      },
      'activate-growth-after-opening',
    );

    assert.equal(activated.usage.copy.allowance, 112);
    assert.equal(activated.usage.image.allowance, 4);
    assert.equal(activated.usage.video.allowance, 2);
  });

  it('refreshes consumed plan allowance across periods without stacking the prior plan', async () => {
    const { entitlements, foundation } = services();
    await entitlements.activatePlan(
      owner,
      { paymentEventId: 'payment-growth-july', policy: growth },
      'activate-growth-july',
    );
    await foundation.appendUsageEvent(
      owner,
      {
        id: 'july-copy-reserve',
        resource: 'copy',
        action: 'reserve',
        amount: 8,
        reservationId: 'july-copy-reservation',
        reason: 'July delivered copy',
      },
      'july-copy-reserve',
    );
    await foundation.appendUsageEvent(
      owner,
      {
        id: 'july-copy-commit',
        resource: 'copy',
        action: 'commit',
        amount: 8,
        reservationId: 'july-copy-reservation',
        reason: 'July delivered copy committed',
      },
      'july-copy-commit',
    );
    assert.equal((await entitlements.getProjection(owner)).usage.copy.available, 2);

    const august = await entitlements.activatePlan(
      owner,
      {
        paymentEventId: 'payment-growth-august',
        policy: {
          ...growth,
          revision: 'growth-2026-08',
          periodId: '2026-08',
          periodStartsAt: '2026-08-01T00:00:00.000Z',
          periodEndsAt: '2026-09-01T00:00:00.000Z',
        },
      },
      'activate-growth-august',
    );

    assert.equal(august.usage.copy.available, 10);
  });

  it('preserves unused composite add-on capacity when a plan period refreshes', async () => {
    const { entitlements, foundation } = services();
    await foundation.appendUsageEvent(
      owner,
      {
        id: 'composite-opening-copy',
        resource: 'copy',
        action: 'adjust',
        amount: 15,
        reason:
          'plan_opening:growth:growth-2026-07;plan_allowance=10;addons=copy-addon;addon_quantity=5',
      },
      'composite-opening-copy',
    );
    await entitlements.activatePlan(
      owner,
      { paymentEventId: 'payment-composite-july', policy: growth },
      'activate-composite-july',
    );
    await foundation.appendUsageEvent(
      owner,
      {
        id: 'composite-copy-reserve',
        resource: 'copy',
        action: 'reserve',
        amount: 12,
        reservationId: 'composite-copy-reservation',
        reason: 'Composite delivered copy',
      },
      'composite-copy-reserve',
    );
    await foundation.appendUsageEvent(
      owner,
      {
        id: 'composite-copy-commit',
        resource: 'copy',
        action: 'commit',
        amount: 12,
        reservationId: 'composite-copy-reservation',
        reason: 'Composite delivered copy committed',
      },
      'composite-copy-commit',
    );

    const august = await entitlements.activatePlan(
      owner,
      {
        paymentEventId: 'payment-composite-august',
        policy: {
          ...growth,
          revision: 'growth-2026-08-composite',
          periodId: '2026-08',
          periodStartsAt: '2026-08-01T00:00:00.000Z',
          periodEndsAt: '2026-09-01T00:00:00.000Z',
        },
      },
      'activate-composite-august',
    );

    assert.equal(august.usage.copy.available, 13);
  });

  it('uses an owner-configured monthly cap for idempotent automatic top-up', async () => {
    const { entitlements, foundation, payments } = services();
    await entitlements.activatePlan(
      owner,
      {
        paymentEventId: 'payment-small-plan',
        policy: {
          ...growth,
          allowance: { audio: 0, copy: 1, image: 1, video: 1 },
        },
      },
      'activate-small-plan',
    );
    await foundation.appendUsageEvent(
      owner,
      {
        id: 'copy-reserve',
        resource: 'copy',
        action: 'reserve',
        amount: 1,
        reservationId: 'copy-reservation',
        reason: 'test output',
      },
      'copy-reserve',
    );
    await foundation.appendUsageEvent(
      owner,
      {
        id: 'copy-commit',
        resource: 'copy',
        action: 'commit',
        amount: 1,
        reservationId: 'copy-reservation',
        reason: 'test output delivered',
      },
      'copy-commit',
    );
    await entitlements.configureAutoTopUp(
      owner,
      {
        enabled: true,
        monthlyCapMicros: 5_000_000,
        packages: {
          copy: { quantity: 5, amountMicros: 2_000_000, currency: 'CNY' },
        },
      },
      'configure-auto-top-up',
    );

    const toppedUp = await entitlements.autoTopUp(
      owner,
      { resource: 'copy', requiredAvailable: 1, month: '2026-07' },
      'auto-top-up-copy',
    );
    const replay = await entitlements.autoTopUp(
      owner,
      { resource: 'copy', requiredAvailable: 1, month: '2026-07' },
      'auto-top-up-copy',
    );

    assert.equal(toppedUp.usage.copy.available, 5);
    assert.deepEqual(replay, toppedUp);
    assert.equal(toppedUp.autoTopUp.spentThisMonthMicros, 2_000_000);
    assert.equal(payments.charges().length, 1);

    await assert.rejects(
      entitlements.recordAutoTopUpPurchase(
        owner,
        {
          paymentEventId: 'payment-over-cap',
          purchaseId: 'auto-over-cap',
          resource: 'copy',
          quantity: 10,
          amountMicros: 4_000_000,
          currency: 'CNY',
          month: '2026-07',
        },
        'record-over-cap',
      ),
      /monthly cap/i,
    );
  });

  it('serializes concurrent automatic top-ups before accepting payment or exceeding the monthly cap', async () => {
    const { entitlements, foundation, payments, repository } = services();
    await entitlements.activatePlan(
      owner,
      {
        paymentEventId: 'payment-concurrent-plan',
        policy: {
          ...growth,
          allowance: { audio: 0, copy: 1, image: 1, video: 1 },
        },
      },
      'activate-concurrent-plan',
    );
    await foundation.appendUsageEvent(
      owner,
      {
        id: 'concurrent-copy-reserve',
        resource: 'copy',
        action: 'reserve',
        amount: 1,
        reservationId: 'concurrent-copy-reservation',
        reason: 'test output',
      },
      'concurrent-copy-reserve',
    );
    await foundation.appendUsageEvent(
      owner,
      {
        id: 'concurrent-copy-commit',
        resource: 'copy',
        action: 'commit',
        amount: 1,
        reservationId: 'concurrent-copy-reservation',
        reason: 'test output delivered',
      },
      'concurrent-copy-commit',
    );
    await foundation.appendUsageEvent(
      owner,
      {
        id: 'concurrent-image-reserve',
        resource: 'image',
        action: 'reserve',
        amount: 1,
        reservationId: 'concurrent-image-reservation',
        reason: 'test output',
      },
      'concurrent-image-reserve',
    );
    await foundation.appendUsageEvent(
      owner,
      {
        id: 'concurrent-image-commit',
        resource: 'image',
        action: 'commit',
        amount: 1,
        reservationId: 'concurrent-image-reservation',
        reason: 'test output delivered',
      },
      'concurrent-image-commit',
    );
    await entitlements.configureAutoTopUp(
      owner,
      {
        enabled: true,
        monthlyCapMicros: 2_000_000,
        packages: {
          copy: { quantity: 5, amountMicros: 2_000_000, currency: 'CNY' },
          image: { quantity: 5, amountMicros: 2_000_000, currency: 'CNY' },
        },
      },
      'configure-concurrent-auto-top-up',
    );

    const results = await Promise.allSettled([
      entitlements.autoTopUp(
        owner,
        { resource: 'copy', requiredAvailable: 1, month: '2026-07' },
        'concurrent-auto-top-up-a',
      ),
      entitlements.autoTopUp(
        owner,
        { resource: 'image', requiredAvailable: 1, month: '2026-07' },
        'concurrent-auto-top-up-b',
      ),
    ]);

    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
    assert.equal(payments.charges().length, 1);
    const events = await repository.listProductEntitlementEvents(
      owner.workspaceId,
    );
    assert.equal(
      events.filter((event) => event.kind === 'auto_top_up_purchased').length,
      1,
    );
    const projection = await entitlements.getProjection(owner, '2026-07');
    assert.equal(projection.autoTopUp.spentThisMonthMicros, 2_000_000);
  });

  it('keeps a durable pending payment without granting usage when settlement fails, then recovers exactly once', async () => {
    const { entitlements, foundation, payments, repository } = services();
    await entitlements.activatePlan(
      owner,
      {
        paymentEventId: 'payment-recovery-plan',
        policy: {
          ...growth,
          allowance: { audio: 0, copy: 1, image: 1, video: 1 },
        },
      },
      'activate-recovery-plan',
    );
    await foundation.appendUsageEvent(
      owner,
      {
        id: 'recovery-copy-reserve',
        resource: 'copy',
        action: 'reserve',
        amount: 1,
        reservationId: 'recovery-copy-reservation',
        reason: 'test output',
      },
      'recovery-copy-reserve',
    );
    await foundation.appendUsageEvent(
      owner,
      {
        id: 'recovery-copy-commit',
        resource: 'copy',
        action: 'commit',
        amount: 1,
        reservationId: 'recovery-copy-reservation',
        reason: 'test output delivered',
      },
      'recovery-copy-commit',
    );
    await entitlements.configureAutoTopUp(
      owner,
      {
        enabled: true,
        monthlyCapMicros: 2_000_000,
        packages: {
          copy: { quantity: 5, amountMicros: 2_000_000, currency: 'CNY' },
        },
      },
      'configure-recovery-auto-top-up',
    );
    payments.failNextSettlement();

    await assert.rejects(
      entitlements.autoTopUp(
        owner,
        { resource: 'copy', requiredAvailable: 1, month: '2026-07' },
        'recoverable-auto-top-up',
      ),
      /settlement unavailable/,
    );
    assert.equal((await entitlements.getProjection(owner)).usage.copy.available, 0);
    assert.equal(payments.charges().length, 0);
    const pending = await repository.listProductEntitlementEvents(
      owner.workspaceId,
    );
    assert.equal(
      pending.filter((event) => event.kind === 'auto_top_up_pending').length,
      1,
    );
    assert.equal(
      pending.filter((event) => event.kind === 'auto_top_up_purchased').length,
      0,
    );

    const restartedPayments = new RecordedAutoTopUpPaymentPort();
    const restartedEntitlements = new ProductEntitlementApplicationService(
      repository,
      restartedPayments,
    );
    const recovered = await restartedEntitlements.autoTopUp(
      owner,
      { resource: 'copy', requiredAvailable: 1, month: '2026-07' },
      'recoverable-auto-top-up',
    );
    const replayed = await restartedEntitlements.autoTopUp(
      owner,
      { resource: 'copy', requiredAvailable: 1, month: '2026-07' },
      'recoverable-auto-top-up',
    );
    assert.equal(recovered.usage.copy.available, 5);
    assert.deepEqual(replayed, recovered);
    assert.equal(restartedPayments.settlements().length, 1);
    const settled = await repository.listProductEntitlementEvents(
      owner.workspaceId,
    );
    assert.equal(
      settled.filter((event) => event.kind === 'auto_top_up_purchased').length,
      1,
    );
  });
});
