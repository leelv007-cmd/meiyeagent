import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';

import { ExpiredFactInvalidationWorker } from './expired-fact-invalidation-outbox.js';
import { PostgresStoreFactLedger } from './postgres-store-fact-ledger.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'a fact appended after polling already expired is durably claimable',
  { skip: !connectionString },
  async () => {
    const pool = new Pool({ connectionString });
    const ledger = new PostgresStoreFactLedger(pool);
    const workspaceId = `expiration-outbox-late-${Date.now()}`;
    await ledger.migrate();
    try {
      await ledger.append(
        factInput({
          expiresAt: '2026-07-19T07:59:00.000Z',
          factId: 'late-expired-price',
          workspaceId,
        }),
      );
      await ledger.append(
        factInput({
          expiresAt: '2026-07-19T08:00:00.000Z',
          factId: 'expires-at-claim-time',
          workspaceId,
        }),
      );

      const claimed = await ledger.claimBatch({
        claimToken: 'claim-late',
        leaseMs: 60_000,
        limit: 10,
        now: new Date('2026-07-19T08:00:00.000Z'),
        workerId: 'worker-a',
      });

      assert.deepEqual(
        claimed.map((item) => [item.factId, item.expiresAt]),
        [
          ['late-expired-price', '2026-07-19T07:59:00.000Z'],
          ['expires-at-claim-time', '2026-07-19T08:00:00.000Z'],
        ],
      );
      assert.ok(
        claimed.every(
          (item) =>
            item.attemptCount === 1 &&
            item.claimToken === 'claim-late' &&
            item.currentRevision === 1 &&
            item.revision === 1 &&
            item.workspaceId === workspaceId,
        ),
      );
    } finally {
      await ledger.deleteWorkspaceForTest(workspaceId);
      await pool.end();
    }
  },
);

test(
  'two PostgreSQL workers atomically claim an expired fact only once',
  { skip: !connectionString },
  async () => {
    const pool = new Pool({ connectionString });
    const first = new PostgresStoreFactLedger(pool);
    const second = new PostgresStoreFactLedger(pool);
    const workspaceId = `expiration-outbox-concurrent-${Date.now()}`;
    await first.migrate();
    try {
      await first.append(
        factInput({
          expiresAt: '2026-07-19T07:59:00.000Z',
          factId: 'concurrent-price',
          workspaceId,
        }),
      );

      const results = await Promise.all([
        first.claimBatch({
          claimToken: 'claim-a',
          leaseMs: 60_000,
          limit: 1,
          now: new Date('2026-07-19T08:00:00.000Z'),
          workerId: 'worker-a',
        }),
        second.claimBatch({
          claimToken: 'claim-b',
          leaseMs: 60_000,
          limit: 1,
          now: new Date('2026-07-19T08:00:00.000Z'),
          workerId: 'worker-b',
        }),
      ]);

      assert.deepEqual(
        results.map((items) => items.length).sort(),
        [0, 1],
      );
      assert.equal(results.flat()[0]?.factId, 'concurrent-price');
    } finally {
      await first.deleteWorkspaceForTest(workspaceId);
      await pool.end();
    }
  },
);

test(
  'a restarted worker reclaims an expired lease while the stale claimant is fenced out',
  { skip: !connectionString },
  async () => {
    const pool = new Pool({ connectionString });
    const beforeRestart = new PostgresStoreFactLedger(pool);
    const afterRestart = new PostgresStoreFactLedger(pool);
    const workspaceId = `expiration-outbox-restart-${Date.now()}`;
    await beforeRestart.migrate();
    try {
      await beforeRestart.append(
        factInput({
          expiresAt: '2026-07-19T07:59:00.000Z',
          factId: 'restart-price',
          workspaceId,
        }),
      );
      const [original] = await beforeRestart.claimBatch({
        claimToken: 'claim-before-restart',
        leaseMs: 1_000,
        limit: 1,
        now: new Date('2026-07-19T08:00:00.000Z'),
        workerId: 'worker-before-restart',
      });
      assert.ok(original);
      assert.deepEqual(
        await afterRestart.claimBatch({
          claimToken: 'claim-too-early',
          leaseMs: 1_000,
          limit: 1,
          now: new Date('2026-07-19T08:00:00.999Z'),
          workerId: 'worker-after-restart',
        }),
        [],
      );

      const [reclaimed] = await afterRestart.claimBatch({
        claimToken: 'claim-after-restart',
        leaseMs: 1_000,
        limit: 1,
        now: new Date('2026-07-19T08:00:01.000Z'),
        workerId: 'worker-after-restart',
      });
      assert.equal(reclaimed?.attemptCount, 2);
      assert.equal(reclaimed?.claimToken, 'claim-after-restart');

      assert.equal(
        await beforeRestart.markDelivered({
          ...original,
          deliveredAt: new Date('2026-07-19T08:00:01.001Z'),
        }),
        false,
      );
      assert.equal(
        await afterRestart.markDelivered({
          ...reclaimed!,
          deliveredAt: new Date('2026-07-19T08:00:01.001Z'),
        }),
        true,
      );
      assert.deepEqual(
        await new PostgresStoreFactLedger(pool).claimBatch({
          claimToken: 'claim-after-delivery',
          leaseMs: 1_000,
          limit: 1,
          now: new Date('2026-07-19T08:01:00.000Z'),
          workerId: 'worker-third-process',
        }),
        [],
      );
    } finally {
      await beforeRestart.deleteWorkspaceForTest(workspaceId);
      await pool.end();
    }
  },
);

test(
  'schema migration backfills an expiration missing from a pre-outbox fact revision',
  { skip: !connectionString },
  async () => {
    const pool = new Pool({ connectionString });
    const ledger = new PostgresStoreFactLedger(pool);
    const workspaceId = `expiration-outbox-backfill-${Date.now()}`;
    await ledger.migrate();
    try {
      await ledger.append(
        factInput({
          expiresAt: '2026-07-19T07:59:00.000Z',
          factId: 'backfilled-price',
          workspaceId,
        }),
      );
      await pool.query(
        `DELETE FROM p1_store_fact_expiration_outbox
          WHERE workspace_id = $1 AND fact_id = $2`,
        [workspaceId, 'backfilled-price'],
      );

      await ledger.migrate();
      const claimed = await ledger.claimBatch({
        claimToken: 'claim-backfilled',
        leaseMs: 60_000,
        limit: 10,
        now: new Date('2026-07-19T08:00:00.000Z'),
        workerId: 'worker-a',
      });

      assert.equal(claimed.length, 1);
      assert.equal(claimed[0]?.factId, 'backfilled-price');
    } finally {
      await ledger.deleteWorkspaceForTest(workspaceId);
      await pool.end();
    }
  },
);

test(
  'the PostgreSQL worker settles an expired revision superseded by the current fact',
  { skip: !connectionString },
  async () => {
    const pool = new Pool({ connectionString });
    const ledger = new PostgresStoreFactLedger(pool);
    const workspaceId = `expiration-outbox-superseded-${Date.now()}`;
    await ledger.migrate();
    try {
      await ledger.append(
        factInput({
          expiresAt: '2026-07-19T07:59:00.000Z',
          factId: 'superseded-price',
          workspaceId,
        }),
      );
      await ledger.append(
        factInput({
          effectiveFrom: '2026-07-19T07:30:00.000Z',
          expectedRevision: 1,
          expiresAt: '2026-07-19T09:00:00.000Z',
          factId: 'superseded-price',
          workspaceId,
        }),
      );
      let dispatched = 0;
      const worker = new ExpiredFactInvalidationWorker(
        ledger,
        {
          async invalidateExpiredFact() {
            dispatched += 1;
          },
        },
        {
          clock: () => new Date('2026-07-19T08:00:00.000Z'),
          claimToken: () => 'claim-superseded',
        },
      );

      assert.deepEqual(await worker.runOnce('worker-a'), {
        claimed: 1,
        deadLettered: 0,
        delivered: 0,
        lost: 0,
        retried: 0,
        superseded: 1,
      });
      assert.equal(dispatched, 0);
      assert.deepEqual(await worker.runOnce('worker-a'), {
        claimed: 0,
        deadLettered: 0,
        delivered: 0,
        lost: 0,
        retried: 0,
        superseded: 0,
      });
    } finally {
      await ledger.deleteWorkspaceForTest(workspaceId);
      await pool.end();
    }
  },
);

test(
  'a failed PostgreSQL delivery resumes from durable retry state after restart',
  { skip: !connectionString },
  async () => {
    const pool = new Pool({ connectionString });
    const ledger = new PostgresStoreFactLedger(pool);
    const workspaceId = `expiration-outbox-retry-${Date.now()}`;
    let now = new Date('2026-07-19T08:00:00.000Z');
    await ledger.migrate();
    try {
      await ledger.append(
        factInput({
          expiresAt: '2026-07-19T07:59:00.000Z',
          factId: 'retry-price',
          workspaceId,
        }),
      );
      let attempts = 0;
      const invalidator = {
        async invalidateExpiredFact() {
          attempts += 1;
          if (attempts === 1) throw new Error('temporary delivery failure');
        },
      };
      const beforeRestart = new ExpiredFactInvalidationWorker(
        ledger,
        invalidator,
        {
          clock: () => now,
          claimToken: () => 'claim-before-restart',
          retryDelayMs: 1_000,
        },
      );

      assert.equal((await beforeRestart.runOnce('worker-before')).retried, 1);
      now = new Date('2026-07-19T08:00:00.999Z');
      const afterRestart = new ExpiredFactInvalidationWorker(
        new PostgresStoreFactLedger(pool),
        invalidator,
        {
          clock: () => now,
          claimToken: () => 'claim-after-restart',
          retryDelayMs: 1_000,
        },
      );
      assert.equal((await afterRestart.runOnce('worker-after')).claimed, 0);

      now = new Date('2026-07-19T08:00:01.000Z');
      assert.equal((await afterRestart.runOnce('worker-after')).delivered, 1);
      assert.equal(attempts, 2);
      now = new Date('2026-07-19T08:01:00.000Z');
      assert.equal((await afterRestart.runOnce('worker-after')).claimed, 0);
    } finally {
      await ledger.deleteWorkspaceForTest(workspaceId);
      await pool.end();
    }
  },
);

test(
  'the PostgreSQL outbox keeps a permanent failure as an unclaimable dead letter',
  { skip: !connectionString },
  async () => {
    const pool = new Pool({ connectionString });
    const ledger = new PostgresStoreFactLedger(pool);
    const workspaceId = `expiration-outbox-dead-${Date.now()}`;
    const now = new Date('2026-07-19T08:00:00.000Z');
    await ledger.migrate();
    try {
      await ledger.append(
        factInput({
          expiresAt: '2026-07-19T07:59:00.000Z',
          factId: 'dead-letter-price',
          workspaceId,
        }),
      );
      const worker = new ExpiredFactInvalidationWorker(
        ledger,
        {
          async invalidateExpiredFact() {
            throw new Error('permanent delivery failure');
          },
        },
        {
          clock: () => now,
          claimToken: () => 'claim-dead-letter',
          maxAttempts: 1,
        },
      );

      assert.equal((await worker.runOnce('worker-a')).deadLettered, 1);
      assert.equal((await worker.runOnce('worker-a')).claimed, 0);
    } finally {
      await ledger.deleteWorkspaceForTest(workspaceId);
      await pool.end();
    }
  },
);

function factInput(input: {
  effectiveFrom?: string;
  expectedRevision?: number;
  expiresAt: string;
  factId: string;
  workspaceId: string;
}) {
  return {
    effectiveFrom: input.effectiveFrom ?? '2026-07-19T07:00:00.000Z',
    expectedRevision: input.expectedRevision ?? 0,
    expiresAt: input.expiresAt,
    factId: input.factId,
    key: 'offer.price',
    kind: 'price' as const,
    recordedAt: '2026-07-19T08:00:00.000Z',
    recordedBy: 'owner-a',
    scope: { storeId: 'store-a' },
    source: {
      capturedAt: '2026-07-19T07:00:00.000Z',
      kind: 'user_confirmation' as const,
      referenceId: `confirmation-${input.factId}`,
    },
    value: { amount: 199, currency: 'CNY' },
    workspaceId: input.workspaceId,
  };
}
