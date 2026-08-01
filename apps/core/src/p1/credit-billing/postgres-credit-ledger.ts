import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { PostgresSchemaMigrator } from '../../postgres-schema-migration.js';
import { P1DomainError } from '../foundation/domain.js';
import {
  CREDIT_GRANT_TRANSACTION_TYPES,
  allocateCreditConsumption,
  compareCreditLotsForFefo,
  normalizeCreditConsumeIdempotencyKey,
  normalizeCreditGrantIdempotencyKey,
  type CreditBalanceProjection,
  type CreditGrantLot,
  type CreditGrantTransactionType,
  type CreditLotTransaction,
  type CreditTransactionType,
  type GrantCreditsInput,
} from './credit-ledger.js';

type Queryable = Pick<Pool | PoolClient, 'query'>;

interface CreditLotRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  original_credits: number;
  remaining_credits: number;
  expiration_date: Date | string | null;
  transaction_type: CreditGrantTransactionType;
  source_ref: string | null;
  grant_idempotency_key: string;
  revision: string | number;
  created_at: Date | string;
}

interface CreditTransactionRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  transaction_type: CreditTransactionType;
  credits: number;
  lot_id: string;
  related_transaction_id: string | null;
  operation_id: string;
  actor_id: string;
  correlation_id: string;
  created_at: Date | string;
  credited: boolean;
}

/**
 * Production merchant-credit ledger. `p1_grant_lots` remains a legacy
 * per-resource migration source; all new merchant balance writes are here.
 */
export class PostgresCreditLedger implements PostgresSchemaMigrator {
  constructor(private readonly pool: Pool) {}

  async migrate(client: PoolClient) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS p1_credit_grant_lots (
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        id text NOT NULL,
        original_credits integer NOT NULL CHECK (original_credits > 0),
        remaining_credits integer NOT NULL CHECK (
          remaining_credits >= 0 AND remaining_credits <= original_credits
        ),
        expiration_date timestamptz,
        transaction_type text NOT NULL CHECK (transaction_type IN (
          'REGISTER_GIFT', 'SUBSCRIPTION_RENEWAL', 'PURCHASE_PACKAGE', 'REDEMPTION_CODE'
        )),
        source_ref text,
        grant_idempotency_key text NOT NULL,
        revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id),
        UNIQUE (workspace_id, grant_idempotency_key),
        CHECK (expiration_date IS NULL OR expiration_date > created_at)
      );
      CREATE INDEX IF NOT EXISTS p1_credit_grant_lots_fefo_idx
        ON p1_credit_grant_lots (workspace_id, expiration_date ASC NULLS LAST, created_at, id)
        WHERE remaining_credits > 0;

      CREATE TABLE IF NOT EXISTS p1_credit_lot_transactions (
        workspace_id text NOT NULL,
        id text NOT NULL,
        transaction_type text NOT NULL CHECK (transaction_type IN (
          'REGISTER_GIFT', 'SUBSCRIPTION_RENEWAL', 'PURCHASE_PACKAGE', 'REDEMPTION_CODE',
          'USAGE', 'REFUND', 'EXPIRE'
        )),
        credits integer NOT NULL CHECK (credits > 0),
        lot_id text NOT NULL,
        related_transaction_id text,
        operation_id text NOT NULL,
        actor_id text NOT NULL,
        correlation_id text NOT NULL,
        created_at timestamptz NOT NULL,
        credited boolean NOT NULL,
        PRIMARY KEY (workspace_id, id),
        FOREIGN KEY (workspace_id, lot_id)
          REFERENCES p1_credit_grant_lots (workspace_id, id) ON DELETE CASCADE,
        FOREIGN KEY (workspace_id, related_transaction_id)
          REFERENCES p1_credit_lot_transactions (workspace_id, id) ON DELETE RESTRICT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS p1_credit_lot_transactions_usage_operation_idx
        ON p1_credit_lot_transactions (workspace_id, operation_id, lot_id)
        WHERE transaction_type = 'USAGE';
      CREATE UNIQUE INDEX IF NOT EXISTS p1_credit_lot_transactions_refund_usage_idx
        ON p1_credit_lot_transactions (workspace_id, related_transaction_id)
        WHERE transaction_type = 'REFUND';
      CREATE INDEX IF NOT EXISTS p1_credit_lot_transactions_workspace_created_idx
        ON p1_credit_lot_transactions (workspace_id, created_at, id);
    `);
  }

  async withWorkspaceCreditLock<T>(workspaceId: string, work: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await lockWorkspaceCreditsWithClient(client, workspaceId);
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

  async grant(input: GrantCreditsInput) {
    return this.withWorkspaceCreditLock(input.workspaceId, (client) =>
      this.grantWithClient(client, input),
    );
  }

  async grantWithClient(client: PoolClient, input: GrantCreditsInput) {
    assertGrant(input);
    await lockWorkspaceCreditsWithClient(client, input.workspaceId);
    const key = normalizeCreditGrantIdempotencyKey(
      input.id,
      input.grantIdempotencyKey,
    );
    const existing = await client.query<CreditLotRow>(
      `SELECT * FROM p1_credit_grant_lots
        WHERE workspace_id = $1 AND (id = $2 OR grant_idempotency_key = $3)
        FOR UPDATE`,
      [input.workspaceId, input.id, key],
    );
    if (existing.rows[0]) {
      const lot = creditLotFromRow(existing.rows[0]);
      if (
        lot.originalCredits !== input.credits ||
        lot.expirationDate !== input.expirationDate ||
        lot.transactionType !== input.transactionType ||
        lot.sourceRef !== input.sourceRef ||
        lot.grantIdempotencyKey !== key ||
        lot.createdAt !== iso(input.createdAt)
      ) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          `Credit grant ${input.id} already exists with different facts.`,
        );
      }
      return lot;
    }
    const inserted = await client.query<CreditLotRow>(
      `INSERT INTO p1_credit_grant_lots
        (workspace_id, id, original_credits, remaining_credits, expiration_date,
         transaction_type, source_ref, grant_idempotency_key, created_at)
       VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        input.workspaceId,
        input.id,
        input.credits,
        input.expirationDate,
        input.transactionType,
        input.sourceRef ?? null,
        key,
        input.createdAt,
      ],
    );
    const lot = creditLotFromRow(inserted.rows[0]!);
    await insertTransaction(client, {
      id: `credit-grant:${lot.id}`,
      workspaceId: lot.workspaceId,
      transactionType: lot.transactionType,
      credits: lot.originalCredits,
      lotId: lot.id,
      operationId: key,
      actorId: input.actorId ?? 'system',
      correlationId: input.correlationId ?? 'credit-grant',
      createdAt: lot.createdAt,
      credited: true,
    });
    return lot;
  }

  async consume(input: {
    workspaceId: string;
    credits: number;
    transactionId: string;
    actorId: string;
    correlationId: string;
    createdAt: string;
  }) {
    return this.withWorkspaceCreditLock(input.workspaceId, (client) =>
      this.consumeWithClient(client, input),
    );
  }

  async consumeWithClient(
    client: PoolClient,
    input: {
      workspaceId: string;
      credits: number;
      transactionId: string;
      actorId: string;
      correlationId: string;
      createdAt: string;
    },
  ) {
    assertPositiveCredits(input.credits, 'credits');
    assertTimestamp(input.createdAt, 'createdAt');
    await lockWorkspaceCreditsWithClient(client, input.workspaceId);
    const operationId = normalizeCreditConsumeIdempotencyKey(input.transactionId);
    const replay = await client.query<CreditTransactionRow>(
      `SELECT * FROM p1_credit_lot_transactions
        WHERE workspace_id = $1 AND transaction_type = 'USAGE' AND operation_id = $2
        ORDER BY id`,
      [input.workspaceId, operationId],
    );
    if (replay.rows.length > 0) {
      const transactions = replay.rows.map(creditTransactionFromRow);
      if (transactions.reduce((sum, transaction) => sum + transaction.credits, 0) !== input.credits) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'Credit usage operation was replayed with different facts.',
        );
      }
      return transactions;
    }
    await this.expireLotsWithClient(client, {
      workspaceId: input.workspaceId,
      now: input.createdAt,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });
    const lots = await this.listSpendableLotsForUpdate(client, input.workspaceId, input.createdAt);
    const allocations = allocateCreditConsumption(lots, input.credits);
    if (allocations.reduce((sum, allocation) => sum + allocation.credits, 0) !== input.credits) {
      throw new P1DomainError('INSUFFICIENT_ENTITLEMENT', 'Insufficient credits.');
    }
    const written: CreditLotTransaction[] = [];
    for (const [index, allocation] of allocations.entries()) {
      const lot = lots.find((candidate) => candidate.id === allocation.lotId);
      if (!lot) throw new Error('Credit lot allocation disappeared.');
      const changed = await client.query(
        `UPDATE p1_credit_grant_lots
            SET remaining_credits = remaining_credits - $3, revision = revision + 1
          WHERE workspace_id = $1 AND id = $2 AND revision = $4
            AND remaining_credits >= $3`,
        [input.workspaceId, lot.id, allocation.credits, lot.revision],
      );
      if (changed.rowCount !== 1) {
        throw new P1DomainError('IDEMPOTENCY_CONFLICT', 'Credit lot changed during consumption.');
      }
      const transaction = await insertTransaction(client, {
        id: `${operationId}:${index}`,
        workspaceId: input.workspaceId,
        transactionType: 'USAGE',
        credits: allocation.credits,
        lotId: lot.id,
        operationId,
        actorId: input.actorId,
        correlationId: input.correlationId,
        createdAt: input.createdAt,
        credited: false,
      });
      written.push(transaction);
    }
    return written;
  }

  async refundUsageOperation(input: {
    workspaceId: string;
    usageOperationId: string;
    refundOperationId: string;
    credits?: number;
    actorId: string;
    correlationId: string;
    createdAt: string;
  }) {
    return this.withWorkspaceCreditLock(input.workspaceId, (client) =>
      this.refundUsageOperationWithClient(client, input),
    );
  }

  async refundUsageOperationWithClient(
    client: PoolClient,
    input: {
      workspaceId: string;
      usageOperationId: string;
      refundOperationId: string;
      credits?: number;
      actorId: string;
      correlationId: string;
      createdAt: string;
    },
  ) {
    if (input.credits !== undefined) assertPositiveCredits(input.credits, 'credits');
    assertTimestamp(input.createdAt, 'createdAt');
    await lockWorkspaceCreditsWithClient(client, input.workspaceId);
    const usageOperationId = normalizeCreditConsumeIdempotencyKey(input.usageOperationId);
    const usages = await client.query<CreditTransactionRow>(
      `SELECT * FROM p1_credit_lot_transactions
        WHERE workspace_id = $1 AND transaction_type = 'USAGE' AND operation_id = $2
        ORDER BY id FOR UPDATE`,
      [input.workspaceId, usageOperationId],
    );
    let remaining = input.credits;
    const refunds: CreditLotTransaction[] = [];
    for (const [index, row] of usages.rows.entries()) {
      if (remaining === 0) break;
      const usage = creditTransactionFromRow(row);
      const existing = await client.query<CreditTransactionRow>(
        `SELECT * FROM p1_credit_lot_transactions
          WHERE workspace_id = $1 AND transaction_type = 'REFUND'
            AND related_transaction_id = $2`,
        [input.workspaceId, usage.id],
      );
      if (existing.rows[0]) {
        const refund = creditTransactionFromRow(existing.rows[0]);
        refunds.push(refund);
        if (remaining !== undefined) remaining -= refund.credits;
        continue;
      }
      const credits = remaining === undefined ? usage.credits : Math.min(usage.credits, remaining);
      const lotResult = await client.query<CreditLotRow>(
        `SELECT * FROM p1_credit_grant_lots
          WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
        [input.workspaceId, usage.lotId],
      );
      const lot = lotResult.rows[0] ? creditLotFromRow(lotResult.rows[0]) : null;
      if (!lot) throw new P1DomainError('NOT_FOUND', 'Credit source lot is missing.');
      const credited =
        lot.expirationDate === null || Date.parse(lot.expirationDate) > Date.parse(input.createdAt);
      if (credited) {
        await client.query(
          `UPDATE p1_credit_grant_lots
              SET remaining_credits = LEAST(original_credits, remaining_credits + $3),
                  revision = revision + 1
            WHERE workspace_id = $1 AND id = $2`,
          [input.workspaceId, lot.id, credits],
        );
      }
      const refund = await insertTransaction(client, {
        id: `${input.refundOperationId}:${index}`,
        workspaceId: input.workspaceId,
        transactionType: 'REFUND',
        credits,
        lotId: lot.id,
        relatedTransactionId: usage.id,
        operationId: input.refundOperationId,
        actorId: input.actorId,
        correlationId: input.correlationId,
        createdAt: input.createdAt,
        credited,
      });
      refunds.push(refund);
      if (remaining !== undefined) remaining -= credits;
    }
    if (remaining !== undefined && remaining !== 0) {
      throw new P1DomainError('INVALID_STATE', 'Credit refund exceeds the original usage operation.');
    }
    return refunds;
  }

  async listLots(workspaceId: string) {
    const result = await this.pool.query<CreditLotRow>(
      `SELECT * FROM p1_credit_grant_lots WHERE workspace_id = $1
        ORDER BY expiration_date ASC NULLS LAST, created_at, id`,
      [workspaceId],
    );
    return result.rows.map(creditLotFromRow);
  }

  async listTransactions(workspaceId: string) {
    const result = await this.pool.query<CreditTransactionRow>(
      `SELECT * FROM p1_credit_lot_transactions WHERE workspace_id = $1
        ORDER BY created_at, id`,
      [workspaceId],
    );
    return result.rows.map(creditTransactionFromRow);
  }

  async project(workspaceId: string): Promise<CreditBalanceProjection> {
    const [lots, transactions] = await Promise.all([
      this.listLots(workspaceId),
      this.listTransactions(workspaceId),
    ]);
    const amount = (...types: CreditTransactionType[]) =>
      transactions
        .filter((transaction) => types.includes(transaction.transactionType))
        .reduce((sum, transaction) => sum + transaction.credits, 0);
    return {
      grantedCredits: amount(...CREDIT_GRANT_TRANSACTION_TYPES),
      usedCredits: amount('USAGE'),
      refundedCredits: transactions
        .filter((transaction) => transaction.transactionType === 'REFUND' && transaction.credited)
        .reduce((sum, transaction) => sum + transaction.credits, 0),
      expiredCredits: amount('EXPIRE'),
      availableCredits: lots.reduce((sum, lot) => sum + lot.remainingCredits, 0),
    };
  }

  async expireSubscriptionLots(input: {
    workspaceId: string;
    subscriptionId: string;
    actorId: string;
    correlationId: string;
    createdAt: string;
  }) {
    return this.withWorkspaceCreditLock(input.workspaceId, async (client) => {
      const lots = await client.query<CreditLotRow>(
        `SELECT * FROM p1_credit_grant_lots
          WHERE workspace_id = $1
            AND transaction_type = 'SUBSCRIPTION_RENEWAL'
            AND source_ref = $2
            AND remaining_credits > 0
          ORDER BY expiration_date ASC NULLS LAST, created_at, id
          FOR UPDATE`,
        [input.workspaceId, input.subscriptionId],
      );
      for (const row of lots.rows) {
        const lot = creditLotFromRow(row);
        await client.query(
          `UPDATE p1_credit_grant_lots
              SET remaining_credits = 0, revision = revision + 1
            WHERE workspace_id = $1 AND id = $2`,
          [lot.workspaceId, lot.id],
        );
        await insertTransaction(client, {
          id: `credit-expire-subscription:${lot.id}:${lot.revision + 1}`,
          workspaceId: lot.workspaceId,
          transactionType: 'EXPIRE',
          credits: lot.remainingCredits,
          lotId: lot.id,
          operationId: `expire-subscription:${lot.id}:${lot.revision + 1}`,
          actorId: input.actorId,
          correlationId: input.correlationId,
          createdAt: input.createdAt,
          credited: false,
        });
      }
    });
  }

  private async listSpendableLotsForUpdate(
    client: PoolClient,
    workspaceId: string,
    asOf: string,
  ) {
    const result = await client.query<CreditLotRow>(
      `SELECT * FROM p1_credit_grant_lots
        WHERE workspace_id = $1 AND remaining_credits > 0
          AND (expiration_date IS NULL OR expiration_date > $2::timestamptz)
        ORDER BY expiration_date ASC NULLS LAST, created_at, id
        FOR UPDATE`,
      [workspaceId, asOf],
    );
    return result.rows.map(creditLotFromRow).sort(compareCreditLotsForFefo);
  }

  private async expireLotsWithClient(
    client: PoolClient,
    input: { workspaceId: string; now: string; actorId: string; correlationId: string },
  ) {
    const lots = await client.query<CreditLotRow>(
      `SELECT * FROM p1_credit_grant_lots
        WHERE workspace_id = $1 AND remaining_credits > 0
          AND expiration_date IS NOT NULL AND expiration_date <= $2::timestamptz
        ORDER BY expiration_date, created_at, id FOR UPDATE`,
      [input.workspaceId, input.now],
    );
    for (const row of lots.rows) {
      const lot = creditLotFromRow(row);
      await client.query(
        `UPDATE p1_credit_grant_lots
            SET remaining_credits = 0, revision = revision + 1
          WHERE workspace_id = $1 AND id = $2`,
        [lot.workspaceId, lot.id],
      );
      await insertTransaction(client, {
        id: `credit-expire:${lot.id}:${lot.revision + 1}`,
        workspaceId: lot.workspaceId,
        transactionType: 'EXPIRE',
        credits: lot.remainingCredits,
        lotId: lot.id,
        operationId: `expire:${lot.id}:${lot.revision + 1}`,
        actorId: input.actorId,
        correlationId: input.correlationId,
        createdAt: input.now,
        credited: false,
      });
    }
  }
}

/**
 * Acquires the one merchant-credit lock for a workspace in the caller's
 * transaction. ProductUsage reservation must take this before it writes its
 * reservation, so its balance check and FEFO consumption are indivisible.
 */
export async function lockWorkspaceCreditsWithClient(
  client: Queryable,
  workspaceId: string,
) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [
    workspaceId,
    'merchant-credits',
  ]);
}

async function insertTransaction(client: Queryable, transaction: CreditLotTransaction) {
  const result = await client.query<CreditTransactionRow>(
    `INSERT INTO p1_credit_lot_transactions
      (workspace_id, id, transaction_type, credits, lot_id, related_transaction_id,
       operation_id, actor_id, correlation_id, created_at, credited)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      transaction.workspaceId,
      transaction.id,
      transaction.transactionType,
      transaction.credits,
      transaction.lotId,
      transaction.relatedTransactionId ?? null,
      transaction.operationId,
      transaction.actorId,
      transaction.correlationId,
      transaction.createdAt,
      transaction.credited,
    ],
  );
  return creditTransactionFromRow(result.rows[0]!);
}

function creditLotFromRow(row: CreditLotRow): CreditGrantLot {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    originalCredits: Number(row.original_credits),
    remainingCredits: Number(row.remaining_credits),
    expirationDate: iso(row.expiration_date),
    transactionType: row.transaction_type,
    ...(row.source_ref ? { sourceRef: row.source_ref } : {}),
    grantIdempotencyKey: row.grant_idempotency_key,
    revision: Number(row.revision),
    createdAt: iso(row.created_at)!,
  };
}

function creditTransactionFromRow(row: CreditTransactionRow): CreditLotTransaction {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    transactionType: row.transaction_type,
    credits: Number(row.credits),
    lotId: row.lot_id,
    ...(row.related_transaction_id ? { relatedTransactionId: row.related_transaction_id } : {}),
    operationId: row.operation_id,
    actorId: row.actor_id,
    correlationId: row.correlation_id,
    createdAt: iso(row.created_at)!,
    credited: row.credited,
  };
}

function assertGrant(input: GrantCreditsInput) {
  if (!input.id.trim() || !input.workspaceId.trim()) {
    throw new P1DomainError('INVALID_STATE', 'Credit grant identity and workspace are required.');
  }
  assertPositiveCredits(input.credits, 'credits');
  assertTimestamp(input.createdAt, 'createdAt');
  if (input.expirationDate !== null) {
    assertTimestamp(input.expirationDate, 'expirationDate');
    if (Date.parse(input.expirationDate) <= Date.parse(input.createdAt)) {
      throw new P1DomainError('INVALID_STATE', 'Credit grant expiration must be after its creation time.');
    }
  }
}

function assertPositiveCredits(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new P1DomainError('INVALID_STATE', `${field} must be a positive integer credit amount.`);
  }
}

function assertTimestamp(value: string, field: string) {
  if (!value.trim() || !Number.isFinite(Date.parse(value))) {
    throw new P1DomainError('INVALID_STATE', `${field} must be an ISO timestamp.`);
  }
}

function iso(value: Date | string | null) {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
