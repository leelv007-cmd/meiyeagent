import { expect, test } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

const waffoAcceptanceEnabled =
  process.env.PLAYWRIGHT_WAFFO_ACCEPTANCE === 'true';

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
});
