import assert from 'node:assert/strict';
import test from 'node:test';

import {
  merchantAssetRightsSoftPrompt,
  merchantBriefFallbackNotice,
  merchantConfirmedMaterialsContinuationNotice,
  merchantConfirmationQuestion,
  merchantContentSourceBlocked,
  merchantDeliveryConflict,
  merchantExactTextMismatch,
  merchantFailureReport,
  merchantGenericModeNotice,
  merchantImageGenerationFailure,
  merchantNotePartialConsistency,
  merchantNotePartialPageMarker,
  merchantPartialDeliveryReport,
  merchantIdentityVoiceNotice,
  merchantNeutralIndustryContinuationNotice,
  merchantNoteProgressMessage,
  merchantNoteSelectionReason,
  merchantNoteStyleQuestion,
  merchantNoteStyleUnavailable,
  merchantParseDisclosure,
  merchantParseFallback,
  merchantParseProgress,
  merchantParseTaskFailed,
  merchantPartialFailure,
  merchantProgressMessage,
  merchantSelectionWhyNow,
  merchantSensitiveDocumentFallback,
  merchantTaskSummary,
  merchantVideoGenerationFailure,
  merchantVideoPartialScenes,
  merchantVisibleLanguageIssues,
} from './merchant-delivery-language.js';

test('five merchant-facing positions stay free of engineering language', () => {
  const messages = [
    merchantProgressMessage('intent_naming'),
    merchantProgressMessage('context_injection'),
    merchantProgressMessage('brief_compilation'),
    merchantProgressMessage('execution_selection'),
    merchantSelectionWhyNow(),
    merchantIdentityVoiceNotice(),
    merchantGenericModeNotice(),
    merchantConfirmedMaterialsContinuationNotice(),
    merchantNeutralIndustryContinuationNotice(),
    merchantConfirmationQuestion('这次更想突出项目效果还是到店体验？'),
    merchantNoteStyleQuestion().question,
    merchantNoteStyleQuestion().responseReason,
    merchantNoteProgressMessage('styles_ready'),
    merchantNoteProgressMessage('style_selected'),
    merchantNoteProgressMessage('consistency_checked'),
    merchantNoteSelectionReason(true),
    merchantNoteSelectionReason(false),
    merchantTaskSummary({
      revision: 3,
      strategyBasis: '结合周末到店场景与本店已确认资料',
      versionPositioning: '这是本次最适合直接发布的主版本',
      useSuggestion: '建议周五傍晚发布，并配一张真实门店图',
    }),
    merchantPartialFailure({
      completed: '文案已经准备好',
      failed: '配图暂时没有成功',
      nextStep: '可以先用自备图发布，稍后再补生成图片',
    }),
    merchantExactTextMismatch({
      expected: ['价格 398'],
      observed: ['价格 389'],
    }),
    merchantVideoGenerationFailure('failed'),
    merchantVideoGenerationFailure('timed_out'),
    merchantParseDisclosure(),
    merchantParseProgress({ completed: 2, total: 4 }),
    merchantParseFallback('failed'),
    merchantParseFallback('timeout'),
    merchantParseFallback('rate_limited'),
    merchantSensitiveDocumentFallback(),
    merchantParseTaskFailed(),
    merchantAssetRightsSoftPrompt(),
    merchantImageGenerationFailure('failed'),
    merchantImageGenerationFailure('timed_out'),
    merchantContentSourceBlocked(),
    merchantDeliveryConflict(),
    merchantBriefFallbackNotice(),
    merchantNotePartialConsistency(2),
  ];

  for (const message of messages) {
    assert.deepEqual(merchantVisibleLanguageIssues(message), []);
  }
});

test('every failure category reports merchant language and a way forward', () => {
  const failures: Array<Record<string, unknown>> = [
    { code: 'MEDIA_GENERATION_FAILED', quotaRefunded: true },
    {
      code: 'MEDIA_GENERATION_FAILED',
      merchantMessage: merchantVideoGenerationFailure('timed_out'),
      quotaRefunded: true,
    },
    {
      code: 'HARNESS_ALL_CANDIDATES_BLOCKED',
      gateIds: ['critical_fact_source'],
      quotaRefunded: true,
    },
    {
      code: 'HARNESS_ALL_CANDIDATES_BLOCKED',
      gateIds: ['image_exact_text'],
      merchantMessage: merchantExactTextMismatch({
        expected: ['价格 398'],
        observed: ['价格 389'],
      }),
      quotaRefunded: true,
    },
    { code: 'MEDIA_EXACT_TEXT_VERIFIER_UNAVAILABLE', quotaRefunded: true },
    { code: 'CONTENT_PACKAGE_REVISION_CONFLICT', quotaRefunded: true },
    { code: 'HARNESS_WORKFLOW_FAILED', quotaRefunded: true },
    {},
  ];

  const categories = new Set<string>();
  for (const failure of failures) {
    const report = merchantFailureReport(failure);
    categories.add(report.category);
    assert.equal(report.kind, 'failure');
    assert.ok(report.actions.length > 0, 'a failure must offer a way forward');
    assert.deepEqual(merchantVisibleLanguageIssues(report.message), []);
    assert.deepEqual(merchantVisibleLanguageIssues(report.nextStep), []);
  }
  assert.ok(categories.has('exact_text'));
  assert.ok(categories.has('content_source'));
  assert.ok(categories.has('media_generation'));
  assert.ok(categories.has('consistency'));
  assert.ok(categories.has('unknown'));
});

test('a failure only claims the quota came back when it actually did', () => {
  assert.equal(
    merchantFailureReport({
      code: 'MEDIA_GENERATION_FAILED',
      quotaRefunded: true,
    }).quotaRefunded,
    true,
  );
  assert.equal(
    merchantFailureReport({ code: 'MEDIA_GENERATION_FAILED' }).quotaRefunded,
    false,
  );
});

test('a partial delivery keeps the run honest instead of throwing it away', () => {
  const report = merchantPartialDeliveryReport({
    message: merchantNotePartialConsistency(2),
    nextStep: '可以先用已经对好的页面，稍后再让我重做那两页。',
  });

  assert.equal(report.kind, 'partial');
  assert.equal(report.quotaRefunded, false);
  assert.ok(report.actions.includes('review_partial'));
  assert.deepEqual(merchantVisibleLanguageIssues(report.message), []);
  assert.deepEqual(merchantVisibleLanguageIssues(report.nextStep), []);

  // The count alone leaves the merchant unable to tell which page to hold
  // back, so the marker rides on the delivered copy too — and it is merchant
  // language like everything else they read.
  const marker = merchantNotePartialPageMarker();
  assert.match(marker, /还没对上/u);
  assert.deepEqual(merchantVisibleLanguageIssues(marker), []);
});

test('a stalled work timeout speaks as a refundable failure, not a hang', () => {
  const report = merchantFailureReport({
    code: 'WORK_EXECUTION_STALLED',
    quotaRefunded: true,
  });
  assert.equal(report.kind, 'failure');
  assert.equal(report.quotaRefunded, true);
  assert.match(report.message, /超时/u);
  assert.match(report.nextStep, /重新发/u);
  assert.deepEqual(merchantVisibleLanguageIssues(report.message), []);
});

test('a lost orchestration reads as an honest failure with the refund and a way back', () => {
  // V31-105 §13 \u2460A: same terminal code as a stall so the existing report
  // card, shelf face and restart entry all apply, but the merchant must not be
  // told it timed out \u2014 the run's workflow was simply gone.
  const report = merchantFailureReport({
    code: 'WORK_EXECUTION_STALLED',
    reason: 'orchestration_lost',
    quotaRefunded: true,
    merchantMessage: '\u8fd9\u6b21\u521b\u4f5c\u6ca1\u80fd\u505a\u5b8c\uff0c\u79ef\u5206\u5df2\u7ecf\u9000\u56de\u3002',
  });

  assert.equal(report.kind, 'failure');
  assert.equal(report.quotaRefunded, true);
  assert.equal(report.message, '\u8fd9\u6b21\u521b\u4f5c\u6ca1\u80fd\u505a\u5b8c\uff0c\u79ef\u5206\u5df2\u7ecf\u9000\u56de\u3002');
  assert.doesNotMatch(report.message, /\u8d85\u65f6/u);
  assert.match(report.nextStep, /\u91cd\u65b0\u53d1/u);
  // The way back: adjust_intent is the action that thaws the frozen intent box.
  assert.deepEqual(report.actions, ['adjust_intent']);
  assert.deepEqual(merchantVisibleLanguageIssues(report.message), []);
  assert.deepEqual(merchantVisibleLanguageIssues(report.nextStep), []);
});

test('a prepare rejection reads as an honest failure with the refund and a way back', () => {
  const report = merchantFailureReport({
    code: 'WORK_EXECUTION_STALLED',
    reason: 'prepare_rejected',
    quotaRefunded: true,
    merchantMessage:
      '\u8fd9\u6b21\u521b\u4f5c\u6ca1\u80fd\u5f00\u59cb\uff0c\u8fd9\u6b21\u7684\u521b\u4f5c\u65b9\u6848\u65e0\u6cd5\u6309\u5f53\u524d\u8981\u6c42\u5f00\u59cb\u3002\u79ef\u5206\u5df2\u7ecf\u9000\u56de\u3002',
  });

  assert.equal(report.kind, 'failure');
  assert.equal(report.quotaRefunded, true);
  assert.equal(
    report.message,
    '\u8fd9\u6b21\u521b\u4f5c\u6ca1\u80fd\u5f00\u59cb\uff0c\u8fd9\u6b21\u7684\u521b\u4f5c\u65b9\u6848\u65e0\u6cd5\u6309\u5f53\u524d\u8981\u6c42\u5f00\u59cb\u3002\u79ef\u5206\u5df2\u7ecf\u9000\u56de\u3002',
  );
  assert.doesNotMatch(report.message, /\u8d85\u65f6/u);
  assert.match(report.nextStep, /\u91cd\u65b0\u53d1/u);
  assert.deepEqual(report.actions, ['adjust_intent']);
  assert.deepEqual(merchantVisibleLanguageIssues(report.message), []);
  assert.deepEqual(merchantVisibleLanguageIssues(report.nextStep), []);
});

test('an unavailable note style speaks to the merchant instead of dying in an error message', () => {
  const report = merchantFailureReport({
    code: 'HARNESS_MEDIA_SCOPE_INVALID',
    merchantMessage: merchantNoteStyleUnavailable(),
  });

  assert.equal(report.message, merchantNoteStyleUnavailable());
  assert.notEqual(report.category, 'unknown');
  assert.ok(report.actions.length > 0);
  assert.deepEqual(merchantVisibleLanguageIssues(report.nextStep), []);
});

test('video failure language offers safe retry and fallback choices', () => {
  const failed = merchantVideoGenerationFailure('failed');
  const timedOut = merchantVideoGenerationFailure('timed_out');

  assert.match(failed, /重新生成/u);
  assert.match(failed, /更换参考素材/u);
  assert.match(timedOut, /重新生成/u);
  assert.match(timedOut, /图片发布方案/u);
});

test('V31-36 video partial language names failed scenes without upstream terms', () => {
  const message = merchantVideoPartialScenes({
    deliveredUsable: 2,
    failedSceneLabels: ['3'],
  });
  assert.match(message, /已完成 2 个镜头/u);
  assert.match(message, /第 3 个镜头没有做成/u);
  assert.match(message, /只重做/u);
  assert.deepEqual(merchantVisibleLanguageIssues(message), []);
});

test('missing identity reminder stays conversational and non-blocking', () => {
  const notice = merchantIdentityVoiceNotice();

  assert.match(notice, /这次先用门店官方口吻生成/u);
  assert.match(notice, /直接在对话里告诉我/u);
  assert.doesNotMatch(notice, /填写|表单|必须|请选择创作类型/u);
});

test('task summary positively carries strategy, version guidance and usage advice', () => {
  const summary = merchantTaskSummary({
    revision: 2,
    strategyBasis: '结合换季需求和本店护理特色',
    versionPositioning: '主版本适合小红书种草',
    useSuggestion: '搭配一张护理前沟通场景图',
  });

  assert.match(summary, /策略依据：结合换季需求和本店护理特色/u);
  assert.match(summary, /版本定位：主版本适合小红书种草/u);
  assert.match(summary, /使用建议：搭配一张护理前沟通场景图/u);
  assert.match(summary, /第 2 版/u);
});

test('language check catches internal ids, providers and transport codes', () => {
  const issues = merchantVisibleLanguageIssues(
    'workspace id ws-1 的 DeepSeek provider 返回 HTTP 502',
  );

  assert.deepEqual(issues, [
    'workspace id',
    'provider',
    'DeepSeek',
    'HTTP code',
  ]);
});

test('parse disclosure and rights reminder are soft prompts, not gates', () => {
  assert.match(merchantParseDisclosure(), /可以随时跳过/u);
  assert.match(merchantAssetRightsSoftPrompt(), /不影响继续/u);
  assert.deepEqual(
    merchantVisibleLanguageIssues(
      `${merchantParseDisclosure()} ${merchantAssetRightsSoftPrompt()}`,
    ),
    [],
  );
  assert.deepEqual(
    merchantVisibleLanguageIssues(
      'MinerU parse pipeline returned a candidate schema.',
    ),
    ['candidate', 'schema', 'MinerU', 'parse', 'pipeline'],
  );
});

test('sensitive documents and stopped batches explain the honest next step', () => {
  assert.match(merchantSensitiveDocumentFallback(), /不会交给外部服务/u);
  assert.doesNotMatch(merchantSensitiveDocumentFallback(), /失败|没有整理成功/u);
  assert.match(merchantParseTaskFailed(), /已经停止/u);
  assert.match(merchantParseTaskFailed(), /手动填写/u);
  assert.deepEqual(
    merchantVisibleLanguageIssues(
      `${merchantSensitiveDocumentFallback()} ${merchantParseTaskFailed()}`,
    ),
    [],
  );
});

test('generic mode notice names the user benefit without internal routing terms', () => {
  const notice = merchantGenericModeNotice();

  assert.equal(
    notice,
    '这次先按通用模式生成；以后补充门店、项目或风格资料，内容会更像你的店。',
  );
  assert.deepEqual(merchantVisibleLanguageIssues(notice), []);
});

test('industry continuation notices reflect whether confirmed materials are used', () => {
  assert.equal(
    merchantConfirmedMaterialsContinuationNotice(),
    '这次会参考你已确认的资料，直接继续生成。',
  );
  assert.equal(
    merchantNeutralIndustryContinuationNotice(),
    '这次先按通用方式继续生成，不需要补充行业信息。',
  );
  assert.deepEqual(
    merchantVisibleLanguageIssues(
      `${merchantConfirmedMaterialsContinuationNotice()} ${merchantNeutralIndustryContinuationNotice()}`,
    ),
    [],
  );
});
