import type { Pool, PoolClient } from 'pg';
import type {
  CommandResult,
  ProductContext,
  ProductState,
} from '@meiye/contracts';
import type {
  IdempotentProductOutcome,
  ProductRepository,
} from './repository.js';

export class PostgresProductRepository implements ProductRepository {
  constructor(
    private readonly pool: Pool,
    private readonly transactionClient?: PoolClient
  ) {}

  private get database() {
    return this.transactionClient ?? this.pool;
  }

  async migrate(client?: PoolClient) {
    await (client ?? this.database).query(`
      CREATE TABLE IF NOT EXISTS product_states (
        workspace_id text PRIMARY KEY,
        state jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS product_command_results (
        workspace_id text NOT NULL,
        idempotency_key text NOT NULL,
        payload_hash text NOT NULL,
        result jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, idempotency_key)
      );
      ALTER TABLE product_command_results
        ADD COLUMN IF NOT EXISTS payload_hash text NOT NULL DEFAULT 'legacy-unavailable';
      CREATE TABLE IF NOT EXISTS p1_write_ownership (
        workspace_id text PRIMARY KEY,
        owner text NOT NULL CHECK (owner IN ('legacy', 'frozen', 'p1')),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  }

  async withWorkspaceLock<T>(
    workspaceId: string,
    action: (repository: ProductRepository) => Promise<T>
  ): Promise<T> {
    if (this.transactionClient) return action(this);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [workspaceId]);
      const result = await action(
        new PostgresProductRepository(this.pool, client)
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async hasMembership(userId: string, workspaceId: string) {
    const result = await this.database.query(
      `SELECT 1
         FROM workspace_memberships
        WHERE workspace_id = $1 AND user_id = $2
        LIMIT 1`,
      [workspaceId, userId]
    );
    return result.rowCount === 1;
  }

  async getMembershipRole(userId: string, workspaceId: string) {
    const result = await this.database.query<{ role: string }>(
      `SELECT role
         FROM workspace_memberships
        WHERE workspace_id = $1 AND user_id = $2
        LIMIT 1`,
      [workspaceId, userId]
    );
    return result.rows[0]?.role ?? null;
  }

  async getFutureWriteOwner(workspaceId: string) {
    const result = await this.database.query<{
      owner: 'legacy' | 'frozen' | 'p1';
    }>('SELECT owner FROM p1_write_ownership WHERE workspace_id = $1', [
      workspaceId,
    ]);
    return result.rows[0]?.owner ?? 'legacy';
  }

  async getCommandOwner(workspaceId: string, idempotencyKey: string) {
    const result = await this.database.query<{
      legacy: boolean;
      p1: boolean;
    }>(
      `SELECT
         EXISTS (
           SELECT 1 FROM product_command_results
            WHERE workspace_id = $1 AND idempotency_key = $2
         ) AS legacy,
         EXISTS (
           SELECT 1 FROM p1_product_command_results
            WHERE workspace_id = $1 AND idempotency_key = $2
         ) AS p1`,
      [workspaceId, idempotencyKey]
    );
    if (result.rows[0]?.legacy) return 'legacy' as const;
    if (result.rows[0]?.p1) return 'p1' as const;
    return null;
  }

  async load(workspaceId: string) {
    const result = await this.database.query<{ state: ProductState }>(
      'SELECT state FROM product_states WHERE workspace_id = $1',
      [workspaceId]
    );
    return result.rows[0]?.state ?? null;
  }

  async save(state: ProductState, _context?: ProductContext) {
    await this.database.query(
      `INSERT INTO product_states (workspace_id, state, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (workspace_id)
       DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
      [state.workspaceId, JSON.stringify(state)]
    );
  }

  async loadIdempotent(workspaceId: string, key: string, payloadHash: string) {
    const result = await this.database.query<{
      result: IdempotentProductOutcome;
      payload_hash: string;
    }>(
      `SELECT result, payload_hash
         FROM product_command_results
        WHERE workspace_id = $1 AND idempotency_key = $2`,
      [workspaceId, key]
    );
    const row = result.rows[0];
    if (!row) return null;
    let outcome: IdempotentProductOutcome;
    const stored = row.result;
    if ('kind' in stored) {
      outcome = stored;
    } else {
      outcome = {
        kind: 'success' as const,
        result: stored as unknown as CommandResult,
      };
    }
    const storedOutput =
      outcome.kind === 'success' ? outcome.result.output : undefined;
    if (
      outcome.kind === 'success' &&
      !('state' in outcome.result)
    ) {
      const state = await this.load(workspaceId);
      if (!state) return null;
      outcome = {
        kind: 'success',
        result: {
          output: storedOutput ?? {},
          state,
        },
      };
    }
    return {
      matches:
        row.payload_hash === 'legacy-unavailable' ||
        row.payload_hash === payloadHash,
      outcome,
    };
  }

  async saveIdempotent(
    workspaceId: string,
    key: string,
    payloadHash: string,
    result: IdempotentProductOutcome
  ) {
    const persisted =
      result.kind === 'success'
        ? { kind: 'success' as const, result: { output: result.result.output } }
        : result;
    await this.database.query(
      `INSERT INTO product_command_results (workspace_id, idempotency_key, payload_hash, result)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (workspace_id, idempotency_key) DO UPDATE
       SET result = EXCLUDED.result
       WHERE product_command_results.result->>'kind' = 'pending'
         AND product_command_results.payload_hash = EXCLUDED.payload_hash`,
      [workspaceId, key, payloadHash, JSON.stringify(persisted)]
    );
  }
}
