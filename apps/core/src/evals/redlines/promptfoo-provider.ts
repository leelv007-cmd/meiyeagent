import {
  evalCaseResultSchema,
  type EvalCaseResult,
} from '@meiye/contracts';

import {
  validateHarnessPolicy,
  type HarnessPolicyInput,
  type HarnessPolicyResult,
} from '../../p1/harness/policy-gates.js';
import type { RedlineCase } from './cases.js';
import { RECORDED_GATE_REASONS } from './recorded-gate-reasons.js';

export const REDLINE_PROMPT_REVISION = 'redline-prompts-v2';
export const REDLINE_SCORER_REVISION = 'visible-copy-redlines-v2';

type HarnessValidator = (input: HarnessPolicyInput) => HarnessPolicyResult;
type EvaluatableRedlineCase = Pick<RedlineCase, 'description' | 'vars'>;

export function evaluateRedlineCase(
  redlineCase: EvaluatableRedlineCase,
  validator: HarnessValidator = validateHarnessPolicy,
): EvalCaseResult {
  const expectedGateId = redlineCase.vars.expectedGateId;
  let policy: HarnessPolicyResult;
  try {
    policy = validator(structuredClone(redlineCase.vars.input));
  } catch (error) {
    return failedResult(
      redlineCase,
      null,
      `Canonical validator threw: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const observed = policy.failures[0];
  const expectedReason =
    redlineCase.vars.expectedReason ?? RECORDED_GATE_REASONS[expectedGateId];
  const stable =
    !policy.passed &&
    policy.failures.length === 1 &&
    observed?.gateId === expectedGateId &&
    observed.reason === expectedReason;

  if (!stable) {
    return failedResult(
      redlineCase,
      observed?.gateId ?? null,
      `Recorded case expected ${expectedGateId}/${expectedReason}; observed ${
        observed ? `${observed.gateId}/${observed.reason}` : 'no gate failure'
      }.`,
    );
  }
  return evalCaseResultSchema.parse({
    caseId: redlineCase.vars.caseId,
    gateId: observed.gateId,
    promptRevision: REDLINE_PROMPT_REVISION,
    scorerRevision: REDLINE_SCORER_REVISION,
    passed: true,
    reason: observed.reason,
    memoryDiff: null,
  });
}

interface PromptfooContext {
  vars?: RedlineCase['vars'];
}

interface PromptfooProviderResponse {
  output: string;
  error?: string;
  metadata: { evalResult: EvalCaseResult };
}

export default class RedlinePromptfooProvider {
  id() {
    return 'meiye:canonical-harness-redlines';
  }

  async callApi(
    _prompt: string,
    context?: PromptfooContext,
  ): Promise<PromptfooProviderResponse> {
    if (!context?.vars) {
      throw new Error('Promptfoo redline case vars are required.');
    }
    const result = evaluateRedlineCase({
      description: context.vars.caseId,
      vars: context.vars,
    });
    const output = JSON.stringify({
      caseId: result.caseId,
      gateId: result.gateId,
      passed: result.passed,
      reason: result.reason,
    });
    return {
      output,
      ...(result.passed ? {} : { error: result.reason }),
      metadata: { evalResult: result },
    };
  }
}

function failedResult(
  redlineCase: EvaluatableRedlineCase,
  gateId: EvalCaseResult['gateId'],
  reason: string,
) {
  return evalCaseResultSchema.parse({
    caseId: redlineCase.vars.caseId,
    gateId,
    promptRevision: REDLINE_PROMPT_REVISION,
    scorerRevision: REDLINE_SCORER_REVISION,
    passed: false,
    reason,
    memoryDiff: null,
  });
}
