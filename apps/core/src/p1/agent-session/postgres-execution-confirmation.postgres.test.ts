/**
 * V31-11 Postgres A3 seam: concurrent createRequest never over-debits.
 * Skips when TEST_DATABASE_URL is unset (local rule).
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import { agentExecutionConfirmationRequestSchema } from '@meiye/contracts';

import { PostgresCreditLedger } from '../credit-billing/postgres-credit-ledger.js';
import { ExecutionConfirmationService } from './execution-confirmation-service.js';
import {
  confirmationCreditPortFromPostgresLedger,
  PostgresExecutionConfirmationMigration,
} from './postgres-execution-confirmation-store.js';
import type { ConfirmationRequestProjectionFacts } from './execution-confirmation-store.js';

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

test(
  'savePendingWithClient joins the caller transaction: rollback removes both the request row and the reserve (P1-b)',
  {
    skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
  },
  async () => {
    const fixture = await createFixture();
    const { creditLedger, requestStore, workspaceId, cleanup } = fixture;
    try {
      await creditLedger.grant({
        id: 'confirm-pkg-p1b',
        workspaceId,
        credits: 5,
        expirationDate: '2026-09-01T00:00:00.000Z',
        transactionType: 'PURCHASE_PACKAGE',
        sourceRef: 'confirm-p1b',
        createdAt: '2026-08-01T00:00:00.000Z',
      });

      const createdAt = '2026-08-08T12:00:00.000Z';
      const client = await fixture.pool.connect();
      try {
        await client.query('BEGIN');
        await creditLedger.consumeWithClient(client, {
          workspaceId,
          credits: 3,
          transactionId: 'reserve-p1b',
          actorId: 'merchant-p1b',
          correlationId: 'confirmation:req-p1b',
          createdAt,
        });
        await requestStore.savePendingWithClient(client, {
          request: agentExecutionConfirmationRequestSchema.parse({
            schemaVersion: 'agent-execution-confirmation-request/v1',
            requestId: 'req-p1b',
            workspaceId,
            planId: 'plan-p1b',
            planRevision: 1,
            snapshotHash: 'snap-p1b',
            quoteRef: { id: 'quote-p1b', revision: 1 },
            reservationIdempotencyKey: 'reserve-p1b',
            createdAt,
            holdExpiresAt: '2026-08-09T12:00:00.000Z',
            status: 'pending',
          }),
          projection: {
            reservedCredits: 3,
            failureRefundsCredits: true,
            rightsSummary: null,
            factSummary: null,
          } satisfies ConfirmationRequestProjectionFacts,
        });
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }

      // The row insert went through the same transaction as the reserve:
      // a rollback must leave neither an orphan request row nor a deduction.
      assert.equal(await requestStore.getById('req-p1b'), null);
      const projection = await creditLedger.project(workspaceId, createdAt);
      assert.equal(projection.availableCredits, 5);
      assert.equal(projection.usedCredits, 0);
    } finally {
      await cleanup();
    }
  },
);

test(
  'createRequest with insufficient balance leaves no orphan request row (A3)',
  {
    skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
  },
  async () => {
    const fixture = await createFixture();
    const { service, creditLedger, workspaceId, cleanup } = fixture;
    try {
      await creditLedger.grant({
        id: 'confirm-pkg-short',
        workspaceId,
        credits: 2,
        expirationDate: '2026-09-01T00:00:00.000Z',
        transactionType: 'PURCHASE_PACKAGE',
        sourceRef: 'confirm-short',
        createdAt: '2026-08-01T00:00:00.000Z',
      });

      await assert.rejects(
        () =>
          service.createRequest({
            requestId: 'req-short',
            workspaceId,
            planId: 'plan-short',
            planRevision: 1,
            snapshotHash: 'snap-short',
            quoteRef: { id: 'quote-short', revision: 1 },
            reservationIdempotencyKey: 'reserve-short',
            createdAt: '2026-08-08T12:00:00.000Z',
            holdExpiresAt: '2026-08-09T12:00:00.000Z',
            actorId: 'merchant-short',
            creditCost: 5,
            failureRefundsCredits: true,
          }),
        /Insufficient credits/i,
      );
      assert.equal(await service.getRequest('req-short'), null);
      const projection = await creditLedger.project(
        workspaceId,
        '2026-08-08T12:00:00.000Z',
      );
      assert.equal(projection.availableCredits, 2);
      assert.equal(projection.usedCredits, 0);
    } finally {
      await cleanup();
    }
  },
);

test(
  'createRequest same requestId re-entry never double-consumes (idempotent)',
  {
    skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
  },
  async () => {
    const fixture = await createFixture();
    const { service, creditLedger, workspaceId, cleanup } = fixture;
    try {
      await creditLedger.grant({
        id: 'confirm-pkg-replay',
        workspaceId,
        credits: 10,
        expirationDate: '2026-09-01T00:00:00.000Z',
        transactionType: 'PURCHASE_PACKAGE',
        sourceRef: 'confirm-replay',
        createdAt: '2026-08-01T00:00:00.000Z',
      });

      const createdAt = '2026-08-08T12:00:00.000Z';
      const input = {
        requestId: 'req-replay',
        workspaceId,
        planId: 'plan-replay',
        planRevision: 1,
        snapshotHash: 'snap-replay',
        quoteRef: { id: 'quote-replay', revision: 1 },
        reservationIdempotencyKey: 'reserve-replay',
        createdAt,
        holdExpiresAt: '2026-08-09T12:00:00.000Z',
        actorId: 'merchant-replay',
        creditCost: 3,
        failureRefundsCredits: true,
      };
      const first = await service.createRequest(input);
      const replay = await service.createRequest(input);
      assert.equal(replay.stored.request.requestId, first.stored.request.requestId);
      assert.equal(replay.reservedCredits, 3);
      const projection = await creditLedger.project(workspaceId, createdAt);
      assert.equal(projection.availableCredits, 7);
      assert.equal(projection.usedCredits, 3);
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
    requestStore: migration.requestStore,
    pool,
    workspaceId,
    async cleanup() {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => undefined);
      await pool.end();
    },
  };
}
