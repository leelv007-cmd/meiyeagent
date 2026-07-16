import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BEAUTY_COPY_EVALUATION_SET_V2,
  evaluateBeautyQualityRejectionFixture,
} from './quality-evaluation.js';

test('beauty copy evaluation V2 covers long-tail prompts and adversarial cases', () => {
  const dataset = BEAUTY_COPY_EVALUATION_SET_V2;
  assert.equal(dataset.revision, 'beauty-copy-eval-v2');
  assert.ok(dataset.cases.length >= 30);
  assert.ok(dataset.rejectionCases.length >= 8);
  assert.equal(
    new Set(dataset.cases.map((fixture) => fixture.id)).size,
    dataset.cases.length,
  );
  assert.ok(
    new Set(dataset.cases.map((fixture) => fixture.grounding.city)).size >= 10,
  );
  assert.ok(new Set(dataset.cases.map((fixture) => fixture.scenario)).size >= 3);
  assert.ok(dataset.cases.some((fixture) => fixture.grounding.price === undefined));
  assert.ok(dataset.cases.some((fixture) => fixture.grounding.price !== undefined));
});

test('every adversarial fixture is caught for its declared reason', () => {
  for (const fixture of BEAUTY_COPY_EVALUATION_SET_V2.rejectionCases) {
    const result = evaluateBeautyQualityRejectionFixture(fixture);
    assert.equal(result.caught, true, fixture.id);
    for (const warning of fixture.expectedWarnings) {
      assert.ok(result.evaluation.warnings.includes(warning), fixture.id);
    }
  }
});
