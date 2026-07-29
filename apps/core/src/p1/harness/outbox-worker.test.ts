import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HarnessLangfuseOutboxLoop,
  HarnessLangfuseOutboxWorker,
  ObservabilityDeliveryFailure,
  type HarnessLangfuseOutboxStore,
} from './outbox-worker.js';
import type { AdminConfigRepository } from '../admin-config/foundation-module.js';

test('one prompt outbox loop starts once and never overlaps delivery', async () => {
  let calls = 0;
  let releaseFirst: (() => void) | undefined;
  const firstRun = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const loop = new HarnessLangfuseOutboxLoop(
    {
      async runOnce() {
        calls += 1;
        if (calls === 1) await firstRun;
        return { sent: 0, failed: 0, deadLettered: 0 };
      },
    },
    { pollMs: 60_000 },
  );

  loop.start();
  loop.start();
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(await loop.runOnce(), false);

  releaseFirst?.();
  await firstRun;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await loop.runOnce(), true);
  assert.equal(calls, 2);
  loop.stop();
});

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

  assert.deepEqual(await worker.runOnce(), {
    sent: 0,
    failed: 1,
    deadLettered: 0,
  });
  assert.equal(store.statuses.get('audit-1'), 'failed');
  assert.equal(
    store.nextAttemptAt.get('audit-1')?.toISOString(),
    '2026-07-18T00:00:01.000Z',
  );

  shouldFail = false;
  assert.deepEqual(await worker.runOnce(), {
    sent: 1,
    failed: 0,
    deadLettered: 0,
  });
  assert.equal(store.statuses.get('audit-1'), 'sent');
  assert.deepEqual(await worker.runOnce(), {
    sent: 0,
    failed: 0,
    deadLettered: 0,
  });
});

test('one Langfuse failure does not block later items in the claimed batch', async () => {
  const store = new MemoryOutboxStore(['audit-1', 'audit-2']);
  const worker = new HarnessLangfuseOutboxWorker(store, {
    async send(item) {
      if (item.auditId === 'audit-1') throw new Error('first item failed');
    },
  });

  assert.deepEqual(await worker.runOnce(), {
    sent: 1,
    failed: 1,
    deadLettered: 0,
  });
  assert.equal(store.statuses.get('audit-1'), 'failed');
  assert.equal(store.statuses.get('audit-2'), 'sent');
});

test('Langfuse failure dead-letters at the attempt limit and is not redelivered', async () => {
  const store = new MemoryOutboxStore();
  let sendAttempts = 0;
  const worker = new HarnessLangfuseOutboxWorker(
    store,
    {
      async send() {
        sendAttempts += 1;
        throw new Error('Langfuse unavailable');
      },
    },
    { maxAttempts: 2 },
  );

  assert.deepEqual(await worker.runOnce(), {
    sent: 0,
    failed: 1,
    deadLettered: 0,
  });
  assert.equal(store.statuses.get('audit-1'), 'failed');
  assert.deepEqual(await worker.runOnce(), {
    sent: 0,
    failed: 1,
    deadLettered: 1,
  });
  assert.equal(store.statuses.get('audit-1'), 'dead_letter');
  assert.deepEqual(await worker.runOnce(), {
    sent: 0,
    failed: 0,
    deadLettered: 0,
  });
  assert.equal(sendAttempts, 2);
  assert.deepEqual(store.deadLetterDrops.get('audit-1'), [
    {
      signal: 'trace',
      reason: 'transient',
      count: 1,
      source: 'langfuse_outbox',
    },
  ]);
});

test('permanent Langfuse configuration failure dead-letters immediately through the independent drop contract', async () => {
  const store = new MemoryOutboxStore();
  const worker = new HarnessLangfuseOutboxWorker(store, {
    async send() {
      throw new ObservabilityDeliveryFailure(
        'Langfuse credentials are invalid.',
        [
          {
            signal: 'trace',
            reason: 'permanent-config',
            count: 2,
            source: 'langfuse_ingestion',
          },
          {
            signal: 'score',
            reason: 'permanent-config',
            count: 3,
            source: 'langfuse_ingestion',
          },
        ],
      );
    },
  });

  assert.deepEqual(await worker.runOnce(), {
    sent: 0,
    failed: 1,
    deadLettered: 1,
  });
  assert.equal(store.statuses.get('audit-1'), 'dead_letter');
  assert.deepEqual(store.deadLetterDrops.get('audit-1'), [
    {
      signal: 'trace',
      reason: 'permanent-config',
      count: 2,
      source: 'langfuse_ingestion',
    },
    {
      signal: 'score',
      reason: 'permanent-config',
      count: 3,
      source: 'langfuse_ingestion',
    },
  ]);
});

test('a lease crash at the attempt limit is dead-lettered without another send', async () => {
  const store = new MemoryOutboxStore();
  let sends = 0;
  const worker = new HarnessLangfuseOutboxWorker(
    store,
    {
      async send() {
        sends += 1;
      },
    },
    { maxAttempts: 0 },
  );

  assert.deepEqual(await worker.runOnce(), {
    sent: 0,
    failed: 1,
    deadLettered: 1,
  });
  assert.equal(sends, 0);
  assert.deepEqual(store.deadLetterDrops.get('audit-1'), [
    {
      signal: 'trace',
      reason: 'transient',
      count: 1,
      source: 'langfuse_outbox',
    },
  ]);
});

test('Langfuse outbox retry and lease settings can be read from admin-config', async () => {
  let claimed: [number, number] | undefined;
  let retryAt: Date | undefined;
  const config: Pick<AdminConfigRepository, 'get'> = {
    async get(_scope, _workspaceId, key) {
      return {
        key,
        scope: 'global' as const,
        workspaceId: '__global__',
        value: {
          batchSize: 3,
          maxAttempts: 4,
          retryDelaySeconds: 9,
          leaseSeconds: 7,
        },
        revision: 1,
        status: 'applied' as const,
        rolledBackToRevision: null,
        actorId: 'test',
        reason: 'test',
        correlationId: `test:${key}`,
        createdAt: '2026-07-18T00:00:00.000Z',
      };
    },
  };
  const store: HarnessLangfuseOutboxStore = {
    async claimLangfuseBatch(limit, leaseSeconds) {
      claimed = [limit, leaseSeconds ?? -1];
      return [
        {
          auditId: 'audit-config',
          workflowId: 'workflow-config',
          stage: 'brief_compilation',
          eventType: 'brief_compiled',
          occurredAt: '2026-07-18T00:00:00.000Z',
          payload: {},
          attempts: 1,
        },
      ];
    },
    async markLangfuseSent() {},
    async markLangfuseFailed(_auditId, _error, at) {
      retryAt = at;
    },
    async markLangfuseDeadLetter() {},
  };

  const worker = new HarnessLangfuseOutboxWorker(
    store,
    { async send() { throw new Error('unavailable'); } },
    {
      config,
      now: () => new Date('2026-07-18T00:00:00.000Z'),
    },
  );

  assert.deepEqual(await worker.runOnce(), {
    sent: 0,
    failed: 1,
    deadLettered: 0,
  });
  assert.deepEqual(claimed, [3, 7]);
  assert.equal(retryAt?.toISOString(), '2026-07-18T00:00:09.000Z');
});

class MemoryOutboxStore implements HarnessLangfuseOutboxStore {
  readonly statuses = new Map<string, OutboxStatus>();
  readonly nextAttemptAt = new Map<string, Date>();
  readonly deadLetterDrops = new Map<
    string,
    Parameters<HarnessLangfuseOutboxStore['markLangfuseDeadLetter']>[2]
  >();
  private readonly attempts = new Map<string, number>();

  constructor(auditIds = ['audit-1']) {
    for (const auditId of auditIds) this.statuses.set(auditId, 'queued');
  }

  async claimLangfuseBatch(limit: number) {
    return [...this.statuses.entries()]
      .filter(([, status]) => status === 'queued' || status === 'failed')
      .slice(0, limit)
      .map(([auditId]) => {
        const attempts = (this.attempts.get(auditId) ?? 0) + 1;
        this.attempts.set(auditId, attempts);
        this.statuses.set(auditId, 'sending');
        return {
          auditId,
          workflowId: `task-${auditId}`,
          stage: 'intent_naming',
          eventType: 'intent_named',
          occurredAt: '2026-07-18T00:00:00.000Z',
          payload: {},
          attempts,
        };
      });
  }

  async markLangfuseSent(auditId: string) {
    this.statuses.set(auditId, 'sent');
  }

  async markLangfuseFailed(
    auditId: string,
    _error: string,
    retryAt: Date,
  ) {
    this.statuses.set(auditId, 'failed');
    this.nextAttemptAt.set(auditId, retryAt);
  }

  async markLangfuseDeadLetter(
    auditId: string,
    _error: string,
    drops: Parameters<
      HarnessLangfuseOutboxStore['markLangfuseDeadLetter']
    >[2],
  ) {
    this.statuses.set(auditId, 'dead_letter');
    this.deadLetterDrops.set(auditId, drops);
  }
}

type OutboxStatus =
  | 'queued'
  | 'sending'
  | 'failed'
  | 'sent'
  | 'dead_letter';
