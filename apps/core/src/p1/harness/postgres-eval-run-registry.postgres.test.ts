/**
 * Shared harness EvalRun registry Postgres parity (#393).
 * Driver executes with TEST_DATABASE_URL; skipped without it.
 * Does not alter Skill write paths; only uses the shared p1_skill_eval_runs table.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import type { EvalRun } from '../../contracts/index.js';
import { P1DomainError } from '../foundation/domain.js';
import { PostgresEvalRunRegistry } from './postgres-eval-run-registry.js';

const connectionString = process.env.TEST_DATABASE_URL;

function sampleRun(overrides: Partial<EvalRun> = {}): EvalRun {
  return {
    schemaVersion: 'eval-run/v1',
    runId: 'eval-shared-pg',
    suiteId: 'recipe-governance',
    suiteRevision: 'recipe-governance@1',
    mode: 'recorded_fixture',
    createdAt: '2026-08-06T12:00:00.000Z',
    passed: true,
    results: [
      {
        caseId: 'case-1',
        gateId: 'recipe_evaluation',
        promptRevision: 'prompt.recipe@1',
        scorerRevision: 'redlines@1',
        passed: true,
        reason: 'fixture pass',
        memoryDiff: null,
      },
    ],
    ...overrides,
  };
}

test(
  'shared Postgres EvalRun registry is put-once and restart-readable',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const runId = `eval-shared-pg-${randomUUID()}`;
    const run = sampleRun({ runId });
    const registry = new PostgresEvalRunRegistry(pool);
    await registry.migrate();

    try {
      assert.deepEqual(await registry.putImmutable(runId, run), run);
      assert.deepEqual(await registry.putImmutable(runId, run), run);
      assert.deepEqual(await registry.get(runId), run);

      await assert.rejects(
        registry.putImmutable(runId, { ...run, suiteId: 'other-suite' }),
        (error: unknown) =>
          error instanceof P1DomainError &&
          error.code === 'IDEMPOTENCY_CONFLICT',
      );

      const restarted = new PostgresEvalRunRegistry(pool);
      await restarted.migrate();
      assert.deepEqual(await restarted.get(runId), run);
    } finally {
      await pool.query('DELETE FROM p1_skill_eval_runs WHERE run_id = $1', [
        runId,
      ]);
      await pool.end();
    }
  },
);
