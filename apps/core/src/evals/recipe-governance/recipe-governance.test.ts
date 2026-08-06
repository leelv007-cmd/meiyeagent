import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { evalRunSchema } from '../../contracts/index.js';
import { scoreFactSatisfactionOutput } from '../fact-satisfaction/promptfoo-scorer.js';
import {
  evaluateRedlineCase,
  REDLINE_SCORER_REVISION,
} from '../redlines/promptfoo-provider.js';
import {
  buildRecipeGovernanceCases,
  recipeGovernanceCaseIds,
} from './cases.js';
import { createRecordedRecipeGovernanceEvalRun } from './runner.js';
import { FIXTURE_RECIPE_GOVERNANCE_SUBJECT } from './subject.js';
import {
  RECIPE_GOVERNANCE_FACT_SATISFACTION_SCORER_REVISION,
  RECIPE_GOVERNANCE_REDLINE_SCORER_REVISION,
  RECIPE_GOVERNANCE_SUITE_ID,
  RECIPE_GOVERNANCE_SUITE_REVISION,
} from './suite.js';

const baselineUrl = new URL(
  './recipe-governance.baseline.eval-run.json',
  import.meta.url,
);

/** Fixture case surface pinned to suiteRevision recipe-governance@1. */
const FIXTURE_CASE_IDS = [
  'fact-satisfaction-required-types-present',
  'fact-satisfaction-required-type-missing',
  'redline-invented-critical-fact-for-recipe-slots',
  'redline-output-delivery-sensitive-words',
] as const;

test('recorded recipe-governance artifact passes EvalRun v1 strict parse', async () => {
  const run = await createRecordedRecipeGovernanceEvalRun();
  const parsed = evalRunSchema.parse(JSON.parse(JSON.stringify(run)));

  assert.equal(parsed.schemaVersion, 'eval-run/v1');
  assert.equal(parsed.suiteId, RECIPE_GOVERNANCE_SUITE_ID);
  assert.equal(parsed.suiteRevision, RECIPE_GOVERNANCE_SUITE_REVISION);
  assert.equal(parsed.mode, 'recorded_fixture');
  assert.equal(parsed.passed, true);
  assert.ok(parsed.results.length >= 1);
});

test('EvalRun passed equals the conjunction of every case result', async () => {
  const passing = await createRecordedRecipeGovernanceEvalRun();
  assert.equal(
    passing.passed,
    passing.results.every((result) => result.passed),
  );
  assert.equal(passing.passed, true);

  const failing = await createRecordedRecipeGovernanceEvalRun({
    redlineValidator: () => ({ passed: true, failures: [] }),
  });
  assert.equal(failing.passed, false);
  assert.equal(
    failing.passed,
    failing.results.every((result) => result.passed),
  );
  assert.ok(failing.results.some((result) => !result.passed));

  // Schema invariant: inconsistent passed/results is rejected.
  assert.equal(
    evalRunSchema.safeParse({
      ...passing,
      results: [{ ...passing.results[0]!, passed: false }],
    }).success,
    false,
  );
});

test('every case carries the Recipe promptRevision and a reused scorerRevision', async () => {
  const run = await createRecordedRecipeGovernanceEvalRun();
  const allowedScorers = new Set([
    RECIPE_GOVERNANCE_REDLINE_SCORER_REVISION,
    RECIPE_GOVERNANCE_FACT_SATISFACTION_SCORER_REVISION,
  ]);

  for (const result of run.results) {
    assert.equal(
      result.promptRevision,
      FIXTURE_RECIPE_GOVERNANCE_SUBJECT.promptRevisionRef,
      result.caseId,
    );
    assert.ok(
      allowedScorers.has(result.scorerRevision as never),
      `${result.caseId} scorerRevision=${result.scorerRevision}`,
    );
  }

  assert.equal(
    RECIPE_GOVERNANCE_REDLINE_SCORER_REVISION,
    REDLINE_SCORER_REVISION,
  );
  assert.equal(
    RECIPE_GOVERNANCE_FACT_SATISFACTION_SCORER_REVISION,
    'fact-satisfaction-v1',
  );
});

test('suite reuses evaluateRedlineCase and scoreFactSatisfactionOutput without new standards', async () => {
  const cases = buildRecipeGovernanceCases(FIXTURE_RECIPE_GOVERNANCE_SUBJECT);
  const redlineCases = cases.filter((evalCase) => evalCase.kind === 'redline');
  const factCases = cases.filter(
    (evalCase) => evalCase.kind === 'fact_satisfaction',
  );

  assert.ok(redlineCases.length >= 2);
  assert.ok(factCases.length >= 2);

  for (const evalCase of redlineCases) {
    if (evalCase.kind !== 'redline') continue;
    const scored = evaluateRedlineCase(evalCase.redline);
    assert.equal(scored.passed, true, evalCase.caseId);
    assert.equal(scored.scorerRevision, REDLINE_SCORER_REVISION);
  }

  // Fact-satisfaction scorer is the production promptfoo scorer module.
  assert.equal(typeof scoreFactSatisfactionOutput, 'function');
  for (const evalCase of factCases) {
    if (evalCase.kind !== 'fact_satisfaction') continue;
    assert.ok(evalCase.vars.expectedJson.length > 0, evalCase.caseId);
  }
});

test('recorded recipe-governance matches the versioned EvalRun baseline', async () => {
  const run = await createRecordedRecipeGovernanceEvalRun();
  const baseline = evalRunSchema.parse(
    JSON.parse(readFileSync(baselineUrl, 'utf8')),
  );

  assert.deepEqual(run, baseline);
});

test('suiteRevision is pinned to the current fixture case surface', () => {
  // Content changes must bump RECIPE_GOVERNANCE_SUITE_REVISION together with
  // this pin. Updating case ids without the revision constant fails this test.
  assert.equal(RECIPE_GOVERNANCE_SUITE_REVISION, 'recipe-governance@1');
  assert.deepEqual(
    recipeGovernanceCaseIds(FIXTURE_RECIPE_GOVERNANCE_SUBJECT),
    [...FIXTURE_CASE_IDS],
  );

  // Promotional intents add a fifth case — suite content surface expands.
  const promotional = {
    ...FIXTURE_RECIPE_GOVERNANCE_SUBJECT,
    intentTypes: ['promotional_material' as const],
  };
  assert.deepEqual(recipeGovernanceCaseIds(promotional), [
    ...FIXTURE_CASE_IDS,
    'redline-promotional-benefit-fabrication',
  ]);
});

test('cases are derived from the subject fact types, intent types, and output contract', () => {
  const emptyFacts = {
    ...FIXTURE_RECIPE_GOVERNANCE_SUBJECT,
    factTypes: [] as const,
  };
  assert.deepEqual(recipeGovernanceCaseIds(emptyFacts), [
    'fact-satisfaction-required-types-present',
    'redline-invented-critical-fact-for-recipe-slots',
    'redline-output-delivery-sensitive-words',
  ]);

  const priceFacts = {
    ...FIXTURE_RECIPE_GOVERNANCE_SUBJECT,
    factTypes: ['service', 'price'] as const,
    output: {
      outputKind: 'image_text_note' as const,
      quantity: 4,
      aspectRatio: '3:4',
    },
  };
  const cases = buildRecipeGovernanceCases(priceFacts);
  const invented = cases.find(
    (evalCase) =>
      evalCase.caseId === 'redline-invented-critical-fact-for-recipe-slots',
  );
  assert.ok(invented && invented.kind === 'redline');
  assert.equal(
    invented.redline.vars.input.candidate.factClaims[0]?.kind,
    'price',
  );
  assert.equal(invented.redline.vars.input.phase, 'execution');
});
