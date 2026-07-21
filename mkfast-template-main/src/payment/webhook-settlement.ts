import { Stripe } from 'stripe';
import type { PaymentProviderName, VerifiedPaymentWebhookEvent } from './types';

export type PaymentWebhookReceipt = 'accepted' | 'busy' | 'processed';

export const PAYMENT_WEBHOOK_MAX_PAYLOAD_BYTES = 512 * 1024;

export interface CanonicalPaymentWebhook {
  eventType: string;
  payload: string;
  provider: PaymentProviderName;
  providerEventId: string;
  signature: string;
}

export interface PaymentWebhookClaim extends CanonicalPaymentWebhook {
  appliedEvent?: VerifiedPaymentWebhookEvent | null;
  attemptCount: number;
  claimToken: string;
}

export interface PaymentWebhookInboxPort {
  receive(event: CanonicalPaymentWebhook): Promise<PaymentWebhookReceipt>;
  claimNext(): Promise<PaymentWebhookClaim | null>;
  checkpointApplied(
    claim: PaymentWebhookClaim,
    event: VerifiedPaymentWebhookEvent | null
  ): Promise<void>;
  complete(claim: PaymentWebhookClaim): Promise<void>;
  retry(claim: PaymentWebhookClaim, errorCode: string): Promise<void>;
}

export interface PaymentWebhookSecrets {
  creemWebhookSecret?: string;
  stripeApiKey?: string;
  stripeWebhookSecret?: string;
}

export class PaymentWebhookSignatureError extends Error {
  constructor() {
    super('Payment webhook signature is invalid.');
    this.name = 'PaymentWebhookSignatureError';
  }
}

export class PaymentWebhookConfigurationError extends Error {
  constructor(provider: PaymentProviderName) {
    super(`${provider} webhook verification is not configured.`);
    this.name = 'PaymentWebhookConfigurationError';
  }
}

export class PaymentWebhookPayloadTooLargeError extends Error {
  constructor() {
    super('Payment webhook payload exceeds 512 KiB.');
    this.name = 'PaymentWebhookPayloadTooLargeError';
  }
}

export async function readPaymentWebhookPayload(request: Request) {
  const declaredLength = request.headers.get('content-length');
  if (
    declaredLength !== null &&
    /^\d+$/u.test(declaredLength) &&
    Number(declaredLength) > PAYMENT_WEBHOOK_MAX_PAYLOAD_BYTES
  ) {
    throw new PaymentWebhookPayloadTooLargeError();
  }

  if (!request.body) return '';

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let payload = '';
  let receivedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > PAYMENT_WEBHOOK_MAX_PAYLOAD_BYTES) {
      await reader.cancel();
      throw new PaymentWebhookPayloadTooLargeError();
    }
    payload += decoder.decode(value, { stream: true });
  }
  return payload + decoder.decode();
}

export async function receivePaymentWebhook(
  input: {
    payload: string;
    provider: PaymentProviderName;
    signature: string;
  },
  dependencies: {
    inbox: PaymentWebhookInboxPort;
    secrets: PaymentWebhookSecrets;
  }
) {
  const event = await verifyPaymentWebhook(input, dependencies.secrets);
  return dependencies.inbox.receive(event);
}

export function paymentWebhookHttpResponse(receipt: PaymentWebhookReceipt) {
  if (receipt === 'busy') {
    return Response.json(
      { received: false, retryable: true },
      { headers: { 'Retry-After': '30' }, status: 503 }
    );
  }
  return Response.json(
    { received: true, replayed: receipt === 'processed' },
    { status: 200 }
  );
}

export function paymentWebhookErrorResponse(error: unknown) {
  if (error instanceof PaymentWebhookPayloadTooLargeError) {
    return Response.json(
      { error: 'Webhook payload too large', received: false },
      { status: 413 }
    );
  }
  if (error instanceof PaymentWebhookSignatureError) {
    return Response.json(
      { error: 'Invalid webhook signature', received: false },
      { status: 400 }
    );
  }
  if (error instanceof PaymentWebhookConfigurationError) {
    return Response.json(
      { error: 'Webhook processing unavailable', received: false },
      { headers: { 'Retry-After': '60' }, status: 503 }
    );
  }
  return Response.json(
    { error: 'Webhook processing failed', received: false },
    { status: 500 }
  );
}

export async function verifyPaymentWebhook(
  input: {
    payload: string;
    provider: PaymentProviderName;
    signature: string;
  },
  secrets: PaymentWebhookSecrets
): Promise<CanonicalPaymentWebhook> {
  if (input.provider === 'creem') {
    const webhookSecret = secrets.creemWebhookSecret?.trim();
    if (!webhookSecret) {
      throw new PaymentWebhookConfigurationError('creem');
    }
    const expected = await hmacHex(input.payload, webhookSecret);
    if (!constantTimeEqual(expected, input.signature)) {
      throw new PaymentWebhookSignatureError();
    }
    try {
      const raw = JSON.parse(input.payload) as Record<string, unknown>;
      if (typeof raw.id !== 'string' || typeof raw.eventType !== 'string') {
        throw new Error('Creem event identity is missing.');
      }
      return {
        eventType: raw.eventType,
        payload: input.payload,
        provider: 'creem',
        providerEventId: raw.id,
        signature: input.signature,
      };
    } catch {
      throw new PaymentWebhookSignatureError();
    }
  }
  const webhookSecret = secrets.stripeWebhookSecret?.trim();
  if (!webhookSecret) {
    throw new PaymentWebhookConfigurationError('stripe');
  }
  try {
    const stripe = new Stripe(
      secrets.stripeApiKey?.trim() || 'sk_test_webhook_verification_only'
    );
    const event = await stripe.webhooks.constructEventAsync(
      input.payload,
      input.signature,
      webhookSecret
    );
    return {
      eventType: event.type,
      payload: input.payload,
      provider: 'stripe',
      providerEventId: event.id,
      signature: input.signature,
    };
  } catch {
    throw new PaymentWebhookSignatureError();
  }
}

export async function refreshVerifiedWebhookSignature(
  claim: PaymentWebhookClaim,
  secrets: PaymentWebhookSecrets,
  clock: () => Date = () => new Date()
) {
  if (claim.provider === 'stripe') {
    const secret = secrets.stripeWebhookSecret?.trim();
    if (!secret) throw new PaymentWebhookConfigurationError('stripe');
    const timestamp = Math.floor(clock().getTime() / 1_000);
    const signature = await hmacHex(`${timestamp}.${claim.payload}`, secret);
    return `t=${timestamp},v1=${signature}`;
  }
  const secret = secrets.creemWebhookSecret?.trim();
  if (!secret) throw new PaymentWebhookConfigurationError('creem');
  return hmacHex(claim.payload, secret);
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

function constantTimeEqual(expected: string, actual: string) {
  if (expected.length !== actual.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  }
  return difference === 0;
}

export interface PaymentWebhookSettlementPort {
  apply(
    claim: PaymentWebhookClaim
  ): Promise<VerifiedPaymentWebhookEvent | null>;
  settle(event: VerifiedPaymentWebhookEvent): Promise<void>;
}

export async function settlePendingPaymentWebhooks(
  input: { limit: number },
  dependencies: {
    inbox: PaymentWebhookInboxPort;
    settlement: PaymentWebhookSettlementPort;
  }
) {
  let completed = 0;
  let failed = 0;
  for (let index = 0; index < input.limit; index += 1) {
    const claim = await dependencies.inbox.claimNext();
    if (!claim) break;
    try {
      const event =
        claim.appliedEvent === undefined
          ? await dependencies.settlement.apply(claim)
          : claim.appliedEvent;
      if (
        event &&
        (event.provider !== claim.provider ||
          event.providerEventId !== claim.providerEventId)
      ) {
        const mismatch = new Error(
          'Verified webhook identity does not match its durable claim.'
        ) as Error & { code: string };
        mismatch.code = 'WEBHOOK_IDENTITY_MISMATCH';
        throw mismatch;
      }
      if (claim.appliedEvent === undefined) {
        await dependencies.inbox.checkpointApplied(claim, event);
      }
      if (event) await dependencies.settlement.settle(event);
      await dependencies.inbox.complete(claim);
      completed += 1;
    } catch (error) {
      await dependencies.inbox.retry(claim, safeWebhookErrorCode(error));
      failed += 1;
    }
  }
  return { completed, failed };
}

function safeWebhookErrorCode(error: unknown) {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z0-9_]{1,80}$/u.test(error.code)
  ) {
    return error.code;
  }
  return 'PAYMENT_WEBHOOK_SETTLEMENT_FAILED';
}
