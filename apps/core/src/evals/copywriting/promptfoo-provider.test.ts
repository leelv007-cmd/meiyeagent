import assert from 'node:assert/strict';
import test from 'node:test';

import { COPYWRITING_ASSERTION_CONTROL_CASE } from './assertion-control-case.js';
import { COPYWRITING_CASES } from './cases.js';
import CopywritingPromptfooProvider from './promptfoo-provider.js';
import { scoreCopywritingOutput } from './promptfoo-scorer.js';

test('copywriting recorded fixtures prove Skill injection and exercise the scorer without causal attribution', async () => {
  const evaluationCase = COPYWRITING_CASES[0]!;
  const response = await new CopywritingPromptfooProvider().callApi(
    evaluationCase.vars.caseId,
    { vars: evaluationCase.vars }
  );
  const observation = JSON.parse(response.output);

  assert.equal(response.metadata.productionSeam, 'executeCopySelection');
  assert.deepEqual(response.metadata.comparisonInputs, [
    'skillInstructions',
    'recordedOutputFixture',
  ]);
  assert.equal(response.metadata.causalAttribution, false);
  assert.equal(observation.conclusion, 'improved');
  assert.ok(observation.delta > 0);
  assert.deepEqual(
    scoreCopywritingOutput(response.output, { vars: evaluationCase.vars }),
    {
      pass: true,
      score: 1,
      reason: `Recorded paired fixture is improved (delta ${observation.delta}); no causal attribution.`,
    }
  );
});

test('copywriting assertion control rejects a valid result with a wrong conclusion', async () => {
  const control = COPYWRITING_ASSERTION_CONTROL_CASE;
  const response = await new CopywritingPromptfooProvider().callApi(
    control.vars.caseId,
    { vars: control.vars }
  );

  assert.deepEqual(
    scoreCopywritingOutput(response.output, { vars: control.vars }),
    {
      pass: false,
      score: 0,
      reason: 'Expected unchanged; observed improved.',
    }
  );
});
