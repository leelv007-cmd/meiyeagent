import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HarnessLangfuseOutboxWorker,
  type HarnessLangfuseOutboxStore,
} from './outbox-worker.js';

test('Langfuse failure leaves the audit queued for compensation', async () => {
  const store = new MemoryOutboxStore();
  let shouldFail = true;
  const worker = new HarnessLangfuseOutboxWorker(
    store,
    {
      async send() {
        if (shouldFail) throw new Error('Langfuse unavailable');
      },
    },
    { now: () => new Date('2026-07-18T00:00:00.000Z'), retryDelayMs: 1_000 },
  );

  assert.deepEqual(await worker.runOnce(), { sent: 0, failed: 1 });
  assert.equal(store.status, 'failed');
  assert.equal(store.nextAttemptAt?.toISOString(), '2026-07-18T00:00:01.000Z');

  shouldFail = false;
  store.status = 'queued';
  assert.deepEqual(await worker.runOnce(), { sent: 1, failed: 0 });
  assert.equal(store.status, 'sent');
});

class MemoryOutboxStore implements HarnessLangfuseOutboxStore {
  status: 'queued' | 'sending' | 'failed' | 'sent' = 'queued';
  nextAttemptAt: Date | null = null;

  async claimLangfuseBatch() {
    if (this.status !== 'queued') return [];
    this.status = 'sending';
    return [
      {
        auditId: 'audit-1',
        workflowId: 'task-1',
        stage: 'intent_naming',
        eventType: 'intent_named',
        occurredAt: '2026-07-18T00:00:00.000Z',
        payload: {},
        attempts: 1,
      },
    ];
  }

  async markLangfuseSent() {
    this.status = 'sent';
  }

  async markLangfuseFailed(_auditId: string, _error: string, retryAt: Date) {
    this.status = 'failed';
    this.nextAttemptAt = retryAt;
  }
}
