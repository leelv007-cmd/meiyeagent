import assert from 'node:assert/strict';
import test from 'node:test';
import { LogMailProvider } from './log';

test('mail log fallback records delivery without recipient or token content', async () => {
  const entries: Array<Record<string, unknown>> = [];
  const provider = new LogMailProvider((entry) => entries.push(entry));

  const result = await provider.sendRawEmail({
    html: '<a href="https://example.test/verify?token=secret-token">Verify</a>',
    subject: 'Verify your account',
    text: 'Verify with secret-token',
    to: 'owner@example.test',
  });

  assert.equal(result.success, true);
  assert.match(result.messageId ?? '', /^mail-log-/u);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.event, 'MAIL_LOG_DELIVERY');
  const serialized = JSON.stringify(entries[0]);
  assert.equal(serialized.includes('owner@example.test'), false);
  assert.equal(serialized.includes('Verify your account'), false);
  assert.equal(serialized.includes('secret-token'), false);
  assert.equal(serialized.includes('<a href='), false);
});
