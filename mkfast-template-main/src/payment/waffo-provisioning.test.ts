import assert from 'node:assert/strict';
import test from 'node:test';
import { provisionWaffoSubscriptionCatalog } from './waffo-provisioning';

test('provisions and publishes the nine subscription products with a test webhook', async () => {
  const created: Array<Record<string, unknown>> = [];
  const published: Array<Record<string, unknown>> = [];
  const createdGroups: Array<Record<string, unknown>> = [];
  const publishedGroups: Array<Record<string, unknown>> = [];
  const webhookAdds: Array<Record<string, unknown>> = [];

  const result = await provisionWaffoSubscriptionCatalog(
    {
      subscriptionProducts: {
        create: async (input: Record<string, unknown>) => {
          created.push(input);
          return { product: { id: `PROD_${created.length}` } };
        },
        publish: async (input: Record<string, unknown>) => {
          published.push(input);
          return { product: { id: input.id } };
        },
      },
      subscriptionProductGroups: {
        create: async (input: Record<string, unknown>) => {
          createdGroups.push(input);
          return { group: { id: `GRP_${createdGroups.length}` } };
        },
        publish: async (input: Record<string, unknown>) => {
          publishedGroups.push(input);
          return { group: { id: input.id } };
        },
      },
      webhooks: {
        add: async (input: Record<string, unknown>) => {
          webhookAdds.push(input);
          return { webhook: { id: 'whk_test_1' } };
        },
      },
    },
    {
      storeId: 'STO_test',
      webhookUrl: 'https://payments.example.test/api/webhooks/waffo',
    }
  );

  assert.equal(created.length, 9);
  assert.deepEqual(
    created.map((product) => product.prices),
    [
      { CNY: { amount: '199.00', taxCategory: 'saas' } },
      { CNY: { amount: '179.10', taxCategory: 'saas' } },
      { CNY: { amount: '1791.00', taxCategory: 'saas' } },
      { CNY: { amount: '499.00', taxCategory: 'saas' } },
      { CNY: { amount: '449.10', taxCategory: 'saas' } },
      { CNY: { amount: '4491.00', taxCategory: 'saas' } },
      { CNY: { amount: '899.00', taxCategory: 'saas' } },
      { CNY: { amount: '809.10', taxCategory: 'saas' } },
      { CNY: { amount: '8091.00', taxCategory: 'saas' } },
    ]
  );
  assert.deepEqual(
    published.map((product) => product.id),
    Array.from({ length: 9 }, (_, index) => `PROD_${index + 1}`)
  );
  assert.deepEqual(createdGroups, [
    {
      name: 'Starter subscriptions',
      productIds: ['PROD_1', 'PROD_2', 'PROD_3'],
      rules: { sharedTrial: false },
      storeId: 'STO_test',
    },
    {
      name: 'Growth subscriptions',
      productIds: ['PROD_4', 'PROD_5', 'PROD_6'],
      rules: { sharedTrial: false },
      storeId: 'STO_test',
    },
    {
      name: 'Pro subscriptions',
      productIds: ['PROD_7', 'PROD_8', 'PROD_9'],
      rules: { sharedTrial: false },
      storeId: 'STO_test',
    },
  ]);
  assert.deepEqual(
    publishedGroups.map((group) => group.id),
    ['GRP_1', 'GRP_2', 'GRP_3']
  );
  assert.deepEqual(webhookAdds, [
    {
      channel: 'http',
      events: [
        'subscription.activated',
        'subscription.payment_succeeded',
        'subscription.canceling',
        'subscription.uncanceled',
        'subscription.canceled',
      ],
      storeId: 'STO_test',
      testMode: true,
      url: 'https://payments.example.test/api/webhooks/waffo',
    },
  ]);
  assert.equal(result.testWebhookId, 'whk_test_1');
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
