import assert from 'node:assert/strict';
import test from 'node:test';
import { provisionWaffoSubscriptionCatalog } from '@/payment/waffo-provisioning';

test('provisions nine HKD Test-only subscription products and reuses the existing test webhook', async () => {
  const created: Array<{ prices: unknown }> = [];
  const createdGroups: unknown[] = [];

  const result = await provisionWaffoSubscriptionCatalog(
    {
      subscriptionProducts: {
        create: async (input) => {
          created.push(input);
          return { product: { id: `PROD_${created.length}` } };
        },
      },
      subscriptionProductGroups: {
        create: async (input) => {
          createdGroups.push(input);
          return { group: { id: `GRP_${createdGroups.length}` } };
        },
      },
    },
    {
      storeId: 'STO_test',
      testWebhookId: 'whk_existing_test',
    }
  );

  assert.equal(created.length, 9);
  assert.deepEqual(
    created.map((product) => product.prices),
    [
      { HKD: { amount: '231.00', taxCategory: 'saas' } },
      { HKD: { amount: '208.00', taxCategory: 'saas' } },
      { HKD: { amount: '2081.00', taxCategory: 'saas' } },
      { HKD: { amount: '580.00', taxCategory: 'saas' } },
      { HKD: { amount: '522.00', taxCategory: 'saas' } },
      { HKD: { amount: '5217.00', taxCategory: 'saas' } },
      { HKD: { amount: '1044.00', taxCategory: 'saas' } },
      { HKD: { amount: '940.00', taxCategory: 'saas' } },
      { HKD: { amount: '9400.00', taxCategory: 'saas' } },
    ]
  );
  assert.deepEqual(createdGroups, [
    {
      name: 'Starter HKD subscriptions',
      productIds: ['PROD_1', 'PROD_2', 'PROD_3'],
      rules: { sharedTrial: false },
      storeId: 'STO_test',
    },
    {
      name: 'Growth HKD subscriptions',
      productIds: ['PROD_4', 'PROD_5', 'PROD_6'],
      rules: { sharedTrial: false },
      storeId: 'STO_test',
    },
    {
      name: 'Pro HKD subscriptions',
      productIds: ['PROD_7', 'PROD_8', 'PROD_9'],
      rules: { sharedTrial: false },
      storeId: 'STO_test',
    },
  ]);
  assert.equal(result.testWebhookId, 'whk_existing_test');
  assert.equal(result.productIds.proMonthly, 'PROD_8');
  assert.deepEqual(result.productGroupIds, {
    starter: 'GRP_1',
    growth: 'GRP_2',
    pro: 'GRP_3',
  });
  assert.deepEqual(result.paymentMapping, {
    mappings: [
      { interval: 'single_month', paymentProductId: 'PROD_1', tier: 'starter' },
      { interval: 'monthly', paymentProductId: 'PROD_2', tier: 'starter' },
      { interval: 'yearly', paymentProductId: 'PROD_3', tier: 'starter' },
      { interval: 'single_month', paymentProductId: 'PROD_4', tier: 'growth' },
      { interval: 'monthly', paymentProductId: 'PROD_5', tier: 'growth' },
      { interval: 'yearly', paymentProductId: 'PROD_6', tier: 'growth' },
      { interval: 'single_month', paymentProductId: 'PROD_7', tier: 'pro' },
      { interval: 'monthly', paymentProductId: 'PROD_8', tier: 'pro' },
      { interval: 'yearly', paymentProductId: 'PROD_9', tier: 'pro' },
    ],
  });
});
