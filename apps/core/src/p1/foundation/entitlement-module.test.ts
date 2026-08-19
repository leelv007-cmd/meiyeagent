import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { P1ApplicationService } from './application-service.js';
import { ProductEntitlementFoundationModule } from './entitlement-module.js';
import {
  ProductEntitlementApplicationService,
  RecordedAutoTopUpPaymentPort,
} from './entitlement-service.js';
import { MemoryFoundationRepository } from './memory-repository.js';
import { CreditBillingService } from '../credit-billing/credit-billing-service.js';
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
      credits: 100,
      expireDays: 7,
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

  it('projects authoritative credits without synthesizing retired resource buckets', async () => {
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
    })) as { credits: { availableCredits: number } };

    assert.equal(projection.credits.availableCredits, 100);
    assert.deepEqual(Object.keys(projection), ['credits']);
  });

  it('projects the nearest unexpired credit lot through the merchant balance seams', async () => {
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
    const grant = async (
      id: string,
      credits: number,
      expirationDate: string,
    ) =>
      ledger.grant({
        id,
        workspaceId: owner.workspaceId,
        credits,
        expirationDate,
        transactionType: 'PURCHASE_PACKAGE',
        sourceRef: 'test-package',
        actorId: owner.userId,
        correlationId: owner.correlationId,
        createdAt: '2026-07-01T00:00:00.000Z',
      });

    await grant('credit-lot-expired', 99, '2026-07-31T23:59:59.000Z');
    await grant('credit-lot-later', 40, '2026-08-10T00:00:00.000Z');
    await grant('credit-lot-soonest', 15, '2026-08-03T00:00:00.000Z');

    const expected = {
      grantedCredits: 154,
      usedCredits: 0,
      refundedCredits: 0,
      expiredCredits: 99,
      availableCredits: 55,
      soonestExpiringLot: {
        remainingCredits: 15,
        expiresAt: '2026-08-03T00:00:00.000Z',
      },
    };
    const balance = await service.queryModule(owner, 'entitlements', {
      action: 'balance',
      payload: {},
    });
    const projection = (await service.queryModule(owner, 'entitlements', {
      action: 'projection',
      payload: {},
    })) as { credits: unknown };

    assert.deepEqual(balance, expected);
    assert.deepEqual(projection.credits, expected);
    await assert.rejects(
      service.queryModule(
        { ...owner, userId: 'non-owner-entitlement-module' },
        'entitlements',
        { action: 'balance', payload: {} },
      ),
      (error: unknown) =>
        error instanceof Error && 'code' in error && error.code === 'NOT_FOUND',
    );
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
          creditBilling: new CreditBillingService(
            new MemoryCreditLedger(),
            new MemoryCreditSubscriptionStore(),
            {
              async get() {
                return structuredClone(DEFAULT_CREDIT_PLAN_CATALOG);
              },
            },
            { async getPaymentMapping() { return null; } },
            clock,
          ),
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
        credits: 100,
        expireDays: 7,
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

    await assert.doesNotReject(
      service.executeModule(
        payment,
        'entitlements',
        {
          action: 'payment_add_on_grant',
          payload: {
            credits: 125,
            expireDays: 9,
            offerId: 'unknown-package',
            paymentEventId: 'waffo:order-add-on-unknown',
          },
        },
        'waffo:order-add-on-unknown',
      ),
    );
    assert.deepEqual(ledger.listLots(owner.workspaceId)[1], {
      createdAt: '2026-08-03T00:00:00.000Z',
      expirationDate: '2026-08-12T00:00:00.000Z',
      grantIdempotencyKey: 'grant:package:waffo:order-add-on-unknown',
      id: 'package:waffo:order-add-on-unknown',
      originalCredits: 125,
      remainingCredits: 125,
      revision: 1,
      sourceRef: 'unknown-package',
      transactionType: 'PURCHASE_PACKAGE',
      workspaceId: owner.workspaceId,
    });

    await assert.rejects(
      service.executeModule(
        payment,
        'entitlements',
        {
          action: 'payment_add_on_grant',
          payload: {
            offerId: 'credits-100',
            paymentEventId: 'waffo:order-missing-snapshot',
          },
        },
        'waffo:order-missing-snapshot',
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'INVALID_STATE',
    );

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

});
