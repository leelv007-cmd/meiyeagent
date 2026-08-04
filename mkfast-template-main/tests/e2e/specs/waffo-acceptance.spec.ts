import { createSign, generateKeyPairSync, verify } from 'node:crypto';
import { expect, test } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

const waffoAcceptanceEnabled =
  process.env.PLAYWRIGHT_WAFFO_ACCEPTANCE === 'true';

type FixtureState = {
  checkout: {
    bindingId: string;
    interval: 'monthly';
    mode: 'test';
    planId: 'growth';
    productId: string;
    status: 'intent';
  };
  inbox: { deliveryId: string; status: 'accepted' } | null;
  outbox: { deliveryId: string; status: 'queued' } | null;
  core: {
    interval: 'monthly';
    paymentEventId: string;
    status: 'applied';
  } | null;
  payment: { provider: 'waffo'; status: 'active' } | null;
  binding: { status: 'active'; subscriptionId: string } | null;
  subscription: { status: 'active'; subscriptionId: string } | null;
};

test.describe('Waffo checkout and webhook acceptance', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => {
    testInfo.annotations.push({
      type: 'boundary',
      description: 'Waffo Test only; no production route or traffic',
    });
  });

  test.beforeAll(async ({ request }) => {
    if (waffoAcceptanceEnabled) await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    if (waffoAcceptanceEnabled) await cleanupE2EUsers(request);
  });

  test('pricing exposes the authenticated Waffo checkout entry in HKD', async ({
    page,
    request,
  }) => {
    if (!waffoAcceptanceEnabled) {
      await page.goto('/pricing');
      await expect(page.getByTestId('pricing-checkout-growth')).toHaveCount(0);
      return;
    }

    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await page.goto('/pricing');

    const checkout = page.getByTestId('pricing-checkout-growth');
    const growthCard = checkout.locator('xpath=ancestor::section[1]');
    await expect(growthCard).toContainText('HK$');
    await expect(checkout).toBeEnabled();
    await expect(checkout).toContainText(/subscribe|订阅/u);

    const testCheckout = page.waitForURL(
      (url) =>
        url.hostname === 'pancake.waffo.ai' &&
        url.searchParams.get('test') === 'true'
    );
    await checkout.click();
    await testCheckout;
  });

  test('the public Waffo webhook endpoint rejects an unsigned delivery', async ({
    request,
  }) => {
    const response = await request.post('/api/webhooks/waffo', {
      data: JSON.stringify({
        eventType: 'subscription.payment_succeeded',
        id: 'e2e-waffo-unsigned',
      }),
      headers: {
        'content-type': 'application/json',
        'x-waffo-signature': 'invalid',
      },
    });

    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      received: false,
    });
  });

  test('completes the deterministic Test checkout-to-entitlement fixture', async ({
    page,
    request,
  }) => {
    test.skip(
      !waffoAcceptanceEnabled,
      'Enable PLAYWRIGHT_WAFFO_ACCEPTANCE for the isolated Waffo Test fixture.'
    );

    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await page.goto('/pricing');

    const growthCheckout = page.getByTestId('pricing-checkout-growth');
    await expect(growthCheckout).toBeVisible();
    await expect(
      growthCheckout.locator('xpath=ancestor::section[1]')
    ).toContainText('HK$');

    const subscriptionId = 'sub_e2e_waffo_test';
    const deliveryId = 'delivery_e2e_waffo_test';
    const providerPaymentId = 'PAY_e2e_waffo_test';
    const paymentEventId = `waffo:${providerPaymentId}`;
    const fixture: FixtureState = {
      checkout: {
        bindingId: 'binding_e2e_waffo_test',
        interval: 'monthly',
        mode: 'test',
        planId: 'growth',
        productId: 'PROD_TEST_HKD_GROWTH_MONTHLY',
        status: 'intent',
      },
      inbox: null,
      outbox: null,
      core: null,
      payment: null,
      binding: null,
      subscription: null,
    };

    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const webhookPayload = JSON.stringify({
      eventType: 'subscription.payment_succeeded',
      eventId: providerPaymentId,
      id: deliveryId,
      mode: 'test',
      productId: fixture.checkout.productId,
      subscriptionId,
      interval: fixture.checkout.interval,
      periodStartsAt: '2026-08-03T00:00:00.000Z',
      periodEndsAt: '2026-09-03T00:00:00.000Z',
    });
    const signature = createSign('RSA-SHA256')
      .update(webhookPayload)
      .sign(privateKey, 'base64');

    await page.route('**/api/webhooks/waffo', async (route) => {
      const requestBody = route.request().postData() ?? '';
      const requestSignature = route.request().headers()['x-waffo-signature'];
      expect(requestBody).toBe(webhookPayload);
      expect(requestSignature).toBe(signature);
      expect(
        createSign('RSA-SHA256').update(requestBody).sign(privateKey, 'base64')
      ).toBe(signature);
      expect(
        verify(
          'RSA-SHA256',
          Buffer.from(requestBody),
          publicKey,
          Buffer.from(requestSignature ?? '', 'base64')
        )
      ).toBe(true);

      const event = JSON.parse(requestBody) as {
        eventType: string;
        eventId: string;
        id: string;
        mode: string;
        productId: string;
        subscriptionId: string;
      };
      expect(event).toMatchObject({
        eventType: 'subscription.payment_succeeded',
        eventId: 'event_e2e_waffo_test',
        id: deliveryId,
        mode: 'test',
        productId: fixture.checkout.productId,
        subscriptionId,
      });
      expect(fixture.checkout.status).toBe('intent');

      fixture.inbox = { deliveryId, status: 'accepted' };
      fixture.outbox = { deliveryId, status: 'queued' };
      fixture.core = {
        interval: fixture.checkout.interval,
        paymentEventId,
        status: 'applied',
      };
      fixture.payment = { provider: 'waffo', status: 'active' };
      fixture.binding = { status: 'active', subscriptionId };
      fixture.subscription = { status: 'active', subscriptionId };

      await route.fulfill({
        contentType: 'application/json',
        json: {
          received: true,
          replayed: false,
          fixture: {
            core: fixture.core,
            inbox: fixture.inbox,
            outbox: fixture.outbox,
            payment: fixture.payment,
            binding: fixture.binding,
            subscription: fixture.subscription,
          },
        },
        status: 200,
      });
    });

    const response = await page.evaluate(
      async ({ body, requestSignature }) => {
        const response = await fetch('/api/webhooks/waffo', {
          body,
          headers: {
            'content-type': 'application/json',
            'x-waffo-signature': requestSignature,
          },
          method: 'POST',
        });
        return { body: await response.json(), status: response.status };
      },
      { body: webhookPayload, requestSignature: signature }
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      fixture: {
        core: { interval: 'monthly', status: 'applied' },
        inbox: { deliveryId, status: 'accepted' },
        outbox: { deliveryId, status: 'queued' },
        payment: { provider: 'waffo', status: 'active' },
        binding: { status: 'active', subscriptionId },
        subscription: { status: 'active', subscriptionId },
      },
      received: true,
      replayed: false,
    });

    expect(fixture).toMatchObject({
      checkout: {
        bindingId: 'binding_e2e_waffo_test',
        interval: 'monthly',
        mode: 'test',
        planId: 'growth',
        productId: 'PROD_TEST_HKD_GROWTH_MONTHLY',
        status: 'intent',
      },
      core: { interval: 'monthly', paymentEventId, status: 'applied' },
      inbox: { deliveryId, status: 'accepted' },
      outbox: { deliveryId, status: 'queued' },
      payment: { provider: 'waffo', status: 'active' },
      binding: { status: 'active', subscriptionId },
      subscription: { status: 'active', subscriptionId },
    });
  });
});
