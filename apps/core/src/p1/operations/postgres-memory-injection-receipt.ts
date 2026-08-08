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
    `);
  }

  async save(input: MemoryInjectionReceipt): Promise<MemoryInjectionReceipt> {
    const receipt = memoryInjectionReceiptSchema.parse(input);
    const inserted = await this.pool.query<PayloadRow>(
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
    if (inserted.rows[0]) {
      return memoryInjectionReceiptSchema.parse(inserted.rows[0].payload);
    }
    const existing = await this.pool.query<PayloadRow>(
      `SELECT payload FROM p1_memory_injection_receipts WHERE task_id = $1`,
      [receipt.taskId],
    );
    const stored = clonePayload(existing.rows[0]);
    if (stored && isDeepStrictEqual(stored, receipt)) {
      return memoryInjectionReceiptSchema.parse(stored);
    }
    throw new ReuseMemoryError(
      'CONFLICT',
      `Injection receipt for task ${receipt.taskId} already exists with another payload.`,
    );
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
