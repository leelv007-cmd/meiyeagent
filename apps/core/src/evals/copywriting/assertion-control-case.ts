import { COPYWRITING_CASES, type CopywritingPromptfooCase } from './cases.js';

const source = COPYWRITING_CASES[0];
if (!source) throw new Error('The copywriting assertion control is missing.');

export const COPYWRITING_ASSERTION_CONTROL_CASE: CopywritingPromptfooCase = {
  ...source,
  description:
    'Control: an improved paired output must fail an intentionally wrong unchanged expectation',
  vars: {
    ...source.vars,
    caseId: 'assertion-control-wrong-copywriting-conclusion',
    expectedConclusion: 'unchanged',
  },
};

export default [COPYWRITING_ASSERTION_CONTROL_CASE];
