import { createHash } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { CreditGrantLot } from '../credit-billing/credit-ledger.js';
import type { PostgresCreditLedger } from '../credit-billing/postgres-credit-ledger.js';
import { P1DomainError } from './domain.js';
import type {
  GrantLotResource,
  GrantLotTransaction,
} from './grant-lot.js';
import { grantLotWithClient } from './postgres-grant-lot.js';
import { creditRedemptionLotId } from './redemption.js';
import type {
  RedemptionCode,
  RedemptionCodeStatus,
  RedemptionStore,
  RedemptionStoreCommand,
  RedeemResult,
} from './redemption.js';

type Queryable = Pick<Pool | PoolClient, 'query'>;

interface RedemptionRow extends QueryResultRow {
  id: string;
  code: string;
  status: RedemptionCodeStatus;
  grants: Partial<Record<GrantLotResource, number>> | string;
  credits: number | null;
  expires_at: Date | string | null;
  revision: string | number;
  created_at: Date | string;
  created_by: string;
  voided_at: Date | string | null;
  redeemed_at: Date | string | null;
  redeemed_workspace_id: string | null;
  redeemed_by_user_id: string | null;
  grant_transaction_id: string | null;
  credit_grant_transaction_id: string | null;
  batch_id: string | null;
}

interface TransactionRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  resource: GrantLotResource;
  transaction_type: GrantLotTransaction['transactionType'];
  amount: number;
  lot_id: string;
  related_transaction_id: string | null;
  operation_id: string;
  actor_id: string;
  correlation_id: string;
  created_at: Date | string;
}

export class PostgresRedemptionStore implements RedemptionStore {
  readonly grantStrategy = 'store_transaction' as const;

  constructor(
    private readonly pool: Pool,
    private readonly creditLedger?: PostgresCreditLedger
  ) {}

  async migrate(client?: PoolClient) {
    const db: Queryable = client ?? this.pool;
    await db.query(`
      CREATE TABLE IF NOT EXISTS p1_redemption_codes (
        id text PRIMARY KEY,
        code text NOT NULL UNIQUE,
        status text NOT NULL CHECK (
          status IN ('active', 'redeemed', 'voided', 'expired')
        ),
        grants jsonb NOT NULL CHECK (
          jsonb_typeof(grants) = 'object'
        ),
        credits integer CHECK (credits > 0),
        expires_at timestamptz,
        revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
        created_at timestamptz NOT NULL,
        created_by text NOT NULL,
        voided_at timestamptz,
        redeemed_at timestamptz,
        redeemed_workspace_id text,
        redeemed_by_user_id text,
        grant_transaction_id text,
        credit_grant_transaction_id text,
        batch_id text,
        FOREIGN KEY (redeemed_workspace_id, grant_transaction_id)
          REFERENCES p1_grant_lot_transactions(workspace_id, id)
      )
    `);
    await db.query(`
      ALTER TABLE p1_redemption_codes
        ADD COLUMN IF NOT EXISTS credits integer;
      ALTER TABLE p1_redemption_codes
        ADD COLUMN IF NOT EXISTS credit_grant_transaction_id text;
      ALTER TABLE p1_redemption_codes
        DROP CONSTRAINT IF EXISTS p1_redemption_codes_grants_check;
      ALTER TABLE p1_redemption_codes
        DROP CONSTRAINT IF EXISTS p1_redemption_codes_credits_check;
      ALTER TABLE p1_redemption_codes
        ADD CONSTRAINT p1_redemption_codes_grants_check CHECK (
          jsonb_typeof(grants) = 'object'
          AND (
            (credits IS NULL AND grants <> '{}'::jsonb)
            OR (credits > 0 AND grants = '{}'::jsonb)
          )
        );
      ALTER TABLE p1_redemption_codes
        ADD CONSTRAINT p1_redemption_codes_credits_check CHECK (
          credits IS NULL OR credits > 0
        )
    `);
    await db.query(`
      DO $$
      DECLARE legacy_check text;
      BEGIN
        FOR legacy_check IN
          SELECT conname
            FROM pg_constraint
           WHERE conrelid = 'p1_redemption_codes'::regclass
             AND contype = 'c'
             AND pg_get_constraintdef(oid) LIKE '%grant_transaction_id IS NOT NULL%'
        LOOP
          EXECUTE format(
            'ALTER TABLE p1_redemption_codes DROP CONSTRAINT %I',
            legacy_check
          );
        END LOOP;
      END $$;
      ALTER TABLE p1_redemption_codes
        DROP CONSTRAINT IF EXISTS p1_redemption_codes_redeemed_grant_check;
      ALTER TABLE p1_redemption_codes
        ADD CONSTRAINT p1_redemption_codes_redeemed_grant_check CHECK (
          (
            status = 'redeemed'
            AND redeemed_at IS NOT NULL
            AND redeemed_workspace_id IS NOT NULL
            AND redeemed_by_user_id IS NOT NULL
            AND num_nonnulls(
              grant_transaction_id,
              credit_grant_transaction_id
            ) = 1
          )
          OR status <> 'redeemed'
        )
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS p1_redemption_codes_batch_idx
        ON p1_redemption_codes (batch_id, created_at DESC, id DESC)
        WHERE batch_id IS NOT NULL
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS p1_redemption_codes_status_expiry_idx
        ON p1_redemption_codes (status, expires_at, created_at DESC)
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS p1_redemption_commands (
        command_scope text NOT NULL,
        idempotency_key text NOT NULL,
        payload_hash text NOT NULL,
        result jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (command_scope, idempotency_key)
      )
    `);
  }

  async create(
    codes: RedemptionCode[],
    command?: RedemptionStoreCommand
  ): Promise<RedemptionCode[]> {
    return this.transaction(async (client) => {
      return this.executeCommand(client, command, async () => {
        const created: RedemptionCode[] = [];
        try {
          for (const code of codes) {
            const result = await client.query<RedemptionRow>(
              `INSERT INTO p1_redemption_codes
                 (id, code, status, grants, credits, expires_at, revision,
                  created_at, created_by, batch_id)
               VALUES ($1, $2, 'active', $3::jsonb, $4, $5::timestamptz, 1,
                       $6::timestamptz, $7, $8)
               RETURNING *`,
              [
                code.id,
                normalizeCode(code.code),
                JSON.stringify(code.grants),
                code.credits ?? null,
                code.expiresAt,
                code.createdAt,
                code.createdBy,
                code.batchId ?? null,
              ]
            );
            created.push(redemptionFromRow(result.rows[0]!));
          }
        } catch (error) {
          if (hasPostgresCode(error, '23505')) {
            throw new P1DomainError(
              'IDEMPOTENCY_CONFLICT',
              'Redemption code already exists.'
            );
          }
          throw error;
        }
        return created;
      });
    });
  }

  async expireDue(now: string) {
    const result = await this.pool.query(
      `UPDATE p1_redemption_codes
          SET status = 'expired', revision = revision + 1
        WHERE status = 'active'
          AND expires_at IS NOT NULL
          AND expires_at <= $1::timestamptz`,
      [now]
    );
    return { expiredCount: result.rowCount ?? 0 };
  }

  async getByCode(code: string): Promise<RedemptionCode | null> {
    const result = await this.pool.query<RedemptionRow>(
      'SELECT * FROM p1_redemption_codes WHERE code = $1',
      [normalizeCode(code)]
    );
    return result.rows[0] ? redemptionFromRow(result.rows[0]) : null;
  }

  async list(filter?: {
    batchId?: string;
    status?: RedemptionCodeStatus;
  }): Promise<RedemptionCode[]> {
    const result = await this.pool.query<RedemptionRow>(
      `SELECT * FROM p1_redemption_codes
        WHERE ($1::text IS NULL OR batch_id = $1)
          AND ($2::text IS NULL OR status = $2)
        ORDER BY created_at DESC, id DESC`,
      [filter?.batchId ?? null, filter?.status ?? null]
    );
    return result.rows.map(redemptionFromRow);
  }

  async voidCode(input: {
    code: string;
    expectedRevision: number;
    voidedAt: string;
    command?: RedemptionStoreCommand;
  }): Promise<RedemptionCode> {
    return this.transaction((client) =>
      this.executeCommand(client, input.command, async () => {
        const normalized = normalizeCode(input.code);
        const result = await client.query<RedemptionRow>(
          `UPDATE p1_redemption_codes
              SET status = 'voided',
                  voided_at = $3::timestamptz,
                  revision = revision + 1
            WHERE code = $1
              AND revision = $2
              AND status IN ('active', 'expired')
            RETURNING *`,
          [normalized, input.expectedRevision, input.voidedAt]
        );
        if (result.rows[0]) return redemptionFromRow(result.rows[0]);
        const selected = await client.query<RedemptionRow>(
          'SELECT * FROM p1_redemption_codes WHERE code = $1',
          [normalized]
        );
        const current = selected.rows[0]
          ? redemptionFromRow(selected.rows[0])
          : null;
        if (!current) {
          throw new P1DomainError('NOT_FOUND', 'Redemption code was not found.');
        }
        if (current.revision !== input.expectedRevision) {
          throw new P1DomainError(
            'IDEMPOTENCY_CONFLICT',
            'Redemption code revision conflict.'
          );
        }
        throw new P1DomainError(
          'INVALID_STATE',
          `A ${current.status} code cannot be voided.`
        );
      })
    );
  }

  private async executeCommand<T>(
    client: PoolClient,
    command: RedemptionStoreCommand | undefined,
    execute: () => Promise<T>
  ): Promise<T> {
    if (!command) return execute();
    const inserted = await client.query(
      `INSERT INTO p1_redemption_commands
         (command_scope, idempotency_key, payload_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (command_scope, idempotency_key) DO NOTHING
       RETURNING command_scope`,
      [command.scope, command.idempotencyKey, command.payloadHash]
    );
    if (inserted.rowCount === 1) {
      const result = await execute();
      await client.query(
        `UPDATE p1_redemption_commands
            SET result = $4::jsonb, updated_at = now()
          WHERE command_scope = $1 AND idempotency_key = $2
            AND payload_hash = $3`,
        [
          command.scope,
          command.idempotencyKey,
          command.payloadHash,
          JSON.stringify(result),
        ]
      );
      return result;
    }
    const replay = await client.query<{
      payload_hash: string;
      result: T | null;
    }>(
      `SELECT payload_hash, result
         FROM p1_redemption_commands
        WHERE command_scope = $1 AND idempotency_key = $2
        FOR UPDATE`,
      [command.scope, command.idempotencyKey]
    );
    const existing = replay.rows[0];
    if (!existing) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Redemption command result was not found.'
      );
    }
    if (existing.payload_hash !== command.payloadHash) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Redemption command key was reused with a different payload.'
      );
    }
    if (existing.result === null) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Redemption command is still in progress.'
      );
    }
    return structuredClone(existing.result);
  }

  async redeemAtomic(input: {
    code: string;
    workspaceId: string;
    userId: string;
    correlationId: string;
    now: string;
    grant?: (code: RedemptionCode) => Promise<{
      grantTransactionId: string;
      grantTransactions: GrantLotTransaction[];
    }>;
  }): Promise<RedeemResult> {
    const client = await this.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      const selected = await client.query<RedemptionRow>(
        `SELECT * FROM p1_redemption_codes
          WHERE code = $1
          FOR UPDATE`,
        [normalizeCode(input.code)]
      );
      const row = selected.rows[0];
      if (!row) {
        throw new P1DomainError('NOT_FOUND', 'Redemption code was not found.');
      }
      const current = redemptionFromRow(row);
      if (current.status === 'redeemed') {
        if (current.redeemedWorkspaceId !== input.workspaceId) {
          throw new P1DomainError(
            'INVALID_STATE',
            'Redemption code was already redeemed.'
          );
        }
        if (this.creditLedger) {
          const creditGrant = await this.grantCreditsWithClient(
            client,
            current,
            input
          );
          if (
            current.creditGrantTransactionId !==
            `credit-grant:${creditGrant.id}`
          ) {
            throw new P1DomainError(
              'INVALID_STATE',
              'Redeemed code is missing its real credit grant transaction.'
            );
          }
          await client.query('COMMIT');
          committed = true;
          return { code: current, grantTransactions: [], creditGrant };
        }
        const transactions = await transactionsForCode(
          client,
          input.workspaceId,
          current.id
        );
        if (
          !current.grantTransactionId ||
          !transactions.some(
            (transaction) => transaction.id === current.grantTransactionId
          )
        ) {
          throw new P1DomainError(
            'INVALID_STATE',
            'Redeemed code is missing its real grant transaction.'
          );
        }
        await client.query('COMMIT');
        committed = true;
        return { code: current, grantTransactions: transactions };
      }
      if (current.status === 'voided') {
        throw new P1DomainError('INVALID_STATE', 'Redemption code is voided.');
      }
      if (
        current.status === 'expired' ||
        (current.expiresAt !== null && current.expiresAt <= input.now)
      ) {
        if (current.status === 'active') {
          await client.query(
            `UPDATE p1_redemption_codes
                SET status = 'expired', revision = revision + 1
              WHERE id = $1 AND revision = $2`,
            [current.id, current.revision]
          );
        }
        await client.query('COMMIT');
        committed = true;
        throw new P1DomainError('INVALID_STATE', 'Redemption code is expired.');
      }
      if (current.status !== 'active') {
        throw new P1DomainError(
          'INVALID_STATE',
          `Redemption code is ${current.status}.`
        );
      }

      const transactions: GrantLotTransaction[] = [];
      let creditGrant: CreditGrantLot | undefined;
      let grantTransactionId: string | null = null;
      let creditGrantTransactionId: string | null = null;
      if (this.creditLedger) {
        creditGrant = await this.grantCreditsWithClient(client, current, input);
        creditGrantTransactionId = `credit-grant:${creditGrant.id}`;
      } else {
        for (const [resource, amount] of Object.entries(current.grants).sort(
          ([left], [right]) => left.localeCompare(right)
        ) as Array<[GrantLotResource, number]>) {
          const lotId = `lot-redeem-${digest(
            `${current.id}:${input.workspaceId}:${resource}`
          ).slice(0, 24)}`;
          const granted = await grantLotWithClient(client, {
            id: lotId,
            workspaceId: input.workspaceId,
            resource,
            amount,
            expirationDate: null,
            transactionType: 'REDEMPTION_CODE',
            sourceRef: current.id,
            actorId: input.userId,
            correlationId: input.correlationId,
            createdAt: input.now,
          });
          transactions.push(granted.transaction);
          // Compatibility projection: p1_usage_events remains the reservation
          // state machine consumed by existing generation paths. Keep its
          // allowance adjustment in this same redemption transaction.
          await client.query(
            `INSERT INTO p1_usage_events
               (workspace_id, id, resource, action, amount, reservation_id,
                reason, actor_id, correlation_id, created_at)
             VALUES ($1, $2, $3, 'adjust', $4, NULL, $5, $6, $7, $8::timestamptz)`,
            [
              input.workspaceId,
              `redemption-${current.id}:${resource}:allowance`,
              resource,
              amount,
              `redemption_code:${current.id}:transaction:${granted.transaction.id}`,
              input.userId,
              input.correlationId,
              input.now,
            ]
          );
        }
        const primary = transactions[0];
        if (!primary) {
          throw new P1DomainError(
            'INVALID_STATE',
            'Redemption grant produced no transactions.'
          );
        }
        grantTransactionId = primary.id;
      }
      const updated = await client.query<RedemptionRow>(
        `UPDATE p1_redemption_codes
            SET status = 'redeemed',
                redeemed_at = $3::timestamptz,
                redeemed_workspace_id = $4,
                redeemed_by_user_id = $5,
                grant_transaction_id = $6,
                credit_grant_transaction_id = $7,
                revision = revision + 1
          WHERE id = $1 AND revision = $2 AND status = 'active'
          RETURNING *`,
        [
          current.id,
          current.revision,
          input.now,
          input.workspaceId,
          input.userId,
          grantTransactionId,
          creditGrantTransactionId,
        ]
      );
      if (!updated.rows[0]) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'Redemption code revision changed during redeem.'
        );
      }
      await client.query('COMMIT');
      committed = true;
      return {
        code: redemptionFromRow(updated.rows[0]),
        grantTransactions: transactions,
        ...(creditGrant ? { creditGrant } : {}),
      };
    } catch (error) {
      if (!committed) await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async grantCreditsWithClient(
    client: PoolClient,
    code: RedemptionCode,
    input: {
      workspaceId: string;
      userId: string;
      correlationId: string;
      now: string;
    }
  ) {
    if (!this.creditLedger || !Number.isSafeInteger(code.credits) || !code.credits) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Credit redemption requires a positive credit amount.'
      );
    }
    if (Object.keys(code.grants).length > 0) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Credit redemption cannot write legacy resource grants.'
      );
    }
    const id = creditRedemptionLotId(code.id, input.workspaceId);
    return this.creditLedger.grantWithClient(client, {
      id,
      workspaceId: input.workspaceId,
      credits: code.credits,
      expirationDate: null,
      transactionType: 'REDEMPTION_CODE',
      sourceRef: code.id,
      grantIdempotencyKey: `grant:redemption:${code.id}:${input.workspaceId}`,
      actorId: input.userId,
      correlationId: input.correlationId,
      createdAt: code.redeemedAt ?? input.now,
    });
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>) {
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
}

async function transactionsForCode(
  client: PoolClient,
  workspaceId: string,
  codeId: string
) {
  const result = await client.query<TransactionRow>(
    `SELECT t.*
       FROM p1_grant_lot_transactions t
       JOIN p1_grant_lots l
         ON l.workspace_id = t.workspace_id AND l.id = t.lot_id
      WHERE t.workspace_id = $1
        AND l.source_ref = $2
        AND t.transaction_type = 'REDEMPTION_CODE'
      ORDER BY t.created_at ASC, t.id ASC`,
    [workspaceId, codeId]
  );
  return result.rows.map(transactionFromRow);
}

function redemptionFromRow(row: RedemptionRow): RedemptionCode {
  const grants =
    typeof row.grants === 'string'
      ? (JSON.parse(row.grants) as Partial<Record<GrantLotResource, number>>)
      : row.grants;
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    grants: structuredClone(grants),
    ...(row.credits !== null ? { credits: Number(row.credits) } : {}),
    expiresAt: timestamp(row.expires_at),
    revision: Number(row.revision),
    createdAt: timestamp(row.created_at)!,
    createdBy: row.created_by,
    ...(row.voided_at ? { voidedAt: timestamp(row.voided_at)! } : {}),
    ...(row.redeemed_at ? { redeemedAt: timestamp(row.redeemed_at)! } : {}),
    ...(row.redeemed_workspace_id
      ? { redeemedWorkspaceId: row.redeemed_workspace_id }
      : {}),
    ...(row.redeemed_by_user_id
      ? { redeemedByUserId: row.redeemed_by_user_id }
      : {}),
    ...(row.grant_transaction_id
      ? { grantTransactionId: row.grant_transaction_id }
      : {}),
    ...(row.credit_grant_transaction_id
      ? { creditGrantTransactionId: row.credit_grant_transaction_id }
      : {}),
    ...(row.batch_id ? { batchId: row.batch_id } : {}),
  };
}

function transactionFromRow(row: TransactionRow): GrantLotTransaction {
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

function normalizeCode(code: string) {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{4,64}$/.test(normalized)) {
    throw new P1DomainError('INVALID_STATE', 'Redemption code is invalid.');
  }
  return normalized;
}

function timestamp(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function hasPostgresCode(error: unknown, code: string) {
  return Boolean(
    error && typeof error === 'object' && 'code' in error && error.code === code
  );
}
