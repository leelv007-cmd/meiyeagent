import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { PostgresGrantLotLedger } from './postgres-grant-lot.js';
import { PostgresRedemptionStore } from './postgres-redemption.js';
import { RedemptionFoundationModule } from './redemption-module.js';
import {
  RedemptionApplicationService,
  type RedemptionCode,
} from './redemption.js';

describe('PostgresRedemptionStore', () => {
  it('migrates CAS codes whose redemption links to a real grant transaction', async () => {
    const queries: string[] = [];
    const client = {
      async query(sql: string) {
        queries.push(sql);
        return { rows: [] };
      },
    } as unknown as PoolClient;
    const pool = {
      async query() {
        throw new Error('migration escaped the supplied client');
      },
    } as unknown as Pool;

    await new PostgresRedemptionStore(pool).migrate(client);

    const ddl = queries.join('\n');
    assert.match(ddl, /CREATE TABLE IF NOT EXISTS p1_redemption_codes/);
    assert.match(ddl, /grants jsonb NOT NULL/);
    assert.match(ddl, /revision bigint NOT NULL/);
    assert.match(ddl, /grant_transaction_id text/);
    assert.match(ddl, /REFERENCES p1_grant_lot_transactions/);
    assert.match(ddl, /CREATE TABLE IF NOT EXISTS p1_redemption_commands/);
  });

  it(
    'redeems concurrently exactly once and returns the persisted transaction on replay',
    {
      skip: process.env.TEST_DATABASE_URL
        ? false
        : 'TEST_DATABASE_URL is not configured',
    },
    async (t) => {
      const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
      const grantLots = new PostgresGrantLotLedger(pool);
      const store = new PostgresRedemptionStore(pool);
      const service = new RedemptionApplicationService(
        store,
        undefined,
        () => new Date('2026-07-19T12:00:00.000Z')
      );
      const workspaceId = `redemption-${randomUUID()}`;
      const code = `R${randomUUID().replaceAll('-', '').slice(0, 12)}`;
      await grantLots.migrate();
      await store.migrate();
      await pool.query(
        "INSERT INTO workspaces (id, name) VALUES ($1, 'Redemption test')",
        [workspaceId]
      );
      t.after(async () => {
        await pool.query(
          'DELETE FROM p1_redemption_codes WHERE redeemed_workspace_id = $1',
          [workspaceId]
        );
        await pool.query(
          "DELETE FROM p1_usage_events WHERE workspace_id = $1 AND reason LIKE 'redemption_code:%'",
          [workspaceId]
        );
        await pool.query(
          'DELETE FROM p1_grant_lot_transactions WHERE workspace_id = $1',
          [workspaceId]
        );
        await pool.query('DELETE FROM p1_grant_lots WHERE workspace_id = $1', [
          workspaceId,
        ]);
        await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
        await pool.end();
      });

      await service.createCodes({
        code,
        grants: { copy: 10, image: 2 },
        createdBy: 'admin-1',
      });
      const [first, second] = await Promise.all([
        service.redeem({
          code,
          workspaceId,
          userId: 'owner-1',
          correlationId: 'corr-1',
        }),
        service.redeem({
          code,
          workspaceId,
          userId: 'owner-1',
          correlationId: 'corr-2',
        }),
      ]);
      assert.equal(first.code.grantTransactionId, second.code.grantTransactionId);
      assert.ok(first.code.grantTransactionId);
      assert.ok(first.grantTransactions.length >= 1);
      assert.ok(second.grantTransactions.length >= 1);

      const rows = await grantLots.listTransactions(workspaceId);
      assert.equal(
        rows.filter((row) => row.transactionType === 'REDEMPTION_CODE').length,
        2
      );
      assert.ok(
        rows.some((row) => row.id === first.code.grantTransactionId)
      );
      const projectionBridge = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM p1_usage_events
          WHERE workspace_id = $1 AND reason LIKE 'redemption_code:%'`,
        [workspaceId]
      );
      assert.equal(projectionBridge.rows[0]?.count, '2');
    }
  );

  it(
    'persists create and void command results for same-key recovery',
    {
      skip: process.env.TEST_DATABASE_URL
        ? false
        : 'TEST_DATABASE_URL is not configured',
    },
    async (t) => {
      const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
      const store = new PostgresRedemptionStore(pool);
      const workspaceId = `redemption-command-${randomUUID()}`;
      const batchId = `completion-loss-${randomUUID()}`;
      const code = `C${randomUUID().replaceAll('-', '').slice(0, 12)}`;
      await new PostgresGrantLotLedger(pool).migrate();
      await store.migrate();
      await pool.query(
        "INSERT INTO workspaces (id, name) VALUES ($1, 'Redemption command test')",
        [workspaceId]
      );
      t.after(async () => {
        await pool.query('DELETE FROM p1_redemption_codes WHERE batch_id = $1', [
          batchId,
        ]);
        await pool.query(
          'DELETE FROM p1_redemption_commands WHERE command_scope = $1',
          [workspaceId]
        );
        await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
        await pool.end();
      });
      const service = new RedemptionApplicationService(
        store,
        undefined,
        () => new Date('2026-07-19T12:00:00.000Z')
      );
      const module = new RedemptionFoundationModule(service);
      const context = {
        actor: 'admin' as const,
        workspaceId,
        userId: 'admin-command-recovery',
        correlationId: 'corr-command-recovery',
      };
      const createCommand = {
        context,
        idempotencyKey: 'create-after-command-completion-loss',
        input: {
          action: 'create',
          payload: { batchId, code, grants: { copy: 20 } },
        },
      };

      const first = (await module.execute(createCommand)) as RedemptionCode[];
      const replay = (await module.execute(createCommand)) as RedemptionCode[];
      assert.deepEqual(replay, first);
      assert.equal((await service.list({ batchId })).length, 1);

      const created = first[0];
      assert.ok(created);
      const voidCommand = {
        context,
        idempotencyKey: 'void-after-command-completion-loss',
        input: {
          action: 'void',
          payload: { code: created.code, expectedRevision: created.revision },
        },
      };
      const firstVoid = (await module.execute(voidCommand)) as RedemptionCode;
      const replayedVoid = (await module.execute(voidCommand)) as RedemptionCode;
      assert.deepEqual(replayedVoid, firstVoid);
      assert.equal(replayedVoid.status, 'voided');
      assert.equal(replayedVoid.revision, 2);
    }
  );
});
