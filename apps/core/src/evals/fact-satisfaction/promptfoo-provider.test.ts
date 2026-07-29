import assert from 'node:assert/strict';
import test from 'node:test';

import { FACT_SATISFACTION_ASSERTION_CONTROL_CASE } from './assertion-control-case.js';
import { FACT_SATISFACTION_CASES } from './cases.js';
import FactSatisfactionPromptfooProvider from './promptfoo-provider.js';
import { scoreFactSatisfactionOutput } from './promptfoo-scorer.js';

test('recorded fact-satisfaction semantics cover eleven frozen production prompts', async () => {
  assert.equal(FACT_SATISFACTION_CASES.length, 11);
  const provider = new FactSatisfactionPromptfooProvider();

  for (const evaluationCase of FACT_SATISFACTION_CASES) {
    const response = await provider.callApi(evaluationCase.vars.caseId, {
      vars: evaluationCase.vars,
    });

    assert.equal(response.error, undefined, evaluationCase.vars.caseId);
    assert.deepEqual(
      scoreFactSatisfactionOutput(response.output, {
        vars: evaluationCase.vars,
      }),
      {
        pass: true,
        score: 1,
        reason: 'Observed production-seam semantics match the frozen case.',
      },
      evaluationCase.vars.caseId,
    );
  }
});

test('the same provider returns a valid wrong outcome for the assertion control', async () => {
  const provider = new FactSatisfactionPromptfooProvider();
  const response = await provider.callApi(
    FACT_SATISFACTION_ASSERTION_CONTROL_CASE.vars.caseId,
    { vars: FACT_SATISFACTION_ASSERTION_CONTROL_CASE.vars },
  );

  assert.equal(response.error, undefined);
  assert.equal(JSON.parse(response.output).result.status, 'satisfied');
  assert.deepEqual(
    scoreFactSatisfactionOutput(response.output, {
      vars: FACT_SATISFACTION_ASSERTION_CONTROL_CASE.vars,
    }),
    {
      pass: false,
      score: 0,
      reason:
        'Observed production-seam semantics differ from the frozen expected result.',
    },
  );
});
