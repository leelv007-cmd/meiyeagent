import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { P1DomainError } from './domain.js';
import { PostgresGrantLotLedger } from './postgres-grant-lot.js';

describe('PostgresGrantLotLedger', () => {
  it('migrates workspace grant lots and append-only transactions with CAS facts', async () => {
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

    await new PostgresGrantLotLedger(pool).migrate(client);

    const ddl = queries.join('\n');
    assert.match(ddl, /CREATE TABLE IF NOT EXISTS p1_grant_lots/);
    assert.match(ddl, /CREATE TABLE IF NOT EXISTS p1_grant_lot_transactions/);
    assert.match(
      ddl,
      /CREATE TABLE IF NOT EXISTS p1_grant_lot_legacy_migrations/
    );
    assert.match(ddl, /remaining_amount >= 0/);
    assert.match(ddl, /revision bigint NOT NULL/);
    assert.match(ddl, /related_transaction_id/);
    assert.match(ddl, /p1_grant_lot_refund_related_fk/);
    assert.match(ddl, /operation_id/);
    assert.match(ddl, /p1_grant_lot_refund_once_idx/);
  });

  it(
    'serializes concurrent FIFO consumption and rebuilds the projection from transaction facts',
    {
      skip: process.env.TEST_DATABASE_URL
        ? false
        : 'TEST_DATABASE_URL is not configured',
    },
    async (t) => {
      const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
      const ledger = new PostgresGrantLotLedger(pool);
      const workspaceId = `grant-lot-${randomUUID()}`;
      const batchWorkspaceId = `${workspaceId}-batch`;
      const reconcileWorkspaceId = `${workspaceId}-reconcile`;
      const debtWorkspaceId = `${workspaceId}-debt`;
      await ledger.migrate();
      await pool.query(
        `INSERT INTO workspaces (id, name)
         VALUES ($1, 'Grant lot test'), ($2, 'Grant lot batch test'),
                ($3, 'Grant lot reconcile test'),
                ($4, 'Grant lot debt test')`,
        [workspaceId, batchWorkspaceId, reconcileWorkspaceId, debtWorkspaceId]
      );
      t.after(async () => {
        await pool.query(
          'DELETE FROM p1_grant_lot_transactions WHERE workspace_id = ANY($1::text[])',
          [[workspaceId, batchWorkspaceId, reconcileWorkspaceId, debtWorkspaceId]]
        );
        await pool.query(
          'DELETE FROM p1_grant_lots WHERE workspace_id = ANY($1::text[])',
          [[workspaceId, batchWorkspaceId, reconcileWorkspaceId, debtWorkspaceId]]
        );
        await pool.query('DELETE FROM workspaces WHERE id = ANY($1::text[])', [
          [workspaceId, batchWorkspaceId, reconcileWorkspaceId, debtWorkspaceId],
        ]);
        await pool.end();
      });

      await ledger.grant({
        id: 'lot-soon',
        workspaceId,
        resource: 'copy',
        amount: 5,
        expirationDate: '2026-07-21T00:00:00.000Z',
        transactionType: 'SUBSCRIPTION_RENEWAL',
        createdAt: '2026-07-19T00:00:00.000Z',
      });
      await ledger.grant({
        id: 'lot-reconcile-plan',
        workspaceId: reconcileWorkspaceId,
        resource: 'copy',
        amount: 10,
        expirationDate: '2026-08-01T00:00:00.000Z',
        transactionType: 'SUBSCRIPTION_RENEWAL',
        createdAt: '2026-07-19T00:00:00.000Z',
      });
      const [reconcileUsage] = await ledger.consume({
        workspaceId: reconcileWorkspaceId,
        resource: 'copy',
        amount: 8,
        transactionId: 'reconcile-usage',
        actorId: 'owner',
        correlationId: 'corr-reconcile-usage',
        createdAt: '2026-07-19T01:00:00.000Z',
      });
      const downgrade = await ledger.reconcileEntitlementLots({
        workspaceId: reconcileWorkspaceId,
        resource: 'copy',
        lotIds: ['lot-reconcile-plan'],
        targetAmount: 5,
        expirationDate: '2026-08-01T00:00:00.000Z',
        operationId: 'reconcile-downgrade-five',
        actorId: 'system',
        correlationId: 'corr-reconcile-downgrade',
        asOf: '2026-07-19T02:00:00.000Z',
      });
      assert.equal(downgrade[0]?.amount, 2);
      assert.equal(
        (await ledger.listLots(reconcileWorkspaceId, 'copy'))[0]
          ?.remainingAmount,
        0
      );

      const debtExpiration = '2026-08-01T00:00:00.000Z';
      await ledger.grant({
        id: 'lot-debt-opening',
        workspaceId: debtWorkspaceId,
        resource: 'copy',
        amount: 10,
        expirationDate: debtExpiration,
        transactionType: 'SUBSCRIPTION_RENEWAL',
        createdAt: '2026-07-19T00:00:00.000Z',
      });
      const debtUsages = [];
      for (let index = 0; index < 8; index += 1) {
        const [usage] = await ledger.consume({
          workspaceId: debtWorkspaceId,
          resource: 'copy',
          amount: 1,
          transactionId: `debt-usage-${index}`,
          actorId: 'owner',
          correlationId: 'corr-debt-usage',
          createdAt: `2026-07-19T0${index + 1}:00:00.000Z`,
        });
        assert.ok(usage);
        debtUsages.push(usage);
      }
      await ledger.reconcileEntitlementLots({
        workspaceId: debtWorkspaceId,
        resource: 'copy',
        lotIds: ['lot-debt-opening'],
        targetAmount: 5,
        expirationDate: debtExpiration,
        operationId: 'debt-downgrade-five',
        actorId: 'system',
        correlationId: 'corr-debt-downgrade',
        asOf: '2026-07-19T10:00:00.000Z',
      });
      await ledger.refundUsage({
        workspaceId: debtWorkspaceId,
        usageTransactionId: debtUsages[0]!.id,
        refundTransactionId: 'debt-partial-refund',
        actorId: 'system',
        correlationId: 'corr-debt-partial-refund',
        createdAt: '2026-07-19T11:00:00.000Z',
      });
      assert.equal(
        (await ledger.listLots(debtWorkspaceId, 'copy'))[0]?.remainingAmount,
        0
      );
      await ledger.grant({
        id: 'lot-debt-upgrade',
        workspaceId: debtWorkspaceId,
        resource: 'copy',
        amount: 15,
        expirationDate: debtExpiration,
        transactionType: 'SUBSCRIPTION_RENEWAL',
        createdAt: '2026-07-19T12:00:00.000Z',
      });
      await ledger.reconcileEntitlementLots({
        workspaceId: debtWorkspaceId,
        resource: 'copy',
        lotIds: ['lot-debt-opening', 'lot-debt-upgrade'],
        targetAmount: 20,
        expirationDate: debtExpiration,
        operationId: 'debt-upgrade-twenty',
        actorId: 'system',
        correlationId: 'corr-debt-upgrade',
        asOf: '2026-07-19T13:00:00.000Z',
      });
      assert.equal(
        (await ledger.listLots(debtWorkspaceId, 'copy')).reduce(
          (total, lot) => total + lot.remainingAmount,
          0
        ),
        13
      );
      assert.ok(reconcileUsage);
      await ledger.refundUsage({
        workspaceId: reconcileWorkspaceId,
        usageTransactionId: reconcileUsage.id,
        refundTransactionId: 'reconcile-refund',
        actorId: 'system',
        correlationId: 'corr-reconcile-refund',
        createdAt: '2026-07-19T03:00:00.000Z',
      });
      assert.equal(
        (await ledger.listLots(reconcileWorkspaceId, 'copy'))[0]
          ?.remainingAmount,
        5
      );
      await ledger.reconcileEntitlementLots({
        workspaceId: reconcileWorkspaceId,
        resource: 'copy',
        lotIds: ['lot-reconcile-plan'],
        targetAmount: 0,
        expirationDate: '2026-07-20T00:00:00.000Z',
        operationId: 'reconcile-period-close',
        actorId: 'system',
        correlationId: 'corr-reconcile-period-close',
        asOf: '2026-07-20T00:00:00.000Z',
      });
      assert.equal(
        (await ledger.listLots(reconcileWorkspaceId, 'copy'))[0]
          ?.remainingAmount,
        0
      );
      for (const [id, expirationDate] of [
        ['batch-soon', '2026-07-21T00:00:00.000Z'],
        ['batch-later', '2026-07-22T00:00:00.000Z'],
      ] as const) {
        await ledger.grant({
          id,
          workspaceId: batchWorkspaceId,
          resource: 'video',
          amount: 1,
          expirationDate,
          transactionType: 'SUBSCRIPTION_RENEWAL',
          createdAt: '2026-07-19T00:00:00.000Z',
        });
      }
      await ledger.consume({
        workspaceId: batchWorkspaceId,
        resource: 'video',
        amount: 2,
        transactionId: 'batch-usage',
        actorId: 'owner',
        correlationId: 'corr-batch-usage',
        createdAt: '2026-07-20T00:00:00.000Z',
      });
      const [batchRefundA, batchRefundB] = await Promise.all([
        ledger.refundUsageOperation({
          workspaceId: batchWorkspaceId,
          usageOperationId: 'batch-usage',
          refundOperationId: 'batch-refund-a',
          actorId: 'system',
          correlationId: 'corr-batch-refund-a',
          createdAt: '2026-07-20T01:00:00.000Z',
        }),
        ledger.refundUsageOperation({
          workspaceId: batchWorkspaceId,
          usageOperationId: 'batch-usage',
          refundOperationId: 'batch-refund-b',
          actorId: 'system',
          correlationId: 'corr-batch-refund-b',
          createdAt: '2026-07-20T01:01:00.000Z',
        }),
      ]);
      assert.deepEqual(batchRefundB, batchRefundA);
      assert.equal(batchRefundA.length, 2);
      assert.equal(
        (await ledger.listLots(batchWorkspaceId, 'video')).reduce(
          (total, lot) => total + lot.remainingAmount,
          0
        ),
        2
      );
      await ledger.grant({
        id: 'lot-idempotent-usage',
        workspaceId,
        resource: 'image',
        amount: 5,
        expirationDate: null,
        transactionType: 'PURCHASE_PACKAGE',
        createdAt: '2026-07-19T00:00:00.000Z',
      });
      const [sharedUsageA, sharedUsageB] = await Promise.all([
        ledger.consume({
          workspaceId,
          resource: 'image',
          amount: 2,
          transactionId: 'usage-shared-operation',
          actorId: 'owner',
          correlationId: 'corr-shared-a',
          createdAt: '2026-07-20T00:00:00.000Z',
        }),
        ledger.consume({
          workspaceId,
          resource: 'image',
          amount: 2,
          transactionId: 'usage-shared-operation',
          actorId: 'owner',
          correlationId: 'corr-shared-b',
          createdAt: '2026-07-20T00:00:00.000Z',
        }),
      ]);
      assert.deepEqual(sharedUsageB, sharedUsageA);
      assert.equal(
        (await ledger.listLots(workspaceId, 'image'))[0]?.remainingAmount,
        3
      );

      const outcomes = await Promise.allSettled([
        ledger.consume({
          workspaceId,
          resource: 'copy',
          amount: 4,
          transactionId: 'usage-a',
          actorId: 'owner',
          correlationId: 'corr-a',
          createdAt: '2026-07-20T00:00:00.000Z',
        }),
        ledger.consume({
          workspaceId,
          resource: 'copy',
          amount: 4,
          transactionId: 'usage-b',
          actorId: 'owner',
          correlationId: 'corr-b',
          createdAt: '2026-07-20T00:00:00.000Z',
        }),
      ]);
      assert.equal(
        outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
        1
      );
      const rejected = outcomes.find(
        (outcome): outcome is PromiseRejectedResult =>
          outcome.status === 'rejected'
      );
      assert.ok(rejected?.reason instanceof P1DomainError);

      const projection = await ledger.rebuildProjection({
        workspaceId,
        asOf: '2026-07-20T01:00:00.000Z',
        actorId: 'system',
        correlationId: 'corr-rebuild',
      });
      assert.deepEqual(projection, [
        {
          resource: 'copy',
          grantedAmount: 5,
          usedAmount: 4,
          refundedAmount: 0,
          expiredAmount: 0,
          remainingAmount: 1,
        },
        {
          resource: 'image',
          grantedAmount: 5,
          usedAmount: 2,
          refundedAmount: 0,
          expiredAmount: 0,
          remainingAmount: 3,
        },
      ]);

      const fulfilled = outcomes.find(
        (outcome): outcome is PromiseFulfilledResult<
          Awaited<ReturnType<PostgresGrantLotLedger['consume']>>
        > => outcome.status === 'fulfilled'
      );
      const usage = fulfilled?.value[0];
      assert.ok(usage);
      const [refund, replay] = await Promise.all([
        ledger.refundUsage({
          workspaceId,
          usageTransactionId: usage.id,
          refundTransactionId: 'refund-a',
          actorId: 'system',
          correlationId: 'corr-refund',
          createdAt: '2026-07-20T02:00:00.000Z',
        }),
        ledger.refundUsage({
          workspaceId,
          usageTransactionId: usage.id,
          refundTransactionId: 'refund-replay',
          actorId: 'system',
          correlationId: 'corr-refund-replay',
          createdAt: '2026-07-20T03:00:00.000Z',
        }),
      ]);
      assert.equal(refund?.relatedTransactionId, usage.id);
      assert.equal(replay?.id, refund?.id);

      const expired = await ledger.expireLots({
        workspaceId,
        now: '2026-07-21T00:00:00.000Z',
        actorId: 'system',
        correlationId: 'corr-expire',
      });
      assert.equal(expired.length, 1);
      assert.equal(expired[0]?.amount, 5);
      assert.deepEqual(
        await ledger.rebuildProjection({
          workspaceId,
          asOf: '2026-07-21T01:00:00.000Z',
          actorId: 'system',
          correlationId: 'corr-final-rebuild',
        }),
        [
          {
            resource: 'copy',
            grantedAmount: 5,
            usedAmount: 4,
            refundedAmount: 4,
            expiredAmount: 5,
            remainingAmount: 0,
          },
          {
            resource: 'image',
            grantedAmount: 5,
            usedAmount: 2,
            refundedAmount: 0,
            expiredAmount: 0,
            remainingAmount: 3,
          },
        ]
      );
    }
  );

  it(
    'rolls back an interrupted legacy migration and replays it exactly once',
    {
      skip: process.env.TEST_DATABASE_URL
        ? false
        : 'TEST_DATABASE_URL is not configured',
    },
    async (t) => {
      const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
      const ledger = new PostgresGrantLotLedger(pool);
      const workspaceId = `grant-lot-migration-${randomUUID()}`;
      await ledger.migrate();
      await pool.query(
        `INSERT INTO workspaces (id, name)
         VALUES ($1, 'Grant lot migration rollback test')`,
        [workspaceId]
      );
      t.after(async () => {
        await pool.query(
          'DELETE FROM p1_grant_lot_transactions WHERE workspace_id = $1',
          [workspaceId]
        );
        await pool.query(
          'DELETE FROM p1_grant_lot_legacy_migrations WHERE workspace_id = $1',
          [workspaceId]
        );
        await pool.query(
          'DELETE FROM p1_grant_lots WHERE workspace_id = $1',
          [workspaceId]
        );
        await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
        await pool.end();
      });

      await ledger.grant({
        id: 'lot-legacy-plan',
        workspaceId,
        resource: 'copy',
        amount: 10,
        expirationDate: null,
        transactionType: 'SUBSCRIPTION_RENEWAL',
        createdAt: '2026-07-19T00:00:00.000Z',
      });
      const operationId = 'legacy-usage-migration:copy:failure-snapshot';
      await pool.query(
        `INSERT INTO p1_grant_lot_transactions
           (workspace_id, id, resource, transaction_type, amount, lot_id,
            related_transaction_id, operation_id, actor_id, correlation_id,
            created_at)
         VALUES ($1, $2, 'copy', 'USAGE', 1, 'lot-legacy-plan', NULL,
                 $3, 'failure-fixture', 'failure-fixture',
                 '2026-07-19T01:00:00.000Z'::timestamptz)`,
        [workspaceId, `${operationId}:0`, operationId]
      );
      const migration = {
        workspaceId,
        resource: 'copy' as const,
        legacyAvailable: 7,
        legacySnapshotId: 'failure-snapshot',
        balanceLotId: 'lot-unused-legacy-balance',
        createdAt: '2026-07-19T00:00:00.000Z',
        asOf: '2026-07-19T02:00:00.000Z',
      };

      await assert.rejects(
        ledger.migrateLegacyBalance(migration),
        (error: unknown) =>
          error instanceof P1DomainError &&
          error.code === 'IDEMPOTENCY_CONFLICT'
      );
      assert.equal(
        (await ledger.listLots(workspaceId, 'copy'))[0]?.remainingAmount,
        10
      );
      assert.equal(await ledger.isLegacyBalanceMigrated(workspaceId, 'copy'), false);

      await pool.query(
        `DELETE FROM p1_grant_lot_transactions
          WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, `${operationId}:0`]
      );
      await ledger.migrateLegacyBalance(migration);
      await ledger.migrateLegacyBalance(migration);

      assert.equal(
        (await ledger.listLots(workspaceId, 'copy'))[0]?.remainingAmount,
        7
      );
      assert.equal(await ledger.isLegacyBalanceMigrated(workspaceId, 'copy'), true);
      const migratedTransactions = (
        await ledger.listTransactions(workspaceId)
      ).filter((transaction) => transaction.operationId === operationId);
      assert.equal(migratedTransactions.length, 1);
      const marker = await pool.query(
        `SELECT count(*)::int AS count
           FROM p1_grant_lot_legacy_migrations
          WHERE workspace_id = $1 AND resource = 'copy'
            AND migration_version = 'legacy-balance-v1'`,
        [workspaceId]
      );
      assert.equal(marker.rows[0]?.count, 1);
    }
  );

  it(
    'fences a stale legacy snapshot from a concurrent entitlement upgrade',
    {
      skip: process.env.TEST_DATABASE_URL
        ? false
        : 'TEST_DATABASE_URL is not configured',
    },
    async (t) => {
      const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
      const ledger = new PostgresGrantLotLedger(pool);
      const workspaceId = `grant-lot-fence-${randomUUID()}`;
      await ledger.migrate();
      await pool.query(
        `INSERT INTO workspaces (id, name)
         VALUES ($1, 'Grant lot resource fence test')`,
        [workspaceId]
      );
      t.after(async () => {
        await pool.query(
          'DELETE FROM p1_grant_lot_transactions WHERE workspace_id = $1',
          [workspaceId]
        );
        await pool.query(
          'DELETE FROM p1_grant_lot_legacy_migrations WHERE workspace_id = $1',
          [workspaceId]
        );
        await pool.query(
          'DELETE FROM p1_grant_lots WHERE workspace_id = $1',
          [workspaceId]
        );
        await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
        await pool.end();
      });

      await ledger.grant({
        id: 'lot-plan-ten',
        workspaceId,
        resource: 'image',
        amount: 10,
        expirationDate: '2026-08-01T00:00:00.000Z',
        transactionType: 'SUBSCRIPTION_RENEWAL',
        createdAt: '2026-07-19T00:00:00.000Z',
      });
      let releaseSnapshot!: () => void;
      const snapshotRelease = new Promise<void>((resolve) => {
        releaseSnapshot = resolve;
      });
      let signalSnapshotRead!: () => void;
      const snapshotRead = new Promise<void>((resolve) => {
        signalSnapshotRead = resolve;
      });
      const staleMigration = ledger.withResourceLocks(
        workspaceId,
        ['image'],
        async () => {
          signalSnapshotRead();
          await snapshotRelease;
          await ledger.migrateLegacyBalance({
            workspaceId,
            resource: 'image',
            legacyAvailable: 7,
            legacySnapshotId: 'stale-seven',
            balanceLotId: 'lot-unused-stale-balance',
            createdAt: '2026-07-19T00:00:00.000Z',
            asOf: '2026-07-19T02:00:00.000Z',
          });
        }
      );
      await snapshotRead;

      const concurrentUpgrade = (async () => {
        await ledger.grant({
          id: 'lot-plan-upgrade-five',
          workspaceId,
          resource: 'image',
          amount: 5,
          expirationDate: '2026-08-01T00:00:00.000Z',
          transactionType: 'SUBSCRIPTION_RENEWAL',
          createdAt: '2026-07-19T01:00:00.000Z',
        });
        await ledger.reconcileEntitlementLots({
          workspaceId,
          resource: 'image',
          lotIds: ['lot-plan-ten', 'lot-plan-upgrade-five'],
          targetAmount: 15,
          expirationDate: '2026-08-01T00:00:00.000Z',
          operationId: 'plan-upgrade-fifteen',
          actorId: 'owner',
          correlationId: 'plan-upgrade-fifteen',
          asOf: '2026-07-19T01:00:00.000Z',
        });
      })();
      releaseSnapshot();
      await Promise.all([staleMigration, concurrentUpgrade]);

      assert.equal(
        (await ledger.listLots(workspaceId, 'image')).reduce(
          (total, lot) => total + lot.remainingAmount,
          0
        ),
        12
      );
      assert.equal(await ledger.isLegacyBalanceMigrated(workspaceId, 'image'), true);
      await ledger.migrateLegacyBalance({
        workspaceId,
        resource: 'image',
        legacyAvailable: 7,
        legacySnapshotId: 'stale-seven',
        balanceLotId: 'lot-unused-stale-balance',
        createdAt: '2026-07-19T00:00:00.000Z',
        asOf: '2026-07-19T02:00:00.000Z',
      });
      assert.equal(
        (await ledger.listLots(workspaceId, 'image')).reduce(
          (total, lot) => total + lot.remainingAmount,
          0
        ),
        12
      );
    }
  );

  it(
    'keeps the business pool available while an outer resource fence is held',
    {
      skip: process.env.TEST_DATABASE_URL
        ? false
        : 'TEST_DATABASE_URL is not configured',
    },
    async (t) => {
      const pool = new Pool({
        connectionString: process.env.TEST_DATABASE_URL,
        connectionTimeoutMillis: 250,
        max: 1,
      });
      const ledger = new PostgresGrantLotLedger(pool);
      const workspaceId = `grant-lot-pool-one-${randomUUID()}`;
      await ledger.migrate();
      await pool.query(
        `INSERT INTO workspaces (id, name)
         VALUES ($1, 'Grant lot pool saturation test')`,
        [workspaceId]
      );
      t.after(async () => {
        await pool.query(
          'DELETE FROM p1_grant_lot_transactions WHERE workspace_id = $1',
          [workspaceId]
        );
        await pool.query(
          'DELETE FROM p1_grant_lot_legacy_migrations WHERE workspace_id = $1',
          [workspaceId]
        );
        await pool.query(
          'DELETE FROM p1_grant_lots WHERE workspace_id = $1',
          [workspaceId]
        );
        await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
        await pool.end();
      });

      await Promise.all(
        [0, 1, 2].map((index) =>
          ledger.withResourceLocks(workspaceId, ['copy'], async () => {
            assert.equal(
              (await pool.query('SELECT 1 AS ready')).rows[0]?.ready,
              1
            );
            await ledger.grant({
              id: `lot-pool-one-${index}`,
              workspaceId,
              resource: 'copy',
              amount: 1,
              expirationDate: null,
              transactionType: 'PURCHASE_PACKAGE',
              createdAt: `2026-07-19T0${index}:00:00.000Z`,
            });
            if (index === 0) {
              await ledger.migrateLegacyBalance({
                workspaceId,
                resource: 'copy',
                legacyAvailable: 1,
                legacySnapshotId: 'pool-one',
                balanceLotId: 'lot-unused-pool-one',
                createdAt: '2026-07-19T00:00:00.000Z',
                asOf: '2026-07-19T01:00:00.000Z',
              });
            }
          })
        )
      );
      assert.equal(
        (await ledger.listLots(workspaceId, 'copy')).reduce(
          (total, lot) => total + lot.remainingAmount,
          0
        ),
        3
      );
      assert.equal(await ledger.isLegacyBalanceMigrated(workspaceId, 'copy'), true);
    }
  );

  it(
    'bounds dedicated fence connections across concurrent workspaces',
    {
      skip: process.env.TEST_DATABASE_URL
        ? false
        : 'TEST_DATABASE_URL is not configured',
    },
    async (t) => {
      const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
      const fenceApplicationName =
        `meiye-grant-resource-fence:${process.pid}:${randomUUID().slice(0, 12)}`;
      const ledger = new PostgresGrantLotLedger(pool, fenceApplicationName);
      let active = 0;
      let maximumActive = 0;
      let entered = 0;
      let signalFirstWaveEntered!: () => void;
      const firstWaveEntered = new Promise<void>((resolve) => {
        signalFirstWaveEntered = resolve;
      });
      let releaseAll!: () => void;
      const allReleased = new Promise<void>((resolve) => {
        releaseAll = resolve;
      });
      let fences: Promise<void>[] = [];
      let fenceResults: PromiseSettledResult<void>[] = [];
      let remainingConnectionCount: number | undefined;
      let cleaned = false;
      const cleanup = async () => {
        if (cleaned) return;
        releaseAll();
        try {
          fenceResults = await Promise.allSettled(fences);
          const remainingConnections = await pool.query<{ count: number }>(
            `SELECT count(*)::integer AS count
               FROM pg_stat_activity
              WHERE datname = current_database() AND application_name = $1`,
            [fenceApplicationName]
          );
          remainingConnectionCount = remainingConnections.rows[0]?.count;
        } finally {
          cleaned = true;
          await pool.end();
        }
      };
      t.after(cleanup);
      try {
        fences = Array.from({ length: 8 }, (_, index) =>
          ledger.withResourceLocks(
            `grant-fence-bounded-${index}-${randomUUID()}`,
            ['copy'],
            async () => {
              active += 1;
              maximumActive = Math.max(maximumActive, active);
              entered += 1;
              if (entered === 4) signalFirstWaveEntered();
              await allReleased;
              active -= 1;
            }
          )
        );
        const allFences = Promise.all(fences);
        await Promise.race([
          firstWaveEntered,
          allFences.then(() => {
            throw new Error('Fence work completed before the first wave entered.');
          }),
        ]);
        assert.equal(maximumActive, 4);
        const heldConnections = await pool.query<{ count: number }>(
          `SELECT count(*)::integer AS count
             FROM pg_stat_activity
            WHERE datname = current_database() AND application_name = $1`,
          [fenceApplicationName]
        );
        assert.equal(heldConnections.rows[0]?.count, 4);
      } finally {
        await cleanup();
      }
      assert.deepEqual(
        fenceResults.map((result) => result.status),
        Array.from({ length: 8 }, () => 'fulfilled')
      );
      assert.equal(remainingConnectionCount, 0);
      assert.ok(maximumActive <= 4);
    }
  );
});
