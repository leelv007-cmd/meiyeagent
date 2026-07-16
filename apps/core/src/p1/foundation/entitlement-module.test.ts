import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { P1ApplicationService } from './application-service.js';
import { ProductEntitlementFoundationModule } from './entitlement-module.js';
import {
  ProductEntitlementApplicationService,
  RecordedAutoTopUpPaymentPort,
} from './entitlement-service.js';
import { MemoryFoundationRepository } from './memory-repository.js';
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
  const repository = new MemoryFoundationRepository();
  repository.grantOwner(owner.workspaceId, owner.userId);
  const entitlements = new ProductEntitlementApplicationService(
    repository,
    new RecordedAutoTopUpPaymentPort(),
  );
  return new P1ApplicationService(repository, {
    operations: [
      new ProductEntitlementFoundationModule(
        entitlements,
        () => new Date('2026-07-11T00:00:00.000Z'),
        { recordedCommerceEnabled },
      ),
    ],
  });
}

function setupHotCatalog() {
  const repository = new MemoryFoundationRepository();
  repository.grantOwner(owner.workspaceId, owner.userId);
  const config = new MemoryAdminConfigRepository();
  const entitlements = new ProductEntitlementApplicationService(
    repository,
    new RecordedAutoTopUpPaymentPort(),
  );
  return {
    config,
    service: new P1ApplicationService(repository, {
      operations: [
        new AdminConfigFoundationModule(config),
        new ProductEntitlementFoundationModule(
          entitlements,
          () => new Date('2026-07-11T00:00:00.000Z'),
          {
            catalogSource: new AdminConfigEntitlementCatalogSource(config),
            recordedCommerceEnabled: true,
          },
        ),
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
});
