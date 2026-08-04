import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { merchantCreditDetailSchema } from '@meiye/contracts';
import {
  creditDetailBilling,
  expiredUncreditedRefund,
} from './merchant-credit-detail';

test('keeps the backend billing contract and makes an expired refund explicit', () => {
  const detail = merchantCreditDetailSchema.parse({
    billing: {
      creditsThisPeriod: 1_300,
      interval: 'monthly',
      periodEndsAt: '2026-09-01T00:00:00.000Z',
      tier: 'growth',
    },
    batches: [],
    transactions: [
      {
        batchNumber: 2,
        credits: 20,
        creditedAmount: 0,
        operation: 'creation',
        occurredAt: '2026-08-03T00:00:00.000Z',
        refundDisposition: 'expired_uncredited',
        status: 'refunded',
        type: 'refund',
      },
    ],
  });

  assert.deepEqual(creditDetailBilling(detail), detail.billing);
  assert.deepEqual(expiredUncreditedRefund(detail.transactions[0]!), {
    credits: 20,
  });
});

test('does not claim a normal refund was lost after a batch expired', () => {
  const detail = merchantCreditDetailSchema.parse({
    billing: null,
    batches: [],
    transactions: [
      {
        batchNumber: 1,
        credits: 20,
        creditedAmount: 20,
        operation: 'creation',
        occurredAt: '2026-08-03T00:00:00.000Z',
        refundDisposition: 'credited',
        status: 'refunded',
        type: 'refund',
      },
    ],
  });

  assert.equal(expiredUncreditedRefund(detail.transactions[0]!), null);
});

test('settings exposes details and billing through the merchant credit contract', () => {
  const panel = readFileSync(
    new URL('./merchant-credit-detail-panel.tsx', import.meta.url),
    'utf8'
  );
  const billingCard = readFileSync(
    new URL('../components/settings/billing/billing-card.tsx', import.meta.url),
    'utf8'
  );
  const creditDetailQuery = readFileSync(
    new URL('./use-merchant-credit-detail.ts', import.meta.url),
    'utf8'
  );
  const accountRoute = readFileSync(
    new URL('../routes/settings/account.tsx', import.meta.url),
    'utf8'
  );
  const messages = JSON.parse(
    readFileSync(
      new URL('../../project.inlang/messages/zh.json', import.meta.url),
      'utf8'
    )
  ) as Record<string, string>;
  const englishMessages = JSON.parse(
    readFileSync(
      new URL('../../project.inlang/messages/en.json', import.meta.url),
      'utf8'
    )
  ) as Record<string, string>;
  const catalog = readFileSync(
    new URL('../../tests/e2e/TEST-CATALOG.md', import.meta.url),
    'utf8'
  );

  assert.match(creditDetailQuery, /queryP1<MerchantCreditDetail>/u);
  assert.match(creditDetailQuery, /action: 'credit_detail'/u);
  for (const source of [panel, billingCard]) {
    assert.match(source, /useMerchantCreditDetail/u);
  }
  assert.doesNotMatch(billingCard, /useCurrentPlan|authClient/u);
  assert.match(billingCard, /CustomerPortalButton/u);
  assert.match(billingCard, /credit_billing_renew/u);
  assert.match(billingCard, /Routes\.Pricing/u);
  assert.match(billingCard, /credit_billing_upgrade/u);
  assert.match(accountRoute, /id="credits"/u);
  assert.match(accountRoute, /MerchantCreditDetailPanel/u);
  assert.doesNotMatch(accountRoute, /AccountUsagePanel|id="usage"/u);
  assert.equal(
    messages.credit_detail_refund_expired_uncredited,
    '已退回 {count} 分（批次已过期，未入账）'
  );
  assert.equal(
    messages.credit_billing_no_active_subscription,
    '当前周期积分暂不可用；你仍可查看积分来源和使用记录。'
  );
  const creditVocabularyKeys = [
    'workbench_quote_usage_copy',
    'workbench_quote_usage_image',
    'workbench_quote_usage_video',
    'account_usage_copy',
    'account_usage_image',
    'account_usage_video',
    'account_usage_audio',
    'account_usage_allowance',
    'account_usage_terms_explanation',
    'account_usage_description',
    'account_usage_title',
    'pricing_output_copy_count',
    'pricing_output_image_count',
    'pricing_output_video_count',
    'pricing_output_copy_label',
    'pricing_output_image_label',
    'pricing_output_video_label',
    'pricing_output_heading',
    'pricing_output_description',
    'admin_plan_copy_quantity',
    'admin_plan_image_quantity',
    'admin_plan_video_quantity',
    'admin_plan_audio_quantity',
    'admin_plan_catalog_description',
    'admin_plan_copy',
    'admin_plan_image',
    'admin_plan_video',
    'admin_plan_audio',
  ];
  // #291 §2.4 enumerates 28 keys although #306's issue text says 27.
  assert.equal(creditVocabularyKeys.length, 28);
  for (const key of creditVocabularyKeys) {
    assert.equal(typeof messages[key], 'string', `missing zh key ${key}`);
    assert.equal(
      typeof englishMessages[key],
      'string',
      `missing en key ${key}`
    );
    assert.doesNotMatch(messages[key], /额度|条|张|段|产出/u, key);
  }
  assert.match(messages.admin_plan_trial_description, /试用积分/u);
  assert.match(messages.admin_plan_trial_enabled, /试用积分/u);
  assert.match(englishMessages.admin_plan_trial_description, /trial credit/u);
  assert.match(englishMessages.admin_plan_trial_enabled, /trial credits/iu);
  assert.match(
    catalog,
    /Merchant credit billing and details stay merchant-safe/u
  );
});
