import assert from 'node:assert/strict';
import test from 'node:test';

import { merchantCreditDetailSchema } from './merchant-credit-detail.js';

test('merchant credit detail is strict and carries an explicit expired refund fact', () => {
  const detail = merchantCreditDetailSchema.parse({
    billing: {
      creditsThisPeriod: 1_300,
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
        operation: 'creation',
        occurredAt: '2026-08-03T00:00:00.000Z',
        refundDisposition: 'expired_uncredited',
        status: 'refunded',
        type: 'refund',
      },
    ],
  });

  assert.equal(detail.transactions[0]?.creditedAmount, 0);
  assert.equal(
    detail.transactions[0]?.refundDisposition,
    'expired_uncredited',
  );
  assert.equal(
    merchantCreditDetailSchema.safeParse({
      ...detail,
      billing: { ...detail.billing, providerSubscriptionId: 'private' },
    }).success,
    false,
  );
  assert.equal(
    merchantCreditDetailSchema.safeParse({
      ...detail,
      transactions: [{ ...detail.transactions[0], correlationId: 'private' }],
    }).success,
    false,
  );
});
