import {
  askMerchantQuestionRequestSchema,
  type AskMerchantQuestionRequest,
} from '@meiye/contracts';

import type { MerchantQuestionRequestPort } from './ask-merchant-handler.js';

export interface HarnessInteractionRequestRegistrar {
  register(
    workspaceId: string,
    request: AskMerchantQuestionRequest,
  ): Promise<void>;
}

export class HarnessQuestionRequestPort
  implements MerchantQuestionRequestPort
{
  constructor(
    private readonly interactions: HarnessInteractionRequestRegistrar,
  ) {}

  async request(
    input: Parameters<MerchantQuestionRequestPort['request']>[0],
  ): Promise<{ requestRef: string }> {
    const harness = input.serverContext.harness;
    if (!harness) {
      throw new Error('Canonical Harness question context is required.');
    }
    const canonicalOptions = harness.question.options.map(
      ({ description, label }) => ({ description, label }),
    );
    const modelOptions = input.options ?? [];
    const optionsMatch =
      modelOptions.length === canonicalOptions.length &&
      modelOptions.every(
        (option, index) =>
          option.label === canonicalOptions[index]?.label &&
          option.description === canonicalOptions[index]?.description,
      );
    if (input.question !== harness.question.question || !optionsMatch) {
      throw new Error(
        'Model question does not match the canonical Harness QuestionCard.',
      );
    }
    await this.interactions.register(
      input.serverContext.workspaceId,
      askMerchantQuestionRequestSchema.parse({
        requestId: harness.question.questionId,
        runId: harness.question.workflowId,
        step: harness.stage,
        revision: harness.question.workflowRevision,
        kind: 'ask_merchant',
        questions: [
          {
            itemId: harness.question.response.field,
            question: harness.question.question,
            ...(canonicalOptions.length > 0
              ? { options: canonicalOptions }
              : {}),
            fallback: { kind: 'deferred' },
          },
        ],
        groupSkip: true,
        timeoutPolicy: {
          kind: 'hold',
          reason: 'unknown',
          serverEvaluated: true,
        },
        presentation: {
          carriers: ['conversation', 'store_page'],
          blocking: 'none',
          notification: 'none',
          renderer: 'ask_merchant_group',
        },
      }),
    );
    return { requestRef: harness.question.questionId };
  }
}
