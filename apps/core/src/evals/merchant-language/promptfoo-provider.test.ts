import assert from 'node:assert/strict';
import test from 'node:test';

import { MERCHANT_LANGUAGE_CASES } from './cases.js';
import MerchantLanguagePromptfooProvider, {
  evaluateMerchantLanguageCase,
} from './promptfoo-provider.js';

test('promptfoo merchant-language cases cover all five customer-facing positions', () => {
  assert.deepEqual(
    MERCHANT_LANGUAGE_CASES.map(({ vars }) => vars.caseId),
    [
      'stage-announcement',
      'progress-event',
      'confirmation-card',
      'task-summary',
      'partial-failure',
    ],
  );
  for (const languageCase of MERCHANT_LANGUAGE_CASES) {
    assert.deepEqual(evaluateMerchantLanguageCase(languageCase.vars), {
      caseId: languageCase.vars.caseId,
      forbiddenTerms: [],
      missingFragments: [],
      passed: true,
    });
  }
});

test('promptfoo language gate rejects engineering terms and incomplete summaries', async () => {
  const provider = new MerchantLanguagePromptfooProvider();
  const response = await provider.callApi('merchant language', {
    vars: {
      caseId: 'bad-summary',
      message: 'workspace id ws-1 的 provider 返回 HTTP 503',
      requiredFragments: ['策略依据：', '版本定位：', '使用建议：'],
    },
  });

  assert.ok(response.error);
  assert.deepEqual(JSON.parse(response.output), {
    caseId: 'bad-summary',
    forbiddenTerms: ['workspace id', 'provider', 'HTTP code'],
    missingFragments: ['策略依据：', '版本定位：', '使用建议：'],
    passed: false,
  });
});

test('promptfoo language gate accepts one expanded required fragment', () => {
  assert.deepEqual(
    evaluateMerchantLanguageCase({
      caseId: 'expanded-task-summary',
      message: '版本定位：主版本适合小红书种草',
      requiredFragments: '版本定位：',
    }),
    {
      caseId: 'expanded-task-summary',
      forbiddenTerms: [],
      missingFragments: [],
      passed: true,
    },
  );
});
