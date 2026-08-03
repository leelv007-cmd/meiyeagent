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
import { CreditBillingService } from '../credit-billing/credit-billing-service.js';
import { CreditSubscriptionEntitlementPolicy } from '../credit-billing/credit-entitlement-policy.js';
import { MemoryCreditLedger } from '../credit-billing/credit-ledger.js';
import { DEFAULT_CREDIT_PLAN_CATALOG } from '../credit-billing/credit-plan-catalog.js';
import {
  CreditSubscriptionCycleScheduler,
  MemoryCreditSubscriptionStore,
} from '../credit-billing/credit-subscription-scheduler.js';

const owner = {
  workspaceId: 'workspace-entitlement-module',
  userId: 'owner-entitlement-module',
  correlationId: 'corr-entitlement-module',
  actor: 'owner' as const,
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
  it('projects workspace-scoped merchant credit details without internal ledger facts', async () => {
    const clock = () => new Date('2026-08-03T00:00:00.000Z');
    const repository = new MemoryFoundationRepository();
    repository.grantOwner(owner.workspaceId, owner.userId);
    const otherOwner = {
      actor: 'owner' as const,
      correlationId: 'corr-other-workspace',
      userId: 'owner-other-workspace',
      workspaceId: 'workspace-other',
    };
    repository.grantOwner(otherOwner.workspaceId, otherOwner.userId);
    const entitlements = new ProductEntitlementApplicationService(
      repository,
      new RecordedAutoTopUpPaymentPort(),
      clock,
    );
    const ledger = new MemoryCreditLedger();
    const subscriptions = new MemoryCreditSubscriptionStore();
    const creditBilling = new CreditBillingService(
      ledger,
      subscriptions,
      {
        async get() {
          const catalog = structuredClone(DEFAULT_CREDIT_PLAN_CATALOG);
          const growth = catalog.plans.find((plan) => plan.id === 'growth');
          if (growth) growth.credits = 2_800;
          return catalog;
        },
      },
      { async getPaymentMapping() { return null; } },
      clock,
    );
    await subscriptions.upsert({
      anchorAt: '2026-08-01T00:00:00.000Z',
      id: 'private-subscription-id',
      interval: 'monthly',
      paidThroughCycle: 1,
      tier: 'growth',
      workspaceId: owner.workspaceId,
    });
    const service = new P1ApplicationService(repository, {
      operations: [
        new ProductEntitlementFoundationModule(entitlements, clock, {
          creditBilling,
        }),
      ],
    });

    ledger.grant({
      actorId: 'private-actor',
      correlationId: 'private-correlation',
      createdAt: '2026-08-01T00:00:00.000Z',
      credits: 20,
      expirationDate: '2026-08-02T00:00:00.000Z',
      grantIdempotencyKey: 'grant:sub:private-subscription-id:0',
      id: 'private-lot-id',
      sourceRef: 'private-subscription-id',
      transactionType: 'SUBSCRIPTION_RENEWAL',
      workspaceId: owner.workspaceId,
    });
    ledger.consume({
      actorId: 'private-actor',
      correlationId: 'private-correlation',
      createdAt: '2026-08-01T01:00:00.000Z',
      credits: 20,
      transactionId: 'task:private-task-id',
      workspaceId: owner.workspaceId,
    });
    ledger.refundUsageOperation({
      actorId: 'private-actor',
      correlationId: 'private-correlation',
      createdAt: '2026-08-03T00:00:00.000Z',
      refundOperationId: 'refund:private-key',
      usageOperationId: 'task:private-task-id',
      workspaceId: owner.workspaceId,
    });

    const detail = await service.queryModule(owner, 'entitlements', {
      action: 'credit_detail',
      payload: {},
    });

    assert.deepEqual(detail, {
      billing: {
        creditsThisPeriod: 20,
        interval: 'monthly',
        periodEndsAt: '2026-09-01T00:00:00.000Z',
        tier: 'growth',
      },
      batches: [
        {
          batchNumber: 1,
          expiresAt: '2026-08-02T00:00:00.000Z',
          remainingCredits: 0,
          source: 'subscription',
          status: 'expired',
        },
      ],
      transactions: [
        {
          batchNumber: 1,
          credits: 20,
          creditedAmount: 0,
          operation: 'account_credit',
          occurredAt: '2026-08-01T00:00:00.000Z',
          refundDisposition: 'not_applicable',
          status: 'not_applicable',
          type: 'grant',
        },
        {
          batchNumber: 1,
          credits: 20,
          creditedAmount: 0,
          operation: 'creation',
          occurredAt: '2026-08-01T01:00:00.000Z',
          refundDisposition: 'not_applicable',
          status: 'reserved',
          type: 'reserve',
        },
        {
          batchNumber: 1,
          credits: 20,
          creditedAmount: 0,
          operation: 'creation',
          occurredAt: '2026-08-03T00:00:00.000Z',
          refundDisposition: 'expired_uncredited',
          status: 'refunded',
          type: 'refund',
        },
      ],
    });
    assert.deepEqual(
      await service.queryModule(otherOwner, 'entitlements', {
        action: 'credit_detail',
        payload: {},
      }),
      { billing: null, batches: [], transactions: [] },
    );
    await assert.rejects(
      service.queryModule(
        { ...owner, userId: 'not-a-workspace-owner' },
        'entitlements',
        { action: 'credit_detail', payload: {} },
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'NOT_FOUND',
    );
  });

  it('shows a settled generation on its credit reservation without exposing its task id', async () => {
    const clock = () => new Date('2026-08-01T02:00:00.000Z');
    const repository = new MemoryFoundationRepository();
    repository.grantOwner(owner.workspaceId, owner.userId);
    const entitlements = new ProductEntitlementApplicationService(
      repository,
      new RecordedAutoTopUpPaymentPort(),
      clock,
    );
    const ledger = new MemoryCreditLedger();
    const creditBilling = new CreditBillingService(
      ledger,
      new MemoryCreditSubscriptionStore(),
      { async get() { return structuredClone(DEFAULT_CREDIT_PLAN_CATALOG); } },
      { async getPaymentMapping() { return null; } },
      clock,
    );
    const usageReads: Array<{ taskId: string; workspaceId: string }> = [];
    const service = new P1ApplicationService(repository, {
      operations: [
        new ProductEntitlementFoundationModule(entitlements, clock, {
          creditBilling,
          creditUsage: {
            async getUsage(workspaceId, taskId) {
              usageReads.push({ taskId, workspaceId });
              return taskId === 'task-settled'
                ? { status: 'committed' as const }
                : null;
            },
          },
        }),
      ],
    });
    ledger.grant({
      createdAt: '2026-08-01T00:00:00.000Z',
      credits: 12,
      expirationDate: null,
      id: 'lot-settled',
      transactionType: 'PURCHASE_PACKAGE',
      workspaceId: owner.workspaceId,
    });
    ledger.consume({
      actorId: 'system',
      correlationId: 'internal',
      createdAt: '2026-08-01T01:00:00.000Z',
      credits: 12,
      transactionId: 'task:task-settled',
      workspaceId: owner.workspaceId,
    });

    const detail = (await service.queryModule(owner, 'entitlements', {
      action: 'credit_detail',
      payload: {},
    })) as {
      transactions: Array<{ status: string; type: string; taskId?: string }>;
    };

    assert.deepEqual(usageReads, [
      { taskId: 'task-settled', workspaceId: owner.workspaceId },
    ]);
    assert.deepEqual(
      detail.transactions.find((transaction) => transaction.type === 'reserve'),
      {
        batchNumber: 1,
        credits: 12,
        creditedAmount: 0,
        operation: 'creation',
        occurredAt: '2026-08-01T01:00:00.000Z',
        refundDisposition: 'not_applicable',
        status: 'settled',
        type: 'reserve',
      },
    );
    assert.equal(
      detail.transactions.some((transaction) => 'taskId' in transaction),
      false,
    );
  });

  it('keeps FEFO batches, credited refunds, and expiry events in merchant-safe detail', async () => {
    const clock = () => new Date('2026-08-03T00:00:00.000Z');
    const repository = new MemoryFoundationRepository();
    repository.grantOwner(owner.workspaceId, owner.userId);
    const entitlements = new ProductEntitlementApplicationService(
      repository,
      new RecordedAutoTopUpPaymentPort(),
      clock,
    );
    const ledger = new MemoryCreditLedger();
    const creditBilling = new CreditBillingService(
      ledger,
      new MemoryCreditSubscriptionStore(),
      { async get() { return structuredClone(DEFAULT_CREDIT_PLAN_CATALOG); } },
      { async getPaymentMapping() { return null; } },
      clock,
    );
    const service = new P1ApplicationService(repository, {
      operations: [
        new ProductEntitlementFoundationModule(entitlements, clock, {
          creditBilling,
        }),
      ],
    });
    ledger.grant({
      createdAt: '2026-08-01T00:00:00.000Z',
      credits: 5,
      expirationDate: '2026-08-02T00:00:00.000Z',
      id: 'private-first-lot',
      transactionType: 'REGISTER_GIFT',
      workspaceId: owner.workspaceId,
    });
    ledger.grant({
      createdAt: '2026-08-01T00:00:01.000Z',
      credits: 10,
      expirationDate: '2026-09-01T00:00:00.000Z',
      id: 'private-second-lot',
      transactionType: 'PURCHASE_PACKAGE',
      workspaceId: owner.workspaceId,
    });
    ledger.consume({
      actorId: 'system',
      correlationId: 'private-correlation',
      createdAt: '2026-08-01T01:00:00.000Z',
      credits: 7,
      transactionId: 'task:private-fefo-task',
      workspaceId: owner.workspaceId,
    });
    ledger.refundUsageOperation({
      actorId: 'system',
      correlationId: 'private-correlation',
      createdAt: '2026-08-01T02:00:00.000Z',
      credits: 1,
      refundOperationId: 'refund:private-fefo-task',
      usageOperationId: 'task:private-fefo-task',
      workspaceId: owner.workspaceId,
    });
    ledger.expireLots({
      actorId: 'system',
      correlationId: 'private-correlation',
      now: '2026-08-02T00:00:00.000Z',
      workspaceId: owner.workspaceId,
    });

    const detail = await service.queryModule(owner, 'entitlements', {
      action: 'credit_detail',
      payload: {},
    });
    const transactions = (detail as {
      batches: Array<{ batchNumber: number; source: string; status: string }>;
      transactions: Array<{
        batchNumber: number;
        creditedAmount: number;
        operation: string;
        type: string;
      }>;
    }).transactions;

    assert.deepEqual((detail as { batches: unknown }).batches, [
      { batchNumber: 1, expiresAt: '2026-08-02T00:00:00.000Z', remainingCredits: 0, source: 'trial', status: 'expired' },
      { batchNumber: 2, expiresAt: '2026-09-01T00:00:00.000Z', remainingCredits: 8, source: 'booster', status: 'active' },
    ]);
    assert.deepEqual(
      transactions
        .filter((transaction) => transaction.type === 'reserve')
        .map(({ batchNumber, operation }) => ({ batchNumber, operation })),
      [
        { batchNumber: 1, operation: 'creation' },
        { batchNumber: 2, operation: 'creation' },
      ],
    );
    assert.deepEqual(
      (() => {
        const transaction = transactions.find(
          (candidate) => candidate.type === 'refund',
        );
        return transaction
          ? {
              batchNumber: transaction.batchNumber,
              creditedAmount: transaction.creditedAmount,
              operation: transaction.operation,
              type: transaction.type,
            }
          : undefined;
      })(),
      { batchNumber: 1, creditedAmount: 1, operation: 'creation', type: 'refund' },
    );
    assert.deepEqual(
      (() => {
        const transaction = transactions.find(
          (candidate) => candidate.type === 'expire',
        );
        return transaction
          ? {
              batchNumber: transaction.batchNumber,
              creditedAmount: transaction.creditedAmount,
              operation: transaction.operation,
              type: transaction.type,
            }
          : undefined;
      })(),
      { batchNumber: 1, creditedAmount: 0, operation: 'account_credit', type: 'expire' },
    );
    assert.doesNotMatch(JSON.stringify(detail), /private-(?:first-lot|second-lot|fefo-task|correlation)/u);
  });

  it('bounds concurrent usage lookups while preserving every creation row', async () => {
    const clock = () => new Date('2026-08-01T02:00:00.000Z');
    const repository = new MemoryFoundationRepository();
    repository.grantOwner(owner.workspaceId, owner.userId);
    const entitlements = new ProductEntitlementApplicationService(
      repository,
      new RecordedAutoTopUpPaymentPort(),
      clock,
    );
    const ledger = new MemoryCreditLedger();
    let activeReads = 0;
    let maxActiveReads = 0;
    const service = new P1ApplicationService(repository, {
      operations: [
        new ProductEntitlementFoundationModule(entitlements, clock, {
          creditBilling: new CreditBillingService(
            ledger,
            new MemoryCreditSubscriptionStore(),
            { async get() { return structuredClone(DEFAULT_CREDIT_PLAN_CATALOG); } },
            { async getPaymentMapping() { return null; } },
            clock,
          ),
          creditUsage: {
            async getUsage() {
              activeReads += 1;
              maxActiveReads = Math.max(maxActiveReads, activeReads);
              await Promise.resolve();
              activeReads -= 1;
              return { status: 'committed' as const };
            },
          },
        }),
      ],
    });
    for (let index = 0; index < 17; index += 1) {
      ledger.grant({
        createdAt: `2026-08-01T00:00:${String(index).padStart(2, '0')}.000Z`,
        credits: 1,
        expirationDate: null,
        id: `lot-${index}`,
        transactionType: 'PURCHASE_PACKAGE',
        workspaceId: owner.workspaceId,
      });
      ledger.consume({
        actorId: 'system',
        correlationId: 'internal',
        createdAt: `2026-08-01T01:00:${String(index).padStart(2, '0')}.000Z`,
        credits: 1,
        transactionId: `task:task-${index}`,
        workspaceId: owner.workspaceId,
      });
    }

    const detail = (await service.queryModule(owner, 'entitlements', {
      action: 'credit_detail',
      payload: {},
    })) as { transactions: Array<{ operation: string; type: string }> };

    assert.equal(maxActiveReads, 16);
    assert.equal(
      detail.transactions.filter((transaction) => transaction.type === 'reserve').length,
      17,
    );
    assert.equal(
      detail.transactions.filter((transaction) => transaction.operation === 'creation').length,
      17,
    );
  });

  it('projects a settled upgrade, expired prior grant, and surviving add-on through credit_detail', async () => {
    let now = new Date('2026-08-01T00:00:00.000Z');
    const clock = () => now;
    const repository = new MemoryFoundationRepository();
    repository.grantOwner(owner.workspaceId, owner.userId);
    const entitlements = new ProductEntitlementApplicationService(
      repository,
      new RecordedAutoTopUpPaymentPort(),
      clock,
    );
    const ledger = new MemoryCreditLedger();
    const subscriptions = new MemoryCreditSubscriptionStore();
    const creditBilling = new CreditBillingService(
      ledger,
      subscriptions,
      { async get() { return structuredClone(DEFAULT_CREDIT_PLAN_CATALOG); } },
      {
        async getPaymentMapping() {
          return {
            mappings: [
              { interval: 'month' as const, paymentProductId: 'starter', tier: 'starter' as const },
              { interval: 'month' as const, paymentProductId: 'growth', tier: 'growth' as const },
            ],
          };
        },
      },
      clock,
    );
    const scheduler = new CreditSubscriptionCycleScheduler(subscriptions, ledger, {
      planFor(tier) {
        const plan = DEFAULT_CREDIT_PLAN_CATALOG.plans.find(
          (candidate) => candidate.id === tier,
        );
        if (!plan) throw new Error(`Missing ${tier} credit plan.`);
        return plan;
      },
    });
    const service = new P1ApplicationService(repository, {
      operations: [
        new ProductEntitlementFoundationModule(entitlements, clock, {
          creditBilling,
        }),
      ],
    });
    const subscriptionId = 'credit-detail-upgrade';

    await creditBilling.settlePayment(owner, {
      interval: 'month',
      lifecycle: 'activate',
      paymentEventId: 'credit-detail-starter',
      paymentProductId: 'starter',
      periodStartsAt: now.toISOString(),
      subscriptionId,
    });
    await scheduler.run(now.toISOString());
    now = new Date('2026-08-02T00:00:00.000Z');
    await creditBilling.grantAddOn(owner, {
      offerId: 'credits-100',
      paymentEventId: 'credit-detail-add-on',
    });
    now = new Date('2026-08-03T00:00:00.000Z');
    await creditBilling.settlePayment(owner, {
      interval: 'month',
      lifecycle: 'activate',
      paymentEventId: 'credit-detail-growth',
      paymentProductId: 'growth',
      periodStartsAt: now.toISOString(),
      subscriptionId,
    });
    await scheduler.run(now.toISOString());

    const detail = (await service.queryModule(owner, 'entitlements', {
      action: 'credit_detail',
      payload: {},
    })) as {
      billing: { creditsThisPeriod: number; tier: string } | null;
      batches: Array<{ remainingCredits: number; source: string; status: string }>;
      transactions: Array<{ operation: string; type: string }>;
    };

    assert.deepEqual(detail.billing, {
      creditsThisPeriod: 1_300,
      interval: 'monthly',
      periodEndsAt: '2026-09-03T00:00:00.000Z',
      tier: 'growth',
    });
    assert.ok(
      detail.batches.some(
        (batch) =>
          batch.source === 'booster' &&
          batch.remainingCredits === 100 &&
          batch.status === 'active',
      ),
    );
    assert.ok(detail.transactions.some((transaction) => transaction.type === 'expire'));
    assert.equal(
      detail.transactions.every(
        (transaction) =>
          transaction.operation === 'account_credit' ||
          transaction.operation === 'creation',
      ),
      true,
    );
  });

  it('keeps the legacy usage projection alongside authoritative credits during cutover', async () => {
    const clock = () => new Date('2026-08-01T00:00:00.000Z');
    const repository = new MemoryFoundationRepository();
    repository.grantOwner(owner.workspaceId, owner.userId);
    const entitlements = new ProductEntitlementApplicationService(
      repository,
      new RecordedAutoTopUpPaymentPort(),
      clock,
    );
    const ledger = new MemoryCreditLedger();
    const subscriptions = new MemoryCreditSubscriptionStore();
    const creditBilling = new CreditBillingService(
      ledger,
      subscriptions,
      { async get() { return structuredClone(DEFAULT_CREDIT_PLAN_CATALOG); } },
      { async getPaymentMapping() { return null; } },
      clock,
    );
    const service = new P1ApplicationService(repository, {
      operations: [
        new ProductEntitlementFoundationModule(entitlements, clock, {
          creditBilling,
        }),
      ],
    });

    await service.executeModule(
      { ...owner, actor: 'worker' as const },
      'entitlements',
      { action: 'register_gift', payload: {} },
      'workspace-provision:trial:v1',
    );

    const projection = (await service.queryModule(owner, 'entitlements', {
      action: 'projection',
      payload: {},
    })) as {
      credits: { availableCredits: number };
      plan: { tier: string };
      usage: {
        copy: { allowance: number; available: number };
        image: { allowance: number; available: number };
        video: { allowance: number; available: number };
      };
    };

    assert.equal(projection.credits.availableCredits, 100);
    assert.equal(projection.plan.tier, 'trial');
    assert.deepEqual(
      {
        copy: projection.usage.copy,
        image: projection.usage.image,
        video: projection.usage.video,
      },
      {
        copy: {
          allowance: 5,
          available: 5,
          committed: 0,
          released: 0,
          reserved: 0,
        },
        image: {
          allowance: 5,
          available: 5,
          committed: 0,
          released: 0,
          reserved: 0,
        },
        video: {
          allowance: 1,
          available: 1,
          committed: 0,
          released: 0,
          reserved: 0,
        },
      },
    );
  });

  it('projects the active paid tier instead of disguising it as trial', async () => {
    const clock = () => new Date('2026-08-01T00:00:00.000Z');
    const repository = new MemoryFoundationRepository();
    repository.grantOwner(owner.workspaceId, owner.userId);
    const entitlements = new ProductEntitlementApplicationService(
      repository,
      new RecordedAutoTopUpPaymentPort(),
      clock,
    );
    const ledger = new MemoryCreditLedger();
    const subscriptions = new MemoryCreditSubscriptionStore();
    const planSource = {
      async get() {
        return structuredClone(DEFAULT_CREDIT_PLAN_CATALOG);
      },
    };
    const creditBilling = new CreditBillingService(
      ledger,
      subscriptions,
      planSource,
      {
        async getPaymentMapping() {
          return {
            mappings: [
              { interval: 'month' as const, paymentProductId: 'growth', tier: 'growth' as const },
            ],
          };
        },
      },
      clock,
    );
    const service = new P1ApplicationService(repository, {
      operations: [
        new ProductEntitlementFoundationModule(entitlements, clock, {
          creditBilling,
          creditEntitlements: new CreditSubscriptionEntitlementPolicy(
            subscriptions,
            planSource,
            clock,
          ),
        }),
      ],
    });

    await creditBilling.settlePayment(owner, {
      lifecycle: 'activate',
      paymentEventId: 'paid-growth-cutover',
      paymentProductId: 'growth',
      interval: 'month',
      periodStartsAt: clock().toISOString(),
      subscriptionId: 'subscription-growth-cutover',
    });

    const projection = (await service.queryModule(owner, 'entitlements', {
      action: 'projection',
      payload: {},
    })) as { plan: { tier: string }; credits: { availableCredits: number } };

    assert.equal(projection.plan.tier, 'growth');
    assert.equal(projection.credits.availableCredits, 0);
  });

  it('adds the canonical monthly output shape using the Shanghai merchant month', async () => {
    const clock = () => new Date('2026-07-31T16:01:00.000Z');
    const repository = new MemoryFoundationRepository();
    repository.grantOwner(owner.workspaceId, owner.userId);
    const entitlements = new ProductEntitlementApplicationService(
      repository,
      new RecordedAutoTopUpPaymentPort(),
      clock,
    );
    const requested: Array<{ workspaceId: string; month: string }> = [];
    const service = new P1ApplicationService(repository, {
      operations: [
        new ProductEntitlementFoundationModule(entitlements, clock, {
          monthlyOutput: {
            async getMonthlyOutput(workspaceId, month) {
              requested.push({ workspaceId, month });
              return { copy: 4, image: 2, video: 1 };
            },
          },
        }),
      ],
    });

    const projection = (await service.queryModule(owner, 'entitlements', {
      action: 'projection',
      payload: {},
    })) as { monthlyOutput: unknown };

    assert.deepEqual(projection.monthlyOutput, {
      month: '2026-08',
      copy: 4,
      image: 2,
      video: 1,
    });
    assert.deepEqual(requested, [
      { workspaceId: owner.workspaceId, month: '2026-08' },
    ]);
  });

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

  it('exposes a strict three-bucket balance sourced from configured entitlements', async () => {
    const { service } = setupHotCatalog();
    await applyConfig(
      service,
      'plan.allowances.growth',
      {
        allowance: { audio: 0, copy: 12, image: 7, video: 2 },
        concurrencyLimit: 2,
        queuePriority: 3,
        supportLabel: 'priority',
      },
      null,
    );
    await service.executeModule(
      owner,
      'entitlements',
      { action: 'checkout_plan', payload: { tier: 'growth' } },
      'checkout-balance-growth',
    );

    const balance = await service.queryModule(owner, 'entitlements', {
      action: 'balance',
      payload: {},
    });

    assert.deepEqual(balance, {
      copy: {
        allowance: 12,
        available: 12,
        committed: 0,
        released: 0,
        reserved: 0,
      },
      image: {
        allowance: 7,
        available: 7,
        committed: 0,
        released: 0,
        reserved: 0,
      },
      video: {
        allowance: 2,
        available: 2,
        committed: 0,
        released: 0,
        reserved: 0,
      },
    });
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
    // pro 图 180 (D-123 高级 seed) + 10 from the add-on grant.
    assert.equal(projection.usage.image.allowance, 190);
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
      (error: unknown) =>
        error instanceof Error &&
        // Authorizer default-deny for unregistered action (preferred path).
        (/not registered for authorization/i.test(error.message) ||
          // Module-level guard if authorizer is bypassed in a test harness.
          /Unknown entitlements command/.test(error.message)),
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
    assert.deepEqual(trial.allowance, {
      audio: 0,
      copy: 5,
      image: 5,
      video: 1,
    });

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
    assert.equal(gifted.usage.copy.allowance, 5);
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
    assert.equal(secondKey.usage.copy.allowance, 5);
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
    await applyConfig(service, 'plan.trial.enabled', false, null);
    const catalog = (await service.queryModule(owner, 'entitlements', {
      action: 'catalog',
      payload: {},
    })) as {
      plans: Array<{ id: string; allowance: { copy: number }; expireDays?: number }>;
      trialEnabled: boolean;
    };
    const trial = catalog.plans.find((plan) => plan.id === 'trial');
    assert.equal(trial?.allowance.copy, 40);
    assert.equal(trial?.expireDays, 14);
    assert.equal(catalog.trialEnabled, false);
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
            async getSnapshot() {
              return {
                audio: {
                  catalogModelId: 'audio-platform-default',
                  configRevision: 'admin-config:14',
                },
                copy: {
                  catalogModelId: 'copy-platform-default',
                  configRevision: 'admin-config:11',
                },
                image: {
                  catalogModelId: 'image-platform-default',
                  configRevision: 'admin-config:12',
                },
                video: {
                  catalogModelId: 'video-platform-default',
                  configRevision: 'admin-config:13',
                },
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
    assert.equal(activated.usage.copy.allowance, 300);

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

  it('grants a configured credit package only through the payment add-on command', async () => {
    const clock = () => new Date('2026-08-03T00:00:00.000Z');
    const repository = new MemoryFoundationRepository();
    repository.grantOwner(owner.workspaceId, owner.userId);
    const entitlements = new ProductEntitlementApplicationService(
      repository,
      new RecordedAutoTopUpPaymentPort(),
      clock,
    );
    const ledger = new MemoryCreditLedger();
    const creditBilling = new CreditBillingService(
      ledger,
      new MemoryCreditSubscriptionStore(),
      { async get() { return structuredClone(DEFAULT_CREDIT_PLAN_CATALOG); } },
      { async getPaymentMapping() { return null; } },
      clock,
    );
    const service = new P1ApplicationService(repository, {
      operations: [
        new ProductEntitlementFoundationModule(entitlements, clock, {
          creditBilling,
        }),
      ],
    });
    const payment = {
      actor: 'payment' as const,
      correlationId: 'corr-payment-add-on',
      userId: 'payment-service',
      workspaceId: owner.workspaceId,
    };
    const command = {
      action: 'payment_add_on_grant',
      payload: {
        offerId: 'credits-100',
        paymentEventId: 'waffo:order-add-on-1',
      },
    };

    const granted = await service.executeModule(
      payment,
      'entitlements',
      command,
      'waffo:order-add-on-1',
    );
    const replay = await service.executeModule(
      payment,
      'entitlements',
      command,
      'waffo:order-add-on-1',
    );

    assert.deepEqual(replay, granted);
    assert.deepEqual(ledger.listLots(owner.workspaceId), [
      {
        createdAt: '2026-08-03T00:00:00.000Z',
        expirationDate: '2026-08-10T00:00:00.000Z',
        grantIdempotencyKey: 'grant:package:waffo:order-add-on-1',
        id: 'package:waffo:order-add-on-1',
        originalCredits: 100,
        remainingCredits: 100,
        revision: 1,
        sourceRef: 'credits-100',
        transactionType: 'PURCHASE_PACKAGE',
        workspaceId: owner.workspaceId,
      },
    ]);

    await assert.rejects(
      service.executeModule(
        payment,
        'entitlements',
        {
          action: 'payment_add_on_grant',
          payload: {
            offerId: 'unknown-package',
            paymentEventId: 'waffo:order-add-on-unknown',
          },
        },
        'waffo:order-add-on-unknown',
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'INVALID_STATE',
    );
    assert.equal(ledger.listLots(owner.workspaceId).length, 1);

    await assert.rejects(
      service.executeModule(
        owner,
        'entitlements',
        command,
        'waffo:owner-forged-add-on',
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'FORBIDDEN',
    );
    await assert.rejects(
      service.executeModule(
        {
          actor: 'admin',
          correlationId: 'corr-admin-forged-add-on',
          userId: 'platform-admin',
          workspaceId: owner.workspaceId,
        },
        'entitlements',
        command,
        'waffo:admin-forged-add-on',
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'FORBIDDEN',
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
    // starter 文案 100 (D-123 初级 seed) + 5 surviving add-on units.
    assert.deepEqual(expired.usage.copy, {
      allowance: 105,
      available: 105,
      committed: 0,
      released: 0,
      reserved: 0,
    });
    assert.equal(
      grantLots
        .listLots(owner.workspaceId, 'copy')
        .filter((lot) => lot.transactionType === 'SUBSCRIPTION_RENEWAL')
        .reduce((total, lot) => total + lot.remainingAmount, 0),
      100,
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
      290,
    );

    now = new Date('2027-12-01T00:00:00.000Z');
    const later = await entitlements.getProjection(owner);
    assert.equal(later.plan?.tier, 'starter');
    assert.equal(later.usage.copy.available, 105);
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
