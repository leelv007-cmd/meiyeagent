/**
 * Postgres store for MemoryInjectionReceipt (V31-18 / V3.1 §12.7).
 * Table: p1_memory_injection_receipts — bind exact task/run/release + revision refs.
 */

import { isDeepStrictEqual } from 'node:util';

import {
  memoryInjectionReceiptSchema,
  type MemoryInjectionReceipt,
} from '@meiye/contracts';
import type { Pool, PoolClient } from 'pg';

import type { PostgresSchemaMigrator } from '../../postgres-schema-migration.js';
import type { MemoryInjectionReceiptStore } from './agent-memory-platform.js';
import { ReuseMemoryError } from './reuse-memory-service.js';

type PayloadRow = { payload: unknown };

function clonePayload(row: PayloadRow | undefined): unknown | null {
  return row ? structuredClone(row.payload) : null;
}

function hasSameInjectionBusinessIdentity(
  left: MemoryInjectionReceipt,
  right: MemoryInjectionReceipt,
): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.taskId === right.taskId &&
    left.runId === right.runId &&
    left.harnessReleaseId === right.harnessReleaseId &&
    isDeepStrictEqual(left.entries, right.entries)
  );
}

export class PostgresMemoryInjectionReceiptStore
  implements MemoryInjectionReceiptStore, PostgresSchemaMigrator
{
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient): Promise<void> {
    const executor = client ?? this.pool;
    await executor.query(`
      SELECT pg_advisory_xact_lock(
        hashtext('p1-memory-injection-receipt-migration-v1')
      );
      CREATE TABLE IF NOT EXISTS p1_memory_injection_receipts (
        task_id text PRIMARY KEY,
        run_id text NOT NULL,
        harness_release_id text NOT NULL,
        payload jsonb NOT NULL,
        injected_at timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS p1_memory_injection_receipts_run_idx
        ON p1_memory_injection_receipts (run_id);
      CREATE INDEX IF NOT EXISTS p1_memory_injection_receipts_release_idx
        ON p1_memory_injection_receipts (harness_release_id);
      -- NOT an outbox despite the name (V31-18 P1-7). It has no reader in any
      -- process: the only SELECT is the same-transaction verification in
      -- save() below, nothing ever leases or dispatches a row, and the CHECK
      -- admits 'ready' alone so no consumer could mark a row done without a
      -- schema change. It therefore grows one row per injected task forever and
      -- delivers nothing, while costing an extra INSERT plus an extra
      -- round-trip inside the hot receipt transaction. The atomicity it does
      -- provide is real and tested; the delivery guarantee its name implies is
      -- vacuous. Resolve it deliberately — either route injection receipts
      -- through the existing drainer that already works
      -- (harness_runtime.langfuse_outbox + outbox-worker.ts, which has leases,
      -- attempts and dead-lettering), or drop this table. Both are decisions
      -- for the owner of this seam; do not add a consumer here speculatively.
      CREATE TABLE IF NOT EXISTS p1_memory_injection_receipt_outbox (
        task_id text PRIMARY KEY REFERENCES p1_memory_injection_receipts(task_id)
          ON DELETE CASCADE,
        payload jsonb NOT NULL,
        status text NOT NULL CHECK (status IN ('ready')),
        created_at timestamptz NOT NULL
      );
    `);
  }

  async save(input: MemoryInjectionReceipt): Promise<MemoryInjectionReceipt> {
    const receipt = memoryInjectionReceiptSchema.parse(input);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<PayloadRow>(
        `INSERT INTO p1_memory_injection_receipts (
           task_id,
           run_id,
           harness_release_id,
           payload,
           injected_at
         ) VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)
         ON CONFLICT (task_id) DO NOTHING
         RETURNING payload`,
        [
          receipt.taskId,
          receipt.runId,
          receipt.harnessReleaseId,
          JSON.stringify(receipt),
          receipt.injectedAt,
        ],
      );
      const storedPayload = inserted.rows[0]?.payload ?? (
        await client.query<PayloadRow>(
          `SELECT payload FROM p1_memory_injection_receipts WHERE task_id = $1`,
          [receipt.taskId],
        )
      ).rows[0]?.payload;
      const stored = memoryInjectionReceiptSchema.safeParse(storedPayload);
      if (
        !stored.success ||
        !hasSameInjectionBusinessIdentity(stored.data, receipt)
      ) {
        throw new ReuseMemoryError(
          'CONFLICT',
          `Injection receipt for task ${receipt.taskId} already exists with another payload.`,
        );
      }
      await client.query(
        `INSERT INTO p1_memory_injection_receipt_outbox (
           task_id,
           payload,
           status,
           created_at
         ) VALUES ($1, $2::jsonb, 'ready', $3::timestamptz)
         ON CONFLICT (task_id) DO NOTHING`,
        [
          receipt.taskId,
          JSON.stringify(stored.data),
          stored.data.injectedAt,
        ],
      );
      const outbox = await client.query<PayloadRow>(
        `SELECT payload FROM p1_memory_injection_receipt_outbox WHERE task_id = $1`,
        [receipt.taskId],
      );
      if (
        !outbox.rows[0] ||
        !isDeepStrictEqual(outbox.rows[0].payload, stored.data)
      ) {
        throw new ReuseMemoryError(
          'CONFLICT',
          `Injection receipt outbox for task ${receipt.taskId} is missing or divergent.`,
        );
      }
      await client.query('COMMIT');
      return stored.data;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getByTask(taskId: string): Promise<MemoryInjectionReceipt | null> {
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload FROM p1_memory_injection_receipts WHERE task_id = $1`,
      [taskId],
    );
    const payload = clonePayload(result.rows[0]);
    return payload ? memoryInjectionReceiptSchema.parse(payload) : null;
  }

  async getByRun(runId: string): Promise<MemoryInjectionReceipt | null> {
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload FROM p1_memory_injection_receipts
        WHERE run_id = $1
        ORDER BY injected_at DESC, task_id DESC
        LIMIT 1`,
      [runId],
    );
    const payload = clonePayload(result.rows[0]);
    return payload ? memoryInjectionReceiptSchema.parse(payload) : null;
  }
}
