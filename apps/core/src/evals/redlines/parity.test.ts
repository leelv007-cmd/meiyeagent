import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';

import { COPY_SCORING_RUBRIC } from '../../p1/harness/execution-selection.js';
import {
  HARNESS_GATE_IDS,
  validateHarnessPolicy,
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

test('seven visible-copy adversarial cases are causal and ignore reported claims', () => {
  const visibleCases = REDLINE_CASES.filter(({ vars }) =>
    vars.caseId.startsWith('visible-empty-claims-'),
  );
  assert.equal(visibleCases.length, 7);

  for (const redlineCase of visibleCases) {
    assert.deepEqual(redlineCase.vars.input.candidate.factClaims, []);
    assert.ok(
      redlineCase.vars.input.candidate.visibleText?.some(
        ({ text }) => text.length > 0,
      ),
    );
    const withoutVisibleCopy = structuredClone(redlineCase.vars.input);
    withoutVisibleCopy.candidate.visibleText = [];
    assert.equal(
      validateHarnessPolicy(withoutVisibleCopy).passed,
      true,
      `${redlineCase.vars.caseId} must pass when its visible breach is removed`,
    );
  }
});

test('live red-team is blocking and runs more than one generated test', () => {
  const config = readFileSync(
    new URL('../../../../../promptfooconfig.redteam.yaml', import.meta.url),
    'utf8',
  );
  const workflow = readFileSync(
    new URL(
      '../../../../../.github/workflows/core-quality.yml',
      import.meta.url,
    ),
    'utf8',
  );
  const redteamConfig = parse(config) as {
    redteam?: { numTests?: unknown };
  };
  const workflowConfig = parse(workflow) as {
    jobs?: Record<
      string,
      { steps?: Array<{ name?: string; 'continue-on-error'?: unknown }> }
    >;
  };
  const liveStep = workflowConfig.jobs?.['live-redteam']?.steps?.find(
    ({ name }) => name === 'Run opt-in Volcengine red-team',
  );

  assert.ok(
    typeof redteamConfig.redteam?.numTests === 'number' &&
      redteamConfig.redteam.numTests > 1,
    'red-team numTests must be greater than one',
  );
  assert.ok(liveStep, 'live red-team workflow step must exist');
  assert.notEqual(liveStep['continue-on-error'], true);
});

test('promptfoo scorer rubric fixture stays aligned with the production N-to-1 rubric', () => {
  const fixture = JSON.parse(
    readFileSync(new URL('./scorer-rubric.json', import.meta.url), 'utf8'),
  );

  assert.deepEqual(fixture, COPY_SCORING_RUBRIC);
});
