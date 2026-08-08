/**
 * Release binding contract tests (V31-23).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGateResult, buildThresholdResult } from './verdict.js';
import { MemoryEvalVerdictStore } from './verdict-store.js';
import { EvalReleaseBinder } from './release-binding.js';

test('bindAndStore freezes evalSuiteRevision from release artifact', async () => {
  const binder = new EvalReleaseBinder({
    releases: {
      async getArtifact(id) {
        if (id !== 'release-bind-1') return null;
        return { evalSuiteRevision: 'eval/from-artifact' } as never;
      },
    },
    verdicts: new MemoryEvalVerdictStore(),
  });

  const stored = await binder.bindAndStore({
    harnessReleaseId: 'release-bind-1',
    layer: 'l1',
    resultId: 'bind-1',
    createdAt: '2026-08-08T02:00:00.000Z',
    datasetRevision: 'l1-intent@1',
    gates: [
      buildGateResult({ id: 'g-f', kind: 'fidelity', passed: true }),
      buildGateResult({ id: 'g-r', kind: 'rights', passed: true }),
      buildGateResult({ id: 'g-rl', kind: 'redline', passed: true }),
    ],
    thresholds: [
      buildThresholdResult({
        id: 't-tone',
        kind: 'brand_tone',
        score: 0.5,
        direction: 'min',
        bound: 0.8,
      }),
    ],
  });

  assert.equal(stored.evalSuiteRevision, 'eval/from-artifact');
  assert.equal(stored.datasetRevision, 'l1-intent@1');
  assert.equal(stored.verdict, 'scored');
  assert.equal(stored.scoredBookkept, true);
  assert.equal(stored.releasable, true);

  const listed = await binder.listForRelease('release-bind-1');
  assert.equal(listed.length, 1);
});

test('bindAndStore fails closed when release missing', async () => {
  const binder = new EvalReleaseBinder({
    releases: { async getArtifact() { return null; } },
    verdicts: new MemoryEvalVerdictStore(),
  });
  await assert.rejects(
    binder.bindAndStore({
      harnessReleaseId: 'nope',
      layer: 'l1',
      gates: [
        buildGateResult({ id: 'g-f', kind: 'fidelity', passed: true }),
        buildGateResult({ id: 'g-r', kind: 'rights', passed: true }),
        buildGateResult({ id: 'g-rl', kind: 'redline', passed: true }),
      ],
    }),
  );
});
