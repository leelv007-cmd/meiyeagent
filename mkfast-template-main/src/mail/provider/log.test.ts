import assert from 'node:assert/strict';
import test from 'node:test';
import { LogMailProvider } from './log';

test('mail log fallback records delivery without exposing the recipient', async () => {
  const entries: Array<Record<string, unknown>> = [];
  const provider = new LogMailProvider((entry) => entries.push(entry));

  const result = await provider.sendRawEmail({
    html: '<p>Verify your account</p>',
    subject: 'Verify your account',
    text: 'Verify your account',
    to: 'owner@example.test',
  });

  assert.equal(result.success, true);
  assert.match(result.messageId ?? '', /^mail-log-/u);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.event, 'MAIL_LOG_DELIVERY');
  assert.equal(entries[0]?.subject, 'Verify your account');
  assert.equal(
    JSON.stringify(entries[0]).includes('owner@example.test'),
    false
  );
});
