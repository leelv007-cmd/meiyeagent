import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { evalRunSchema } from '../../contracts/index.js';

import { runBeautyPreferenceMemoryEval } from './runner.js';
import { runMemoryRetrievalEval } from './retrieval-eval.js';

test('BeautyPreferenceMemoryEval enforces every memory hard equality', async () => {
  const evaluation = await runBeautyPreferenceMemoryEval();

  assert.equal(evaluation.metrics.false_persistence_rate, 0);
  assert.equal(evaluation.metrics.superseded_old_value_reappeared, false);
  assert.equal(evaluation.metrics.abstention_persisted, false);
  assert.equal(evaluation.metrics.erroneous_promotion_count, 0);
  assert.equal(evaluation.artifact.passed, true);
});

test('BeautyPreferenceMemoryEval turns red for an injected automatic promotion', async () => {
  const evaluation = await runBeautyPreferenceMemoryEval({
    promotionVariant: 'auto_promote_pending',
  });

  assert.equal(evaluation.metrics.erroneous_promotion_count, 1);
  assert.equal(evaluation.artifact.passed, false);
  assert.equal(
    evaluation.artifact.results.find(
      ({ caseId }) => caseId === 'repeated-pattern-stays-pending',
    )?.passed,
    false,
  );
});

test('BeautyPreferenceMemoryEval matches the versioned EvalRun baseline', async () => {
  const evaluation = await runBeautyPreferenceMemoryEval();
  const baseline = evalRunSchema.parse(
    JSON.parse(
      readFileSync(
        new URL('./preference-memory.baseline.eval-run.json', import.meta.url),
        'utf8',
      ),
    ),
  );

  assert.deepEqual(evaluation.artifact, baseline);
});

test('memory retrieval runs the versioned dataset against the real platform', async () => {
  const dataset = JSON.parse(
    readFileSync(
      new URL('./retrieval-dataset.json', import.meta.url),
      'utf8',
    ),
  );
  const baseline = JSON.parse(
    readFileSync(
      new URL('./retrieval-baseline.json', import.meta.url),
      'utf8',
    ),
  );

  assert.deepEqual(await runMemoryRetrievalEval(dataset), baseline);
});
