/**
 * Postgres EvalRun registry on the shared `p1_skill_eval_runs` table (Spec I #393).
 *
 * Read/write without Skill reference-edge side effects. Skill's own putImmutable
 * path remains the authoritative writer for Skill governance; this port lets
 * creation-experience and recipe issuers share the same run fact store.
 */

import { isDeepStrictEqual } from 'node:util';

import type { Pool, PoolClient } from 'pg';

import { evalRunSchema, type EvalRun } from '../../contracts/index.js';
import { P1DomainError } from '../foundation/domain.js';
import type { EvalRunRegistryPort } from './eval-run-registry.js';

type PayloadRow<T> = { payload: T };

function clonePayload<T>(row: PayloadRow<T> | undefined): T | null {
  return row ? structuredClone(row.payload) : null;
}

export class PostgresEvalRunRegistry implements EvalRunRegistryPort {
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient): Promise<void> {
    await (client ?? this.pool).query(`
      CREATE TABLE IF NOT EXISTS p1_skill_eval_runs (
        run_id text PRIMARY KEY,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL
      );
    `);
  }

  async putImmutable(runId: string, input: EvalRun): Promise<EvalRun> {
    const run = evalRunSchema.parse(input);
    if (run.runId !== runId) {
      throw new P1DomainError(
        'INVALID_STATE',
        'EvalRun ID must match the immutable registry key.',
      );
    }
    const inserted = await this.pool.query<PayloadRow<EvalRun>>(
      `INSERT INTO p1_skill_eval_runs
         (run_id, payload, created_at)
       VALUES ($1, $2::jsonb, $3::timestamptz)
       ON CONFLICT (run_id) DO NOTHING
       RETURNING payload`,
      [runId, JSON.stringify(run), run.createdAt],
    );
    if (inserted.rows[0]) {
      return structuredClone(run);
    }
    const existing = await this.pool.query<PayloadRow<EvalRun>>(
      'SELECT payload FROM p1_skill_eval_runs WHERE run_id = $1',
      [runId],
    );
    const stored = clonePayload(existing.rows[0]);
    if (stored && isDeepStrictEqual(stored, run)) {
      return structuredClone(run);
    }
    throw new P1DomainError(
      'IDEMPOTENCY_CONFLICT',
      'EvalRun is already bound to different facts.',
    );
  }

  async get(runId: string): Promise<EvalRun | null> {
    const result = await this.pool.query<PayloadRow<unknown>>(
      'SELECT payload FROM p1_skill_eval_runs WHERE run_id = $1',
      [runId],
    );
    const payload = clonePayload(result.rows[0]);
    return payload ? evalRunSchema.parse(payload) : null;
  }
}
