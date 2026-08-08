/**
 * Eval layers contract tests (V31-23).
 * Seams: gates/verdict schema invariants, dataset freeze, D-061 forbidden keys.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EVAL_GATE_KINDS,
  EVAL_LAYER_RESULT_SCHEMA_VERSION,
  EVAL_TRACE_FORBIDDEN_KEYS,
  EVAL_TRACE_REQUIRED_FIELDS,
  evalDatasetManifestSchema,
  evalHigherLayerBacklogEntrySchema,
  evalLayerResultSchema,
  evalSafeTraceFieldsSchema,
} from './eval-layers.js';

const baseResult = {
  schemaVersion: EVAL_LAYER_RESULT_SCHEMA_VERSION,
  resultId: 'eval-result-1',
  layer: 'l1' as const,
  harnessReleaseId: 'release-1',
  evalSuiteRevision: 'eval/1',
  gates: [
    { id: 'g-fidelity', kind: 'fidelity' as const, passed: true },
    { id: 'g-rights', kind: 'rights' as const, passed: true },
    { id: 'g-redline', kind: 'redline' as const, passed: true },
  ],
  thresholds: [
    {
      id: 't-tone',
      kind: 'brand_tone' as const,
      score: 0.9,
      direction: 'min' as const,
      bound: 0.7,
      met: true,
    },
  ],
  verdict: 'passed' as const,
  scoredBookkept: false,
  releasable: true,
  createdAt: '2026-08-08T00:00:00.000Z',
};

test('evalLayerResult accepts passed and scored (U12 bookkeeping)', () => {
  const passed = evalLayerResultSchema.parse(baseResult);
  assert.equal(passed.verdict, 'passed');

  const scored = evalLayerResultSchema.parse({
    ...baseResult,
    resultId: 'eval-result-scored',
    thresholds: [
      {
        id: 't-tone',
        kind: 'brand_tone',
        score: 0.4,
        direction: 'min',
        bound: 0.7,
        met: false,
      },
    ],
    verdict: 'scored',
    scoredBookkept: true,
    releasable: true,
  });
  assert.equal(scored.scoredBookkept, true);
  assert.equal(scored.releasable, true);
});

test('evalLayerResult rejects failed+releasable and scored without bookkeep', () => {
  assert.equal(
    evalLayerResultSchema.safeParse({
      ...baseResult,
      verdict: 'failed',
      releasable: true,
      scoredBookkept: false,
    }).success,
    false,
  );
  assert.equal(
    evalLayerResultSchema.safeParse({
      ...baseResult,
      verdict: 'scored',
      scoredBookkept: false,
      releasable: true,
    }).success,
    false,
  );
});

test('required gate kinds catalog is fidelity/rights/redline', () => {
  assert.deepEqual([...EVAL_GATE_KINDS], ['fidelity', 'rights', 'redline']);
});

test('dataset manifest freezes revision/source/license (U3)', () => {
  const manifest = evalDatasetManifestSchema.parse({
    schemaVersion: 'eval-dataset-manifest/v1',
    datasetId: 'l1-intent-baseline',
    revision: 'l1-intent@1',
    source: 'fixture',
    license: 'internal-fixture-v1',
    frozenAt: '2026-08-08T00:00:00.000Z',
    node: 'intent',
    caseIds: ['intent-goal-classify-1'],
  });
  assert.equal(manifest.revision, 'l1-intent@1');
  assert.equal(manifest.license, 'internal-fixture-v1');
});

test('safe trace schema requires release binding fields and forbids extras', () => {
  const safe = evalSafeTraceFieldsSchema.parse({
    threadId: 'thread-1',
    runId: 'run-1',
    harnessReleaseId: 'release-1',
    promptVersion: 'copy@1',
  });
  assert.equal(safe.harnessReleaseId, 'release-1');

  assert.equal(
    evalSafeTraceFieldsSchema.safeParse({
      threadId: 'thread-1',
      runId: 'run-1',
      harnessReleaseId: 'release-1',
      apiKey: 'sk-leak',
    }).success,
    false,
  );

  for (const field of EVAL_TRACE_REQUIRED_FIELDS) {
    assert.ok(field === 'threadId' || field === 'runId' || field === 'harnessReleaseId');
  }
  assert.ok(EVAL_TRACE_FORBIDDEN_KEYS.includes('apiKey'));
  assert.ok(EVAL_TRACE_FORBIDDEN_KEYS.includes('upstreamUsdCost'));
  assert.ok(EVAL_TRACE_FORBIDDEN_KEYS.includes('chainOfThought'));
});

test('L2/L3 backlog entries require readonly gate literals', () => {
  const entry = evalHigherLayerBacklogEntrySchema.parse({
    schemaVersion: 'eval-higher-layer-backlog/v1',
    kind: 'l2_journey_replay',
    status: 'trigger_bound_backlog',
    trigger: 'historical_tasks_hundreds',
    readonlyGateRequired: true,
    paidSideEffectsForbidden: true,
  });
  assert.equal(entry.status, 'trigger_bound_backlog');
  assert.equal(
    evalHigherLayerBacklogEntrySchema.safeParse({
      ...entry,
      paidSideEffectsForbidden: false,
    }).success,
    false,
  );
});
