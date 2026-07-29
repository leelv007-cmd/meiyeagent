import type { MerchantQuestionRequestPort } from './ask-merchant-handler.js';

export class HarnessQuestionRequestPort
  implements MerchantQuestionRequestPort
{
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
    return { requestRef: harness.question.questionId };
  }
}
