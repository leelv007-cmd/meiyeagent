/**
 * V31-11 Postgres A3 seam: concurrent createRequest never over-debits.
 * Skips when TEST_DATABASE_URL is unset (local rule).
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import { PostgresCreditLedger } from '../credit-billing/postgres-credit-ledger.js';
import { ExecutionConfirmationService } from './execution-confirmation-service.js';
import {
  confirmationCreditPortFromPostgresLedger,
  PostgresExecutionConfirmationMigration,
} from './postgres-execution-confirmation-store.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'Postgres confirmation create serializes concurrent reserves without over-debit (A3)',
  {
    skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
  },
  async () => {
    const fixture = await createFixture();
    const { service, creditLedger, workspaceId, cleanup } = fixture;
    try {
      await creditLedger.grant({
        id: 'confirm-pkg',
        workspaceId,
        credits: 5,
        expirationDate: '2026-09-01T00:00:00.000Z',
        transactionType: 'PURCHASE_PACKAGE',
        sourceRef: 'confirm-a3',
        createdAt: '2026-08-01T00:00:00.000Z',
      });

      const createdAt = '2026-08-08T12:00:00.000Z';
      const holdExpiresAt = '2026-08-09T12:00:00.000Z';
      const attempts = Array.from({ length: 4 }, (_, index) =>
        service.createRequest({
          requestId: `req-a3-${index}`,
          workspaceId,
          planId: `plan-a3-${index}`,
          planRevision: 1,
          snapshotHash: `snap-a3-${index}`,
          quoteRef: { id: `quote-a3-${index}`, revision: 1 },
          reservationIdempotencyKey: `reserve-a3-${index}`,
          createdAt,
          holdExpiresAt,
          actorId: 'merchant-a3',
          creditCost: 3,
          failureRefundsCredits: true,
        }),
      );
      const results = await Promise.allSettled(attempts);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      assert.equal(fulfilled.length, 1);
      assert.equal(rejected.length, 3);

      const projection = await creditLedger.project(workspaceId, createdAt);
      assert.equal(projection.availableCredits, 2);
      assert.equal(projection.usedCredits, 3);

      const winner = (
        fulfilled[0] as PromiseFulfilledResult<
          Awaited<ReturnType<ExecutionConfirmationService['createRequest']>>
        >
      ).value;
      const expired = await service.expireHold({
        requestId: winner.stored.request.requestId,
        now: '2026-08-09T12:00:01.000Z',
      });
      assert.equal(expired.refundedCredits, 3);
      assert.match(expired.merchantMessage, /退回/);
      assert.equal(
        (await creditLedger.project(workspaceId, '2026-08-09T12:00:01.000Z'))
          .availableCredits,
        5,
      );
    } finally {
      await cleanup();
    }
  },
);

async function createFixture() {
  const schema = `confirm_${randomUUID().replaceAll('-', '')}`;
  const pool = new Pool({ connectionString });
  await pool.query(`CREATE SCHEMA ${schema}`);
  await pool.query(`SET search_path TO ${schema}`);
  // Re-bind search_path for subsequent connections from this pool.
  pool.on('connect', (client) => {
    void client.query(`SET search_path TO ${schema}`);
  });

  const workspaceId = `ws-confirm-${randomUUID()}`;
  await pool.query(`
    CREATE TABLE workspaces (
      id text PRIMARY KEY,
      name text NOT NULL
    )
  `);
  await pool.query(
    "INSERT INTO workspaces (id, name) VALUES ($1, 'Confirmation A3')",
    [workspaceId],
  );

  const creditLedger = new PostgresCreditLedger(pool);
  const migration = new PostgresExecutionConfirmationMigration(pool);
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO ${schema}`);
    await creditLedger.migrate(client);
    await migration.migrate(client);
  } finally {
    client.release();
  }

  const service = new ExecutionConfirmationService(
    migration.requestStore,
    migration.decisionStore,
    confirmationCreditPortFromPostgresLedger(creditLedger),
  );

  return {
    service,
    creditLedger,
    workspaceId,
    async cleanup() {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => undefined);
      await pool.end();
    },
  };
}
