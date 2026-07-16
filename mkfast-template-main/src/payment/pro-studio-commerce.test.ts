import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ProStudioCommerceError,
  createProStudioCheckout,
  isProStudioPaymentProviderReady,
  resolveProStudioAddOnOffer,
  settlePendingProStudioActivations,
  settleVerifiedProStudioPayment,
  type ProStudioActivationClaim,
  type ProStudioCommerceStore,
} from './pro-studio-commerce';

const addOnEnvironment = {
  PRO_STUDIO_AMOUNT_CENTS: '29900',
  PRO_STUDIO_CURRENCY: 'CNY',
  PRO_STUDIO_OFFER_ID: 'pro-studio-v1',
  PRO_STUDIO_PAYMENT_TYPE: 'one_time',
  PRO_STUDIO_PRICE_ID: 'price-pro-studio',
};

test('the dedicated add-on catalog fails closed, freezes cadence and rejects every main-plan price', () => {
  const mainCatalog = {
    findPlanByPriceId(priceId: string) {
      return priceId === 'price-growth' ? { id: 'growth' } : undefined;
    },
  };
  for (const environment of [
    { ...addOnEnvironment, PRO_STUDIO_OFFER_ID: '' },
    { ...addOnEnvironment, PRO_STUDIO_PRICE_ID: 'price-growth' },
    {
      ...addOnEnvironment,
      PRO_STUDIO_PAYMENT_TYPE: 'subscription',
      PRO_STUDIO_INTERVAL: 'month',
    },
    {
      ...addOnEnvironment,
      PRO_STUDIO_PAYMENT_TYPE: 'one_time',
      PRO_STUDIO_INTERVAL: 'month',
    },
  ]) {
    assert.throws(
      () => resolveProStudioAddOnOffer(environment, mainCatalog),
      (error: unknown) =>
        error instanceof ProStudioCommerceError &&
        error.code === 'CHECKOUT_UNAVAILABLE'
    );
  }
  assert.deepEqual(resolveProStudioAddOnOffer(addOnEnvironment, mainCatalog), {
    offerId: 'pro-studio-v1',
    price: {
      amount: 29900,
      currency: 'CNY',
      priceId: 'price-pro-studio',
      type: 'one_time',
    },
    priceLabel: '¥299 一次性',
  });
});

test('purchase availability requires an enabled constructible provider and webhook secret', () => {
  assert.equal(
    isProStudioPaymentProviderReady(
      { enable: true, provider: 'stripe' },
      { STRIPE_SECRET_KEY: 'sk_test', STRIPE_WEBHOOK_SECRET: 'whsec_test' }
    ),
    true
  );
  assert.equal(
    isProStudioPaymentProviderReady(
      { enable: true, provider: 'creem' },
      { CREEM_API_KEY: 'creem_test', CREEM_WEBHOOK_SECRET: 'whsec_test' }
    ),
    true
  );
  for (const [config, environment] of [
    [
      { enable: false, provider: 'stripe' },
      { STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'wh' },
    ],
    [{ enable: true, provider: 'stripe' }, { STRIPE_SECRET_KEY: 'sk' }],
    [{ enable: true, provider: 'creem' }, { CREEM_WEBHOOK_SECRET: 'wh' }],
  ] as const) {
    assert.equal(isProStudioPaymentProviderReady(config, environment), false);
  }
});

function emptyStore(
  overrides: Partial<ProStudioCommerceStore> = {}
): ProStudioCommerceStore {
  return {
    async attachProviderCheckout() {},
    async claimPaidCheckout() {
      return null;
    },
    async createOwnerBinding() {
      return { id: 'binding-1' };
    },
    async getLatestWorkspaceClaimStatus() {
      return null;
    },
    async leaseActivation() {
      return null;
    },
    async leaseNextActivation() {
      return null;
    },
    async markActivated() {},
    async markActivationFailed() {},
    async markCheckoutFailed() {},
    ...overrides,
  };
}

test('checkout uses only the server-owned add-on offer and binds before provider access', async () => {
  const events: string[] = [];
  const offer = resolveProStudioAddOnOffer(addOnEnvironment, {
    findPlanByPriceId() {
      return undefined;
    },
  });
  const result = await createProStudioCheckout(
    {
      customerEmail: 'owner@example.test',
      customerName: 'Owner',
      ownerSessionId: 'session-1',
      ownerUserId: 'owner-1',
      workspaceId: 'workspace-1',
    },
    {
      offer,
      provider: {
        name: 'stripe',
        async validateServerCatalogOffer(input) {
          events.push(`validate:${input.offerId}:${input.price.amount}`);
        },
        async createCheckout(input) {
          events.push(
            `provider:${input.serverCatalogOffer?.kind}:${input.serverCatalogOffer?.offerId}`
          );
          assert.equal(input.planId, 'pro-studio-v1');
          assert.equal(input.priceId, 'price-pro-studio');
          return { id: 'checkout-1', url: 'https://pay.example/checkout-1' };
        },
      },
      store: emptyStore({
        async attachProviderCheckout(input) {
          events.push(`attach:${input.providerCheckoutId}`);
        },
        async createOwnerBinding(input) {
          events.push(`bind:${input.offerId}:${input.workspaceId}`);
          return { id: 'binding-1' };
        },
      }),
      urls: {
        cancelUrl: 'https://app.example/pro-studio?checkout=cancelled',
        successUrl: 'https://app.example/pro-studio?checkout=success',
      },
    }
  );
  assert.deepEqual(events, [
    'bind:pro-studio-v1:workspace-1',
    'validate:pro-studio-v1:29900',
    'provider:pro_studio_add_on:pro-studio-v1',
    'attach:checkout-1',
  ]);
  assert.deepEqual(result, {
    checkoutId: 'checkout-1',
    url: 'https://pay.example/checkout-1',
  });
});

test('checkout never reaches the provider when the current session is not an owner', async () => {
  let providerCalls = 0;
  await assert.rejects(
    createProStudioCheckout(
      {
        customerEmail: 'operator@example.test',
        customerName: 'Operator',
        ownerSessionId: 'session-operator',
        ownerUserId: 'operator-1',
        workspaceId: 'workspace-1',
      },
      {
        offer: resolveProStudioAddOnOffer(addOnEnvironment, {
          findPlanByPriceId: () => undefined,
        }),
        provider: {
          name: 'stripe',
          async validateServerCatalogOffer() {
            providerCalls += 1;
          },
          async createCheckout() {
            providerCalls += 1;
            return { id: 'forbidden', url: 'https://pay.example/forbidden' };
          },
        },
        store: emptyStore({
          async createOwnerBinding() {
            return null;
          },
        }),
        urls: {
          cancelUrl: 'https://app.example',
          successUrl: 'https://app.example',
        },
      }
    ),
    (error: unknown) =>
      error instanceof ProStudioCommerceError && error.code === 'OWNER_REQUIRED'
  );
  assert.equal(providerCalls, 0);
});

test('checkout rejects a workspace with a paid claim awaiting or after activation', async () => {
  for (const status of ['pending', 'activating', 'active'] as const) {
    let sideEffects = 0;
    await assert.rejects(
      createProStudioCheckout(
        {
          customerEmail: 'owner@example.test',
          customerName: 'Owner',
          ownerSessionId: 'session-1',
          ownerUserId: 'owner-1',
          workspaceId: 'workspace-1',
        },
        {
          offer: resolveProStudioAddOnOffer(addOnEnvironment, {
            findPlanByPriceId: () => undefined,
          }),
          provider: {
            name: 'stripe',
            async validateServerCatalogOffer() {
              sideEffects += 1;
            },
            async createCheckout() {
              sideEffects += 1;
              return { id: 'duplicate', url: 'https://pay.example/duplicate' };
            },
          },
          store: emptyStore({
            async createOwnerBinding() {
              sideEffects += 1;
              return { id: 'duplicate' };
            },
            async getLatestWorkspaceClaimStatus() {
              return status;
            },
          }),
          urls: {
            cancelUrl: 'https://app.example',
            successUrl: 'https://app.example',
          },
        }
      ),
      (error: unknown) =>
        error instanceof ProStudioCommerceError &&
        error.code ===
          (status === 'active' ? 'ALREADY_PURCHASED' : 'ACTIVATION_PENDING'),
      status
    );
    assert.equal(sideEffects, 0, status);
  }
});

test('checkout rejects provider catalog drift before checkout and marks its owner binding failed', async () => {
  let bindings = 0;
  let failed = 0;
  await assert.rejects(
    createProStudioCheckout(
      {
        customerEmail: 'owner@example.test',
        customerName: 'Owner',
        ownerSessionId: 'session-1',
        ownerUserId: 'owner-1',
        workspaceId: 'workspace-1',
      },
      {
        offer: resolveProStudioAddOnOffer(addOnEnvironment, {
          findPlanByPriceId: () => undefined,
        }),
        provider: {
          name: 'stripe',
          async createCheckout() {
            throw new Error('must not create checkout');
          },
          async validateServerCatalogOffer() {
            throw new Error('amount mismatch');
          },
        },
        store: emptyStore({
          async createOwnerBinding() {
            bindings += 1;
            return { id: 'unexpected' };
          },
          async markCheckoutFailed() {
            failed += 1;
          },
        }),
        urls: {
          cancelUrl: 'https://app.example',
          successUrl: 'https://app.example',
        },
      }
    ),
    (error: unknown) =>
      error instanceof ProStudioCommerceError &&
      error.code === 'CHECKOUT_UNAVAILABLE'
  );
  assert.equal(bindings, 1);
  assert.equal(failed, 1);
});

const activationClaim: ProStudioActivationClaim = {
  activationAttempts: 1,
  offerId: 'pro-studio-v1',
  ownerUserId: 'owner-1',
  paymentEventId: 'stripe:event-paid-1',
  paymentId: 'payment-1',
  provider: 'stripe',
  providerCheckoutId: 'checkout-1',
  providerEventId: 'event-paid-1',
  workspaceId: 'workspace-1',
};

test('settlement claims only the exact verified provider event and persists a retry after activation failure', async () => {
  const exactEvent = {
    eventType: 'checkout.session.completed' as const,
    provider: 'stripe' as const,
    providerEventId: 'event-paid-1',
    reference: { id: 'checkout-1', kind: 'checkout' as const },
  };
  const calls: string[] = [];
  const store = emptyStore({
    async claimPaidCheckout(event) {
      assert.deepEqual(event, exactEvent);
      calls.push(`claim:${event.provider}:${event.providerEventId}`);
      return activationClaim;
    },
    async leaseActivation(paymentEventId) {
      calls.push(`lease:${paymentEventId}`);
      return activationClaim;
    },
    async markActivationFailed(input) {
      calls.push(
        `retry:${input.paymentEventId}:${input.availableAt.toISOString()}`
      );
    },
  });
  await assert.rejects(
    settleVerifiedProStudioPayment(exactEvent, {
      async activate() {
        throw new Error('Canvas unavailable');
      },
      clock: () => new Date('2026-07-16T00:00:00.000Z'),
      store,
    }),
    /Canvas unavailable/u
  );
  assert.deepEqual(calls, [
    'claim:stripe:event-paid-1',
    'lease:stripe:event-paid-1',
    'retry:stripe:event-paid-1:2026-07-16T00:00:02.000Z',
  ]);
});

test('the scheduled retry worker activates due claims without another webhook', async () => {
  const calls: string[] = [];
  let leased = false;
  const store = emptyStore({
    async leaseNextActivation() {
      if (leased) return null;
      leased = true;
      return { ...activationClaim, activationAttempts: 2 };
    },
    async markActivated(paymentEventId) {
      calls.push(`active:${paymentEventId}`);
    },
  });
  const result = await settlePendingProStudioActivations({
    async activate(claim) {
      calls.push(`activate:${claim.providerEventId}`);
    },
    limit: 10,
    store,
  });
  assert.deepEqual(result, { activated: 1, failed: 0 });
  assert.deepEqual(calls, [
    'activate:event-paid-1',
    'active:stripe:event-paid-1',
  ]);
});
