import type {
  ProductQuoteSnapshot,
  ProductUsageRecord,
  ProviderCostSnapshot,
} from '@meiye/contracts';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { PostgresSchemaMigrator } from '../../postgres-schema-migration.js';

export type ProductUsageResource = NonNullable<ProductUsageRecord['resource']>;
export interface ProductUsageBucketProjection {
  reserved: number;
  committed: number;
  released: number;
}
export type ProductUsageProjection = Record<
  ProductUsageResource,
  ProductUsageBucketProjection
>;

export interface MerchantExecutionRecord {
  contractHash: string;
  effectKey: string;
  idempotencyKey: string;
  inputSnapshot: {
    input: Record<string, unknown> | null;
    instructions?: string;
    prompt: string;
    schema?: Record<string, unknown>;
    schemaName?: string;
    schemaRevision?: string;
    streaming?: boolean;
  };
  result?: unknown;
  status: 'bound' | 'claimed' | 'completed';
  taskId: string;
  updatedAt?: string;
  workspaceId: string;
}

export interface ProductBillingTransaction {
  getQuote(workspaceId: string, quoteId: string): Promise<ProductQuoteSnapshot | null>;
  getQuoteByTask(
    workspaceId: string,
    taskId: string,
  ): Promise<ProductQuoteSnapshot | null>;
  getUsage(workspaceId: string, taskId: string): Promise<ProductUsageRecord | null>;
  getMerchantExecution(
    workspaceId: string,
    taskId: string,
    effectKey: string,
  ): Promise<MerchantExecutionRecord | null>;
  getUsageProjection(workspaceId: string): Promise<ProductUsageProjection>;
  getMonthlyOutput(
    workspaceId: string,
    month: string,
  ): Promise<{ copy: number; image: number; video: number }>;
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
  saveMerchantExecution(record: MerchantExecutionRecord): Promise<void>;
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
      SELECT pg_advisory_xact_lock(
        hashtext('p1-product-billing-merchant-executions'),
        hashtext('bound-status-v1')
      );

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

      CREATE TABLE IF NOT EXISTS p1_product_billing_merchant_executions (
        workspace_id text NOT NULL,
        task_id text NOT NULL,
        effect_key text NOT NULL,
        idempotency_key text NOT NULL,
        contract_hash text NOT NULL,
        input_snapshot jsonb NOT NULL,
        status text NOT NULL,
        result jsonb,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, task_id, effect_key),
        FOREIGN KEY (workspace_id, task_id)
          REFERENCES p1_product_billing_usage (workspace_id, task_id),
        CONSTRAINT p1_product_billing_merchant_executions_status_check
          CHECK (status IN ('bound', 'claimed', 'completed')),
        CONSTRAINT p1_product_billing_merchant_executions_result_check
          CHECK (status IN ('bound', 'claimed') OR result IS NOT NULL)
      );

      DO $$
      DECLARE
        primary_key_definition text;
      BEGIN
        IF NOT EXISTS (
          SELECT 1
            FROM pg_attribute
           WHERE attrelid = 'p1_product_billing_merchant_executions'::regclass
             AND attname = 'effect_key'
             AND NOT attisdropped
        ) THEN
          ALTER TABLE p1_product_billing_merchant_executions
            ADD COLUMN effect_key text;
        END IF;
        UPDATE p1_product_billing_merchant_executions
           SET effect_key = 'merchant-execution:' || task_id
         WHERE effect_key IS NULL;
        IF EXISTS (
          SELECT 1
            FROM pg_attribute
           WHERE attrelid = 'p1_product_billing_merchant_executions'::regclass
             AND attname = 'effect_key'
             AND NOT attnotnull
        ) THEN
          ALTER TABLE p1_product_billing_merchant_executions
            ALTER COLUMN effect_key SET NOT NULL;
        END IF;

        IF NOT EXISTS (
          SELECT 1
            FROM pg_attribute
           WHERE attrelid = 'p1_product_billing_merchant_executions'::regclass
             AND attname = 'input_snapshot'
             AND NOT attisdropped
        ) THEN
          ALTER TABLE p1_product_billing_merchant_executions
            ADD COLUMN input_snapshot jsonb;
        END IF;
        UPDATE p1_product_billing_merchant_executions
           SET input_snapshot = jsonb_build_object('input', null, 'prompt', '')
         WHERE input_snapshot IS NULL;
        IF EXISTS (
          SELECT 1
            FROM pg_attribute
           WHERE attrelid = 'p1_product_billing_merchant_executions'::regclass
             AND attname = 'input_snapshot'
             AND NOT attnotnull
        ) THEN
          ALTER TABLE p1_product_billing_merchant_executions
            ALTER COLUMN input_snapshot SET NOT NULL;
        END IF;

        SELECT pg_get_constraintdef(oid)
          INTO primary_key_definition
          FROM pg_constraint
         WHERE conrelid = 'p1_product_billing_merchant_executions'::regclass
           AND conname = 'p1_product_billing_merchant_executions_pkey';
        IF primary_key_definition IS NULL OR
           primary_key_definition NOT LIKE '%effect_key%' THEN
          ALTER TABLE p1_product_billing_merchant_executions
            DROP CONSTRAINT IF EXISTS p1_product_billing_merchant_executions_pkey;
          ALTER TABLE p1_product_billing_merchant_executions
            ADD PRIMARY KEY (workspace_id, task_id, effect_key);
        END IF;

        IF EXISTS (
          SELECT 1
            FROM pg_constraint
           WHERE conrelid = 'p1_product_billing_merchant_executions'::regclass
             AND conname = 'p1_product_billing_merchant_executions_status_check'
             AND pg_get_constraintdef(oid) NOT LIKE '%bound%'
        ) THEN
          ALTER TABLE p1_product_billing_merchant_executions
            DROP CONSTRAINT p1_product_billing_merchant_executions_status_check;
        END IF;
        IF NOT EXISTS (
          SELECT 1
            FROM pg_constraint
           WHERE conrelid = 'p1_product_billing_merchant_executions'::regclass
             AND conname = 'p1_product_billing_merchant_executions_status_check'
        ) THEN
          ALTER TABLE p1_product_billing_merchant_executions
            ADD CONSTRAINT p1_product_billing_merchant_executions_status_check
              CHECK (status IN ('bound', 'claimed', 'completed'));
        END IF;

        IF EXISTS (
          SELECT 1
            FROM pg_constraint
           WHERE conrelid = 'p1_product_billing_merchant_executions'::regclass
             AND conname = 'p1_product_billing_merchant_executions_check'
        ) THEN
          ALTER TABLE p1_product_billing_merchant_executions
            DROP CONSTRAINT p1_product_billing_merchant_executions_check;
        END IF;
        IF EXISTS (
          SELECT 1
            FROM pg_constraint
           WHERE conrelid = 'p1_product_billing_merchant_executions'::regclass
             AND conname = 'p1_product_billing_merchant_executions_result_check'
             AND pg_get_constraintdef(oid) NOT LIKE '%bound%'
        ) THEN
          ALTER TABLE p1_product_billing_merchant_executions
            DROP CONSTRAINT p1_product_billing_merchant_executions_result_check;
        END IF;
        IF NOT EXISTS (
          SELECT 1
            FROM pg_constraint
           WHERE conrelid = 'p1_product_billing_merchant_executions'::regclass
             AND conname = 'p1_product_billing_merchant_executions_result_check'
        ) THEN
          ALTER TABLE p1_product_billing_merchant_executions
            ADD CONSTRAINT p1_product_billing_merchant_executions_result_check
              CHECK (status IN ('bound', 'claimed') OR result IS NOT NULL);
        END IF;
      END $$;

      CREATE INDEX IF NOT EXISTS p1_product_billing_quotes_workspace_status_idx
        ON p1_product_billing_quotes (workspace_id, lifecycle_status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS p1_product_billing_usage_workspace_status_idx
        ON p1_product_billing_usage (workspace_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS p1_product_billing_usage_reserved_recovery_idx
        ON p1_product_billing_usage (updated_at, task_id)
        WHERE status = 'reserved';
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

  async getMerchantExecution(
    workspaceId: string,
    taskId: string,
    effectKey: string,
  ) {
    const result = await this.database.query<{
      contract_hash: string;
      effect_key: string;
      idempotency_key: string;
      input_snapshot: MerchantExecutionRecord['inputSnapshot'];
      result: unknown;
      status: MerchantExecutionRecord['status'];
      updated_at: string;
    }>(
      `SELECT effect_key, idempotency_key, contract_hash, input_snapshot, status, result, updated_at
         FROM p1_product_billing_merchant_executions
        WHERE workspace_id = $1 AND task_id = $2 AND effect_key = $3`,
      [workspaceId, taskId, effectKey],
    );
    const row = result.rows[0];
    return row
      ? {
          contractHash: row.contract_hash,
          effectKey: row.effect_key,
          idempotencyKey: row.idempotency_key,
          inputSnapshot: structuredClone(row.input_snapshot),
          ...(row.status === 'completed'
            ? { result: structuredClone(row.result) }
            : {}),
          status: row.status,
          taskId,
          updatedAt: row.updated_at,
          workspaceId,
        }
      : null;
  }

  async getUsageProjection(workspaceId: string): Promise<ProductUsageProjection> {
    const result = await this.database.query<{
      resource: ProductUsageResource;
      reserved: string;
      committed: string;
      released: string;
    }>(
      `WITH usage_rows AS (
         SELECT status, payload
           FROM p1_product_billing_usage
          WHERE workspace_id = $1
       ),
       usage_units AS (
         SELECT 'reserved' AS disposition, unit
           FROM usage_rows
           CROSS JOIN LATERAL jsonb_array_elements(
             COALESCE(
               payload->'reservedUnits',
               jsonb_build_array(jsonb_build_object(
                 'resource', payload->>'resource',
                 'quantity', (payload->>'reservedQuantity')::numeric
               ))
             )
           ) AS unit
          WHERE status = 'reserved'
         UNION ALL
         SELECT 'committed' AS disposition, unit
           FROM usage_rows
           CROSS JOIN LATERAL jsonb_array_elements(
             COALESCE(
               payload->'settledUnits',
               jsonb_build_array(jsonb_build_object(
                 'resource', payload->>'resource',
                 'quantity', (payload->>'settledQuantity')::numeric
               ))
             )
           ) AS unit
          WHERE status IN ('committed', 'partially_refunded')
         UNION ALL
         SELECT 'released' AS disposition, unit
           FROM usage_rows
           CROSS JOIN LATERAL jsonb_array_elements(
             COALESCE(
               payload->'refundedUnits',
               jsonb_build_array(jsonb_build_object(
                 'resource', payload->>'resource',
                 'quantity', (payload->>'refundedQuantity')::numeric
               ))
             )
           ) AS unit
          WHERE status IN ('refunded', 'partially_refunded')
       )
       SELECT unit->>'resource' AS resource,
              COALESCE(sum(CASE WHEN disposition = 'reserved'
                THEN (unit->>'quantity')::numeric ELSE 0 END), 0)::text AS reserved,
              COALESCE(sum(CASE WHEN disposition = 'committed'
                THEN (unit->>'quantity')::numeric ELSE 0 END), 0)::text AS committed,
              COALESCE(sum(CASE WHEN disposition = 'released'
                THEN (unit->>'quantity')::numeric ELSE 0 END), 0)::text AS released
         FROM usage_units
        WHERE unit->>'resource' IN ('copy', 'image', 'video', 'audio')
        GROUP BY unit->>'resource'`,
      [workspaceId],
    );
    const projection = emptyUsageProjection();
    for (const row of result.rows) {
      projection[row.resource] = {
        reserved: Number(row.reserved),
        committed: Number(row.committed),
        released: Number(row.released),
      };
    }
    return projection;
  }

  async getMonthlyOutput(workspaceId: string, month: string) {
    const match = /^(\d{4})-(\d{2})$/u.exec(month);
    const year = Number(match?.[1]);
    const monthNumber = Number(match?.[2]);
    if (!match || monthNumber < 1 || monthNumber > 12) {
      throw new Error('month must use YYYY-MM.');
    }
    const nextYear = monthNumber === 12 ? year + 1 : year;
    const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
    const startsAt = `${month}-01T00:00:00+08:00`;
    const endsAt =
      `${String(nextYear).padStart(4, '0')}-` +
      `${String(nextMonth).padStart(2, '0')}-01T00:00:00+08:00`;
    const result = await this.database.query<{
      copy: string;
      image: string;
      video: string;
    }>(
      `SELECT
         COALESCE(sum(CASE WHEN
           u.payload->>'resource' = 'copy' OR
           COALESCE(u.payload->'settledUnits', '[]'::jsonb)
             @> '[{"resource":"copy"}]'::jsonb
           THEN COALESCE(
             (SELECT (unit->>'quantity')::int
                FROM jsonb_array_elements(
                  COALESCE(u.payload->'settledUnits', '[]'::jsonb)
                ) AS unit
               WHERE unit->>'resource' = 'copy'),
             (q.payload->>'outputCount')::int,
             1
           ) ELSE 0 END), 0)::text AS copy,
         COALESCE(sum(CASE WHEN
           u.payload->>'resource' = 'image' OR
           COALESCE(u.payload->'settledUnits', '[]'::jsonb)
             @> '[{"resource":"image"}]'::jsonb
           THEN COALESCE(
             (SELECT (unit->>'quantity')::int
                FROM jsonb_array_elements(
                  COALESCE(u.payload->'settledUnits', '[]'::jsonb)
                ) AS unit
               WHERE unit->>'resource' = 'image'),
             (q.payload->>'outputCount')::int,
             1
           ) ELSE 0 END), 0)::text AS image,
         COALESCE(sum(CASE WHEN
           u.payload->>'resource' = 'video' OR
           COALESCE(u.payload->'settledUnits', '[]'::jsonb)
             @> '[{"resource":"video"}]'::jsonb
           THEN COALESCE((q.payload->>'outputCount')::int, 1) ELSE 0 END), 0)::text AS video
       FROM p1_product_billing_usage u
       JOIN p1_product_billing_quotes q
         ON q.workspace_id = u.workspace_id AND q.quote_id = u.quote_id
       WHERE u.workspace_id = $1
         AND u.status IN ('committed', 'partially_refunded')
         AND (u.payload->>'updatedAt')::timestamptz >= $2::timestamptz
         AND (u.payload->>'updatedAt')::timestamptz < $3::timestamptz`,
      [workspaceId, startsAt, endsAt],
    );
    const row = result.rows[0];
    return {
      copy: Number(row?.copy ?? 0),
      image: Number(row?.image ?? 0),
      video: Number(row?.video ?? 0),
    };
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

  async saveMerchantExecution(record: MerchantExecutionRecord) {
    await this.database.query(
      `INSERT INTO p1_product_billing_merchant_executions
        (workspace_id, task_id, effect_key, idempotency_key, contract_hash, input_snapshot, status, result, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, now())
       ON CONFLICT (workspace_id, task_id, effect_key) DO UPDATE SET
         idempotency_key = EXCLUDED.idempotency_key,
         contract_hash = EXCLUDED.contract_hash,
         input_snapshot = EXCLUDED.input_snapshot,
         status = EXCLUDED.status,
         result = EXCLUDED.result,
         updated_at = now()`,
      [
        record.workspaceId,
        record.taskId,
        record.effectKey,
        record.idempotencyKey,
        record.contractHash,
        JSON.stringify(record.inputSnapshot),
        record.status,
        JSON.stringify(record.status === 'completed' ? record.result : null),
      ],
    );
  }
}

function emptyUsageProjection(): ProductUsageProjection {
  const empty = () => ({ reserved: 0, committed: 0, released: 0 });
  return {
    copy: empty(),
    image: empty(),
    video: empty(),
    audio: empty(),
  };
}
