import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { Stripe } from 'stripe';
import { DatabaseBindingUnavailableError } from '@/db/runtime';
import {
  type CanonicalPaymentWebhook,
  PaymentWebhookConfigurationError,
  paymentWebhookErrorResponse,
  PaymentWebhookPayloadTooLargeError,
  PaymentWebhookSignatureError,
  paymentWebhookHttpResponse,
  readPaymentWebhookPayload,
  receiveAndSettlePaymentWebhook,
  receivePaymentWebhook,
  refreshVerifiedWebhookSignature,
  settlePendingPaymentWebhooks,
  type PaymentWebhookClaim,
  type PaymentWebhookInboxPort,
} from './webhook-settlement';

function claim(
  provider: 'stripe' | 'creem' | 'waffo',
  providerEventId: string
): PaymentWebhookClaim {
  return {
    attemptCount: 1,
    claimToken: `claim-${providerEventId}`,
    eventType: 'checkout.session.completed',
    payload: JSON.stringify({ id: providerEventId }),
    provider,
    providerEventId,
    signature: 'verified-signature',
  };
}

test('webhook payload limits reject declared and streamed bodies over 512 KiB', async () => {
  const oversizedLength = new Request('https://example.test/webhook', {
    body: 'small',
    headers: { 'content-length': String(512 * 1024 + 1) },
    method: 'POST',
  });
  await assert.rejects(readPaymentWebhookPayload(oversizedLength), {
    name: 'PaymentWebhookPayloadTooLargeError',
  });

  const streamedBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(512 * 1024));
      controller.enqueue(new Uint8Array([1]));
      controller.close();
    },
  });
  const oversizedStream = new Request('https://example.test/webhook', {
    body: streamedBody,
    duplex: 'half',
    method: 'POST',
  } as RequestInit & { duplex: 'half' });
  await assert.rejects(readPaymentWebhookPayload(oversizedStream), {
    name: 'PaymentWebhookPayloadTooLargeError',
  });

  const response = paymentWebhookErrorResponse(
    new PaymentWebhookPayloadTooLargeError()
  );
  assert.equal(response.status, 413);
});

test('an invalid Stripe signature is rejected before the verified inbox', async () => {
  let received = false;
  const inbox: PaymentWebhookInboxPort = {
    async receive() {
      received = true;
      return 'accepted';
    },
    async claimNext() {
      return null;
    },
    async checkpointApplied() {},
    async complete() {},
    async retry() {},
  };

  await assert.rejects(
    receivePaymentWebhook(
      {
        payload: JSON.stringify({
          id: 'evt_signature_rejected',
          type: 'checkout.session.completed',
        }),
        provider: 'stripe',
        signature: 't=1720000000,v1=invalid',
      },
      {
        inbox,
        secrets: { stripeWebhookSecret: 'whsec_contract_test' },
      }
    ),
    (error: unknown) => error instanceof PaymentWebhookSignatureError
  );
  assert.equal(received, false);
});

test('a forged Stripe event cannot reserve the id used by a later verified delivery', async () => {
  const payload = JSON.stringify({
    id: 'evt_forged_then_verified',
    type: 'checkout.session.completed',
  });
  const webhookSecret = 'whsec_forged_then_verified';
  const receivedIds: string[] = [];
  const inbox: PaymentWebhookInboxPort = {
    async receive(event) {
      receivedIds.push(event.providerEventId);
      return 'accepted';
    },
    async claimNext() {
      return null;
    },
    async checkpointApplied() {},
    async complete() {},
    async retry() {},
  };

  await assert.rejects(
    receivePaymentWebhook(
      {
        payload,
        provider: 'stripe',
        signature: 't=1720000000,v1=forged',
      },
      { inbox, secrets: { stripeWebhookSecret: webhookSecret } }
    ),
    (error: unknown) => error instanceof PaymentWebhookSignatureError
  );
  assert.deepEqual(receivedIds, []);

  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });
  assert.equal(
    await receivePaymentWebhook(
      { payload, provider: 'stripe', signature },
      { inbox, secrets: { stripeWebhookSecret: webhookSecret } }
    ),
    'accepted'
  );
  assert.deepEqual(receivedIds, ['evt_forged_then_verified']);
});

test('a verified Stripe event reaches the inbox with its canonical identity', async () => {
  const payload = JSON.stringify({
    id: 'evt_verified_contract',
    type: 'checkout.session.completed',
  });
  const webhookSecret = 'whsec_verified_contract';
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });
  let received: CanonicalPaymentWebhook | null = null;
  const inbox: PaymentWebhookInboxPort = {
    async receive(event) {
      received = event;
      return 'accepted';
    },
    async claimNext() {
      return null;
    },
    async checkpointApplied() {},
    async complete() {},
    async retry() {},
  };

  const result = await receivePaymentWebhook(
    { payload, provider: 'stripe', signature },
    { inbox, secrets: { stripeWebhookSecret: webhookSecret } }
  );

  assert.equal(result, 'accepted');
  assert.deepEqual(received, {
    eventType: 'checkout.session.completed',
    payload,
    provider: 'stripe',
    providerEventId: 'evt_verified_contract',
    signature,
  });
});

test('a verified Creem event reaches the same provider-scoped inbox', async () => {
  const payload = JSON.stringify({
    id: 'evt_creem_verified_contract',
    eventType: 'subscription.paid',
  });
  const webhookSecret = 'creem_verified_contract';
  const signature = await hmacHex(payload, webhookSecret);
  let received: CanonicalPaymentWebhook | null = null;
  const inbox: PaymentWebhookInboxPort = {
    async receive(event) {
      received = event;
      return 'accepted';
    },
    async claimNext() {
      return null;
    },
    async checkpointApplied() {},
    async complete() {},
    async retry() {},
  };

  const result = await receivePaymentWebhook(
    { payload, provider: 'creem', signature },
    { inbox, secrets: { creemWebhookSecret: webhookSecret } }
  );

  assert.equal(result, 'accepted');
  assert.deepEqual(received, {
    eventType: 'subscription.paid',
    payload,
    provider: 'creem',
    providerEventId: 'evt_creem_verified_contract',
    signature,
  });
});

test('Waffo only accepts an RSA-signed raw delivery into the inbox', async () => {
  const payload = JSON.stringify({
    data: {
      orderId: 'waffo-order-001',
    },
    eventId: 'waffo-order-001',
    eventType: 'subscription.activated',
    id: 'waffo-delivery-001',
    mode: 'test',
  });
  const trusted = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs1' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  });
  const untrusted = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs1' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  });
  const signature = waffoSignature(payload, trusted.privateKey);
  let received: CanonicalPaymentWebhook | null = null;
  const inbox: PaymentWebhookInboxPort = {
    async receive(event) {
      received = event;
      return 'accepted';
    },
    async claimNext() {
      return null;
    },
    async checkpointApplied() {},
    async complete() {},
    async retry() {},
  };

  await assert.rejects(
    receivePaymentWebhook(
      { payload, provider: 'waffo', signature },
      {
        inbox,
        secrets: {
          waffoEnvironment: 'test',
          waffoWebhookPublicKeys: { test: untrusted.publicKey },
        },
      }
    ),
    (error: unknown) => error instanceof PaymentWebhookSignatureError
  );
  assert.equal(received, null);

  assert.equal(
    await receivePaymentWebhook(
      { payload, provider: 'waffo', signature },
      {
        inbox,
        secrets: {
          waffoEnvironment: 'test',
          waffoWebhookPublicKeys: { test: trusted.publicKey },
        },
      }
    ),
    'accepted'
  );
  assert.deepEqual(received, {
    eventType: 'subscription.activated',
    payload,
    provider: 'waffo',
    providerEventId: 'waffo-delivery-001',
    signature,
  });
});

test('Waffo does not accept a production-signed delivery into the Test inbox', async () => {
  const payload = JSON.stringify({
    data: { orderId: 'waffo-order-prod-001' },
    eventId: 'waffo-payment-prod-001',
    eventType: 'subscription.activated',
    id: 'waffo-delivery-prod-001',
  });
  const production = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs1' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  });
  const test = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs1' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  });
  let received = false;
  const inbox: PaymentWebhookInboxPort = {
    async receive() {
      received = true;
      return 'accepted';
    },
    async claimNext() {
      return null;
    },
    async checkpointApplied() {},
    async complete() {},
    async retry() {},
  };

  await assert.rejects(
    receivePaymentWebhook(
      {
        payload,
        provider: 'waffo',
        signature: waffoSignature(payload, production.privateKey),
      },
      {
        inbox,
        secrets: {
          waffoEnvironment: 'test',
          waffoWebhookPublicKeys: { test: test.publicKey },
        },
      }
    ),
    (error: unknown) => error instanceof PaymentWebhookSignatureError
  );
  assert.equal(received, false);
});

test('Waffo production authority accepts only the configured production key and mode', async () => {
  const payload = JSON.stringify({
    data: { orderId: 'waffo-order-production-001' },
    eventId: 'waffo-payment-production-001',
    eventType: 'subscription.activated',
    id: 'waffo-delivery-production-001',
    mode: 'prod',
  });
  const production = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs1' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  });
  const inbox: PaymentWebhookInboxPort = {
    async receive() {
      return 'accepted';
    },
    async claimNext() {
      return null;
    },
    async checkpointApplied() {},
    async complete() {},
    async retry() {},
  };

  assert.equal(
    await receivePaymentWebhook(
      {
        payload,
        provider: 'waffo',
        signature: waffoSignature(payload, production.privateKey),
      },
      {
        inbox,
        secrets: {
          waffoEnvironment: 'production',
          waffoWebhookPublicKeys: { prod: production.publicKey },
        },
      }
    ),
    'accepted'
  );
});

test('Waffo Test authority rejects a valid Test-key signature carrying production mode', async () => {
  const payload = JSON.stringify({
    data: { orderId: 'waffo-order-mode-mismatch-001' },
    eventId: 'waffo-payment-mode-mismatch-001',
    eventType: 'subscription.activated',
    id: 'waffo-delivery-mode-mismatch-001',
    mode: 'prod',
  });
  const testKey = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs1' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  });
  const inbox: PaymentWebhookInboxPort = {
    async receive() {
      return 'accepted';
    },
    async claimNext() {
      return null;
    },
    async checkpointApplied() {},
    async complete() {},
    async retry() {},
  };

  await assert.rejects(
    receivePaymentWebhook(
      {
        payload,
        provider: 'waffo',
        signature: waffoSignature(payload, testKey.privateKey),
      },
      {
        inbox,
        secrets: {
          waffoEnvironment: 'test',
          waffoWebhookPublicKeys: { test: testKey.publicKey },
        },
      }
    ),
    (error: unknown) => error instanceof PaymentWebhookSignatureError
  );
});

test('Waffo requires an explicit current-environment public key before verification', async () => {
  const inbox: PaymentWebhookInboxPort = {
    async receive() {
      return 'accepted';
    },
    async claimNext() {
      return null;
    },
    async checkpointApplied() {},
    async complete() {},
    async retry() {},
  };

  await assert.rejects(
    receivePaymentWebhook(
      {
        payload: JSON.stringify({ id: 'waffo-delivery-unconfigured' }),
        provider: 'waffo',
        signature: 't=1,v1=invalid',
      },
      { inbox, secrets: { waffoEnvironment: 'test' } }
    ),
    (error: unknown) => error instanceof PaymentWebhookConfigurationError
  );
});

function waffoSignature(payload: string, privateKey: string) {
  const timestamp = Date.now();
  const signer = createSign('RSA-SHA256');
  signer.update(`${timestamp}.${payload}`);
  signer.end();
  return `t=${timestamp},v1=${signer.sign(privateKey).toString('base64')}`;
}

async function hmacHex(payload: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign']
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

test('a busy verified event is retryable and is never acknowledged with 200', async () => {
  const response = paymentWebhookHttpResponse('busy');

  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), '30');
  assert.deepEqual(await response.json(), {
    received: false,
    retryable: true,
  });
});

test('an accepted delivery settles only its durable record before acknowledgement', async () => {
  const payload = JSON.stringify({
    id: 'evt_route_settlement',
    type: 'checkout.session.completed',
  });
  const webhookSecret = 'whsec_route_settlement';
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });
  const calls: string[] = [];
  const inbox: PaymentWebhookInboxPort = {
    async receive() {
      calls.push('received');
      return 'accepted';
    },
    async claimNext() {
      return null;
    },
    async checkpointApplied() {},
    async complete() {},
    async retry() {},
  };

  const receipt = await receiveAndSettlePaymentWebhook(
    { payload, provider: 'stripe', signature },
    {
      inbox,
      secrets: { stripeWebhookSecret: webhookSecret },
      settle: async (delivery) => {
        calls.push(`settled:${delivery.provider}:${delivery.providerEventId}`);
        return { completed: 1, failed: 0 };
      },
    }
  );

  assert.equal(receipt, 'accepted');
  assert.deepEqual(calls, ['received', 'settled:stripe:evt_route_settlement']);
});

test('a settlement failure remains retryable instead of acknowledging the delivery', async () => {
  const payload = JSON.stringify({
    id: 'evt_route_retry',
    type: 'checkout.session.completed',
  });
  const webhookSecret = 'whsec_route_retry';
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });
  const inbox: PaymentWebhookInboxPort = {
    async receive() {
      return 'accepted';
    },
    async claimNext() {
      return null;
    },
    async checkpointApplied() {},
    async complete() {},
    async retry() {},
  };

  await assert.rejects(
    receiveAndSettlePaymentWebhook(
      { payload, provider: 'stripe', signature },
      {
        inbox,
        secrets: { stripeWebhookSecret: webhookSecret },
        settle: async () => ({ completed: 0, failed: 1 }),
      }
    ),
    { name: 'PaymentWebhookSettlementDeferredError' }
  );
});

test('an accepted delivery is retryable when its durable claim is not completed', async () => {
  const payload = JSON.stringify({
    id: 'evt_route_not_claimed',
    type: 'checkout.session.completed',
  });
  const webhookSecret = 'whsec_route_not_claimed';
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });
  const inbox: PaymentWebhookInboxPort = {
    async receive() {
      return 'accepted';
    },
    async claimNext() {
      return null;
    },
    async checkpointApplied() {},
    async complete() {},
    async retry() {},
  };

  await assert.rejects(
    receiveAndSettlePaymentWebhook(
      { payload, provider: 'stripe', signature },
      {
        inbox,
        secrets: { stripeWebhookSecret: webhookSecret },
        settle: async () => ({ completed: 0, failed: 0 }),
      }
    ),
    { name: 'PaymentWebhookSettlementDeferredError' }
  );
});

test('webhook verification failures and missing secrets fail closed', async () => {
  const invalid = paymentWebhookErrorResponse(
    new PaymentWebhookSignatureError()
  );
  const unavailable = paymentWebhookErrorResponse(
    new PaymentWebhookConfigurationError('stripe')
  );

  assert.equal(invalid.status, 400);
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get('retry-after'), '60');
  assert.equal(
    paymentWebhookErrorResponse(new DatabaseBindingUnavailableError()).status,
    503
  );
});

test('the settlement worker persists a retry when downstream settlement fails', async () => {
  const claim: PaymentWebhookClaim = {
    attemptCount: 1,
    claimToken: 'claim-contract-1',
    eventType: 'checkout.session.completed',
    payload: '{"id":"evt_retry"}',
    provider: 'stripe',
    providerEventId: 'evt_retry',
    signature: 'verified-signature',
  };
  const mutations: string[] = [];
  let claimed = false;
  const inbox: PaymentWebhookInboxPort = {
    async receive() {
      return 'accepted';
    },
    async claimNext() {
      if (claimed) return null;
      claimed = true;
      return claim;
    },
    async complete() {
      mutations.push('completed');
    },
    async checkpointApplied(current, event) {
      mutations.push(
        `applied:${current.claimToken}:${event?.providerEventId ?? 'none'}`
      );
    },
    async retry(current, errorCode) {
      mutations.push(`retry:${current.claimToken}:${errorCode}`);
    },
  };

  const result = await settlePendingPaymentWebhooks(
    { limit: 5 },
    {
      inbox,
      settlement: {
        async apply() {
          return {
            eventType: 'checkout.session.completed',
            provider: 'stripe',
            providerEventId: 'evt_retry',
            reference: { id: 'checkout-retry', kind: 'checkout' },
          };
        },
        async settle() {
          throw Object.assign(new Error('Core unavailable'), {
            code: 'CORE_UNAVAILABLE',
          });
        },
      },
    }
  );

  assert.deepEqual(result, { completed: 0, failed: 1 });
  assert.deepEqual(mutations, [
    'applied:claim-contract-1:evt_retry',
    'retry:claim-contract-1:CORE_UNAVAILABLE',
  ]);
});

test('targeted settlement does not claim an unrelated poison delivery', async () => {
  const current = claim('stripe', 'evt_current');
  const poison = claim('stripe', 'evt_poison');
  const requested: Array<string | undefined> = [];
  const settled: string[] = [];
  let currentClaimed = false;
  const inbox: PaymentWebhookInboxPort = {
    async receive() {
      return 'accepted';
    },
    async claimNext(delivery) {
      requested.push(delivery?.providerEventId);
      if (
        delivery?.providerEventId !== current.providerEventId ||
        currentClaimed
      ) {
        return poison;
      }
      currentClaimed = true;
      return current;
    },
    async checkpointApplied() {},
    async complete() {},
    async retry() {},
  };

  const result = await settlePendingPaymentWebhooks(
    {
      delivery: {
        provider: current.provider,
        providerEventId: current.providerEventId,
      },
      limit: 1,
    },
    {
      inbox,
      settlement: {
        async apply(delivery) {
          return {
            eventType: 'checkout.session.completed',
            provider: delivery.provider,
            providerEventId: delivery.providerEventId,
            reference: {
              id: `checkout:${delivery.providerEventId}`,
              kind: 'checkout',
            },
          };
        },
        async settle(event) {
          settled.push(event.providerEventId);
        },
      },
    }
  );

  assert.deepEqual(result, { completed: 1, failed: 0 });
  assert.deepEqual(requested, ['evt_current']);
  assert.deepEqual(settled, ['evt_current']);
});

test('a durable Stripe event receives a fresh internal signature before delayed settlement', async () => {
  const payload = JSON.stringify({
    id: 'evt_delayed_settlement',
    type: 'checkout.session.completed',
  });
  const webhookSecret = 'whsec_delayed_contract';
  const signature = await refreshVerifiedWebhookSignature(
    {
      attemptCount: 2,
      claimToken: 'claim-delayed',
      eventType: 'checkout.session.completed',
      payload,
      provider: 'stripe',
      providerEventId: 'evt_delayed_settlement',
      signature: 't=1,v1=expired',
    },
    { stripeWebhookSecret: webhookSecret },
    () => new Date('2026-07-22T00:00:00.000Z')
  );
  const stripe = new Stripe('sk_test_delayed_contract');

  const event = await stripe.webhooks.constructEventAsync(
    payload,
    signature,
    webhookSecret,
    undefined,
    undefined,
    Date.parse('2026-07-22T00:00:00.000Z')
  );
  assert.equal(event.id, 'evt_delayed_settlement');
});

test('a retried settlement does not repeat an already checkpointed provider write', async () => {
  let claimed = false;
  let settled = '';
  let completed = false;
  const appliedEvent = {
    eventType: 'checkout.session.completed' as const,
    provider: 'stripe' as const,
    providerEventId: 'evt_checkpointed',
    reference: { id: 'checkout-checkpointed', kind: 'checkout' as const },
  };
  const inbox: PaymentWebhookInboxPort = {
    async receive() {
      return 'accepted';
    },
    async claimNext() {
      if (claimed) return null;
      claimed = true;
      return {
        appliedEvent,
        attemptCount: 2,
        claimToken: 'claim-checkpointed',
        eventType: appliedEvent.eventType,
        payload: '{"id":"evt_checkpointed"}',
        provider: 'stripe',
        providerEventId: appliedEvent.providerEventId,
        signature: 'verified-signature',
      };
    },
    async checkpointApplied() {
      assert.fail('checkpoint must not repeat');
    },
    async complete() {
      completed = true;
    },
    async retry() {},
  };

  const result = await settlePendingPaymentWebhooks(
    { limit: 1 },
    {
      inbox,
      settlement: {
        async apply() {
          assert.fail('provider write must not repeat');
        },
        async settle(event) {
          settled = event.providerEventId;
        },
      },
    }
  );

  assert.deepEqual(result, { completed: 1, failed: 0 });
  assert.equal(settled, 'evt_checkpointed');
  assert.equal(completed, true);
});
