import { createHash } from 'node:crypto';
import type {
  ProductQuoteSnapshot,
  ProductUsageRecord,
  ProviderCostSnapshot,
} from '@meiye/contracts';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { PostgresSchemaMigrator } from '../../postgres-schema-migration.js';
import type { ProviderCostEvent, UsageEvent } from '../foundation/domain.js';
import { P1DomainError } from '../foundation/domain.js';
import { PostgresFoundationRepository } from '../foundation/postgres-repository.js';
import { projectUsage } from '../foundation/application-service.js';

export interface ProductBillingTransaction {
  getQuote(workspaceId: string, quoteId: string): Promise<ProductQuoteSnapshot | null>;
  getQuoteByTask(workspaceId: string, taskId: string): Promise<ProductQuoteSnapshot | null>;
  getUsage(workspaceId: string, taskId: string): Promise<ProductUsageRecord | null>;
  listProviderCosts(workspaceId: string, taskId: string): Promise<ProviderCostSnapshot[]>;
  saveQuote(workspaceId: string, quote: ProductQuoteSnapshot): Promise<void>;
  saveUsage(workspaceId: string, usage: ProductUsageRecord): Promise<void>;
  saveProviderCost(workspaceId: string, cost: ProviderCostSnapshot): Promise<void>;
}

export interface ProductBillingRepository extends ProductBillingTransaction {
  withTransaction<T>(
    workspaceId: string,
    lockKeys: readonly string[],
    action: (transaction: ProductBillingTransaction) => Promise<T>,
  ): Promise<T>;
}

type JsonRow<T> = QueryResultRow & { payload: T };

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

function digest(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex')
    .slice(0, 20);
}

function usageFromEvents(events: UsageEvent[], taskId: string): ProductUsageRecord | null {
  const reserve = events.find(
    (event) => event.action === 'reserve' && event.billing?.taskId === taskId,
  );
  if (!reserve?.billing || !reserve.reservationId) return null;
  const terminal = events.find(
    (event) =>
      event.reservationId === reserve.reservationId &&
      (event.action === 'commit' || event.action === 'refund' || event.action === 'expire'),
  );
  const settledQuantity =
    terminal?.billing?.settledQuantity ??
    (terminal?.action === 'commit' ? terminal.amount : 0);
  const refundedQuantity =
    terminal?.billing?.refundedQuantity ??
    (terminal ? Math.max(0, reserve.amount - settledQuantity) : 0);
  const status: ProductUsageRecord['status'] = !terminal
    ? 'reserved'
    : settledQuantity === 0
      ? 'refunded'
      : refundedQuantity > 0
        ? 'partially_refunded'
        : 'committed';
  return {
    id: reserve.reservationId,
    taskId,
    workspaceId: reserve.workspaceId,
    quoteId: reserve.billing.quoteId,
    status,
    reservedQuantity: reserve.amount,
    settledQuantity,
    refundedQuantity,
    billingMode: reserve.billing.billingMode,
    settlementStatus:
      terminal?.billing?.settlementStatus ?? reserve.billing.settlementStatus,
    resource: reserve.resource,
    createdAt: reserve.createdAt,
    updatedAt: terminal?.createdAt ?? reserve.createdAt,
  };
}

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

  private get foundation() {
    return new PostgresFoundationRepository(this.pool, this.transactionClient);
  }

  async migrate(client?: PoolClient) {
    const database = client ?? this.database;
    await database.query(`
      CREATE TABLE IF NOT EXISTS p1_product_billing_quotes (
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
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
      CREATE INDEX IF NOT EXISTS p1_product_billing_quotes_workspace_status_idx
        ON p1_product_billing_quotes (workspace_id, lifecycle_status, updated_at DESC);
    `);
  }

  async withTransaction<T>(
    workspaceId: string,
    _lockKeys: readonly string[],
    action: (transaction: ProductBillingTransaction) => Promise<T>,
  ): Promise<T> {
    if (this.transactionClient) return action(this);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // One workspace lock prevents quote/task/attempt lock-order gaps and mixed-key races.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [workspaceId]);
      const result = await action(new PostgresProductBillingRepository(this.pool, client));
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
      `SELECT payload FROM p1_product_billing_quotes
        WHERE workspace_id = $1 AND quote_id = $2`,
      [workspaceId, quoteId],
    );
    return result.rows[0]?.payload ? structuredClone(result.rows[0].payload) : null;
  }

  async getQuoteByTask(workspaceId: string, taskId: string) {
    const result = await this.database.query<JsonRow<ProductQuoteSnapshot>>(
      `SELECT payload FROM p1_product_billing_quotes
        WHERE workspace_id = $1 AND task_id = $2`,
      [workspaceId, taskId],
    );
    return result.rows[0]?.payload ? structuredClone(result.rows[0].payload) : null;
  }

  async getUsage(workspaceId: string, taskId: string) {
    const events: UsageEvent[] = [];
    for (const resource of ['copy', 'image', 'video', 'audio'] as const) {
      events.push(...(await this.foundation.listUsageEvents(workspaceId, resource)));
    }
    return usageFromEvents(events, taskId);
  }

  async listProviderCosts(workspaceId: string, taskId: string) {
    const result = await this.database.query<
      QueryResultRow & { snapshot: ProviderCostSnapshot; createdAt: string; id: string }
    >(
      `SELECT id, snapshot, created_at::text AS "createdAt"
         FROM p1_provider_cost_events
        WHERE workspace_id = $1 AND snapshot->>'taskId' = $2
        ORDER BY created_at, id`,
      [workspaceId, taskId],
    );
    const latest = new Map<string, ProviderCostSnapshot>();
    for (const row of result.rows) {
      if (row.snapshot) latest.set(row.snapshot.attemptId, row.snapshot);
    }
    return [...latest.values()].map((snapshot) => structuredClone(snapshot));
  }

  async saveQuote(workspaceId: string, quote: ProductQuoteSnapshot) {
    const existing = await this.getQuote(workspaceId, quote.quoteId);
    if (existing?.taskId && quote.taskId && existing.taskId !== quote.taskId) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        `Quote ${quote.quoteId} is already bound to task ${existing.taskId}.`,
      );
    }
    await this.database.query(
      `INSERT INTO p1_product_billing_quotes
       (workspace_id, quote_id, task_id, lifecycle_status, payload, updated_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,now())
       ON CONFLICT (workspace_id, quote_id) DO UPDATE SET
         task_id = EXCLUDED.task_id,
         lifecycle_status = EXCLUDED.lifecycle_status,
         payload = EXCLUDED.payload,
         updated_at = now()`,
      [workspaceId, quote.quoteId, quote.taskId ?? null, quote.lifecycleStatus, JSON.stringify(quote)],
    );
  }

  async saveUsage(workspaceId: string, usage: ProductUsageRecord) {
    const current = await this.getUsage(workspaceId, usage.taskId);
    if (!current) {
      const resource = usage.resource ?? 'video';
      const projection = projectUsage(
        await this.foundation.listUsageEvents(workspaceId, resource),
      );
      if (projection.available < usage.reservedQuantity) {
        throw new P1DomainError(
          'INSUFFICIENT_ENTITLEMENT',
          'Insufficient product usage allowance.',
        );
      }
      await this.foundation.appendUsageEvent({
        id: `product-usage:${usage.id}:reserve`,
        workspaceId,
        resource,
        action: 'reserve',
        amount: usage.reservedQuantity,
        reservationId: usage.id,
        reason: 'product_quote_reserve',
        actorId: 'product-billing',
        correlationId: usage.taskId,
        createdAt: usage.createdAt,
        billing: {
          quoteId: usage.quoteId,
          taskId: usage.taskId,
          billingMode: usage.billingMode,
          settlementStatus: 'estimated',
        },
      });
    } else if (
      current.quoteId !== usage.quoteId ||
      current.reservedQuantity !== usage.reservedQuantity
    ) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        `Product usage for task ${usage.taskId} already has different reserve facts.`,
      );
    }
    if (usage.status === 'reserved' || current?.status !== 'reserved') return;
    const action = usage.status === 'refunded' ? 'refund' : 'commit';
    await this.foundation.appendUsageEvent({
      id: `product-usage:${usage.id}:terminal`,
      workspaceId,
      resource: usage.resource ?? current?.resource ?? 'video',
      action,
      amount: action === 'refund' ? usage.reservedQuantity : usage.settledQuantity,
      reservationId: usage.id,
      reason: 'product_quote_settle',
      actorId: 'product-billing',
      correlationId: usage.taskId,
      createdAt: usage.updatedAt,
      billing: {
        quoteId: usage.quoteId,
        taskId: usage.taskId,
        billingMode: usage.billingMode,
        settlementStatus: usage.settlementStatus,
        settledQuantity: usage.settledQuantity,
        refundedQuantity: usage.refundedQuantity,
      },
    });
  }

  async saveProviderCost(workspaceId: string, cost: ProviderCostSnapshot) {
    const existing = (await this.listProviderCosts(workspaceId, cost.taskId)).find(
      (item) => item.attemptId === cost.attemptId,
    );
    if (existing && digest(existing) === digest(cost)) return;
    if (
      existing &&
      (existing.deploymentId !== cost.deploymentId ||
        existing.supplierPriceRevision !== cost.supplierPriceRevision)
    ) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        `Provider cost ${cost.attemptId} already has different frozen facts.`,
      );
    }
    const event: ProviderCostEvent = {
      id: `product-cost:${cost.attemptId}:${digest(cost)}`,
      workspaceId,
      attemptId: cost.attemptId,
      stage: cost.observedCostMicros !== undefined ? 'observed' : 'estimated',
      amountMicros: cost.observedCostMicros ?? cost.estimatedCostMicros,
      currency: cost.currency,
      unit: cost.unit,
      evidence: cost.evidence ?? cost.evidenceKind ?? 'unknown',
      payer: cost.payer,
      billingStatus:
        cost.billingStatus === 'externally_billed' ? 'externally_billed' :
        cost.billingStatus === 'unknown' ? 'unknown' : 'known',
      actorId: 'product-billing',
      correlationId: cost.taskId,
      createdAt: new Date().toISOString(),
      snapshot: structuredClone(cost),
    };
    await this.foundation.appendProviderCost(event);
  }
}
