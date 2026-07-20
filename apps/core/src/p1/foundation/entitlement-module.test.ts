import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { P1ApplicationService } from './application-service.js';
import { ProductEntitlementFoundationModule } from './entitlement-module.js';
import {
  ProductEntitlementApplicationService,
  RecordedAutoTopUpPaymentPort,
} from './entitlement-service.js';
import { MemoryFoundationRepository } from './memory-repository.js';
import { GrantLotAwareProductEntitlementService } from './grant-lot-entitlement-service.js';
import { MemoryGrantLotLedger } from './grant-lot.js';
import {
  AdminConfigEntitlementCatalogSource,
  AdminConfigFoundationModule,
  MemoryAdminConfigRepository,
} from '../admin-config/index.js';

const owner = {
  workspaceId: 'workspace-entitlement-module',
  userId: 'owner-entitlement-module',
  correlationId: 'corr-entitlement-module',
};

function setup(recordedCommerceEnabled = true) {
  const clock = () => new Date('2026-07-11T00:00:00.000Z');
  const repository = new MemoryFoundationRepository();
  repository.grantOwner(owner.workspaceId, owner.userId);
  const entitlements = new ProductEntitlementApplicationService(
    repository,
    new RecordedAutoTopUpPaymentPort(),
    clock,
  );
  return new P1ApplicationService(repository, {
    operations: [
      new ProductEntitlementFoundationModule(entitlements, clock, {
        recordedCommerceEnabled,
      }),
    ],
  });
}

function setupHotCatalog() {
  const clock = () => new Date('2026-07-11T00:00:00.000Z');
  const repository = new MemoryFoundationRepository();
  repository.grantOwner(owner.workspaceId, owner.userId);
  const config = new MemoryAdminConfigRepository();
  const entitlements = new ProductEntitlementApplicationService(
    repository,
    new RecordedAutoTopUpPaymentPort(),
    clock,
  );
  return {
    config,
    service: new P1ApplicationService(repository, {
      operations: [
        new AdminConfigFoundationModule(config),
        new ProductEntitlementFoundationModule(entitlements, clock, {
          catalogSource: new AdminConfigEntitlementCatalogSource(config),
          recordedCommerceEnabled: true,
        }),
      ],
    }),
  };
}

const admin = {
  actor: 'admin' as const,
  correlationId: 'catalog-admin-change',
  userId: 'platform-admin',
  workspaceId: '__global__',
};

async function applyConfig(
  service: P1ApplicationService,
  key: string,
  value: unknown,
  expectedRevision: number | null,
) {
  return service.executeModule(
    admin,
    'admin-config',
    {
      action: 'config_apply',
      payload: {
        expectedRevision,
        key,
        reason: 'Ticket 21 hot catalog test',
        value,
      },
    },
    `apply-${key}-${String(expectedRevision)}`,
  );
}

describe('ProductEntitlementFoundationModule', () => {
  it('defaults historical plan config to zero audio allowance', async () => {
    const { config, service } = setupHotCatalog();
    await config.apply({
      actorId: admin.userId,
      correlationId: admin.correlationId,
      expectedRevision: null,
      key: 'plan.allowances.growth',
      reason: 'historical plan without audio',
      scope: 'global',
      value: {
        allowance: { copy: 100, image: 40, video: 20 },
        concurrencyLimit: 4,
        queuePriority: 5,
        supportLabel: 'priority',
      },
      workspaceId: admin.workspaceId,
    });

    const catalog = (await service.queryModule(owner, 'entitlements', {
      action: 'catalog',
      payload: {},
    })) as { plans: Array<{ id: string; allowance: { audio: number } }> };
    assert.equal(
      catalog.plans.find((plan) => plan.id === 'growth')?.allowance.audio,
      0
    );
  });

  it('hot-reads plan changes for catalog and new checkout without rewriting an activated plan', async () => {
    const { service } = setupHotCatalog();
    await applyConfig(
      service,
      'plan.allowances.growth',
      {
        allowance: { audio: 0, copy: 120, image: 48, video: 24 },
        concurrencyLimit: 5,
        queuePriority: 6,
        supportLabel: 'priority',
      },
      null,
    );

    const catalog = (await service.queryModule(
      owner,
      'entitlements',
      { action: 'catalog', payload: {} },
    )) as { plans: Array<{ id: string; allowance: { copy: number } }> };
    assert.equal(
      catalog.plans.find((plan) => plan.id === 'growth')?.allowance.copy,
      120,
    );

    await service.executeModule(
      owner,
      'entitlements',
      { action: 'checkout_plan', payload: { tier: 'growth' } },
      'checkout-hot-growth',
    );
    await applyConfig(
      service,
      'plan.allowances.growth',
      {
        allowance: { audio: 0, copy: 140, image: 56, video: 28 },
        concurrencyLimit: 6,
        queuePriority: 7,
        supportLabel: 'priority',
      },
      1,
    );
    const projection = (await service.queryModule(
      owner,
      'entitlements',
      { action: 'projection', payload: { month: '2026-07' } },
    )) as { plan: { allowance: { copy: number }; concurrencyLimit: number } };

    assert.equal(projection.plan.allowance.copy, 120);
    assert.equal(projection.plan.concurrencyLimit, 5);
  });

  it('hot-reads add-on price for checkout and automatic top-up configuration', async () => {
    const { service } = setupHotCatalog();
    await applyConfig(
      service,
      'plan.addons',
      [
        {
          amountMicros: 1_290_000,
          currency: 'CNY',
          id: 'copy-20',
          quantity: 20,
          resource: 'copy',
        },
      ],
      null,
    );
    await service.executeModule(
      owner,
      'entitlements',
      { action: 'checkout_add_on', payload: { offerId: 'copy-20' } },
      'checkout-hot-copy-add-on',
    );
    await service.executeModule(
      owner,
      'entitlements',
      {
        action: 'configure_auto_top_up',
        payload: {
          enabled: true,
          monthlyCapMicros: 3_000_000,
          packageOfferIds: { copy: 'copy-20' },
        },
      },
      'configure-hot-copy-auto-top-up',
    );
    await service.executeModule(
      owner,
      'entitlements',
      {
        action: 'auto_top_up',
        payload: { resource: 'copy', requiredAvailable: 25, month: '2026-07' },
      },
      'run-hot-copy-auto-top-up',
    );

    const projection = (await service.queryModule(
      owner,
      'entitlements',
      { action: 'projection', payload: { month: '2026-07' } },
    )) as {
      addOnPurchases: Array<{ amountMicros: number }>;
      autoTopUp: {
        packages: { copy: { amountMicros: number } };
        spentThisMonthMicros: number;
      };
    };
    assert.equal(projection.addOnPurchases[0]?.amountMicros, 1_290_000);
    assert.equal(projection.autoTopUp.packages.copy.amountMicros, 1_290_000);
    assert.equal(projection.autoTopUp.spentThisMonthMicros, 1_290_000);
  });

  it('exposes owner plan/add-on/auto-top-up commands and the projection query', async () => {
    const service = setup();

    await service.executeModule(
      owner,
      'entitlements',
      {
        action: 'checkout_plan',
        payload: {
          tier: 'pro',
        },
      },
      'activate-pro-recorded',
    );
    await service.executeModule(
      owner,
      'entitlements',
      {
        action: 'checkout_add_on',
        payload: {
          offerId: 'image-10',
        },
      },
      'purchase-image-recorded',
    );
    await service.executeModule(
      owner,
      'entitlements',
      {
        action: 'configure_auto_top_up',
        payload: {
          enabled: true,
          monthlyCapMicros: 3_000_000,
          packageOfferIds: { image: 'image-10' },
        },
      },
      'configure-image-auto-top-up',
    );

    const projection = await service.queryModule<
      { action: string; payload: { month: string } },
      {
        plan: { tier: string };
        usage: { image: { allowance: number } };
        addOns: { image: number };
        autoTopUp: { enabled: boolean; monthlyCapMicros: number };
      }
    >(owner, 'entitlements', {
      action: 'projection',
      payload: { month: '2026-07' },
    });

    assert.equal(projection.plan.tier, 'pro');
    assert.equal(projection.usage.image.allowance, 130);
    assert.equal(projection.addOns.image, 10);
    assert.equal(projection.autoTopUp.enabled, true);
    assert.equal(projection.autoTopUp.monthlyCapMicros, 3_000_000);
  });

  it('never exposes raw policy, payment event or arbitrary quantity commands to an Owner', async () => {
    const service = setup();
    const catalog = await service.queryModule(
      owner,
      'entitlements',
      { action: 'catalog', payload: {} },
    );
    assert.equal(JSON.stringify(catalog).includes('paymentEventId'), false);
    await assert.rejects(
      service.executeModule(
        owner,
        'entitlements',
        {
          action: 'activate_plan',
          payload: {
            paymentEventId: 'forged',
            policy: { allowance: { copy: 999_999 } },
          },
        },
        'forged-owner-entitlement',
      ),
      /Unknown entitlements command/,
    );
  });

  it('keeps the module owner-only through the Foundation authorization seam', async () => {
    const service = setup();
    await assert.rejects(
      service.queryModule(
        { ...owner, userId: 'workspace-member' },
        'entitlements',
        { action: 'projection', payload: {} },
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'NOT_FOUND',
    );
  });

  it('keeps recorded commerce disabled unless the development gate is explicit', async () => {
    const service = setup(false);
    const catalog = (await service.queryModule(
      owner,
      'entitlements',
      { action: 'catalog', payload: {} },
    )) as { mode: string };

    assert.equal(catalog.mode, 'disabled');
    await assert.rejects(
      service.executeModule(
        owner,
        'entitlements',
        { action: 'checkout_plan', payload: { tier: 'pro' } },
        'recorded-commerce-disabled',
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'FORBIDDEN',
    );
  });

  it('exposes trial in catalog with fixed_days period and limits register_gift to a trusted worker', async () => {
    const service = setup(false);
    const catalog = (await service.queryModule(owner, 'entitlements', {
      action: 'catalog',
      payload: {},
    })) as {
      plans: Array<{
        id: string;
        expireDays?: number;
        periodStrategy?: string;
        allowance: { copy: number };
      }>;
    };
    const trial = catalog.plans.find((plan) => plan.id === 'trial');
    assert.ok(trial);
    assert.equal(trial.periodStrategy, 'fixed_days');
    assert.equal(trial.expireDays, 7);
    assert.equal(trial.allowance.copy, 20);

    await assert.rejects(
      service.executeModule(
        owner,
        'entitlements',
        { action: 'register_gift', payload: {} },
        'workspace-provision:user-forbidden',
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'FORBIDDEN',
    );

    // register_gift is trusted internal — not gated by recorded commerce.
    const provisioningWorker = { ...owner, actor: 'worker' as const };
    const gifted = (await service.executeModule(
      provisioningWorker,
      'entitlements',
      { action: 'register_gift', payload: {} },
      'workspace-provision:trial:v1',
    )) as {
      plan: {
        tier: string;
        periodStrategy?: string;
        periodStartsAt: string;
        periodEndsAt: string;
      };
      usage: { copy: { allowance: number } };
    };
    assert.equal(gifted.plan.tier, 'trial');
    assert.equal(gifted.plan.periodStrategy, 'fixed_days');
    assert.equal(gifted.usage.copy.allowance, 20);
    const starts = Date.parse(gifted.plan.periodStartsAt);
    const ends = Date.parse(gifted.plan.periodEndsAt);
    assert.equal(ends - starts, 7 * 24 * 60 * 60 * 1000);

    // Replay with same idempotency key is stable; different key still once-only.
    const replay = await service.executeModule(
      provisioningWorker,
      'entitlements',
      { action: 'register_gift', payload: {} },
      'workspace-provision:trial:v1',
    );
    assert.deepEqual(replay, gifted);
    const secondKey = (await service.executeModule(
      provisioningWorker,
      'entitlements',
      { action: 'register_gift', payload: {} },
      'workspace-provision:trial:v1-retry-other-key',
    )) as { usage: { copy: { allowance: number } } };
    assert.equal(secondKey.usage.copy.allowance, 20);
  });

  it('hot-reads trial plan config into catalog', async () => {
    const { service } = setupHotCatalog();
    await applyConfig(
      service,
      'plan.allowances.trial',
      {
        allowance: { audio: 0, copy: 40, image: 10, video: 4 },
        concurrencyLimit: 2,
        queuePriority: 2,
        supportLabel: 'standard',
        expireDays: 14,
      },
      null,
    );
    const catalog = (await service.queryModule(owner, 'entitlements', {
      action: 'catalog',
      payload: {},
    })) as {
      plans: Array<{ id: string; allowance: { copy: number }; expireDays?: number }>;
    };
    const trial = catalog.plans.find((plan) => plan.id === 'trial');
    assert.equal(trial?.allowance.copy, 40);
    assert.equal(trial?.expireDays, 14);
  });

  it('provisions platform model defaults once under the dedicated stable key', async () => {
    const clock = () => new Date('2026-07-11T00:00:00.000Z');
    const repository = new MemoryFoundationRepository();
    repository.grantOwner(owner.workspaceId, owner.userId);
    const entitlements = new ProductEntitlementApplicationService(
      repository,
      new RecordedAutoTopUpPaymentPort(),
      clock,
    );
    const writes: Array<{
      modelId: string;
      operation: string;
      workspaceId: string;
    }> = [];
    const service = new P1ApplicationService(repository, {
      operations: [
        new ProductEntitlementFoundationModule(entitlements, clock, {
          modelDefaults: {
            async getDefaults() {
              return {
                audio: 'audio-platform-default',
                copy: 'copy-platform-default',
                image: 'image-platform-default',
                video: 'video-platform-default',
              };
            },
            async validateDefault() {},
            async setWorkspaceDefault(workspaceId, operation, modelId) {
              writes.push({ modelId, operation, workspaceId });
            },
          },
        }),
      ],
    });
    const worker = { ...owner, actor: 'worker' as const };
    const command = { action: 'provision_model_defaults', payload: {} };

    const first = await service.executeModule(
      worker,
      'entitlements',
      command,
      'workspace-provision:model-default:v1',
    );
    const replay = await service.executeModule(
      worker,
      'entitlements',
      command,
      'workspace-provision:model-default:v1',
    );

    assert.deepEqual(replay, first);
    assert.deepEqual(writes, [
      {
        modelId: 'copy-platform-default',
        operation: 'copy.generate',
        workspaceId: owner.workspaceId,
      },
      {
        modelId: 'image-platform-default',
        operation: 'image.generate',
        workspaceId: owner.workspaceId,
      },
      {
        modelId: 'video-platform-default',
        operation: 'video.generate',
        workspaceId: owner.workspaceId,
      },
      {
        modelId: 'audio-platform-default',
        operation: 'audio.speech',
        workspaceId: owner.workspaceId,
      },
    ]);
    await assert.rejects(
      service.executeModule(
        worker,
        'entitlements',
        { action: 'register_gift', payload: {} },
        'workspace-provision:model-default:v1',
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'IDEMPOTENCY_CONFLICT',
    );
  });

  it('payment_grant activates growth with provider billing period and is idempotent', async () => {
    // payment_grant is trusted webhook path — works even when recorded commerce is off.
    const service = setup(false);
    const payment = {
      actor: 'payment' as const,
      workspaceId: owner.workspaceId,
      userId: 'payment-service',
      correlationId: 'corr-payment-grant',
    };
    const activated = (await service.executeModule(
      payment,
      'entitlements',
      {
        action: 'payment_grant',
        payload: {
          lifecycle: 'activate',
          paymentEventId: 'stripe:evt_checkout_1',
          paymentProductId: 'price_growth_month',
          interval: 'month',
          periodStartsAt: '2026-07-15T00:00:00.000Z',
          periodEndsAt: '2026-08-15T00:00:00.000Z',
        },
      },
      'stripe:evt_checkout_1',
    )) as {
      plan: {
        tier: string;
        periodStrategy?: string;
        periodStartsAt: string;
        periodEndsAt: string;
      };
      usage: { copy: { allowance: number } };
    };
    assert.equal(activated.plan.tier, 'growth');
    assert.equal(activated.plan.periodStrategy, 'provider_period');
    assert.equal(activated.plan.periodStartsAt, '2026-07-15T00:00:00.000Z');
    assert.equal(activated.plan.periodEndsAt, '2026-08-15T00:00:00.000Z');
    assert.equal(activated.usage.copy.allowance, 100);

    const replay = await service.executeModule(
      payment,
      'entitlements',
      {
        action: 'payment_grant',
        payload: {
          lifecycle: 'activate',
          paymentEventId: 'stripe:evt_checkout_1',
          paymentProductId: 'price_growth_month',
          interval: 'month',
          periodStartsAt: '2026-07-15T00:00:00.000Z',
          periodEndsAt: '2026-08-15T00:00:00.000Z',
        },
      },
      'stripe:evt_checkout_1',
    );
    assert.deepEqual(replay, activated);

    // Non-payment actor is rejected.
    await assert.rejects(
      () =>
        service.executeModule(
          owner,
          'entitlements',
          {
            action: 'payment_grant',
            payload: {
              lifecycle: 'activate',
              paymentEventId: 'stripe:evt_other',
              paymentProductId: 'price_growth_month',
            },
          },
          'stripe:evt_other',
        ),
      /payment service actor/
    );
  });

  it('payment_grant maps lifetime activate to pro and cancel keeps period end', async () => {
    const service = setup(false);
    const payment = {
      actor: 'payment' as const,
      workspaceId: owner.workspaceId,
      userId: owner.userId,
      correlationId: 'corr-payment-life',
    };
    const life = (await service.executeModule(
      payment,
      'entitlements',
      {
        action: 'payment_grant',
        payload: {
          lifecycle: 'activate',
          paymentEventId: 'stripe:evt_life',
          paymentProductId: 'price_lifetime',
          interval: 'lifetime',
          periodStartsAt: '2026-07-01T00:00:00.000Z',
          periodEndsAt: '2126-07-01T00:00:00.000Z',
        },
      },
      'stripe:evt_life',
    )) as { plan: { tier: string; periodEndsAt: string } };
    assert.equal(life.plan.tier, 'pro');

    const canceled = (await service.executeModule(
      payment,
      'entitlements',
      {
        action: 'payment_grant',
        payload: {
          lifecycle: 'cancel_at_period_end',
          paymentEventId: 'stripe:evt_cancel',
          paymentProductId: 'price_lifetime',
          interval: 'lifetime',
          periodStartsAt: '2026-07-01T00:00:00.000Z',
          periodEndsAt: '2026-08-01T00:00:00.000Z',
        },
      },
      'stripe:evt_cancel',
    )) as { plan: { periodEndsAt: string; tier: string } };
    // End-of-period fall back: still pro until periodEndsAt.
    assert.equal(canceled.plan.tier, 'pro');
    assert.equal(canceled.plan.periodEndsAt, '2026-08-01T00:00:00.000Z');

    const resumed = (await service.executeModule(
      payment,
      'entitlements',
      {
        action: 'payment_grant',
        payload: {
          lifecycle: 'resume',
          paymentEventId: 'stripe:evt_resume',
          paymentProductId: 'price_lifetime',
          interval: 'lifetime',
          periodStartsAt: '2026-07-01T00:00:00.000Z',
          periodEndsAt: '2126-07-01T00:00:00.000Z',
        },
      },
      'stripe:evt_resume',
    )) as { plan: { periodEndsAt: string; tier: string } };
    assert.equal(resumed.plan.tier, 'pro');
    assert.equal(resumed.plan.periodEndsAt, '2126-07-01T00:00:00.000Z');

    await assert.rejects(
      service.executeModule(
        payment,
        'entitlements',
        {
          action: 'payment_grant',
          payload: {
            lifecycle: 'cancel_at_period_end',
            paymentEventId: 'stripe:evt_cancel_without_period',
            paymentProductId: 'price_lifetime',
            interval: 'lifetime',
          },
        },
        'stripe:evt_cancel_without_period',
      ),
      /requires provider periodEndsAt/,
    );
  });

  it('falls back to persistent starter after paid expiry without reviving paid allowance or dropping add-ons', async () => {
    let now = new Date('2026-07-19T12:00:00.000Z');
    const repository = new MemoryFoundationRepository();
    const grantLots = new MemoryGrantLotLedger();
    repository.grantOwner(owner.workspaceId, owner.userId);
    const entitlements = new GrantLotAwareProductEntitlementService(
      repository,
      grantLots,
      undefined,
      () => now,
    );
    const service = new P1ApplicationService(repository, {
      operations: [
        new ProductEntitlementFoundationModule(entitlements, () => now, {
          recordedCommerceEnabled: false,
        }),
      ],
    });
    const payment = {
      actor: 'payment' as const,
      workspaceId: owner.workspaceId,
      userId: 'payment-service',
      correlationId: 'corr-payment-expiry-fallback',
    };

    await service.executeModule(
      payment,
      'entitlements',
      {
        action: 'payment_grant',
        payload: {
          lifecycle: 'activate',
          paymentEventId: 'stripe:evt_paid_before_expiry',
          paymentProductId: 'price_growth_month',
          interval: 'month',
          periodStartsAt: '2026-07-19T00:00:00.000Z',
          periodEndsAt: '2026-07-20T00:00:00.000Z',
        },
      },
      'stripe:evt_paid_before_expiry',
    );
    grantLots.consume({
      workspaceId: owner.workspaceId,
      resource: 'copy',
      amount: 10,
      transactionId: 'paid-copy-before-expiry',
      actorId: owner.userId,
      correlationId: owner.correlationId,
      createdAt: now.toISOString(),
    });
    await entitlements.recordAddOnPurchase(
      owner,
      {
        paymentEventId: 'package-after-paid-plan',
        purchaseId: 'copy-package-after-paid-plan',
        resource: 'copy',
        quantity: 5,
        amountMicros: 100,
        currency: 'CNY',
      },
      'copy-package-after-paid-plan',
    );

    now = new Date('2026-07-21T00:00:00.000Z');
    const expired = (await service.executeModule(
      payment,
      'entitlements',
      {
        action: 'payment_grant',
        payload: {
          lifecycle: 'expire',
          paymentEventId: 'stripe:evt_paid_expired',
          paymentProductId: 'price_growth_month',
          interval: 'month',
        },
      },
      'stripe:evt_paid_expired',
    )) as {
      plan: { periodEndsAt: string; tier: string } | null;
      usage: { copy: { allowance: number; available: number } };
    };

    assert.equal(expired.plan?.tier, 'starter');
    assert.ok(Date.parse(expired.plan?.periodEndsAt ?? '') > now.getTime());
    assert.deepEqual(expired.usage.copy, {
      allowance: 35,
      available: 35,
      committed: 0,
      released: 0,
      reserved: 0,
    });
    assert.equal(
      grantLots
        .listLots(owner.workspaceId, 'copy')
        .filter((lot) => lot.transactionType === 'SUBSCRIPTION_RENEWAL')
        .reduce((total, lot) => total + lot.remainingAmount, 0),
      30,
    );
    assert.equal(
      grantLots
        .listLots(owner.workspaceId, 'copy')
        .filter((lot) => lot.transactionType === 'PURCHASE_PACKAGE')
        .reduce((total, lot) => total + lot.remainingAmount, 0),
      5,
    );
    assert.equal(
      grantLots
        .listTransactions(owner.workspaceId)
        .filter(
          (transaction) =>
            transaction.resource === 'copy' &&
            transaction.transactionType === 'EXPIRE',
        )
        .reduce((total, transaction) => total + transaction.amount, 0),
      90,
    );

    now = new Date('2027-12-01T00:00:00.000Z');
    const later = await entitlements.getProjection(owner);
    assert.equal(later.plan?.tier, 'starter');
    assert.equal(later.usage.copy.available, 35);
  });

  it('hot-reads plan.payment-mapping for every paid settlement', async () => {
    const { service } = setupHotCatalog();
    const payment = {
      actor: 'payment' as const,
      workspaceId: owner.workspaceId,
      userId: 'payment-service',
      correlationId: 'corr-payment-mapping',
    };
    await applyConfig(
      service,
      'plan.payment-mapping',
      {
        mappings: [
          {
            paymentProductId: 'price_admin_mapped',
            interval: 'month',
            tier: 'pro',
          },
        ],
      },
      null,
    );

    const pro = (await service.executeModule(
      payment,
      'entitlements',
      {
        action: 'payment_grant',
        payload: {
          lifecycle: 'activate',
          paymentEventId: 'stripe:evt_mapping_pro',
          paymentProductId: 'price_admin_mapped',
          interval: 'month',
          periodStartsAt: '2026-07-01T00:00:00.000Z',
          periodEndsAt: '2026-08-01T00:00:00.000Z',
        },
      },
      'stripe:evt_mapping_pro',
    )) as { plan: { tier: string } };
    assert.equal(pro.plan.tier, 'pro');

    await applyConfig(
      service,
      'plan.payment-mapping',
      {
        mappings: [
          {
            paymentProductId: 'price_admin_mapped',
            interval: 'month',
            tier: 'growth',
          },
        ],
      },
      1,
    );
    const growth = (await service.executeModule(
      payment,
      'entitlements',
      {
        action: 'payment_grant',
        payload: {
          lifecycle: 'renew',
          paymentEventId: 'stripe:evt_mapping_growth',
          paymentProductId: 'price_admin_mapped',
          interval: 'month',
          periodStartsAt: '2026-08-01T00:00:00.000Z',
          periodEndsAt: '2026-09-01T00:00:00.000Z',
        },
      },
      'stripe:evt_mapping_growth',
    )) as { plan: { tier: string } };
    assert.equal(growth.plan.tier, 'growth');
  });
});
