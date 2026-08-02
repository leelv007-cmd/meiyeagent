import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';

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
      monthlyPriceMicros: 199_000_000,
    },
    key: 'plan.credits.starter',
    storedValue: {
      credits: 500,
      monthlyPriceMicros: 199_000_000,
    },
  },
  {
    effectiveValue: {
      credits: 1_300,
      monthlyPriceMicros: 499_000_000,
    },
    key: 'plan.credits.growth',
    storedValue: {
      credits: 1_300,
      monthlyPriceMicros: 499_000_000,
    },
  },
  {
    effectiveValue: {
      credits: 2_800,
      monthlyPriceMicros: 899_000_000,
    },
    key: 'plan.credits.pro',
    storedValue: {
      credits: 2_800,
      monthlyPriceMicros: 899_000_000,
    },
  },
  {
    effectiveValue: [
      { amountMicros: 49_000_000, credits: 100 },
      { amountMicros: 139_000_000, credits: 300 },
      { amountMicros: 429_000_000, credits: 1_000 },
    ],
    key: 'plan.credits.addons',
    storedValue: [
      { amountMicros: 49_000_000, credits: 100 },
      { amountMicros: 139_000_000, credits: 300 },
      { amountMicros: 429_000_000, credits: 1_000 },
    ],
  },
];

test('uses versioned credit-plan keys, preserves existing controls, and keeps the booster reminder non-blocking', () => {
  assert.deepEqual(CREDIT_PLAN_CONFIG_KEYS, [
    'plan.credits.trial',
    'plan.credits.starter',
    'plan.credits.growth',
    'plan.credits.pro',
    'plan.credits.addons',
    'plan.credits.cycle_coefficients',
    'plan.credits.trial.enabled',
  ]);
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
  queryClient.setQueryData(
    p1QueryKeys.request('admin-config', 'config_list'),
    publishedCreditConfigs
  );
  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminPlanControl />
    </QueryClientProvider>
  );

  assert.match(html, /积分套餐与加油包/u);
  assert.match(html, /这是可见提醒，不阻止保存或发布/u);
  assert.match(html, /plan\.credits\.starter/u);
});
