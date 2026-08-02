import assert from 'node:assert/strict';
import test from 'node:test';

import { type GrantCreditsInput, MemoryCreditLedger } from './credit-ledger.js';
import { CreditBillingService } from './credit-billing-service.js';
import { DEFAULT_CREDIT_PLAN_CATALOG } from './credit-plan-catalog.js';
import { MemoryCreditSubscriptionStore } from './credit-subscription-scheduler.js';
import { E2ECreditDetailFixture } from './e2e-credit-detail-fixture.js';
import { ProductQuoteService } from '../product-billing/quote-service.js';

const now = new Date('2026-08-03T10:00:00.000Z');

test('E2E credit detail fixture seeds the real credit lifecycle idempotently', async () => {
  const ledger = new MemoryCreditLedger();
  const subscriptions = new MemoryCreditSubscriptionStore();
  const productBilling = new ProductQuoteService({ clock: () => now });
  const fixture = new E2ECreditDetailFixture({
    ledger,
    productBilling,
    subscriptions,
    clock: () => now,
  });

  assert.deepEqual(
    await fixture.seed({ workspaceId: 'workspace-e2e-credit-detail' }),
    { ready: true },
  );
  assert.deepEqual(
    await fixture.seed({ workspaceId: 'workspace-e2e-credit-detail-second' }),
    { ready: true },
  );
  assert.equal(
    ledger.listLots('workspace-e2e-credit-detail-second').length,
    6,
  );
  assert.equal(
    ledger
      .listLots('workspace-e2e-credit-detail')
      .some((lot) =>
        ledger
          .listLots('workspace-e2e-credit-detail-second')
          .some((otherLot) => otherLot.id === lot.id),
      ),
    false,
  );
  assert.deepEqual(
    await fixture.seed({ workspaceId: 'workspace-e2e-credit-detail' }),
    { ready: true },
  );

  const detail = await new CreditBillingService(
    ledger,
    subscriptions,
    {
      get: async () => ({
        addOns: [],
        cycleCoefficientBasisPoints: {
          monthly: 9_000,
          single_month: 10_000,
          yearly: 7_500,
        },
        plans: [],
        referenceNumbers: structuredClone(
          DEFAULT_CREDIT_PLAN_CATALOG.referenceNumbers,
        ),
        trialEnabled: true,
      }),
    },
    { getPaymentMapping: async () => null },
    () => now,
  ).detail('workspace-e2e-credit-detail');

  assert.deepEqual(detail.billing, {
    creditsThisPeriod: 500,
    interval: 'monthly',
    periodEndsAt: '2026-09-03T10:00:00.000Z',
    tier: 'starter',
  });
  assert.deepEqual(
    detail.lots.filter((lot) => lot.transactionType === 'PURCHASE_PACKAGE')
      .length,
    5,
  );
  assert.equal(
    detail.lots.some((lot) => lot.transactionType === 'SUBSCRIPTION_RENEWAL'),
    true,
  );
  assert.deepEqual(
    new Set(detail.transactions.map((transaction) => transaction.transactionType)),
    new Set([
      'SUBSCRIPTION_RENEWAL',
      'PURCHASE_PACKAGE',
      'USAGE',
      'REFUND',
      'EXPIRE',
    ]),
  );
  assert.equal(
    detail.transactions.some(
      (transaction) =>
        transaction.transactionType === 'REFUND' && transaction.credited === false,
    ),
    true,
  );

  const lotById = new Map(detail.lots.map((lot) => [lot.id, lot]));
  const usages = detail.transactions.filter(
    (transaction) => transaction.transactionType === 'USAGE',
  );
  assert.deepEqual(
    usages.map((usage) => lotById.get(usage.lotId)?.originalCredits).sort(),
    [2, 3, 4, 5],
  );
  assert.equal(
    detail.transactions.some(
      (transaction) =>
        transaction.transactionType === 'EXPIRE' &&
        lotById.get(transaction.lotId)?.originalCredits === 50,
    ),
    true,
  );

  const refunds = detail.transactions.filter(
    (transaction) => transaction.transactionType === 'REFUND',
  );
  assert.deepEqual(
    refunds.map((refund) => refund.credited).sort(),
    [false, true],
  );
  for (const refund of refunds) {
    const usage = detail.transactions.find(
      (transaction) => transaction.id === refund.relatedTransactionId,
    );
    assert.equal(usage?.lotId, refund.lotId);
  }

  const lifecycleByCredits = new Map(
    usages.map((usage) => {
      const taskId = usage.operationId.slice('consume:task:'.length);
      return [lotById.get(usage.lotId)?.originalCredits, productBilling.getUsage(taskId)?.status];
    }),
  );
  assert.deepEqual(lifecycleByCredits, new Map([
    [2, 'reserved'],
    [3, 'committed'],
    [4, 'refunded'],
    [5, 'refunded'],
  ]));

  const lifecycleStatuses = usages.map((usage) => {
    const taskId = usage.operationId.slice('consume:task:'.length);
    return productBilling.getUsage(taskId)?.status;
  });
  assert.deepEqual(
    lifecycleStatuses.sort(),
    ['committed', 'refunded', 'refunded', 'reserved'],
  );
});

test('E2E credit detail fixture resumes after an interrupted partial seed', async () => {
  const ledger = new MemoryCreditLedger();
  const subscriptions = new MemoryCreditSubscriptionStore();
  const productBilling = new ProductQuoteService({ clock: () => now });
  let grantAttempts = 0;
  const fixture = new E2ECreditDetailFixture({
    ledger: {
      consume: ledger.consume.bind(ledger),
      grant: async (input: GrantCreditsInput) => {
        grantAttempts += 1;
        if (grantAttempts === 2) throw new Error('interrupted seed');
        return ledger.grant(input);
      },
      listLots: ledger.listLots.bind(ledger),
      listTransactions: ledger.listTransactions.bind(ledger),
      refundUsageOperation: ledger.refundUsageOperation.bind(ledger),
    },
    productBilling,
    subscriptions,
    clock: () => now,
  });

  await assert.rejects(
    fixture.seed({ workspaceId: 'workspace-e2e-credit-detail-replay' }),
    /interrupted seed/u,
  );
  assert.equal(
    ledger.listLots('workspace-e2e-credit-detail-replay').length,
    1,
  );

  assert.deepEqual(
    await fixture.seed({ workspaceId: 'workspace-e2e-credit-detail-replay' }),
    { ready: true },
  );
  assert.equal(
    ledger.listLots('workspace-e2e-credit-detail-replay').length,
    6,
  );
  assert.equal(
    ledger
      .listTransactions('workspace-e2e-credit-detail-replay')
      .filter((transaction) => transaction.transactionType === 'USAGE').length,
    4,
  );
});
