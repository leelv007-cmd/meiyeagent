import {
  askMerchantAnswerSchema,
  type AskMerchantAnswer,
  type AskMerchantQuestionRequest,
} from '@meiye/contracts';
import { askMerchantSemanticDefaultConditionRevision } from './ask-merchant-timeout-authority.js';

export type AskMerchantResolution =
  | {
      kind: 'resume';
      runId: string;
      step: string;
      resumeData: AskMerchantAnswer['response'];
    }
  | {
      kind: 'reask';
      request: AskMerchantQuestionRequest;
    }
  | {
      kind: 'stale';
    };

export function resolveAskMerchantAnswer(
  request: AskMerchantQuestionRequest,
  input: unknown,
): AskMerchantResolution {
  const parsed = askMerchantAnswerSchema.safeParse(input);
  if (!parsed.success) return reask(request);
  const answer = parsed.data;
  if (
    answer.requestId !== request.requestId ||
    answer.revision !== request.revision ||
    answer.resume.runId !== request.runId ||
    answer.resume.step !== request.step
  ) {
    return { kind: 'stale' };
  }
  if (answer.response.kind === 'skipped') {
    return {
      kind: 'resume',
      runId: request.runId,
      step: request.step,
      resumeData: answer.response,
    };
  }

  if (answer.response.items.length !== request.questions.length) {
    return reask(request);
  }
  const answers = new Map(
    answer.response.items.map((item) => [item.itemId, item]),
  );
  if (answers.size !== request.questions.length) {
    return reask(request);
  }
  for (const question of request.questions) {
    const item = answers.get(question.itemId);
    if (!item) return reask(request);
    const result = item.result;
    if (
      result.kind === 'answer' &&
      question.options &&
      !question.options.some((option) => option.label === result.value)
    ) {
      return reask(request);
    }
  }

  return {
    kind: 'resume',
    runId: request.runId,
    step: request.step,
    resumeData: answer.response,
  };
}

function reask(
  request: AskMerchantQuestionRequest,
): Extract<AskMerchantResolution, { kind: 'reask' }> {
  const revision = request.revision + 1;
  return {
    kind: 'reask',
    request: {
      ...request,
      revision,
      ...(request.timeoutPolicy?.kind === 'semantic_default'
        ? {
            timeoutPolicy: {
              ...request.timeoutPolicy,
              eligibility: {
                ...request.timeoutPolicy.eligibility,
                conditionRevision:
                  askMerchantSemanticDefaultConditionRevision(
                    request.requestId,
                    revision,
                  ),
              },
            },
          }
        : {}),
    },
  };
}
