/**
 * Gates/verdict contract tests (V31-23 acceptance seam).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGateResult,
  buildThresholdResult,
  computeEvalVerdict,
  thresholdMet,
} from './verdict.js';

const fullGates = [
  buildGateResult({ id: 'g-f', kind: 'fidelity', passed: true }),
  buildGateResult({ id: 'g-r', kind: 'rights', passed: true }),
  buildGateResult({ id: 'g-rl', kind: 'redline', passed: true }),
];

test('thresholdMet supports reverse max band (hallucination)', () => {
  assert.equal(thresholdMet(0.2, 'max', 0.3), true);
  assert.equal(thresholdMet(0.5, 'max', 0.3), false);
  assert.equal(thresholdMet(0.8, 'min', 0.7), true);
  assert.equal(thresholdMet(0.6, 'min', 0.7), false);
});

test('missing any required gate kind forces failed', () => {
  const withoutRights = computeEvalVerdict({
    gates: [
      buildGateResult({ id: 'g-f', kind: 'fidelity', passed: true }),
      buildGateResult({ id: 'g-rl', kind: 'redline', passed: true }),
    ],
  });
  assert.equal(withoutRights.verdict, 'failed');
  assert.equal(withoutRights.releasable, false);
  assert.deepEqual(withoutRights.missingGateKinds, ['rights']);
});

test('any failed gate forces failed even if thresholds perfect', () => {
  const result = computeEvalVerdict({
    gates: [
      buildGateResult({ id: 'g-f', kind: 'fidelity', passed: true }),
      buildGateResult({
        id: 'g-r',
        kind: 'rights',
        passed: false,
        reason: 'unauthorized fact',
      }),
      buildGateResult({ id: 'g-rl', kind: 'redline', passed: true }),
    ],
    thresholds: [
      buildThresholdResult({
        id: 't-tone',
        kind: 'brand_tone',
        score: 1,
        direction: 'min',
        bound: 0.5,
      }),
    ],
  });
  assert.equal(result.verdict, 'failed');
  assert.equal(result.releasable, false);
  assert.deepEqual(result.failedGateIds, ['g-r']);
});

test('gates pass + unmet threshold → scored bookkept only (U12)', () => {
  const result = computeEvalVerdict({
    gates: fullGates,
    thresholds: [
      buildThresholdResult({
        id: 't-read',
        kind: 'readability',
        score: 0.4,
        direction: 'min',
        bound: 0.7,
      }),
    ],
  });
  assert.equal(result.verdict, 'scored');
  assert.equal(result.scoredBookkept, true);
  assert.equal(result.releasable, true);
  assert.deepEqual(result.unmetThresholdIds, ['t-read']);
});

test('all gates and thresholds met → passed', () => {
  const result = computeEvalVerdict({
    gates: fullGates,
    thresholds: [
      buildThresholdResult({
        id: 't-tone',
        kind: 'brand_tone',
        score: 0.9,
        direction: 'min',
        bound: 0.7,
      }),
      buildThresholdResult({
        id: 't-hall',
        kind: 'hallucination',
        score: 0.1,
        direction: 'max',
        bound: 0.2,
      }),
    ],
  });
  assert.equal(result.verdict, 'passed');
  assert.equal(result.scoredBookkept, false);
  assert.equal(result.releasable, true);
});
