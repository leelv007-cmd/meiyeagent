import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  adminPlanConfigApplyRequest,
  AdminPlanControl,
  planEditorConfigValue,
  replaceAddOnPrice,
} from './admin-plan-control';
import { p1QueryKeys } from './query-keys';

test('renders audio allowance and add-on resources in the plan catalog', () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(p1QueryKeys.request('entitlements', 'catalog'), {
    addOns: [
      {
        amountMicros: 100_000,
        currency: 'CNY',
        id: 'audio-100',
        quantity: 100,
        resource: 'audio',
      },
    ],
    mode: 'recorded',
    plans: [
      {
        allowance: { audio: 0, copy: 20, image: 5, video: 2 },
        concurrencyLimit: 1,
        expireDays: 7,
        id: 'trial',
        queuePriority: 1,
        supportLabel: 'standard',
      },
      {
        allowance: { audio: 8, copy: 30, image: 10, video: 5 },
        concurrencyLimit: 1,
        id: 'starter',
        queuePriority: 1,
        supportLabel: 'standard',
      },
    ],
  });

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminPlanControl />
    </QueryClientProvider>
  );

  assert.match(html, /音频/u);
  assert.match(html, /8 段/u);
  assert.match(html, /audio-100/u);
  assert.match(html, /id="plan-trial-expire-days"[^>]*max="366"/u);
  assert.doesNotMatch(html, /id="plan-starter-expire-days"/u);
});

test('renders dedicated plan fields, add-on pricing, compliance switches, and audit metadata', () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(p1QueryKeys.request('entitlements', 'catalog'), {
    addOns: [
      {
        amountMicros: 1_290_000,
        currency: 'CNY',
        id: 'copy-20',
        quantity: 20,
        resource: 'copy',
      },
    ],
    mode: 'recorded',
    plans: [
      {
        allowance: { audio: 8, copy: 120, image: 48, video: 24 },
        concurrencyLimit: 5,
        id: 'growth',
        queuePriority: 6,
        supportLabel: 'priority',
      },
    ],
  });
  queryClient.setQueryData(p1QueryKeys.request('admin-config', 'config_list'), [
    {
      actorId: 'platform-admin',
      createdAt: '2026-07-15T10:02:00.000Z',
      effectiveValue: {
        allowance: { audio: 8, copy: 120, image: 48, video: 24 },
        concurrencyLimit: 5,
        queuePriority: 6,
        supportLabel: 'priority',
      },
      key: 'plan.allowances.growth',
      revision: 7,
      storedValue: {
        allowance: { audio: 8, copy: 120, image: 48, video: 24 },
        concurrencyLimit: 5,
        queuePriority: 6,
        supportLabel: 'priority',
      },
    },
    {
      actorId: 'platform-admin',
      createdAt: '2026-07-15T10:02:30.000Z',
      effectiveValue: true,
      key: 'plan.trial.enabled',
      revision: 3,
      storedValue: true,
    },
    {
      actorId: 'platform-admin',
      createdAt: '2026-07-15T10:03:00.000Z',
      effectiveValue: [
        {
          amountMicros: 1_290_000,
          currency: 'CNY',
          id: 'copy-20',
          quantity: 20,
          resource: 'copy',
        },
      ],
      key: 'plan.addons',
      revision: 4,
      storedValue: [
        {
          amountMicros: 1_290_000,
          currency: 'CNY',
          id: 'copy-20',
          quantity: 20,
          resource: 'copy',
        },
      ],
    },
    {
      actorId: 'platform-admin',
      createdAt: '2026-07-15T10:03:30.000Z',
      effectiveValue: {
        mappings: [
          {
            paymentProductId: 'price_growth_month',
            interval: 'month',
            tier: 'growth',
          },
        ],
      },
      key: 'plan.payment-mapping',
      revision: 2,
      storedValue: {
        mappings: [
          {
            paymentProductId: 'price_growth_month',
            interval: 'month',
            tier: 'growth',
          },
        ],
      },
    },
    ...[
      ['compliance.watermark.default', true],
      ['compliance.aigc_label.default', false],
      ['compliance.regulated_mode.default', true],
    ].map(([key, value], index) => ({
      actorId: 'platform-admin',
      createdAt: '2026-07-15T10:04:00.000Z',
      effectiveValue: value,
      key,
      revision: index + 1,
      storedValue: value,
    })),
  ]);

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminPlanControl />
    </QueryClientProvider>
  );

  assert.match(html, /id="plan-growth-copy"/u);
  assert.match(html, /id="plan-growth-image"/u);
  assert.match(html, /id="plan-growth-video"/u);
  assert.match(html, /id="plan-growth-audio"/u);
  assert.match(html, /id="plan-growth-concurrency"/u);
  assert.match(html, /id="plan-growth-priority"/u);
  assert.match(html, /id="plan-growth-support"/u);
  assert.match(html, /id="addon-copy-20-price"/u);
  assert.match(html, /id="addon-copy-20-currency"/u);
  assert.match(html, /id="plan-trial-enabled"[^>]*checked/u);
  assert.match(html, /id="compliance-watermark-default"[^>]*checked/u);
  assert.doesNotMatch(html, /id="compliance-aigc-label-default"[^>]*checked/u);
  assert.match(html, /id="compliance-regulated-mode-default"[^>]*checked/u);
  assert.match(html, /v7/u);
  assert.match(html, /platform-admin/u);
  assert.match(html, /部分接线/u);
  assert.match(html, /高级配置与版本历史/u);
  assert.match(html, /plan\.payment-mapping/u);
  assert.match(html, /id="plan-growth-copy"[^>]*max="1000000"/u);
  assert.match(html, /id="plan-growth-concurrency"[^>]*max="100"/u);
  assert.match(html, /id="plan-growth-priority"[^>]*max="100"/u);
  assert.match(html, /id="addon-copy-20-price"[^>]*max="1000000"/u);
});

test('builds audited CAS requests and replaces only the selected add-on price', () => {
  assert.deepEqual(
    planEditorConfigValue('starter', {
      allowance: { audio: 0, copy: 30, image: 10, video: 5 },
      concurrencyLimit: 1,
      expireDays: 7,
      queuePriority: 1,
      supportLabel: 'standard',
    }),
    {
      allowance: { audio: 0, copy: 30, image: 10, video: 5 },
      concurrencyLimit: 1,
      queuePriority: 1,
      supportLabel: 'standard',
    }
  );
  assert.deepEqual(
    adminPlanConfigApplyRequest(
      { key: 'plan.allowances.growth', revision: 7 },
      {
        allowance: { audio: 8, copy: 120, image: 48, video: 24 },
        concurrencyLimit: 5,
        queuePriority: 6,
        supportLabel: 'priority',
      },
      'raise growth allowance'
    ),
    {
      action: 'config_apply',
      payload: {
        expectedRevision: 7,
        key: 'plan.allowances.growth',
        reason: 'raise growth allowance',
        value: {
          allowance: { audio: 8, copy: 120, image: 48, video: 24 },
          concurrencyLimit: 5,
          queuePriority: 6,
          supportLabel: 'priority',
        },
      },
    }
  );
  assert.deepEqual(
    adminPlanConfigApplyRequest(
      { key: 'compliance.aigc_label.default', revision: 2 },
      false,
      'change AIGC default'
    ),
    {
      action: 'config_apply',
      payload: {
        expectedRevision: 2,
        key: 'compliance.aigc_label.default',
        reason: 'change AIGC default',
        value: false,
      },
    }
  );

  assert.deepEqual(
    replaceAddOnPrice(
      [
        {
          amountMicros: 990_000,
          currency: 'CNY',
          id: 'copy-20',
          quantity: 20,
          resource: 'copy',
        },
        {
          amountMicros: 2_000_000,
          currency: 'CNY',
          id: 'image-10',
          quantity: 10,
          resource: 'image',
        },
      ],
      'copy-20',
      { amountMicros: 1_290_000, currency: 'CNY' }
    ),
    [
      {
        amountMicros: 1_290_000,
        currency: 'CNY',
        id: 'copy-20',
        quantity: 20,
        resource: 'copy',
      },
      {
        amountMicros: 2_000_000,
        currency: 'CNY',
        id: 'image-10',
        quantity: 10,
        resource: 'image',
      },
    ]
  );
});
