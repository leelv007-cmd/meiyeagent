import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  COPY_SCORING_RUBRIC,
} from '../../p1/harness/execution-selection.js';
import {
  HARNESS_GATE_IDS,
} from '../../p1/harness/policy-gates.js';
import { REDLINE_CASES } from './cases.js';
import { RECORDED_GATE_REASONS } from './recorded-gate-reasons.js';

test('promptfoo dataset gateIds exactly match the canonical production gateIds', () => {
  const productionGateIds = [...HARNESS_GATE_IDS].sort();
  const datasetGateIds = [
    ...new Set(REDLINE_CASES.map(({ vars }) => vars.expectedGateId)),
  ].sort();

  assert.deepEqual(datasetGateIds, productionGateIds);
  assert.deepEqual(Object.keys(RECORDED_GATE_REASONS).sort(), productionGateIds);
});

test('every canonical gate has a must-block case and an adversarial variant', () => {
  for (const gateId of HARNESS_GATE_IDS) {
    assert.ok(
      REDLINE_CASES.filter(({ vars }) => vars.expectedGateId === gateId)
        .length >= 2,
      `${gateId} must have at least two recorded cases`,
    );
  }
});

test('promptfoo scorer rubric fixture stays aligned with the production N-to-1 rubric', () => {
  const fixture = JSON.parse(
    readFileSync(new URL('./scorer-rubric.json', import.meta.url), 'utf8'),
  );

  assert.deepEqual(fixture, COPY_SCORING_RUBRIC);
});
