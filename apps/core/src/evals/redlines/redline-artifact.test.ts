import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { evalRunSchema } from '../../contracts/index.js';

import { REDLINE_CASES } from './cases.js';
import { createRecordedRedlineEvalRun } from './redline-artifact.js';

test('recorded redline evaluation matches the versioned EvalRun baseline', () => {
  const run = createRecordedRedlineEvalRun();
  const baseline = evalRunSchema.parse(
    JSON.parse(
      readFileSync(
        new URL('./redlines.baseline.eval-run.json', import.meta.url),
        'utf8',
      ),
    ),
  );

  assert.equal(run.passed, true);
  assert.equal(run.results.length, REDLINE_CASES.length);
  assert.ok(run.results.every((result) => result.memoryDiff === null));
  assert.deepEqual(run, baseline);
});
