import type {
  ProductQuoteSnapshot,
  ProductUsageRecord,
  ProviderCostSnapshot,
} from '@meiye/contracts';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { PostgresSchemaMigrator } from '../../postgres-schema-migration.js';

export interface ProductBillingTransaction {
  getQuote(workspaceId: string, quoteId: string): Promise<ProductQuoteSnapshot | null>;
  getQuoteByTask(
    workspaceId: string,
    taskId: string,
  ): Promise<ProductQuoteSnapshot | null>;
  getUsage(workspaceId: string, taskId: string): Promise<ProductUsageRecord | null>;
  listProviderCosts(
    workspaceId: string,
    taskId: string,
  ): Promise<ProviderCostSnapshot[]>;
  saveQuote(workspaceId: string, quote: ProductQuoteSnapshot): Promise<void>;
  saveUsage(workspaceId: string, usage: ProductUsageRecord): Promise<void>;
  saveProviderCost(
    workspaceId: string,
    cost: ProviderCostSnapshot,
  ): Promise<void>;
}

export interface ProductBillingRepository extends ProductBillingTransaction {
  withTransaction<T>(
    workspaceId: string,
    lockKeys: readonly string[],
    action: (transaction: ProductBillingTransaction) => Promise<T>,
  ): Promise<T>;
}

type JsonRow<T> = QueryResultRow & { payload: T };

export class PostgresProductBillingRepository
  implements ProductBillingRepository, PostgresSchemaMigrator
{
  constructor(
    private readonly pool: Pool,
    private readonly transactionClient?: PoolClient,
  ) {}

  private get database() {
    return this.transactionClient ?? this.pool;
  }

  async migrate(client?: PoolClient) {
    const database = client ?? this.database;
    await database.query(`
      CREATE TABLE IF NOT EXISTS p1_product_billing_quotes (
        workspace_id text NOT NULL,
        quote_id text NOT NULL,
        task_id text,
        lifecycle_status text NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, quote_id),
        UNIQUE (workspace_id, task_id),
        CHECK (payload->>'workspaceId' = workspace_id),
        CHECK (payload->>'quoteId' = quote_id)
      );

      CREATE TABLE IF NOT EXISTS p1_product_billing_usage (
        workspace_id text NOT NULL,
        usage_id text NOT NULL,
        task_id text NOT NULL,
        quote_id text NOT NULL,
        status text NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, usage_id),
        UNIQUE (workspace_id, task_id),
        FOREIGN KEY (workspace_id, quote_id)
          REFERENCES p1_product_billing_quotes (workspace_id, quote_id),
        CHECK (payload->>'workspaceId' = workspace_id),
        CHECK (payload->>'taskId' = task_id),
        CHECK (payload->>'quoteId' = quote_id)
      );

      CREATE TABLE IF NOT EXISTS p1_product_billing_provider_costs (
        workspace_id text NOT NULL,
        attempt_id text NOT NULL,
        task_id text NOT NULL,
        deployment_id text NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, attempt_id),
        FOREIGN KEY (workspace_id, task_id)
          REFERENCES p1_product_billing_usage (workspace_id, task_id),
        CHECK (payload->>'attemptId' = attempt_id),
        CHECK (payload->>'taskId' = task_id),
        CHECK (payload->>'deploymentId' = deployment_id)
      );

      CREATE INDEX IF NOT EXISTS p1_product_billing_quotes_workspace_status_idx
        ON p1_product_billing_quotes (workspace_id, lifecycle_status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS p1_product_billing_usage_workspace_status_idx
        ON p1_product_billing_usage (workspace_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS p1_product_billing_provider_costs_task_idx
        ON p1_product_billing_provider_costs (workspace_id, task_id, updated_at);
    `);
  }

  async withTransaction<T>(
    workspaceId: string,
    lockKeys: readonly string[],
    action: (transaction: ProductBillingTransaction) => Promise<T>,
  ): Promise<T> {
    if (this.transactionClient) return action(this);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const lockKey of [...new Set(lockKeys)].sort()) {
        await client.query(
          'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
          [workspaceId, lockKey],
        );
      }
      const result = await action(
        new PostgresProductBillingRepository(this.pool, client),
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

  async getQuote(workspaceId: string, quoteId: string) {
    const result = await this.database.query<JsonRow<ProductQuoteSnapshot>>(
      `SELECT payload
         FROM p1_product_billing_quotes
        WHERE workspace_id = $1 AND quote_id = $2`,
      [workspaceId, quoteId],
    );
    return result.rows[0]?.payload
      ? structuredClone(result.rows[0].payload)
      : null;
  }

  async getQuoteByTask(workspaceId: string, taskId: string) {
    const result = await this.database.query<JsonRow<ProductQuoteSnapshot>>(
      `SELECT payload
         FROM p1_product_billing_quotes
        WHERE workspace_id = $1 AND task_id = $2`,
      [workspaceId, taskId],
    );
    return result.rows[0]?.payload
      ? structuredClone(result.rows[0].payload)
      : null;
  }

  async getUsage(workspaceId: string, taskId: string) {
    const result = await this.database.query<JsonRow<ProductUsageRecord>>(
      `SELECT payload
         FROM p1_product_billing_usage
        WHERE workspace_id = $1 AND task_id = $2`,
      [workspaceId, taskId],
    );
    return result.rows[0]?.payload
      ? structuredClone(result.rows[0].payload)
      : null;
  }

  async listProviderCosts(workspaceId: string, taskId: string) {
    const result = await this.database.query<JsonRow<ProviderCostSnapshot>>(
      `SELECT payload
         FROM p1_product_billing_provider_costs
        WHERE workspace_id = $1 AND task_id = $2
        ORDER BY updated_at, attempt_id`,
      [workspaceId, taskId],
    );
    return result.rows.map((row) => structuredClone(row.payload));
  }

  async saveQuote(workspaceId: string, quote: ProductQuoteSnapshot) {
    await this.database.query(
      `INSERT INTO p1_product_billing_quotes
        (workspace_id, quote_id, task_id, lifecycle_status, payload, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, now())
       ON CONFLICT (workspace_id, quote_id) DO UPDATE SET
         task_id = EXCLUDED.task_id,
         lifecycle_status = EXCLUDED.lifecycle_status,
         payload = EXCLUDED.payload,
         updated_at = now()`,
      [
        workspaceId,
        quote.quoteId,
        quote.taskId ?? null,
        quote.lifecycleStatus,
        JSON.stringify(quote),
      ],
    );
  }

  async saveUsage(workspaceId: string, usage: ProductUsageRecord) {
    await this.database.query(
      `INSERT INTO p1_product_billing_usage
        (workspace_id, usage_id, task_id, quote_id, status, payload, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())
       ON CONFLICT (workspace_id, usage_id) DO UPDATE SET
         task_id = EXCLUDED.task_id,
         quote_id = EXCLUDED.quote_id,
         status = EXCLUDED.status,
         payload = EXCLUDED.payload,
         updated_at = now()`,
      [
        workspaceId,
        usage.id,
        usage.taskId,
        usage.quoteId,
        usage.status,
        JSON.stringify(usage),
      ],
    );
  }

  async saveProviderCost(
    workspaceId: string,
    cost: ProviderCostSnapshot,
  ) {
    await this.database.query(
      `INSERT INTO p1_product_billing_provider_costs
        (workspace_id, attempt_id, task_id, deployment_id, payload, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, now())
       ON CONFLICT (workspace_id, attempt_id) DO UPDATE SET
         task_id = EXCLUDED.task_id,
         deployment_id = EXCLUDED.deployment_id,
         payload = EXCLUDED.payload,
         updated_at = now()`,
      [
        workspaceId,
        cost.attemptId,
        cost.taskId,
        cost.deploymentId,
        JSON.stringify(cost),
      ],
    );
  }
}
