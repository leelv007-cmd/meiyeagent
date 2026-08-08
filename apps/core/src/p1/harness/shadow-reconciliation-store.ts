/**
 * Shadow reconciliation evidence + program state store (V31-13).
 * Postgres in production; Memory for unit tests only.
 */

import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import type { PostgresSchemaMigrator } from '../../postgres-schema-migration.js';
import type {
  ShadowCloseReason,
  ShadowFieldDiff,
  ShadowProgramState,
  ShadowReconciliationSample,
} from './shadow-reconciliation.js';

export interface ShadowReconciliationStore {
  getProgramState(): Promise<ShadowProgramState | null>;
  putProgramState(state: ShadowProgramState): Promise<ShadowProgramState>;
  putSampleIdempotent(
    sample: ShadowReconciliationSample,
  ): Promise<ShadowReconciliationSample>;
  listSamples(limit?: number): Promise<ShadowReconciliationSample[]>;
  countMismatchesSince(sinceIso: string): Promise<number>;
}

export class MemoryShadowReconciliationStore
  implements ShadowReconciliationStore
{
  private state: ShadowProgramState | null = null;
  private readonly samples = new Map<string, ShadowReconciliationSample>();

  async getProgramState(): Promise<ShadowProgramState | null> {
    return this.state ? structuredClone(this.state) : null;
  }

  async putProgramState(
    state: ShadowProgramState,
  ): Promise<ShadowProgramState> {
    this.state = structuredClone(state);
    return structuredClone(this.state);
  }

  async putSampleIdempotent(
    sample: ShadowReconciliationSample,
  ): Promise<ShadowReconciliationSample> {
    const existing = this.samples.get(sample.workflowId);
    if (existing) return structuredClone(existing);
    this.samples.set(sample.workflowId, structuredClone(sample));
    return structuredClone(sample);
  }

  async listSamples(limit = 500): Promise<ShadowReconciliationSample[]> {
    return [...this.samples.values()]
      .sort((a, b) => b.sampledAt.localeCompare(a.sampledAt))
      .slice(0, limit)
      .map((s) => structuredClone(s));
  }

  async countMismatchesSince(sinceIso: string): Promise<number> {
    let count = 0;
    for (const sample of this.samples.values()) {
      if (!sample.matched && sample.sampledAt >= sinceIso) count += 1;
    }
    return count;
  }
}

type StateRow = { payload: ShadowProgramState };
type SampleRow = {
  workflow_id: string;
  workspace_id: string;
  matched: boolean;
  sampled_at: Date | string;
  payload: ShadowReconciliationSample;
};

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export class PostgresShadowReconciliationStore
  implements ShadowReconciliationStore, PostgresSchemaMigrator
{
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient): Promise<void> {
    const db = client ?? this.pool;
    await db.query(`
      SELECT pg_advisory_xact_lock(
        hashtext('p1-shadow-reconciliation-migration-v1')
      );
      CREATE TABLE IF NOT EXISTS p1_shadow_reconciliation_state (
        id text PRIMARY KEY,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL
      );
      CREATE TABLE IF NOT EXISTS p1_shadow_reconciliation_samples (
        workflow_id text PRIMARY KEY,
        workspace_id text NOT NULL,
        snapshot_hash text,
        matched boolean NOT NULL,
        sampled_at timestamptz NOT NULL,
        payload jsonb NOT NULL
      );
      CREATE INDEX IF NOT EXISTS p1_shadow_reconciliation_samples_time_idx
        ON p1_shadow_reconciliation_samples (sampled_at DESC);
      CREATE INDEX IF NOT EXISTS p1_shadow_reconciliation_samples_mismatch_idx
        ON p1_shadow_reconciliation_samples (matched, sampled_at DESC);
    `);
  }

  async getProgramState(): Promise<ShadowProgramState | null> {
    const result = await this.pool.query<StateRow>(
      `SELECT payload FROM p1_shadow_reconciliation_state WHERE id = 'global'`,
    );
    const row = result.rows[0];
    return row ? structuredClone(row.payload) : null;
  }

  async putProgramState(
    state: ShadowProgramState,
  ): Promise<ShadowProgramState> {
    const payload = structuredClone(state);
    await this.pool.query(
      `INSERT INTO p1_shadow_reconciliation_state (id, payload, updated_at)
       VALUES ('global', $1::jsonb, $2::timestamptz)
       ON CONFLICT (id) DO UPDATE SET
         payload = EXCLUDED.payload,
         updated_at = EXCLUDED.updated_at`,
      [JSON.stringify(payload), payload.updatedAt],
    );
    return payload;
  }

  async putSampleIdempotent(
    sample: ShadowReconciliationSample,
  ): Promise<ShadowReconciliationSample> {
    const payload = structuredClone(sample);
    const inserted = await this.pool.query<SampleRow>(
      `INSERT INTO p1_shadow_reconciliation_samples (
         workflow_id, workspace_id, snapshot_hash, matched, sampled_at, payload
       ) VALUES ($1, $2, $3, $4, $5::timestamptz, $6::jsonb)
       ON CONFLICT (workflow_id) DO NOTHING
       RETURNING workflow_id, workspace_id, matched, sampled_at, payload`,
      [
        sample.workflowId,
        sample.workspaceId,
        sample.snapshotHash,
        sample.matched,
        sample.sampledAt,
        JSON.stringify(payload),
      ],
    );
    if (inserted.rows[0]) {
      return structuredClone(inserted.rows[0].payload);
    }
    const existing = await this.pool.query<SampleRow>(
      `SELECT workflow_id, workspace_id, matched, sampled_at, payload
         FROM p1_shadow_reconciliation_samples
        WHERE workflow_id = $1`,
      [sample.workflowId],
    );
    if (!existing.rows[0]) {
      // Concurrent delete edge — re-insert with fresh id not needed; return input.
      return payload;
    }
    return structuredClone(existing.rows[0].payload);
  }

  async listSamples(limit = 500): Promise<ShadowReconciliationSample[]> {
    const result = await this.pool.query<SampleRow>(
      `SELECT workflow_id, workspace_id, matched, sampled_at, payload
         FROM p1_shadow_reconciliation_samples
        ORDER BY sampled_at DESC
        LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => structuredClone(row.payload));
  }

  async countMismatchesSince(sinceIso: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM p1_shadow_reconciliation_samples
        WHERE matched = false
          AND sampled_at >= $1::timestamptz`,
      [sinceIso],
    );
    return Number(result.rows[0]?.count ?? 0);
  }
}

/** Helper for tests / assembly that need a fresh sample id. */
export function newShadowSampleId(): string {
  return randomUUID();
}

export type { ShadowCloseReason, ShadowFieldDiff };
