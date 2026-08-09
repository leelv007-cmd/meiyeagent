import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { CREDIT_PLAN_CONFIG_KEYS as CONTRACT_CREDIT_PLAN_CONFIG_KEYS } from '@meiye/contracts';

import {
  AdminPlanControl,
  CREDIT_PLAN_CONFIG_KEYS,
  hasCreditBoosterUnitPriceWarning,
  PLAN_CONTROL_CONFIG_KEYS,
} from './admin-plan-control';
import { p1QueryKeys } from './query-keys';

const publishedCreditConfigs = [
  {
    effectiveValue: {
      credits: 500,
      monthlyPriceMicros: 231_183_288,
    },
    key: 'plan.credits.starter',
    storedValue: {
      credits: 500,
      monthlyPriceMicros: 231_183_288,
    },
  },
  {
    effectiveValue: {
      credits: 1_300,
      monthlyPriceMicros: 579_700_809,
    },
    key: 'plan.credits.growth',
    storedValue: {
      credits: 1_300,
      monthlyPriceMicros: 579_700_809,
    },
  },
  {
    effectiveValue: {
      credits: 2_800,
      monthlyPriceMicros: 1_044_390_836,
    },
    key: 'plan.credits.pro',
    storedValue: {
      credits: 2_800,
      monthlyPriceMicros: 1_044_390_836,
    },
  },
  {
    effectiveValue: [
      { amountMicros: 57_000_000, credits: 100 },
      { amountMicros: 161_000_000, credits: 300 },
      { amountMicros: 498_000_000, credits: 1_000 },
    ],
    key: 'plan.credits.addons',
    storedValue: [
      { amountMicros: 57_000_000, credits: 100 },
      { amountMicros: 161_000_000, credits: 300 },
      { amountMicros: 498_000_000, credits: 1_000 },
    ],
  },
];

test('credit-plan config keys are a single contracts source including reference_numbers', () => {
  // Spec G / #390: no handwritten shell/core copies — contracts is authority.
  assert.equal(CREDIT_PLAN_CONFIG_KEYS, CONTRACT_CREDIT_PLAN_CONFIG_KEYS);
  assert.deepEqual(
    [...CREDIT_PLAN_CONFIG_KEYS],
    [
      'plan.credits.trial',
      'plan.credits.starter',
      'plan.credits.growth',
      'plan.credits.pro',
      'plan.credits.addons',
      'plan.credits.cycle_coefficients',
      'plan.credits.reference_numbers',
      'plan.credits.trial.enabled',
    ]
  );
  assert.ok(
    PLAN_CONTROL_CONFIG_KEYS.includes('plan.credits.reference_numbers'),
    'reference_numbers must appear in the plans runtime config key list'
  );
});

test('uses versioned credit-plan keys, preserves existing controls, and keeps the booster reminder non-blocking', () => {
  assert.equal(
    PLAN_CONTROL_CONFIG_KEYS.includes(
      'harness.confirmation_card.hold_timeout_seconds'
    ),
    true
  );
  assert.equal(PLAN_CONTROL_CONFIG_KEYS.includes('plan.payment-mapping'), true);
  assert.equal(hasCreditBoosterUnitPriceWarning(publishedCreditConfigs), false);
  assert.equal(
    hasCreditBoosterUnitPriceWarning([
      ...publishedCreditConfigs.slice(0, 3),
      {
        effectiveValue: [{ amountMicros: 39_800_000, credits: 100 }],
        key: 'plan.credits.addons',
        storedValue: [{ amountMicros: 39_800_000, credits: 100 }],
      },
    ]),
    true
  );

  const queryClient = new QueryClient();
  queryClient.setQueryData(p1QueryKeys.request('admin-config', 'config_list'), [
    ...publishedCreditConfigs,
    {
      effectiveValue: {
        published: {
          growth: { copy: 1_300, image: 260, video: 26 },
          pro: { copy: 2_800, image: 560, video: 56 },
          starter: { copy: 500, image: 100, video: 10 },
          trial: { copy: 100, image: 20, video: 2 },
        },
        referenceModels: {
          copy: 'deepseek-v4-pro',
          image: 'seedream-5-pro',
          video: 'seedance-2',
        },
      },
      key: 'plan.credits.reference_numbers',
      storedValue: null,
    },
  ]);
  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminPlanControl />
    </QueryClientProvider>
  );

  assert.match(html, /积分套餐与加油包/u);
  assert.match(html, /这是可见提醒，不阻止保存或发布/u);
  assert.match(html, /plan\.credits\.starter/u);
  // Spec G / #390: reference_numbers must appear in the plans runtime config table.
  assert.match(html, /plan\.credits\.reference_numbers/u);
});
