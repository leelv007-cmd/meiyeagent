import type { RedlineCase } from './cases.js';

interface PromptfooContext {
  vars?: RedlineCase['vars'];
}

export default class FalseWithoutErrorPromptfooProvider {
  id() {
    return 'meiye:assertion-control-false-without-provider-error';
  }

  async callApi(_prompt: string, context?: PromptfooContext) {
    if (!context?.vars) {
      throw new Error('Promptfoo redline case vars are required.');
    }
    return {
      output: JSON.stringify({
        caseId: context.vars.caseId,
        gateId: context.vars.expectedGateId,
        passed: false,
        reason: 'Assertion control intentionally failed.',
      }),
    };
  }
}
