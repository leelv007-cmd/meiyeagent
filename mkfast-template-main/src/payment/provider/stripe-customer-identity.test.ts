import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STRIPE_USER_ID_METADATA_KEY,
  StripeCustomerIdentityError,
  assertStripeCustomerBoundToUser,
  verifyOrBackfillHistoricalStripeSubscriptionCustomer,
} from './stripe-customer-identity';

test('accepts a historical Stripe customer only when its metadata matches the local user', async () => {
  await assert.doesNotReject(
    assertStripeCustomerBoundToUser(
      {
        id: 'cus-user-a',
        metadata: { [STRIPE_USER_ID_METADATA_KEY]: 'user-a' },
      },
      'user-a'
    )
  );
});

test('rejects a same-email Stripe customer owned by another immutable user', async () => {
  await assert.rejects(
    assertStripeCustomerBoundToUser(
      {
        id: 'cus-user-b',
        metadata: { [STRIPE_USER_ID_METADATA_KEY]: 'user-b' },
      },
      'user-a'
    ),
    (error: unknown) =>
      error instanceof StripeCustomerIdentityError &&
      error.code === 'STRIPE_CUSTOMER_IDENTITY_MISMATCH'
  );
});

test('rejects deleted and unbound historical Stripe customers', async () => {
  for (const customer of [
    { deleted: true, id: 'cus-deleted' },
    { id: 'cus-without-metadata' },
  ]) {
    await assert.rejects(
      assertStripeCustomerBoundToUser(customer, 'user-a'),
      (error: unknown) =>
        error instanceof StripeCustomerIdentityError &&
        error.code === 'STRIPE_CUSTOMER_IDENTITY_MISMATCH'
    );
  }
});

test('rejects a historical subscription webhook whose remote customer belongs to another user', async () => {
  let lookedUpCustomerId = '';

  await assert.rejects(
    verifyOrBackfillHistoricalStripeSubscriptionCustomer(
      { id: 'cus-user-b' },
      {
        async findUserIdByCustomerId(customerId) {
          lookedUpCustomerId = customerId;
          return 'user-a';
        },
        async retrieveCustomer() {
          return {
            id: 'cus-user-b',
            metadata: { [STRIPE_USER_ID_METADATA_KEY]: 'user-b' },
          };
        },
        async updateCustomerMetadata() {
          throw new Error('must not update mismatched metadata');
        },
      }
    ),
    (error: unknown) =>
      error instanceof StripeCustomerIdentityError &&
      error.code === 'STRIPE_CUSTOMER_IDENTITY_MISMATCH'
  );

  assert.equal(lookedUpCustomerId, 'cus-user-b');
});
