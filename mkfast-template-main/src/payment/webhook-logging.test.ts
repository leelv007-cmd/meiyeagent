import assert from 'node:assert/strict';
import test from 'node:test';
import { logPaymentWebhookError } from './webhook-logging';

test('payment webhook failure logs stable fields without payload or signature', () => {
  const secret = 'whsec_not_for_logs';
  const payload = '{"id":"evt_not_for_logs"}';
  const email = 'payer-not-for-logs@example.test';
  const error = Object.assign(new Error(`${payload} ${secret}`), {
    body: { code: 'PAYMENT_DATABASE_FAILED', email, payload },
    code: 'PAYMENT_DATABASE_FAILED',
    email,
    payload,
    signature: secret,
  });
  const messages: unknown[][] = [];

  logPaymentWebhookError(
    { error, provider: 'stripe', stage: 'provider_effect' },
    (...args) => messages.push(args)
  );

  assert.deepEqual(messages, [
    [
      'payment webhook processing failed',
      {
        errorCode: 'PAYMENT_DATABASE_FAILED',
        errorName: 'Error',
        event: 'PAYMENT_WEBHOOK_PROCESSING_FAILED',
        provider: 'stripe',
        stage: 'provider_effect',
      },
    ],
  ]);
  assert.doesNotMatch(
    JSON.stringify(messages),
    /evt_not_for_logs|whsec_|payer-not-for-logs/u
  );
});
