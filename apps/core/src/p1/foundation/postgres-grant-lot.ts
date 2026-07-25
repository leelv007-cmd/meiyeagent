import { AsyncLocalStorage } from 'node:async_hooks';
import { Client, type Pool, type PoolClient, type QueryResultRow } from 'pg';
import { P1DomainError } from './domain.js';
import {
  allocateFifoConsumption,
  assertGrantLotEntitlementReconciliationInput,
  assertGrantLotGrantInput,
  type GrantLot,
  type GrantLotEntitlementReconciliationInput,
  type GrantLotGrantInput,
  type GrantLotProjection,
  type GrantLotResource,
  type GrantLotTransaction,
  type GrantLotTransactionType,
  type LegacyGrantLotMigrationInput,
} from './grant-lot.js';

type Queryable = Pick<Pool | PoolClient, 'query'>;

class AsyncPermitPool {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(limit: number) {
    this.available = limit;
  }

  async acquire() {
    if (this.available > 0) {
      this.available -= 1;
    } else {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) next();
      else this.available += 1;
    };
  }
}

const grantFenceConnectionLimiter = new AsyncPermitPool(4);

interface GrantLotRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  resource: GrantLotResource;
  original_amount: number;
  entitlement_amount: number;
  remaining_amount: number;
  expiration_date: Date | string | null;
  transaction_type: GrantLot['transactionType'];
  source_ref: string | null;
  revision: string | number;
  created_at: Date | string;
}

interface GrantTransactionRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  resource: GrantLotResource;
  transaction_type: GrantLotTransactionType;
  amount: number;
  lot_id: string;
  related_transaction_id: string | null;
  operation_id: string;
  actor_id: string;
  correlation_id: string;
  created_at: Date | string;
}

export class PostgresGrantLotLedger {
  private readonly resourceLockContext = new AsyncLocalStorage<
    ReadonlySet<string>
  >();
  private readonly workspaceFences = new Map<string, Promise<void>>();

  constructor(
    private readonly pool: Pool,
    private readonly fenceApplicationName =
      `meiye-grant-resource-fence:${process.pid}`
  ) {}

  async migrate(client?: PoolClient) {
    const db: Queryable = client ?? this.pool;
    await db.query(`
      CREATE TABLE IF NOT EXISTS p1_grant_lots (
        workspace_id text NOT NULL,
        id text NOT NULL,
        resource text NOT NULL CHECK (resource IN ('copy', 'image', 'video', 'audio')),
        original_amount integer NOT NULL CHECK (original_amount > 0),
        entitlement_amount integer NOT NULL CHECK (
          entitlement_amount >= 0 AND entitlement_amount <= original_amount
        ),
        remaining_amount integer NOT NULL CHECK (
          remaining_amount >= 0 AND
          remaining_amount <= entitlement_amount
        ),
        expiration_date timestamptz,
        transaction_type text NOT NULL CHECK (
          transaction_type IN (
            'REGISTER_GIFT',
            'SUBSCRIPTION_RENEWAL',
            'PURCHASE_PACKAGE',
            'REDEMPTION_CODE'
          )
        ),
        source_ref text,
        revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id),
        CONSTRAINT p1_grant_lots_workspace_fk
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        CHECK (expiration_date IS NULL OR expiration_date > created_at)
      )
    `);
    await db.query(`
      ALTER TABLE p1_grant_lots
        ADD COLUMN IF NOT EXISTS entitlement_amount integer;
      UPDATE p1_grant_lots
        SET entitlement_amount = original_amount
        WHERE entitlement_amount IS NULL;
      ALTER TABLE p1_grant_lots
        ALTER COLUMN entitlement_amount SET NOT NULL;
      DO $$ BEGIN
        ALTER TABLE p1_grant_lots
          ADD CONSTRAINT p1_grant_lots_entitlement_amount_check
          CHECK (
            entitlement_amount >= 0 AND
            entitlement_amount <= original_amount
          );
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$
      ;
      DO $$ BEGIN
        ALTER TABLE p1_grant_lots
          ADD CONSTRAINT p1_grant_lots_remaining_entitlement_check
          CHECK (remaining_amount <= entitlement_amount);
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$
    `);
    await db.query(`
      DO $$ BEGIN
        ALTER TABLE p1_grant_lots
          ADD CONSTRAINT p1_grant_lots_workspace_fk
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS p1_grant_lot_legacy_migrations (
        workspace_id text NOT NULL,
        resource text NOT NULL CHECK (
          resource IN ('copy', 'image', 'video', 'audio')
        ),
        migration_version text NOT NULL,
        completed_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, resource, migration_version),
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS p1_grant_lot_transactions (
        workspace_id text NOT NULL,
        id text NOT NULL,
        resource text NOT NULL CHECK (resource IN ('copy', 'image', 'video', 'audio')),
        transaction_type text NOT NULL CHECK (
          transaction_type IN (
            'REGISTER_GIFT',
            'SUBSCRIPTION_RENEWAL',
            'PURCHASE_PACKAGE',
            'REDEMPTION_CODE',
            'REFUND',
            'USAGE',
            'EXPIRE'
          )
        ),
        amount integer NOT NULL CHECK (amount > 0),
        lot_id text NOT NULL,
        related_transaction_id text,
        operation_id text NOT NULL,
        actor_id text NOT NULL,
        correlation_id text NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id),
        FOREIGN KEY (workspace_id, lot_id)
          REFERENCES p1_grant_lots(workspace_id, id),
        CONSTRAINT p1_grant_lot_refund_related_fk
          FOREIGN KEY (workspace_id, related_transaction_id)
          REFERENCES p1_grant_lot_transactions(workspace_id, id),
        CHECK (
          (transaction_type = 'REFUND' AND related_transaction_id IS NOT NULL)
          OR (transaction_type <> 'REFUND' AND related_transaction_id IS NULL)
        )
      )
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS p1_grant_lots_fifo_idx
        ON p1_grant_lots (
          workspace_id,
          resource,
          expiration_date ASC NULLS LAST,
          created_at ASC,
          id ASC
        )
        WHERE remaining_amount > 0
    `);
    await db.query(`
      DO $$ BEGIN
        ALTER TABLE p1_grant_lot_transactions
          ADD CONSTRAINT p1_grant_lot_refund_related_fk
          FOREIGN KEY (workspace_id, related_transaction_id)
          REFERENCES p1_grant_lot_transactions(workspace_id, id);
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS p1_grant_lot_operation_idx
        ON p1_grant_lot_transactions (
          workspace_id,
          transaction_type,
          operation_id,
          created_at,
          id
        )
    `);
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS p1_grant_lot_refund_once_idx
        ON p1_grant_lot_transactions (workspace_id, related_transaction_id)
        WHERE transaction_type = 'REFUND'
    `);
  }

  async grant(input: GrantLotGrantInput): Promise<GrantLot> {
    return this.transaction(async (client) => {
      await this.lockGrantResource(client, input.workspaceId, input.resource);
      const result = await grantLotWithClient(client, input);
      return result.lot;
    });
  }

  async withResourceLocks<T>(
    workspaceId: string,
    resources: readonly GrantLotResource[],
    work: () => Promise<T>
  ): Promise<T> {
    return this.enqueueWorkspaceFence(workspaceId, async () => {
      const releaseFenceConnection =
        await grantFenceConnectionLimiter.acquire();
      let lockClient: Client | undefined;
      let begun = false;
      let result: T | undefined;
      let failure: unknown;
      try {
        lockClient = new Client({
          ...this.pool.options,
          application_name: this.fenceApplicationName,
        });
        await lockClient.connect();
        await lockClient.query('BEGIN');
        begun = true;
        const orderedResources = [...new Set(resources)].sort();
        for (const resource of orderedResources) {
          await lockGrantResource(lockClient, workspaceId, resource);
        }
        const heldLocks = new Set(
          orderedResources.map((resource) =>
            grantResourceLockKey(workspaceId, resource)
          )
        );
        result = await this.resourceLockContext.run(heldLocks, work);
        await lockClient.query('COMMIT');
      } catch (error) {
        failure = error;
        if (begun && lockClient) {
          await lockClient.query('ROLLBACK').catch(() => undefined);
        }
      } finally {
        if (lockClient) {
          try {
            await lockClient.end();
          } catch (error) {
            if (failure === undefined) failure = error;
          }
        }
        releaseFenceConnection();
      }
      if (failure !== undefined) throw failure;
      return result as T;
    });
  }

  async listLots(
    workspaceId: string,
    resource?: GrantLotResource
  ): Promise<GrantLot[]> {
    const result = await this.pool.query<GrantLotRow>(
      `SELECT * FROM p1_grant_lots
        WHERE workspace_id = $1
          AND ($2::text IS NULL OR resource = $2)
        ORDER BY expiration_date ASC NULLS LAST, created_at ASC, id ASC`,
      [workspaceId, resource ?? null]
    );
    return result.rows.map(grantLotFromRow);
  }

  async listTransactions(workspaceId: string): Promise<GrantLotTransaction[]> {
    const result = await this.pool.query<GrantTransactionRow>(
      `SELECT * FROM p1_grant_lot_transactions
        WHERE workspace_id = $1
        ORDER BY created_at ASC, id ASC`,
      [workspaceId]
    );
    return result.rows.map(grantTransactionFromRow);
  }

  async isLegacyBalanceMigrated(
    workspaceId: string,
    resource: GrantLotResource
  ): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM p1_grant_lot_legacy_migrations
        WHERE workspace_id = $1 AND resource = $2
          AND migration_version = 'legacy-balance-v1'`,
      [workspaceId, resource]
    );
    return result.rowCount === 1;
  }

  async markLegacyBalanceMigrated(input: {
    workspaceId: string;
    resource: GrantLotResource;
    completedAt: string;
  }): Promise<void> {
    assertTimestamp(input.completedAt, 'completedAt');
    await this.pool.query(
      `INSERT INTO p1_grant_lot_legacy_migrations
         (workspace_id, resource, migration_version, completed_at)
       VALUES ($1, $2, 'legacy-balance-v1', $3::timestamptz)
       ON CONFLICT (workspace_id, resource, migration_version) DO NOTHING`,
      [input.workspaceId, input.resource, input.completedAt]
    );
  }

  async migrateLegacyBalance(
    input: LegacyGrantLotMigrationInput
  ): Promise<void> {
    if (!Number.isInteger(input.legacyAvailable) || input.legacyAvailable < 0) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Legacy available balance must be a non-negative integer.'
      );
    }
    if (!input.legacySnapshotId.trim() || !input.balanceLotId.trim()) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Legacy migration identity is required.'
      );
    }
    assertTimestamp(input.createdAt, 'createdAt');
    assertTimestamp(input.asOf, 'asOf');
    await this.transaction(async (client) => {
      await this.lockGrantResource(client, input.workspaceId, input.resource);
      const marker = await client.query(
        `SELECT 1 FROM p1_grant_lot_legacy_migrations
          WHERE workspace_id = $1 AND resource = $2
            AND migration_version = 'legacy-balance-v1'`,
        [input.workspaceId, input.resource]
      );
      if (marker.rowCount) return;

      const selected = await client.query<GrantLotRow>(
        `SELECT * FROM p1_grant_lots
          WHERE workspace_id = $1 AND resource = $2
            AND transaction_type <> 'REDEMPTION_CODE'
          ORDER BY expiration_date ASC NULLS LAST, created_at ASC, id ASC
          FOR UPDATE`,
        [input.workspaceId, input.resource]
      );
      const mirroredRemaining = selected.rows.reduce(
        (total, lot) => total + lot.remaining_amount,
        0
      );
      const historicalUsage = Math.max(
        0,
        mirroredRemaining - input.legacyAvailable
      );
      if (historicalUsage > 0) {
        const allocations = allocateFifoConsumption(
          selected.rows.map(grantLotFromRow),
          historicalUsage
        );
        const operationId =
          `legacy-usage-migration:${input.resource}:${input.legacySnapshotId}`;
        for (const [index, allocation] of allocations.entries()) {
          const lot = selected.rows.find(
            (candidate) => candidate.id === allocation.lotId
          );
          if (!lot) {
            throw new P1DomainError(
              'INVALID_STATE',
              'Legacy migration lot disappeared.'
            );
          }
          const updated = await client.query(
            `UPDATE p1_grant_lots
                SET remaining_amount = remaining_amount - $3,
                    revision = revision + 1
              WHERE workspace_id = $1 AND id = $2
                AND revision = $4 AND remaining_amount >= $3`,
            [
              input.workspaceId,
              lot.id,
              allocation.amount,
              Number(lot.revision),
            ]
          );
          if (updated.rowCount !== 1) {
            throw new P1DomainError(
              'IDEMPOTENCY_CONFLICT',
              'Grant lot changed during legacy migration.'
            );
          }
          await insertTransaction(client, {
            id: `${operationId}:${index}`,
            workspaceId: input.workspaceId,
            resource: input.resource,
            transactionType: 'USAGE',
            amount: allocation.amount,
            lotId: lot.id,
            operationId,
            actorId: 'system-legacy-grant-migration',
            correlationId: `legacy-grant-migration:${input.workspaceId}`,
            createdAt: input.asOf,
          });
        }
      } else {
        const missingBalance = Math.max(
          0,
          input.legacyAvailable - mirroredRemaining
        );
        if (missingBalance > 0) {
          await grantLotWithClient(client, {
            id: input.balanceLotId,
            workspaceId: input.workspaceId,
            resource: input.resource,
            amount: missingBalance,
            expirationDate: null,
            transactionType: 'PURCHASE_PACKAGE',
            sourceRef: `legacy-usage-balance:${input.resource}:v1`,
            actorId: 'system-legacy-grant-migration',
            correlationId: `legacy-grant-migration:${input.workspaceId}`,
            createdAt: input.createdAt,
          });
        }
      }
      await client.query(
        `INSERT INTO p1_grant_lot_legacy_migrations
           (workspace_id, resource, migration_version, completed_at)
         VALUES ($1, $2, 'legacy-balance-v1', $3::timestamptz)`,
        [input.workspaceId, input.resource, input.asOf]
      );
    });
  }

  async consume(input: {
    workspaceId: string;
    resource: GrantLotResource;
    amount: number;
    transactionId: string;
    actorId: string;
    correlationId: string;
    createdAt: string;
  }): Promise<GrantLotTransaction[]> {
    assertPositiveInteger(input.amount, 'Usage amount');
    assertTimestamp(input.createdAt, 'createdAt');
    return this.transaction((client) => this.consumeWithClient(client, input));
  }

  async consumeWithClient(
    client: PoolClient,
    input: {
      workspaceId: string;
      resource: GrantLotResource;
      amount: number;
      transactionId: string;
      actorId: string;
      correlationId: string;
      createdAt: string;
    }
  ): Promise<GrantLotTransaction[]> {
    assertPositiveInteger(input.amount, 'Usage amount');
    assertTimestamp(input.createdAt, 'createdAt');
    await this.lockGrantResource(client, input.workspaceId, input.resource);
    await lockOperation(client, input.workspaceId, input.transactionId);
    const replay = await client.query<GrantTransactionRow>(
      `SELECT * FROM p1_grant_lot_transactions
          WHERE workspace_id = $1
            AND transaction_type = 'USAGE'
            AND operation_id = $2
          ORDER BY id ASC`,
      [input.workspaceId, input.transactionId]
    );
    if (replay.rowCount) {
      const transactions = replay.rows.map(grantTransactionFromRow);
      if (
        transactions.some((row) => row.resource !== input.resource) ||
        transactions.reduce((total, row) => total + row.amount, 0) !==
          input.amount
      ) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'Usage operation was replayed with different facts.'
        );
      }
      return transactions;
    }

    await expireLotsWithClient(client, {
      workspaceId: input.workspaceId,
      now: input.createdAt,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });
    const selected = await client.query<GrantLotRow>(
      `SELECT * FROM p1_grant_lots
          WHERE workspace_id = $1
            AND resource = $2
            AND remaining_amount > 0
            AND (expiration_date IS NULL OR expiration_date > $3::timestamptz)
          ORDER BY expiration_date ASC NULLS LAST, created_at ASC, id ASC
          FOR UPDATE`,
      [input.workspaceId, input.resource, input.createdAt]
    );
    const allocations = allocateFifoConsumption(
      selected.rows.map(grantLotFromRow),
      input.amount
    );
    if (
      allocations.reduce((total, allocation) => total + allocation.amount, 0) !==
      input.amount
    ) {
      throw new P1DomainError(
        'INSUFFICIENT_ENTITLEMENT',
        `Insufficient ${input.resource} allowance.`
      );
    }

    const written: GrantLotTransaction[] = [];
    for (const [index, allocation] of allocations.entries()) {
      const lot = selected.rows.find((row) => row.id === allocation.lotId);
      if (!lot) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Selected grant lot disappeared.'
        );
      }
      const updated = await client.query(
        `UPDATE p1_grant_lots
              SET remaining_amount = remaining_amount - $3,
                  revision = revision + 1
            WHERE workspace_id = $1
              AND id = $2
              AND revision = $4
              AND remaining_amount >= $3`,
        [
          input.workspaceId,
          allocation.lotId,
          allocation.amount,
          Number(lot.revision),
        ]
      );
      if (updated.rowCount !== 1) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'Grant lot revision changed during consumption.'
        );
      }
      const transaction: GrantLotTransaction = {
        id: `${input.transactionId}:${index}`,
        workspaceId: input.workspaceId,
        resource: input.resource,
        transactionType: 'USAGE',
        amount: allocation.amount,
        lotId: allocation.lotId,
        operationId: input.transactionId,
        actorId: input.actorId,
        correlationId: input.correlationId,
        createdAt: input.createdAt,
      };
      await insertTransaction(client, transaction);
      written.push(transaction);
    }
    return written;
  }

  async refundUsage(input: {
    workspaceId: string;
    usageTransactionId: string;
    refundTransactionId: string;
    actorId: string;
    correlationId: string;
    createdAt: string;
  }): Promise<GrantLotTransaction | null> {
    assertTimestamp(input.createdAt, 'createdAt');
    return this.transaction(async (client) => {
      await lockOperation(client, input.workspaceId, 'grant-lot-projection');
      await lockOperation(client, input.workspaceId, input.usageTransactionId);
      const refund = await refundUsageWithClient(client, input);
      await expireLotsWithClient(client, {
        workspaceId: input.workspaceId,
        now: input.createdAt,
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
      return refund;
    });
  }

  async refundUsageOperation(input: {
    workspaceId: string;
    usageOperationId: string;
    refundOperationId: string;
    amount?: number;
    actorId: string;
    correlationId: string;
    createdAt: string;
  }): Promise<GrantLotTransaction[]> {
    assertTimestamp(input.createdAt, 'createdAt');
    if (input.amount !== undefined) {
      assertPositiveInteger(input.amount, 'Refund amount');
    }
    return this.transaction(async (client) => {
      await lockOperation(client, input.workspaceId, 'grant-lot-projection');
      await lockOperation(client, input.workspaceId, input.usageOperationId);
      const usages = await client.query<GrantTransactionRow>(
        `SELECT * FROM p1_grant_lot_transactions
          WHERE workspace_id = $1
            AND transaction_type = 'USAGE'
            AND operation_id = $2
          ORDER BY id ASC`,
        [input.workspaceId, input.usageOperationId]
      );
      const refunds: GrantLotTransaction[] = [];
      let remaining = input.amount;
      for (const [index, usage] of usages.rows.entries()) {
        if (remaining === 0) break;
        const amount =
          remaining === undefined
            ? Number(usage.amount)
            : Math.min(Number(usage.amount), remaining);
        const refund = await refundUsageWithClient(client, {
          workspaceId: input.workspaceId,
          usageTransactionId: usage.id,
          refundTransactionId: `${input.refundOperationId}:${index}`,
          amount,
          actorId: input.actorId,
          correlationId: input.correlationId,
          createdAt: input.createdAt,
        });
        if (refund) {
          refunds.push(refund);
          if (remaining !== undefined) remaining -= refund.amount;
        }
      }
      if (remaining !== undefined && remaining !== 0) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Refund amount exceeds the usage operation.'
        );
      }
      await expireLotsWithClient(client, {
        workspaceId: input.workspaceId,
        now: input.createdAt,
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
      return refunds;
    });
  }

  async reconcileEntitlementLots(
    input: GrantLotEntitlementReconciliationInput
  ): Promise<GrantLotTransaction[]> {
    assertGrantLotEntitlementReconciliationInput(input);
    return this.transaction(async (client) => {
      await this.lockGrantResource(client, input.workspaceId, input.resource);
      await lockOperation(client, input.workspaceId, 'grant-lot-projection');
      await lockOperation(client, input.workspaceId, input.operationId);
      let selected = await selectReconciliationLots(client, input);
      for (const lot of selected) {
        if (
          (lot.expirationDate === null ||
            Date.parse(input.expirationDate) <
              Date.parse(lot.expirationDate)) &&
          Date.parse(input.expirationDate) > Date.parse(lot.createdAt)
        ) {
          const updated = await client.query(
            `UPDATE p1_grant_lots
                SET expiration_date = $3::timestamptz,
                    revision = revision + 1
              WHERE workspace_id = $1 AND id = $2 AND revision = $4`,
            [
              input.workspaceId,
              lot.id,
              input.expirationDate,
              Number(lot.revision),
            ]
          );
          if (updated.rowCount !== 1) {
            throw new P1DomainError(
              'IDEMPOTENCY_CONFLICT',
              'Grant lot revision changed during entitlement reconciliation.'
            );
          }
        }
      }
      selected = await selectReconciliationLots(client, input);
      const replay = await client.query<GrantTransactionRow>(
        `SELECT * FROM p1_grant_lot_transactions
          WHERE workspace_id = $1
            AND transaction_type = 'EXPIRE'
            AND operation_id = $2
          ORDER BY id ASC`,
        [input.workspaceId, input.operationId]
      );
      if (replay.rowCount) {
        await rebuildWorkspaceRemainingWithClient(client, input.workspaceId);
        return replay.rows.map(grantTransactionFromRow);
      }

      const effectiveTarget =
        Date.parse(input.expirationDate) <= Date.parse(input.asOf)
          ? 0
          : input.targetAmount;
      let amountToReduce = Math.max(
        0,
        selected.reduce(
          (total, lot) =>
            total + (lot.entitlementAmount ?? lot.originalAmount),
          0
        ) - effectiveTarget
      );
      const written: GrantLotTransaction[] = [];
      for (const lot of selected) {
        if (amountToReduce === 0) break;
        const currentCap = lot.entitlementAmount ?? lot.originalAmount;
        const capReduction = Math.min(amountToReduce, currentCap);
        const amount = Math.min(lot.remainingAmount, capReduction);
        const updated = await client.query(
          `UPDATE p1_grant_lots
              SET entitlement_amount = entitlement_amount - $3,
                  remaining_amount = remaining_amount - $4,
                  revision = revision + 1
            WHERE workspace_id = $1 AND id = $2 AND revision = $5
              AND entitlement_amount >= $3 AND remaining_amount >= $4`,
          [
            input.workspaceId,
            lot.id,
            capReduction,
            amount,
            Number(lot.revision),
          ]
        );
        if (updated.rowCount !== 1) {
          throw new P1DomainError(
            'IDEMPOTENCY_CONFLICT',
            'Grant lot revision changed during entitlement reconciliation.'
          );
        }
        amountToReduce -= capReduction;
        if (amount === 0) continue;
        const transaction: GrantLotTransaction = {
          id: `${input.operationId}:${written.length}`,
          workspaceId: input.workspaceId,
          resource: input.resource,
          transactionType: 'EXPIRE',
          amount,
          lotId: lot.id,
          operationId: input.operationId,
          actorId: input.actorId,
          correlationId: input.correlationId,
          createdAt: input.asOf,
        };
        await insertTransaction(client, transaction);
        written.push(transaction);
      }
      await rebuildWorkspaceRemainingWithClient(client, input.workspaceId);
      return written;
    });
  }

  async expireLots(input: {
    workspaceId: string;
    now: string;
    actorId: string;
    correlationId: string;
  }): Promise<GrantLotTransaction[]> {
    assertTimestamp(input.now, 'now');
    return this.transaction((client) => expireLotsWithClient(client, input));
  }

  async rebuildProjection(input: {
    workspaceId: string;
    asOf: string;
    actorId: string;
    correlationId: string;
  }): Promise<GrantLotProjection[]> {
    assertTimestamp(input.asOf, 'asOf');
    return this.transaction(async (client) => {
      await lockOperation(client, input.workspaceId, 'grant-lot-projection');
      await rebuildWorkspaceRemainingWithClient(client, input.workspaceId);
      await expireLotsWithClient(client, {
        workspaceId: input.workspaceId,
        now: input.asOf,
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
      return readProjection(client, input.workspaceId);
    });
  }

  private async transaction<T>(
    work: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private lockGrantResource(
    client: PoolClient,
    workspaceId: string,
    resource: GrantLotResource
  ) {
    if (
      this.resourceLockContext
        .getStore()
        ?.has(grantResourceLockKey(workspaceId, resource))
    ) {
      return Promise.resolve();
    }
    return lockGrantResource(client, workspaceId, resource);
  }

  private async enqueueWorkspaceFence<T>(
    workspaceId: string,
    work: () => Promise<T>
  ): Promise<T> {
    const previous = this.workspaceFences.get(workspaceId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.workspaceFences.set(workspaceId, current);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.workspaceFences.get(workspaceId) === current) {
        this.workspaceFences.delete(workspaceId);
      }
    }
  }
}

export async function grantLotWithClient(
  client: PoolClient,
  input: GrantLotGrantInput
): Promise<{ lot: GrantLot; transaction: GrantLotTransaction }> {
  assertGrantLotGrantInput(input);
  const inserted = await client.query<GrantLotRow>(
    `INSERT INTO p1_grant_lots
       (workspace_id, id, resource, original_amount, entitlement_amount,
        remaining_amount, expiration_date, transaction_type, source_ref,
        revision, created_at)
     VALUES ($1, $2, $3, $4, $4, $4, $5::timestamptz, $6, $7, 1,
             $8::timestamptz)
     ON CONFLICT (workspace_id, id) DO NOTHING
     RETURNING *`,
    [
      input.workspaceId,
      input.id,
      input.resource,
      input.amount,
      input.expirationDate,
      input.transactionType,
      input.sourceRef ?? null,
      input.createdAt,
    ]
  );
  let lot = inserted.rows[0] ? grantLotFromRow(inserted.rows[0]) : undefined;
  if (!lot) {
    const existing = await client.query<GrantLotRow>(
      `SELECT * FROM p1_grant_lots
        WHERE workspace_id = $1 AND id = $2
        FOR UPDATE`,
      [input.workspaceId, input.id]
    );
    lot = existing.rows[0] ? grantLotFromRow(existing.rows[0]) : undefined;
    if (
      !lot ||
      lot.resource !== input.resource ||
      lot.originalAmount !== input.amount ||
      !expirationIsSameOrShorter(lot.expirationDate, input.expirationDate) ||
      lot.transactionType !== input.transactionType ||
      lot.sourceRef !== input.sourceRef ||
      lot.createdAt !== input.createdAt
    ) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        `Grant lot ${input.id} already exists with different facts.`
      );
    }
  }
  const transaction: GrantLotTransaction = {
    id: `tx-grant-${input.id}`,
    workspaceId: input.workspaceId,
    resource: input.resource,
    transactionType: input.transactionType,
    amount: input.amount,
    lotId: input.id,
    operationId: `grant:${input.id}`,
    actorId: input.actorId ?? 'system',
    correlationId: input.correlationId ?? 'grant',
    createdAt: input.createdAt,
  };
  const persistedTransaction = await insertTransaction(client, transaction, true);
  return { lot, transaction: persistedTransaction };
}

async function refundUsageWithClient(
  client: PoolClient,
  input: {
    workspaceId: string;
    usageTransactionId: string;
    refundTransactionId: string;
    amount?: number;
    actorId: string;
    correlationId: string;
    createdAt: string;
  }
): Promise<GrantLotTransaction | null> {
  const replay = await client.query<GrantTransactionRow>(
    `SELECT * FROM p1_grant_lot_transactions
      WHERE workspace_id = $1
        AND transaction_type = 'REFUND'
        AND related_transaction_id = $2`,
    [input.workspaceId, input.usageTransactionId]
  );
  if (replay.rows[0]) return grantTransactionFromRow(replay.rows[0]);

  const usage = await client.query<GrantTransactionRow & GrantLotRow>(
    `SELECT t.*,
            l.original_amount,
            l.entitlement_amount,
            l.remaining_amount,
            l.expiration_date,
            l.source_ref,
            l.revision,
            l.created_at AS lot_created_at
       FROM p1_grant_lot_transactions t
       JOIN p1_grant_lots l
         ON l.workspace_id = t.workspace_id AND l.id = t.lot_id
      WHERE t.workspace_id = $1
        AND t.id = $2
        AND t.transaction_type = 'USAGE'
      FOR UPDATE OF l`,
    [input.workspaceId, input.usageTransactionId]
  );
  const row = usage.rows[0];
  if (!row) return null;
  const amount = input.amount ?? Number(row.amount);
  if (!Number.isInteger(amount) || amount <= 0 || amount > Number(row.amount)) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Grant lot refund amount must be within the usage transaction.'
    );
  }
  const refund: GrantLotTransaction = {
    id: input.refundTransactionId,
    workspaceId: input.workspaceId,
    resource: row.resource,
    transactionType: 'REFUND',
    amount,
    lotId: row.lot_id,
    relatedTransactionId: row.id,
    operationId: input.refundTransactionId,
    actorId: input.actorId,
    correlationId: input.correlationId,
    createdAt: input.createdAt,
  };
  const inserted = await insertTransaction(client, refund);
  await rebuildWorkspaceRemainingWithClient(client, input.workspaceId);
  return inserted;
}

async function rebuildWorkspaceRemainingWithClient(
  client: PoolClient,
  workspaceId: string
) {
  const lotsResult = await client.query<GrantLotRow>(
    `SELECT * FROM p1_grant_lots
      WHERE workspace_id = $1
      ORDER BY expiration_date ASC NULLS LAST, created_at ASC, id ASC
      FOR UPDATE`,
    [workspaceId]
  );
  const transactions = await client.query<GrantTransactionRow>(
    `SELECT * FROM p1_grant_lot_transactions
      WHERE workspace_id = $1
      ORDER BY created_at ASC, id ASC`,
    [workspaceId]
  );
  const groups = new Map<string, GrantLotRow[]>();
  for (const lot of lotsResult.rows) {
    const isPeriodGrant =
      lot.transaction_type === 'REGISTER_GIFT' ||
      lot.transaction_type === 'SUBSCRIPTION_RENEWAL';
    const expiration = timestamp(lot.expiration_date);
    const key =
      isPeriodGrant && expiration !== null
        ? `period:${lot.resource}:${Date.parse(expiration)}`
        : `lot:${lot.id}`;
    const group = groups.get(key) ?? [];
    group.push(lot);
    groups.set(key, group);
  }
  for (const cohort of groups.values()) {
    const lotIds = new Set(cohort.map((lot) => lot.id));
    const netUsage = transactions.rows
      .filter((transaction) => lotIds.has(transaction.lot_id))
      .reduce((total, transaction) => {
        if (transaction.transaction_type === 'USAGE') {
          return total + transaction.amount;
        }
        if (transaction.transaction_type === 'REFUND') {
          return total - transaction.amount;
        }
        return total;
      }, 0);
    let usageDebt = Math.max(0, netUsage);
    for (const lot of cohort) {
      const entitlement = Number(lot.entitlement_amount);
      const repaired = Math.max(0, entitlement - usageDebt);
      usageDebt = Math.max(0, usageDebt - entitlement);
      if (repaired === Number(lot.remaining_amount)) continue;
      const updated = await client.query(
        `UPDATE p1_grant_lots
            SET remaining_amount = $3,
                revision = revision + 1
          WHERE workspace_id = $1 AND id = $2 AND revision = $4`,
        [workspaceId, lot.id, repaired, Number(lot.revision)]
      );
      if (updated.rowCount !== 1) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'Grant lot revision changed during projection rebuild.'
        );
      }
    }
  }
}

async function expireLotsWithClient(
  client: PoolClient,
  input: {
    workspaceId: string;
    now: string;
    actorId: string;
    correlationId: string;
  }
) {
  const selected = await client.query<GrantLotRow>(
    `SELECT * FROM p1_grant_lots
      WHERE workspace_id = $1
        AND expiration_date IS NOT NULL
        AND expiration_date <= $2::timestamptz
        AND entitlement_amount > 0
      ORDER BY expiration_date ASC, created_at ASC, id ASC
      FOR UPDATE`,
    [input.workspaceId, input.now]
  );
  const expired: GrantLotTransaction[] = [];
  for (const row of selected.rows) {
    const nextRevision = Number(row.revision) + 1;
    const updated = await client.query(
      `UPDATE p1_grant_lots
          SET remaining_amount = 0,
              entitlement_amount = 0,
              revision = revision + 1
        WHERE workspace_id = $1
          AND id = $2
          AND revision = $3
          AND entitlement_amount = $4`,
      [input.workspaceId, row.id, Number(row.revision), row.entitlement_amount]
    );
    if (updated.rowCount !== 1) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Grant lot revision changed during expiration.'
      );
    }
    if (row.remaining_amount === 0) continue;
    const transaction: GrantLotTransaction = {
      id: `tx-expire-${row.id}-${nextRevision}`,
      workspaceId: input.workspaceId,
      resource: row.resource,
      transactionType: 'EXPIRE',
      amount: row.remaining_amount,
      lotId: row.id,
      operationId: `expire:${row.id}:${nextRevision}`,
      actorId: input.actorId,
      correlationId: input.correlationId,
      createdAt: input.now,
    };
    await insertTransaction(client, transaction);
    expired.push(transaction);
  }
  return expired;
}

async function insertTransaction(
  client: PoolClient,
  transaction: GrantLotTransaction,
  allowReplay = false
): Promise<GrantLotTransaction> {
  const result = await client.query<GrantTransactionRow>(
    `INSERT INTO p1_grant_lot_transactions
       (workspace_id, id, resource, transaction_type, amount, lot_id,
        related_transaction_id, operation_id, actor_id, correlation_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz)
     ON CONFLICT (workspace_id, id) DO NOTHING
     RETURNING *`,
    [
      transaction.workspaceId,
      transaction.id,
      transaction.resource,
      transaction.transactionType,
      transaction.amount,
      transaction.lotId,
      transaction.relatedTransactionId ?? null,
      transaction.operationId ?? transaction.id,
      transaction.actorId,
      transaction.correlationId,
      transaction.createdAt,
    ]
  );
  if (result.rows[0]) return grantTransactionFromRow(result.rows[0]);
  if (allowReplay) {
    const replay = await client.query<GrantTransactionRow>(
      `SELECT * FROM p1_grant_lot_transactions
        WHERE workspace_id = $1 AND id = $2`,
      [transaction.workspaceId, transaction.id]
    );
    const existing = replay.rows[0]
      ? grantTransactionFromRow(replay.rows[0])
      : undefined;
    if (
      existing &&
      existing.resource === transaction.resource &&
      existing.transactionType === transaction.transactionType &&
      existing.amount === transaction.amount &&
      existing.lotId === transaction.lotId &&
      existing.relatedTransactionId === transaction.relatedTransactionId &&
      existing.operationId === transaction.operationId &&
      existing.createdAt === timestamp(transaction.createdAt)
    ) {
      return existing;
    }
  }
  throw new P1DomainError(
    'IDEMPOTENCY_CONFLICT',
    `Grant transaction ${transaction.id} already exists.`
  );
}

async function lockOperation(
  client: PoolClient,
  workspaceId: string,
  operationId: string
) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
    [workspaceId, operationId]
  );
}

async function lockGrantResource(
  client: Queryable,
  workspaceId: string,
  resource: GrantLotResource
) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
    [workspaceId, `grant-resource:${resource}`]
  );
}

function grantResourceLockKey(
  workspaceId: string,
  resource: GrantLotResource
) {
  return `${workspaceId}\u0000${resource}`;
}

async function selectReconciliationLots(
  client: PoolClient,
  input: GrantLotEntitlementReconciliationInput
) {
  if (input.lotIds.length === 0) return [];
  const result = await client.query<GrantLotRow>(
    `SELECT * FROM p1_grant_lots
      WHERE workspace_id = $1
        AND resource = $2
        AND id = ANY($3::text[])
      ORDER BY created_at DESC, id DESC
      FOR UPDATE`,
    [input.workspaceId, input.resource, input.lotIds]
  );
  return result.rows.map(grantLotFromRow);
}

async function readProjection(
  client: PoolClient,
  workspaceId: string
): Promise<GrantLotProjection[]> {
  const lots = await client.query<GrantLotRow>(
    'SELECT * FROM p1_grant_lots WHERE workspace_id = $1',
    [workspaceId]
  );
  const transactions = await client.query<GrantTransactionRow>(
    'SELECT * FROM p1_grant_lot_transactions WHERE workspace_id = $1',
    [workspaceId]
  );
  const resources = new Set(lots.rows.map((lot) => lot.resource));
  return [...resources].sort().map((resource) => {
    const rows = transactions.rows.filter((row) => row.resource === resource);
    const amountFor = (...types: GrantLotTransactionType[]) =>
      rows
        .filter((row) => types.includes(row.transaction_type))
        .reduce((total, row) => total + row.amount, 0);
    return {
      resource,
      grantedAmount: amountFor(
        'REGISTER_GIFT',
        'SUBSCRIPTION_RENEWAL',
        'PURCHASE_PACKAGE',
        'REDEMPTION_CODE'
      ),
      usedAmount: amountFor('USAGE'),
      refundedAmount: amountFor('REFUND'),
      expiredAmount: amountFor('EXPIRE'),
      remainingAmount: lots.rows
        .filter((lot) => lot.resource === resource)
        .reduce((total, lot) => total + lot.remaining_amount, 0),
    };
  });
}

function grantLotFromRow(row: GrantLotRow): GrantLot {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    resource: row.resource,
    originalAmount: row.original_amount,
    entitlementAmount: row.entitlement_amount,
    remainingAmount: row.remaining_amount,
    expirationDate: timestamp(row.expiration_date),
    transactionType: row.transaction_type,
    ...(row.source_ref ? { sourceRef: row.source_ref } : {}),
    revision: Number(row.revision),
    createdAt: timestamp(row.created_at)!,
  };
}

function grantTransactionFromRow(row: GrantTransactionRow): GrantLotTransaction {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    resource: row.resource,
    transactionType: row.transaction_type,
    amount: row.amount,
    lotId: row.lot_id,
    ...(row.related_transaction_id
      ? { relatedTransactionId: row.related_transaction_id }
      : {}),
    operationId: row.operation_id,
    actorId: row.actor_id,
    correlationId: row.correlation_id,
    createdAt: timestamp(row.created_at)!,
  };
}

function timestamp(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function expirationIsSameOrShorter(
  current: string | null,
  original: string | null
) {
  if (current === original) return true;
  if (current === null || original === null) return original === null;
  return Date.parse(current) <= Date.parse(original);
}

function assertPositiveInteger(value: number, field: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      `${field} must be a positive integer.`
    );
  }
}

function assertTimestamp(value: string, field: string) {
  if (!value.trim() || !Number.isFinite(Date.parse(value))) {
    throw new P1DomainError('INVALID_STATE', `${field} must be an ISO timestamp.`);
  }
}
