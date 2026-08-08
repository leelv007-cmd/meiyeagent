/**
 * Postgres EvalLayerResult store (V31-23).
 * Table p1_eval_layer_results — immutable, indexed by release.
 */

import { isDeepStrictEqual } from 'node:util';

import type { Pool, PoolClient } from 'pg';

import {
  evalLayerResultSchema,
  type EvalLayerResult,
} from '@meiye/contracts';

import { P1DomainError } from '../foundation/domain.js';
import type { EvalVerdictStore } from './verdict-store.js';

type PayloadRow<T> = { payload: T };

function clonePayload<T>(row: PayloadRow<T> | undefined): T | null {
  return row ? structuredClone(row.payload) : null;
}

export class PostgresEvalVerdictStore implements EvalVerdictStore {
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient): Promise<void> {
    await (client ?? this.pool).query(`
      CREATE TABLE IF NOT EXISTS p1_eval_layer_results (
        result_id text PRIMARY KEY,
        harness_release_id text NOT NULL,
        layer text NOT NULL,
        verdict text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS p1_eval_layer_results_release_idx
        ON p1_eval_layer_results (harness_release_id, created_at DESC);
    `);
  }

  async putImmutable(input: EvalLayerResult): Promise<EvalLayerResult> {
    const result = evalLayerResultSchema.parse(input);
    const inserted = await this.pool.query<PayloadRow<EvalLayerResult>>(
      `INSERT INTO p1_eval_layer_results
         (result_id, harness_release_id, layer, verdict, payload, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)
       ON CONFLICT (result_id) DO NOTHING
       RETURNING payload`,
      [
        result.resultId,
        result.harnessReleaseId,
        result.layer,
        result.verdict,
        JSON.stringify(result),
        result.createdAt,
      ],
    );
    if (inserted.rows[0]) {
      return structuredClone(result);
    }
    const existing = await this.pool.query<PayloadRow<EvalLayerResult>>(
      'SELECT payload FROM p1_eval_layer_results WHERE result_id = $1',
      [result.resultId],
    );
    const stored = clonePayload(existing.rows[0]);
    if (stored && isDeepStrictEqual(stored, result)) {
      return structuredClone(stored);
    }
    throw new P1DomainError(
      'IDEMPOTENCY_CONFLICT',
      `EvalLayerResult ${result.resultId} is immutable and already bound to different facts.`,
    );
  }

  async get(resultId: string): Promise<EvalLayerResult | null> {
    const row = await this.pool.query<PayloadRow<unknown>>(
      'SELECT payload FROM p1_eval_layer_results WHERE result_id = $1',
      [resultId],
    );
    const payload = clonePayload(row.rows[0]);
    return payload ? evalLayerResultSchema.parse(payload) : null;
  }

  async listByRelease(
    harnessReleaseId: string,
    limit = 100,
  ): Promise<EvalLayerResult[]> {
    const rows = await this.pool.query<PayloadRow<unknown>>(
      `SELECT payload FROM p1_eval_layer_results
       WHERE harness_release_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [harnessReleaseId, limit],
    );
    return rows.rows.map((row) =>
      evalLayerResultSchema.parse(clonePayload(row)!),
    );
  }
}
