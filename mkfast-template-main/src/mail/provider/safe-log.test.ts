import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { CloudflareProvider } from './cloudflare';
import { ResendProvider } from './resend';

const recipient = 'owner@example.test';
const subject = 'Verify secret account';
const html =
  '<a href="https://example.test/verify?token=secret-token">Verify</a>';

function unsafeLogValue(entries: unknown[][]) {
  const serialized = JSON.stringify(entries);
  return (
    serialized.includes(recipient) ||
    serialized.includes(subject) ||
    serialized.includes(html) ||
    serialized.includes('secret-token')
  );
}

test('both mail providers log missing field names without field values', async () => {
  const entries: unknown[][] = [];
  const warning = mock.method(console, 'warn', (...args: unknown[]) => {
    entries.push(args);
  });
  try {
    const resend = Object.create(ResendProvider.prototype) as ResendProvider;
    Object.assign(resend, { from: 'sender@example.test' });
    await resend.sendRawEmail({
      html,
      subject,
      text: 'secret-token',
      to: '',
    });

    const cloudflare = Object.create(
      CloudflareProvider.prototype
    ) as CloudflareProvider;
    Object.assign(cloudflare, { from: 'sender@example.test' });
    await cloudflare.sendRawEmail({
      html,
      subject: '',
      text: 'secret-token',
      to: recipient,
    });
  } finally {
    warning.mock.restore();
  }

  const serialized = JSON.stringify(entries);
  assert.match(serialized, /missingFields/u);
  assert.match(serialized, /to/u);
  assert.match(serialized, /subject/u);
  assert.equal(unsafeLogValue(entries), false);
});

test('both mail providers redact field values from send failure logs', async () => {
  const entries: unknown[][] = [];
  const failure = new Error(`${recipient} ${subject} ${html} secret-token`);
  const errorLog = mock.method(console, 'error', (...args: unknown[]) => {
    entries.push(args);
  });
  const fetchMock = mock.method(globalThis, 'fetch', async () => {
    throw failure;
  });
  try {
    const resend = Object.create(ResendProvider.prototype) as ResendProvider;
    Object.assign(resend, {
      from: 'sender@example.test',
      resend: {
        emails: {
          send: async () => {
            throw failure;
          },
        },
      },
    });
    await resend.sendRawEmail({
      html,
      subject,
      text: 'secret-token',
      to: recipient,
    });

    const cloudflare = Object.create(
      CloudflareProvider.prototype
    ) as CloudflareProvider;
    Object.assign(cloudflare, {
      accountId: 'account-id',
      apiToken: 'api-token',
      from: 'sender@example.test',
    });
    await cloudflare.sendRawEmail({
      html,
      subject,
      text: 'secret-token',
      to: recipient,
    });
  } finally {
    fetchMock.mock.restore();
    errorLog.mock.restore();
  }

  const serialized = JSON.stringify(entries);
  assert.match(serialized, /MAIL_PROVIDER_SEND_FAILED/u);
  assert.equal(unsafeLogValue(entries), false);
});
