import {
  merchantConfirmationQuestion,
  merchantPartialFailure,
  merchantProgressMessage,
  merchantTaskSummary,
} from '../../p1/harness/merchant-delivery-language.js';

export interface MerchantLanguageCase {
  description: string;
  assert: Array<{ type: 'javascript'; value: string }>;
  vars: {
    caseId: string;
    message: string;
    requiredFragments: string[];
  };
}

function merchantCase(
  caseId: string,
  description: string,
  message: string,
  requiredFragments: string[] = [],
): MerchantLanguageCase {
  return {
    description,
    assert: [
      {
        type: 'javascript',
        value: 'JSON.parse(output).passed === true',
      },
    ],
    vars: { caseId, message, requiredFragments },
  };
}

export const MERCHANT_LANGUAGE_CASES: MerchantLanguageCase[] = [
  merchantCase(
    'stage-announcement',
    'Stage announcements use merchant language',
    merchantProgressMessage('intent_naming'),
  ),
  merchantCase(
    'progress-event',
    'Progress events describe useful work instead of internals',
    merchantProgressMessage('brief_compilation'),
  ),
  merchantCase(
    'confirmation-card',
    'Confirmation cards ask a natural merchant question',
    merchantConfirmationQuestion('这次更想突出项目效果还是到店体验？'),
  ),
  merchantCase(
    'task-summary',
    'Task summaries include strategy, version guidance, and usage advice',
    merchantTaskSummary({
      revision: 2,
      strategyBasis: '结合换季需求和本店护理特色',
      versionPositioning: '主版本适合小红书种草',
      useSuggestion: '搭配一张护理前沟通场景图',
    }),
    ['策略依据：', '版本定位：', '使用建议：'],
  ),
  merchantCase(
    'partial-failure',
    'Partial failures say what is ready and what to do next',
    merchantPartialFailure({
      completed: '文案已经准备好',
      failed: '配图暂时没有成功',
      nextStep: '可以先用自备图发布，稍后再补生成图片',
    }),
  ),
];

export default MERCHANT_LANGUAGE_CASES;
