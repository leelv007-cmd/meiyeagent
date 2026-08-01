import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import { PostgresCreditSubscriptionStore } from './credit-subscription-scheduler.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'Postgres credit subscription state cold-starts and persists past_due recovery',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const schema = `credit_subscription_${randomUUID().replaceAll('-', '')}`;
    const pool = new Pool({
      connectionString,
      options: `-c search_path=${schema},public`,
    });
    const workspaceId = `credit-subscription-workspace-${randomUUID()}`;
    const subscriptionId = `credit-subscription-${randomUUID()}`;
    try {
      await pool.query(`CREATE SCHEMA ${schema}`);
      await pool.query(`
        CREATE TABLE workspaces (
          id text PRIMARY KEY,
          name text NOT NULL
        )
      `);
      const store = new PostgresCreditSubscriptionStore(pool);
      const client = await pool.connect();
      try {
        await store.migrate(client);
      } finally {
        client.release();
      }
      await pool.query(
        "INSERT INTO workspaces (id, name) VALUES ($1, 'Credit subscription test')",
        [workspaceId],
      );

      await store.upsert({
        anchorAt: '2026-01-01T00:00:00.000Z',
        id: subscriptionId,
        interval: 'yearly',
        paidThroughCycle: 12,
        tier: 'pro',
        workspaceId,
      });
      await store.markPastDue(subscriptionId, '2026-02-01T00:00:00.000Z');
      assert.equal((await store.get(subscriptionId))?.status, 'past_due');

      const resumed = await store.recordPaidCoverage(
        subscriptionId,
        13,
        '2026-02-04T00:00:00.000Z',
      );
      assert.equal(resumed.status, 'active');
      assert.equal(resumed.paidThroughCycle, 13);
      assert.equal(resumed.pastDueAt, null);

      await store.markPastDue(subscriptionId, '2026-03-01T00:00:00.000Z');
      const cancelled = await store.cancelPastDue(
        subscriptionId,
        '2026-03-08T00:00:00.000Z',
      );
      assert.equal(cancelled.status, 'cancelled');
      assert.equal(cancelled.pastDueAt, null);
      await assert.rejects(
        store.recordPaidCoverage(subscriptionId, 14, '2026-03-08T00:00:00.000Z'),
        /cancelled/i,
      );
    } finally {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => undefined);
      await pool.end();
    }
  },
);
