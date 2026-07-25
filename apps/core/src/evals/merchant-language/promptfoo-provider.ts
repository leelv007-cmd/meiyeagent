import { merchantVisibleLanguageIssues } from '../../p1/harness/merchant-delivery-language.js';
import type { MerchantLanguageCase } from './cases.js';

type MerchantLanguageVars = MerchantLanguageCase['vars'];
type MerchantLanguagePromptfooVars = Omit<
  MerchantLanguageVars,
  'requiredFragments'
> & {
  requiredFragments: string | string[];
};

export function evaluateMerchantLanguageCase(
  vars: MerchantLanguagePromptfooVars,
) {
  const requiredFragments = Array.isArray(vars.requiredFragments)
    ? vars.requiredFragments
    : [vars.requiredFragments];
  const forbiddenTerms = merchantVisibleLanguageIssues(vars.message);
  const missingFragments = requiredFragments.filter(
    (fragment) => !vars.message.includes(fragment),
  );
  const passed = forbiddenTerms.length === 0 && missingFragments.length === 0;
  return {
    caseId: vars.caseId,
    forbiddenTerms,
    missingFragments,
    passed,
  };
}

export default class MerchantLanguagePromptfooProvider {
  id() {
    return 'meiye:merchant-delivery-language';
  }

  async callApi(
    _prompt: string,
    context?: { vars?: MerchantLanguagePromptfooVars },
  ) {
    if (!context?.vars) {
      throw new Error('Promptfoo merchant-language case vars are required.');
    }
    const result = evaluateMerchantLanguageCase(context.vars);
    return {
      output: JSON.stringify(result),
      ...(result.passed
        ? {}
        : {
            error: [
              ...result.forbiddenTerms,
              ...result.missingFragments.map(
                (fragment) => `missing ${fragment}`,
              ),
            ].join(', '),
          }),
      metadata: { result },
    };
  }
}
