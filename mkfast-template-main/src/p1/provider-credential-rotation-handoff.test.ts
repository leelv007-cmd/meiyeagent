import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearCredentialRotationHandoff,
  consumeCredentialRotationHandoff,
  isTerminalRotationReceiptError,
  peekCredentialRotationHandoff,
  PLATFORM_CREDENTIAL_WORKSPACE_ID,
  resetCredentialRotationHandoffForTests,
  stageCredentialRotationHandoff,
} from './provider-credential-rotation-handoff';

const NOW = Date.parse('2026-08-07T12:00:00.000Z');
const FUTURE = '2026-08-07T12:10:00.000Z';
const PAST = '2026-08-07T11:50:00.000Z';

const base = {
  workspaceId: PLATFORM_CREDENTIAL_WORKSPACE_ID,
  accountId: 'credential-account:platform:model.direct',
  receiptId: 'secure-write-123e4567-e89b-42d3-a456-426614174000',
  expiresAt: FUTURE,
};

test.beforeEach(() => {
  resetCredentialRotationHandoffForTests();
});

test('stages and peeks a same-origin memory handoff without mutating storage', () => {
  stageCredentialRotationHandoff(base);
  const peeked = peekCredentialRotationHandoff(NOW);
  assert.deepEqual(peeked, base);
  assert.equal(peekCredentialRotationHandoff(NOW)?.receiptId, base.receiptId);
});

test('peek clears and returns null when the receipt is expired', () => {
  stageCredentialRotationHandoff({ ...base, expiresAt: PAST });
  assert.equal(peekCredentialRotationHandoff(NOW), null);
  assert.equal(peekCredentialRotationHandoff(NOW), null);
});

test('consume succeeds once for matching workspace/account and clears by default', () => {
  stageCredentialRotationHandoff(base);
  const first = consumeCredentialRotationHandoff(
    { workspaceId: base.workspaceId, accountId: base.accountId },
    { nowMs: NOW }
  );
  assert.equal(first.status, 'ready');
  if (first.status === 'ready') {
    assert.equal(first.record.receiptId, base.receiptId);
  }
  assert.equal(
    consumeCredentialRotationHandoff(
      { workspaceId: base.workspaceId, accountId: base.accountId },
      { nowMs: NOW }
    ).status,
    'missing'
  );
});

test('consume with clearOnReady:false keeps the record for prefill then clear', () => {
  stageCredentialRotationHandoff(base);
  const ready = consumeCredentialRotationHandoff(
    { workspaceId: base.workspaceId, accountId: base.accountId },
    { nowMs: NOW, clearOnReady: false }
  );
  assert.equal(ready.status, 'ready');
  assert.equal(peekCredentialRotationHandoff(NOW)?.receiptId, base.receiptId);
  clearCredentialRotationHandoff(base.receiptId);
  assert.equal(peekCredentialRotationHandoff(NOW), null);
});

test('consume clears on expired receipt', () => {
  stageCredentialRotationHandoff({ ...base, expiresAt: PAST });
  assert.equal(
    consumeCredentialRotationHandoff(
      { workspaceId: base.workspaceId, accountId: base.accountId },
      { nowMs: NOW }
    ).status,
    'expired'
  );
  assert.equal(peekCredentialRotationHandoff(NOW), null);
});

test('consume clears on wrong account (binding mismatch)', () => {
  stageCredentialRotationHandoff(base);
  assert.equal(
    consumeCredentialRotationHandoff(
      {
        workspaceId: base.workspaceId,
        accountId: 'credential-account:platform:ark.media',
      },
      { nowMs: NOW }
    ).status,
    'account_mismatch'
  );
  assert.equal(peekCredentialRotationHandoff(NOW), null);
});

test('consume clears on wrong workspace (binding mismatch)', () => {
  stageCredentialRotationHandoff(base);
  assert.equal(
    consumeCredentialRotationHandoff(
      { workspaceId: 'ws-merchant-other', accountId: base.accountId },
      { nowMs: NOW }
    ).status,
    'workspace_mismatch'
  );
  assert.equal(peekCredentialRotationHandoff(NOW), null);
});

test('clear is a no-op when receiptId does not match', () => {
  stageCredentialRotationHandoff(base);
  clearCredentialRotationHandoff('secure-write-other');
  assert.equal(peekCredentialRotationHandoff(NOW)?.receiptId, base.receiptId);
  clearCredentialRotationHandoff(base.receiptId);
  assert.equal(peekCredentialRotationHandoff(NOW), null);
});

test('terminal Core receipt errors are detected for handoff cleanup', () => {
  assert.equal(
    isTerminalRotationReceiptError(
      new Error('The secure-write receipt has expired.')
    ),
    true
  );
  assert.equal(
    isTerminalRotationReceiptError(
      new Error('The secure-write receipt has already been consumed.')
    ),
    true
  );
  assert.equal(
    isTerminalRotationReceiptError(
      new Error(
        'The secure-write receipt was not found for this credential account.'
      )
    ),
    true
  );
  assert.equal(
    isTerminalRotationReceiptError(new Error('Preview unavailable')),
    false
  );
});

test('handoff record never includes secret material fields', () => {
  stageCredentialRotationHandoff(base);
  const json = JSON.stringify(peekCredentialRotationHandoff(NOW));
  assert.equal(/secret|token|password|apiKey/i.test(json ?? ''), false);
  assert.match(json ?? '', /receiptId/);
});
