import assert from 'node:assert/strict';
import test from 'node:test';

import { BEAUTY_COPYWRITING_INSTRUCTION } from '../../p1/skills/platform-recipes.js';
import { COPYWRITING_ASSERTION_CONTROL_CASE } from './assertion-control-case.js';
import { COPYWRITING_CASES } from './cases.js';
import CopywritingPromptfooProvider from './promptfoo-provider.js';
import { scoreCopywritingOutput } from './promptfoo-scorer.js';

test('copywriting recorded A/B changes only Skill instructions while keeping the fixture output fixed', async () => {
  const evaluationCase = COPYWRITING_CASES[0]!;
  const response = await new CopywritingPromptfooProvider().callApi(
    evaluationCase.vars.caseId,
    { vars: evaluationCase.vars }
  );
  const observation = JSON.parse(response.output);

  assert.equal(response.metadata.productionSeam, 'executeCopySelection');
  assert.deepEqual(response.metadata.comparisonInputs, ['skillInstructions']);
  assert.equal(response.metadata.fixtureOutputPolicy, 'shared_between_arms');
  assert.equal(response.metadata.causalAttribution, false);
  assert.equal(observation.conclusion, 'unchanged');
  assert.equal(observation.delta, 0);
  assert.deepEqual(observation.baseline.output, observation.treatment.output);
  assert.equal(
    observation.treatment.requestInstructions,
    [
      observation.baseline.requestInstructions,
      '',
      'Apply only these accepted and frozen Skills for the current stage:',
      `[${evaluationCase.vars.skillRevisionRef}] ${BEAUTY_COPYWRITING_INSTRUCTION}`,
    ].join('\n'),
  );
  assert.notEqual(
    observation.baseline.requestInstructions,
    observation.treatment.requestInstructions,
  );
  assert.deepEqual(
    scoreCopywritingOutput(response.output, { vars: evaluationCase.vars }),
    {
      pass: true,
      score: 1,
      reason:
        'Recorded single-variable fixture is unchanged (delta 0); no live-model attribution.',
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
      reason: 'Expected improved; observed unchanged.',
    }
  );
});
