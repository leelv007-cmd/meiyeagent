import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { P1ApplicationService } from './application-service.js';
import { REGISTER_GIFT_GRANT_KEY } from './domain.js';
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

function services(clock: () => Date = () => new Date('2026-07-11T00:00:00.000Z')) {
  const repository = new MemoryFoundationRepository();
  repository.grantOwner(owner.workspaceId, owner.userId);
  const foundation = new P1ApplicationService(repository, { clock });
  const payments = new RecordedAutoTopUpPaymentPort();
  const entitlements = new ProductEntitlementApplicationService(
    repository,
    payments,
    clock,
  );
  return { entitlements, foundation, payments, repository, clock };
}

describe('ProductEntitlementApplicationService', () => {
  it('requires fixed_days only for trial policies', async () => {
    const { entitlements } = services();
    await assert.rejects(
      entitlements.activatePlan(
        owner,
        {
          paymentEventId: 'invalid-trial-strategy',
          policy: { ...growth, tier: 'trial' },
        },
        'invalid-trial-strategy'
      ),
      /Trial plans require the fixed_days period strategy/u
    );
    await assert.rejects(
      entitlements.activatePlan(
        owner,
        {
          paymentEventId: 'invalid-paid-strategy',
          policy: { ...growth, periodStrategy: 'fixed_days' },
        },
        'invalid-paid-strategy'
      ),
      /Only trial plans may use the fixed_days period strategy/u
    );
  });

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
      allowedCatalogModelIds: [],
      allowedQualityTiers: ['auto', 'quality', 'balanced'],
      availableSupplyPoolIds: [],
      autoTopUp: {
        enabled: false,
        monthlyCapMicros: 0,
        spentThisMonthMicros: 0,
      },
      concurrencyLimit: pro.concurrencyLimit,
      overage: { mode: 'block' },
      queuePriority: pro.queuePriority,
      revision: pro.revision,
      supportLabel: pro.supportLabel,
      tier: pro.tier,
      validity: {
        validFrom: pro.periodStartsAt,
        validUntil: pro.periodEndsAt,
      },
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

  it('uses the injected clock month for automatic top-up when month is omitted', async () => {
    const { entitlements, foundation, repository } = services(
      () => new Date('2031-02-11T00:00:00.000Z'),
    );
    await entitlements.activatePlan(
      owner,
      {
        paymentEventId: 'payment-clocked-plan',
        policy: {
          ...growth,
          revision: 'growth-2031-02',
          periodId: '2031-02',
          periodStartsAt: '2031-02-01T00:00:00.000Z',
          periodEndsAt: '2031-03-01T00:00:00.000Z',
          allowance: { audio: 0, copy: 1, image: 1, video: 1 },
        },
      },
      'activate-clocked-plan',
    );
    await foundation.appendUsageEvent(
      owner,
      {
        id: 'clocked-copy-reserve',
        resource: 'copy',
        action: 'reserve',
        amount: 1,
        reservationId: 'clocked-copy-reservation',
        reason: 'test output',
      },
      'clocked-copy-reserve',
    );
    await foundation.appendUsageEvent(
      owner,
      {
        id: 'clocked-copy-commit',
        resource: 'copy',
        action: 'commit',
        amount: 1,
        reservationId: 'clocked-copy-reservation',
        reason: 'test output delivered',
      },
      'clocked-copy-commit',
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
      'configure-clocked-auto-top-up',
    );

    await entitlements.autoTopUp(
      owner,
      { resource: 'copy', requiredAvailable: 1 },
      'clocked-auto-top-up',
    );
    const events = await repository.listProductEntitlementEvents(
      owner.workspaceId,
    );
    assert.deepEqual(
      events
        .filter(
          (event) =>
            event.kind === 'auto_top_up_pending' ||
            event.kind === 'auto_top_up_purchased',
        )
        .map((event) => event.month),
      ['2031-02', '2031-02'],
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
    const { clock, entitlements, foundation, payments, repository } = services();
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
      clock,
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

  it('activates a fixed_days trial plan and zeros allowance after periodEndsAt', async () => {
    let now = new Date('2026-07-01T00:00:00.000Z');
    const { entitlements, repository } = services(() => now);
    const trial = {
      revision: 'trial-fixed-7d',
      tier: 'trial' as const,
      periodId: 'fixed-2026-07-01-7d',
      periodStartsAt: '2026-07-01T00:00:00.000Z',
      periodEndsAt: '2026-07-08T00:00:00.000Z',
      periodStrategy: 'fixed_days' as const,
      allowance: { audio: 0, copy: 20, image: 5, video: 2 },
      concurrencyLimit: 1,
      queuePriority: 1,
      supportLabel: 'standard' as const,
    };

    const activated = await entitlements.activatePlan(
      owner,
      {
        paymentEventId: 'payment-trial',
        policy: trial,
        grantKey: REGISTER_GIFT_GRANT_KEY,
      },
      'activate-trial',
    );
    assert.equal(activated.plan?.tier, 'trial');
    assert.equal(activated.usage.copy.allowance, 20);
    assert.deepEqual(await entitlements.resolve(owner.workspaceId), {
      addOns: [],
      allowance: trial.allowance,
      allowedCatalogModelIds: [],
      allowedQualityTiers: ['auto', 'quality', 'balanced'],
      availableSupplyPoolIds: [],
      autoTopUp: {
        enabled: false,
        monthlyCapMicros: 0,
        spentThisMonthMicros: 0,
      },
      concurrencyLimit: 1,
      overage: { mode: 'block' },
      queuePriority: 1,
      revision: trial.revision,
      supportLabel: 'standard',
      tier: 'trial',
      validity: {
        validFrom: trial.periodStartsAt,
        validUntil: trial.periodEndsAt,
      },
    });

    // Advance past periodEndsAt — projection must zero and record plan_expired.
    now = new Date('2026-07-09T00:00:00.000Z');
    const expiredProjection = await entitlements.getProjection(owner);
    assert.equal(expiredProjection.plan, null);
    assert.equal(expiredProjection.usage.copy.allowance, 0);
    assert.equal(await entitlements.resolve(owner.workspaceId), null);

    const after = await repository.listProductEntitlementEvents(
      owner.workspaceId,
    );
    assert.ok(
      after.some((event) => event.kind === 'plan_expired'),
      'plan_expired event must be recorded',
    );
  });

  it('uses the injected clock for every projection path at the plan end boundary', async () => {
    let now = new Date('2026-07-27T00:00:00.000Z');
    const { entitlements, payments } = services(() => now);
    await entitlements.activatePlan(
      owner,
      { paymentEventId: 'boundary-plan', policy: growth },
      'boundary-plan',
    );

    now = new Date('2026-08-01T00:00:00.000Z');
    const addOn = {
      amountMicros: 2_000_000,
      currency: 'CNY',
      paymentEventId: 'boundary-add-on',
      purchaseId: 'boundary-add-on-purchase',
      quantity: 1,
      resource: 'image' as const,
    };
    assert.equal(
      (await entitlements.recordAddOnPurchase(owner, addOn, 'boundary-add-on')).plan,
      null,
    );
    assert.equal(
      (
        await entitlements.recordAddOnPurchase(
          owner,
          addOn,
          'boundary-add-on-replay',
        )
      ).plan,
      null,
    );

    assert.equal(
      (
        await entitlements.configureAutoTopUp(
          owner,
          {
            enabled: true,
            monthlyCapMicros: 10_000_000,
            packages: {
              copy: { quantity: 5, amountMicros: 2_000_000, currency: 'CNY' },
            },
          },
          'boundary-auto-config',
        )
      ).plan,
      null,
    );

    assert.equal(
      (
        await entitlements.autoTopUp(
          owner,
          { resource: 'copy', requiredAvailable: 1, month: '2026-07' },
          'boundary-auto-top-up',
        )
      ).plan,
      null,
    );

    const directPurchase = {
      amountMicros: 2_000_000,
      currency: 'CNY',
      month: '2026-07',
      paymentEventId: 'boundary-direct-auto-payment',
      purchaseId: 'boundary-direct-auto-purchase',
      quantity: 5,
      resource: 'copy' as const,
    };
    assert.equal(
      (
        await entitlements.recordAutoTopUpPurchase(
          owner,
          directPurchase,
          'boundary-direct-auto',
        )
      ).plan,
      null,
    );
    assert.equal(
      (
        await entitlements.recordAutoTopUpPurchase(
          owner,
          directPurchase,
          'boundary-direct-auto-replay',
        )
      ).plan,
      null,
    );
    assert.equal(payments.charges().length, 1);
  });

  it('does not resurrect an older plan after the latest fixed_days plan expires', async () => {
    let now = new Date('2026-07-01T00:00:00.000Z');
    const { entitlements } = services(() => now);
    const starter = {
      ...growth,
      revision: 'starter-long-window',
      tier: 'starter' as const,
      periodEndsAt: '2026-08-01T00:00:00.000Z',
    };
    const trial = {
      ...growth,
      revision: 'trial-latest-window',
      tier: 'trial' as const,
      periodId: 'fixed-2026-07-01-7d',
      periodEndsAt: '2026-07-08T00:00:00.000Z',
      periodStrategy: 'fixed_days' as const,
    };

    await entitlements.activatePlan(
      owner,
      { paymentEventId: 'starter-before-trial', policy: starter },
      'starter-before-trial',
    );
    await entitlements.activatePlan(
      owner,
      {
        paymentEventId: 'latest-trial',
        policy: trial,
        grantKey: REGISTER_GIFT_GRANT_KEY,
      },
      'latest-trial',
    );

    now = new Date('2026-07-09T00:00:00.000Z');
    const projection = await entitlements.getProjection(owner);
    assert.equal(projection.plan, null);
    assert.equal(projection.usage.copy.allowance, 0);
    assert.equal(await entitlements.resolve(owner.workspaceId), null);
  });

  it('preserves paid add-on allowance when the fixed_days trial expires', async () => {
    let now = new Date('2026-07-01T00:00:00.000Z');
    const { entitlements } = services(() => now);
    await entitlements.activatePlan(
      owner,
      {
        grantKey: REGISTER_GIFT_GRANT_KEY,
        paymentEventId: 'trial-before-addon',
        policy: {
          ...growth,
          allowance: { audio: 0, copy: 20, image: 5, video: 2 },
          periodEndsAt: '2026-07-08T00:00:00.000Z',
          periodId: 'fixed-2026-07-01-7d',
          periodStrategy: 'fixed_days',
          revision: 'trial-before-addon',
          tier: 'trial',
        },
      },
      'trial-before-addon',
    );
    await entitlements.recordAddOnPurchase(
      owner,
      {
        amountMicros: 4_900_000,
        currency: 'CNY',
        paymentEventId: 'trial-addon-payment',
        purchaseId: 'trial-addon-image-8',
        quantity: 8,
        resource: 'image',
      },
      'trial-addon-purchase',
    );

    now = new Date('2026-07-09T00:00:00.000Z');
    const projection = await entitlements.getProjection(owner);

    assert.equal(projection.plan, null);
    assert.deepEqual(projection.usage.image, {
      allowance: 8,
      available: 8,
      committed: 0,
      released: 0,
      reserved: 0,
    });
  });

  it('grants full paid availability after a consumed trial expires', async () => {
    let now = new Date('2026-07-01T00:00:00.000Z');
    const { entitlements, foundation, repository } = services(() => now);
    await foundation.appendUsageEvent(
      owner,
      {
        action: 'adjust',
        amount: 20,
        id: 'historical-trial-model-opening',
        reason:
          'plan_opening:trial:historical-trial;plan_allowance=20;addons=none;addon_quantity=0',
        resource: 'copy',
      },
      'historical-trial-model-opening',
    );
    await entitlements.activatePlan(
      owner,
      {
        grantKey: REGISTER_GIFT_GRANT_KEY,
        paymentEventId: 'historical-trial-gift',
        policy: {
          ...growth,
          allowance: { audio: 0, copy: 20, image: 5, video: 2 },
          periodEndsAt: '2026-07-08T00:00:00.000Z',
          periodId: 'fixed-2026-07-01-7d',
          periodStrategy: 'fixed_days',
          revision: 'historical-trial',
          tier: 'trial',
        },
      },
      'historical-trial-gift',
    );
    await repository.appendUsageEvent({
      action: 'reserve',
      actorId: owner.userId,
      amount: 3,
      correlationId: owner.correlationId,
      createdAt: '2026-07-02T00:00:00.000Z',
      id: 'historical-trial-copy-reserve',
      reason: 'Trial delivered copy',
      reservationId: 'historical-trial-copy',
      resource: 'copy',
      workspaceId: owner.workspaceId,
    });
    await repository.appendUsageEvent({
      action: 'commit',
      actorId: owner.userId,
      amount: 3,
      correlationId: owner.correlationId,
      createdAt: '2026-07-02T00:01:00.000Z',
      id: 'historical-trial-copy-commit',
      reason: 'Trial delivered copy committed',
      reservationId: 'historical-trial-copy',
      resource: 'copy',
      workspaceId: owner.workspaceId,
    });

    now = new Date('2026-07-09T00:00:00.000Z');
    const expired = await entitlements.getProjection(owner);
    assert.equal(expired.usage.copy.allowance, 0);
    assert.equal(expired.usage.copy.available, 0);
    assert.equal(expired.usage.copy.committed, 3);
    const paid = await entitlements.activatePlan(
      owner,
      {
        paymentEventId: 'starter-after-expired-trial',
        policy: {
          ...growth,
          allowance: { audio: 0, copy: 30, image: 10, video: 5 },
          periodEndsAt: '2026-08-01T00:00:00.000Z',
          periodId: '2026-07-paid',
          periodStartsAt: '2026-07-09T00:00:00.000Z',
          revision: 'starter-after-expired-trial',
          tier: 'starter',
        },
      },
      'starter-after-expired-trial',
    );

    assert.equal(paid.usage.copy.allowance, 33);
    assert.equal(paid.usage.copy.available, 30);
  });

  it('grants REGISTER_GIFT only once per workspace regardless of paymentEventId', async () => {
    const { entitlements, repository } = services();
    const trial = {
      revision: 'trial-gift',
      tier: 'trial' as const,
      periodId: 'fixed-2026-07-11-7d',
      periodStartsAt: '2026-07-11T00:00:00.000Z',
      periodEndsAt: '2026-07-18T00:00:00.000Z',
      periodStrategy: 'fixed_days' as const,
      allowance: { audio: 0, copy: 20, image: 5, video: 2 },
      concurrencyLimit: 1,
      queuePriority: 1,
      supportLabel: 'standard' as const,
    };

    await entitlements.activatePlan(
      owner,
      {
        paymentEventId: 'gift-payment-1',
        policy: trial,
        grantKey: REGISTER_GIFT_GRANT_KEY,
      },
      'gift-1',
    );
    // Different paymentEventId + command key must not double-grant.
    const second = await entitlements.activatePlan(
      owner,
      {
        paymentEventId: 'gift-payment-2',
        policy: {
          ...trial,
          revision: 'trial-gift-attempt-2',
          allowance: { audio: 0, copy: 999, image: 999, video: 999 },
        },
        grantKey: REGISTER_GIFT_GRANT_KEY,
      },
      'gift-2',
    );
    assert.equal(second.plan?.revision, 'trial-gift');
    assert.equal(second.usage.copy.allowance, 20);
    const events = await repository.listProductEntitlementEvents(
      owner.workspaceId,
    );
    assert.equal(
      events.filter(
        (event) =>
          event.kind === 'plan_activated' &&
          event.grantKey === REGISTER_GIFT_GRANT_KEY,
      ).length,
      1,
    );
    await assert.rejects(
      repository.appendProductEntitlementEvent({
        actorId: owner.userId,
        correlationId: owner.correlationId,
        createdAt: '2026-07-12T00:00:00.000Z',
        grantKey: REGISTER_GIFT_GRANT_KEY,
        id: 'direct-register-gift-bypass',
        kind: 'plan_activated',
        paymentEventId: 'gift-payment-direct-bypass',
        policy: trial,
        workspaceId: owner.workspaceId,
      }),
      /Register gift already activated/iu,
    );
  });
});
