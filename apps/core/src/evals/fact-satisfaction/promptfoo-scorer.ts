import { isDeepStrictEqual } from 'node:util';

import type { FactSatisfactionPromptfooVars } from './cases.js';

interface PromptfooAssertionContext {
  vars?: FactSatisfactionPromptfooVars;
}

export function scoreFactSatisfactionOutput(
  output: string,
  context?: PromptfooAssertionContext,
) {
  if (!context?.vars) {
    return {
      pass: false,
      score: 0,
      reason: 'Fact-satisfaction scorer requires the frozen case vars.',
    };
  }
  let observed: unknown;
  try {
    observed = JSON.parse(output);
  } catch {
    return {
      pass: false,
      score: 0,
      reason: 'Fact-satisfaction provider output must be valid JSON.',
    };
  }
  let expected: unknown;
  try {
    expected = JSON.parse(context.vars.expectedJson);
  } catch {
    return {
      pass: false,
      score: 0,
      reason: 'Fact-satisfaction frozen expectation must be valid JSON.',
    };
  }
  if (isDeepStrictEqual(observed, expected)) {
    return {
      pass: true,
      score: 1,
      reason: 'Observed production-seam semantics match the frozen case.',
    };
  }
  return {
    pass: false,
    score: 0,
    reason:
      'Observed production-seam semantics differ from the frozen expected result.',
  };
}

export default scoreFactSatisfactionOutput;
