import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PaymentRecordBusinessKeyConflictError,
  persistPaymentRecordEffect,
  type PaymentRecordEffectInput,
  type PaymentRecordEffectStore,
} from './payment-record-effect';

test('a durable checkout-session business key makes a reclaimed effect a no-op', async () => {
  const rows = new Set<string>();
  let writes = 0;
  const store: PaymentRecordEffectStore = {
    async insertOnce(input) {
      if (rows.has(input.sessionId)) return 'already_applied';
      rows.add(input.sessionId);
      writes += 1;
      return 'applied';
    },
  };

  const first = await persistPaymentRecordEffect(
    paymentRecord('cs_one_time_without_invoice'),
    store
  );
  // Simulate process death after provider apply and before outbox checkpoint.
  const reclaimed = await persistPaymentRecordEffect(
    paymentRecord('cs_one_time_without_invoice'),
    store
  );

  assert.equal(first, 'applied');
  assert.equal(reclaimed, 'already_applied');
  assert.equal(writes, 1);
});

test('a conflicting payment record is not silently treated as an applied effect', async () => {
  const store: PaymentRecordEffectStore = {
    async insertOnce() {
      return 'conflict';
    },
  };

  await assert.rejects(
    persistPaymentRecordEffect(paymentRecord('cs_conflict'), store),
    PaymentRecordBusinessKeyConflictError
  );
});

function paymentRecord(sessionId: string): PaymentRecordEffectInput {
  return {
    customerId: 'customer-1',
    paid: true,
    priceId: 'price-one-time',
    sessionId,
    status: 'completed',
    type: 'one_time',
    userId: 'user-1',
  };
}
