/**
 * Postgres eval verdict store seam (V31-23).
 * Skips when TEST_DATABASE_URL is unset.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import {
  evalLayerResultSchema,
  type EvalLayerResult,
} from '@meiye/contracts';

import { P1DomainError } from '../foundation/domain.js';
import { PostgresEvalVerdictStore } from './postgres-verdict-store.js';

const connectionString = process.env.TEST_DATABASE_URL;

function sampleResult(
  overrides: Record<string, unknown> = {},
): EvalLayerResult {
  return evalLayerResultSchema.parse({
    schemaVersion: 'eval-layer-result/v1',
    resultId: 'eval-result-pg',
    layer: 'l0.5',
    harnessReleaseId: 'release-pg-1',
    evalSuiteRevision: 'eval/1',
    gates: [
      { id: 'g-f', kind: 'fidelity', passed: true },
      { id: 'g-r', kind: 'rights', passed: true },
      { id: 'g-rl', kind: 'redline', passed: true },
    ],
    thresholds: [],
    verdict: 'passed',
    scoredBookkept: false,
    releasable: true,
    createdAt: '2026-08-08T12:00:00.000Z',
    ...overrides,
  });
}

test(
  'Postgres eval verdict store is put-once and listable by release',
  {
    skip: connectionString
      ? false
      : 'TEST_DATABASE_URL is not configured — PG seam skipped',
  },
  async () => {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString });
    const resultId = `eval-result-pg-${randomUUID()}`;
    const releaseId = `release-pg-${randomUUID()}`;
    const result = sampleResult({
      resultId,
      harnessReleaseId: releaseId,
    });
    const store = new PostgresEvalVerdictStore(pool);
    await store.migrate();

    try {
      assert.deepEqual(await store.putImmutable(result), result);
      assert.deepEqual(await store.putImmutable(result), result);
      assert.deepEqual(await store.get(resultId), result);

      await assert.rejects(
        store.putImmutable({ ...result, verdict: 'failed', releasable: false }),
        (error: unknown) =>
          error instanceof P1DomainError &&
          error.code === 'IDEMPOTENCY_CONFLICT',
      );

      const listed = await store.listByRelease(releaseId);
      assert.equal(listed.length, 1);
      assert.equal(listed[0]?.resultId, resultId);

      const restarted = new PostgresEvalVerdictStore(pool);
      await restarted.migrate();
      assert.deepEqual(await restarted.get(resultId), result);
    } finally {
      await pool.query('DELETE FROM p1_eval_layer_results WHERE result_id = $1', [
        resultId,
      ]);
      await pool.end();
    }
  },
);
