import { evalRunSchema, type EvalRun } from '../../contracts/index.js';

import { REDLINE_CASES } from './cases.js';
import { evaluateRedlineCase } from './promptfoo-provider.js';

export function createRecordedRedlineEvalRun(): EvalRun {
  const results = REDLINE_CASES.map((redlineCase) =>
    evaluateRedlineCase(redlineCase),
  );
  return evalRunSchema.parse({
    schemaVersion: 'eval-run/v1',
    runId: 'harness-seven-redlines-recorded-v2',
    suiteId: 'harness-seven-redlines',
    suiteRevision: 'redlines-fixtures-v2',
    mode: 'recorded_fixture',
    createdAt: '2026-07-18T08:00:00.000Z',
    passed: results.every((result) => result.passed),
    results,
  });
}
