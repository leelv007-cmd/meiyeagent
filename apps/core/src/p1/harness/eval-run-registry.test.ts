import assert from 'node:assert/strict';
import test from 'node:test';

import type { EvalRun } from '../../contracts/index.js';
import { P1DomainError } from '../foundation/domain.js';
import { MemoryEvalRunRegistry } from './eval-run-registry.js';

function sampleRun(overrides: Partial<EvalRun> = {}): EvalRun {
  return {
    schemaVersion: 'eval-run/v1',
    runId: 'eval-shared-1',
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

test('shared memory EvalRun registry is put-once with deep-compare idempotency', async () => {
  const registry = new MemoryEvalRunRegistry();
  const run = sampleRun();

  assert.deepEqual(await registry.putImmutable(run.runId, run), run);
  assert.deepEqual(await registry.putImmutable(run.runId, run), run);
  assert.deepEqual(await registry.get(run.runId), run);

  await assert.rejects(
    registry.putImmutable(run.runId, { ...run, suiteId: 'other-suite' }),
    (error: unknown) =>
      error instanceof P1DomainError &&
      error.code === 'IDEMPOTENCY_CONFLICT',
  );
});

test('shared memory EvalRun registry rejects runId mismatch', async () => {
  const registry = new MemoryEvalRunRegistry();
  await assert.rejects(
    registry.putImmutable('other-id', sampleRun()),
    (error: unknown) =>
      error instanceof P1DomainError && error.code === 'INVALID_STATE',
  );
});
