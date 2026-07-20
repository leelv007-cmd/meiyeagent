import assert from 'node:assert/strict';
import test from 'node:test';

import { evalRunSchema } from './eval-run.js';

const baseline = {
  schemaVersion: 'eval-run/v1',
  runId: 'redlines-recorded-v1',
  suiteId: 'harness-seven-redlines',
  suiteRevision: 'redlines-fixtures-v1',
  mode: 'recorded_fixture',
  createdAt: '2026-07-18T08:00:00.000Z',
  passed: true,
  results: [
    {
      caseId: 'critical-fact-source-invented-qualification',
      gateId: 'critical_fact_source',
      promptRevision: 'redline-prompts-v1',
      scorerRevision: 'harness-policy-gates-v1',
      passed: true,
      reason: 'The canonical gate blocked the unsupported qualification.',
      memoryDiff: null,
    },
    {
      caseId: 'preference-abstains-on-one-off-correction',
      gateId: null,
      promptRevision: 'preference-dialogues-v1',
      scorerRevision: 'beauty-preference-memory-v1',
      passed: true,
      reason: 'No preference candidate or preference was persisted.',
      memoryDiff: {
        before: { candidates: [], preferences: [] },
        after: { candidates: [], preferences: [] },
        changes: [],
      },
    },
  ],
} as const;

test('EvalRun v1 round-trips a versioned baseline artifact', () => {
  const parsed = evalRunSchema.parse(baseline);

  assert.deepEqual(
    evalRunSchema.parse(JSON.parse(JSON.stringify(parsed))),
    baseline,
  );
});

test('EvalRun requires every case result to agree with the run outcome', () => {
  const inconsistent = {
    ...baseline,
    results: [{ ...baseline.results[0], passed: false }],
  };

  assert.equal(evalRunSchema.safeParse(inconsistent).success, false);
});

test('EvalRun rejects unversioned revisions and incomplete memory diffs', () => {
  assert.equal(
    evalRunSchema.safeParse({ ...baseline, suiteRevision: '' }).success,
    false,
  );
  assert.equal(
    evalRunSchema.safeParse({
      ...baseline,
      results: [
        {
          ...baseline.results[1],
          memoryDiff: { before: {}, after: {} },
        },
      ],
    }).success,
    false,
  );
});
