import type {
  AskMerchantQuestionRequest,
  QuestionCard,
} from '@meiye/contracts';

import { fingerprintValue } from '../job-runtime/job-contracts.js';

export const ASK_MERCHANT_SEMANTIC_DEFAULT_POLICY_REVISION =
  'ask-semantic-default/v1';

export function askMerchantSemanticDefaultConditionRevision(
  requestId: string,
  revision: number,
) {
  return `${requestId}:r${revision}`;
}

export function buildAskMerchantSemanticDefaultTimeoutPolicy(
  question: QuestionCard,
  timeoutSeconds: number | null,
): AskMerchantQuestionRequest['timeoutPolicy'] {
  if (
    timeoutSeconds === null ||
    question.unattended !== 'continue' ||
    question.semanticDefaultAuthority?.kind !== 'non_resource_no_effect' ||
    question.semanticDefaultAuthority.source !== 'intent_gap' ||
    question.semanticDefaultAuthority.revision !== 'intent-gap/v1'
  ) {
    return {
      kind: 'hold',
      reason: 'unknown',
      serverEvaluated: true,
    };
  }
  const defaultResponse = {
    kind: 'answer' as const,
    items: [
      {
        itemId: question.response.field,
        result: { kind: 'deferred' as const },
      },
    ],
  };
  return {
    kind: 'semantic_default',
    timeoutSeconds,
    eligibility: {
      kind: 'safe',
      serverEvaluated: true,
      effect: 'none',
      quota: 'not_applicable',
      defaultResponse,
      defaultResponseFingerprint: fingerprintValue(defaultResponse),
      policyRevision: ASK_MERCHANT_SEMANTIC_DEFAULT_POLICY_REVISION,
      conditionRevision: askMerchantSemanticDefaultConditionRevision(
        question.questionId,
        question.workflowRevision,
      ),
    },
  };
}

export function isCurrentAskMerchantSemanticDefault(
  request: AskMerchantQuestionRequest,
) {
  const policy = request.timeoutPolicy;
  return (
    policy?.kind === 'semantic_default' &&
    policy.eligibility.policyRevision ===
      ASK_MERCHANT_SEMANTIC_DEFAULT_POLICY_REVISION &&
    policy.eligibility.conditionRevision ===
      askMerchantSemanticDefaultConditionRevision(
        request.requestId,
        request.revision,
      ) &&
    fingerprintValue(policy.eligibility.defaultResponse) ===
      policy.eligibility.defaultResponseFingerprint
  );
}
