import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import {
  PostgresCreditSubscriptionStore,
  type CreditSubscriptionStore,
} from './credit-subscription-scheduler.js';

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

      let settlementCalls = 0;
      const paymentEvent = {
        workspaceId,
        paymentEventId: 'payment-renew-once',
        payloadHash: 'a'.repeat(64),
        createdAt: '2026-02-04T00:00:00.000Z',
      };
      const settle = (subscriptions: CreditSubscriptionStore) => {
        settlementCalls += 1;
        return subscriptions.recordPaidCoverage(
          subscriptionId,
          14,
          '2026-02-04T00:00:00.000Z',
        );
      };
      await store.withPaymentEvent(paymentEvent, settle);
      await store.withPaymentEvent(paymentEvent, settle);
      assert.equal(settlementCalls, 1);
      assert.equal((await store.get(subscriptionId))?.paidThroughCycle, 14);
      await assert.rejects(
        store.withPaymentEvent(
          { ...paymentEvent, payloadHash: 'b'.repeat(64) },
          settle,
        ),
        /different facts/i,
      );

      for (const [paymentEventId, payloadHash] of [
        ['payment-same-period-a', 'c'.repeat(64)],
        ['payment-same-period-b', 'd'.repeat(64)],
      ] as const) {
        await store.withPaymentEvent(
          {
            workspaceId,
            paymentEventId,
            payloadHash,
            createdAt: '2026-03-01T00:00:00.000Z',
          },
          (subscriptions) =>
            subscriptions.recordPaidPeriod({
              subscriptionId,
              periodStartsAt: '2026-03-01T00:00:00.000Z',
              coverageCycles: 1,
              at: '2026-03-01T00:00:00.000Z',
            }),
        );
      }
      assert.equal((await store.get(subscriptionId))?.paidThroughCycle, 15);

      await assert.rejects(
        store.upsert({
          anchorAt: '2026-03-01T00:00:00.000Z',
          id: `${subscriptionId}-second`,
          interval: 'monthly',
          paidThroughCycle: 1,
          tier: 'starter',
          workspaceId,
        }),
        /one_active_per_workspace|unique/i,
      );

      await store.markPastDue(subscriptionId, '2026-03-01T00:00:00.000Z');
      const cancelled = await store.cancelPastDue(
        subscriptionId,
        '2026-03-08T00:00:00.000Z',
      );
      assert.equal(cancelled.status, 'cancelled');
      assert.equal(cancelled.pastDueAt, null);
      await assert.rejects(
        store.recordPaidCoverage(subscriptionId, 16, '2026-03-08T00:00:00.000Z'),
        /cancelled/i,
      );
    } finally {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => undefined);
      await pool.end();
    }
  },
);
