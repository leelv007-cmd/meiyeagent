import {
  FACT_SATISFACTION_CASES,
  type FactSatisfactionPromptfooCase,
} from './cases.js';

const satisfiedCase = FACT_SATISFACTION_CASES.find(
  ({ vars }) => vars.caseId === 'service-and-price-satisfied',
);
if (!satisfiedCase) {
  throw new Error('The fact-satisfaction assertion control source is missing.');
}

export const FACT_SATISFACTION_ASSERTION_CONTROL_CASE: FactSatisfactionPromptfooCase =
  {
    ...satisfiedCase,
    description:
      'Control: a valid satisfied model output must fail an intentionally wrong semantic expectation',
    vars: {
      ...satisfiedCase.vars,
      caseId: 'assertion-control-valid-wrong-outcome',
      expectedJson: JSON.stringify({
        ...JSON.parse(satisfiedCase.vars.expectedJson),
        caseId: 'assertion-control-valid-wrong-outcome',
        result: {
          status: 'unsatisfied',
          action: 'conservative_guidance',
          factRefs: [],
          missingFactTypes: ['service', 'price'],
          guidance: '缺少可授权、可核对的当前事实，请先补充或确认资料。',
        },
      }),
    },
  };

export default [FACT_SATISFACTION_ASSERTION_CONTROL_CASE];
