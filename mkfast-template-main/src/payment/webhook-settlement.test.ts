import assert from 'node:assert/strict';
import test from 'node:test';
import { Stripe } from 'stripe';
import {
  type CanonicalPaymentWebhook,
  PaymentWebhookConfigurationError,
  paymentWebhookErrorResponse,
  PaymentWebhookPayloadTooLargeError,
  PaymentWebhookSignatureError,
  paymentWebhookHttpResponse,
  readPaymentWebhookPayload,
  receivePaymentWebhook,
  refreshVerifiedWebhookSignature,
  settlePendingPaymentWebhooks,
  type PaymentWebhookClaim,
  type PaymentWebhookInboxPort,
} from './webhook-settlement';

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
