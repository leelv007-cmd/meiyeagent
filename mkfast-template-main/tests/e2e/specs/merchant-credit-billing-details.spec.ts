import { expect, test } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { E2E_TEST_SECRET } from '../fixtures/test-data';

const fixtureHeaders = { 'x-e2e-secret': E2E_TEST_SECRET };

test.describe('merchant credit billing and details', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('keeps the fixture and aliases inaccessible to guests', async ({
    page,
  }) => {
    const hiddenFixture = await page.request.post(
      '/api/e2e/credit-detail-fixture',
      { headers: { 'x-e2e-secret': 'wrong-secret' } }
    );
    expect(hiddenFixture.status()).toBe(404);

    const unauthenticatedFixture = await page.request.post(
      '/api/e2e/credit-detail-fixture',
      { headers: fixtureHeaders }
    );
    expect(unauthenticatedFixture.status()).toBe(401);

    await page.goto('/settings/credits');
    await expect(page).toHaveURL(/\/auth\/login/u);
  });

  test('renders backend-seeded FEFO credit details through both production aliases', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    const seeded = await page.request.post('/api/e2e/credit-detail-fixture', {
      headers: fixtureHeaders,
    });
    expect(seeded.ok(), await seeded.text()).toBeTruthy();
    await expect(seeded.json()).resolves.toMatchObject({
      data: { ready: true },
    });

    for (const alias of ['/settings/credits', '/settings/billing']) {
      await page.goto(alias);
      await expect(page).toHaveURL(
        (url) =>
          url.pathname === '/settings/account' &&
          url.searchParams.get('section') === 'credits'
      );
      await expect(page.getByTestId('merchant-credit-detail')).toBeVisible();
      await expect(page.getByTestId('credit-billing-card')).toBeVisible();
    }

    const detail = page.getByTestId('merchant-credit-detail');
    const batches = detail.locator(
      'section[aria-labelledby="merchant-credit-batches"]'
    );
    const transactions = detail.locator(
      'section[aria-labelledby="merchant-credit-transactions"]'
    );
    const billing = page.getByTestId('credit-billing-card');

    await expect(billing).toContainText(/Starter plan|初级套餐/u);
    await expect(billing).toContainText(/Continuous monthly|连续包月/u);
    await expect(billing).toContainText('500');
    const periodEnd = billing
      .locator('dt')
      .filter({ hasText: /Current period ends|本周期结束/u })
      .locator('xpath=following-sibling::dd');
    await expect(periodEnd).toHaveText(/\S/u);
    await expect(
      billing.getByRole('button', { name: /Manage renewal|管理续费/u })
    ).toBeVisible();
    await expect(
      billing.getByRole('link', { name: /Upgrade plan|升级套餐/u })
    ).toHaveAttribute('href', /\/pricing/u);

    // Registration provisions one merchant gift lot; the fixture adds its
    // subscription lot plus five lifecycle lots.
    await expect(batches.locator('tbody tr')).toHaveCount(7);
    await expect(batches).toContainText(/Credit pack|加油包/u);
    await expect(batches).toContainText(/Subscription period|订阅周期/u);
    await expect(batches).toContainText(/Expired|已过期/u);

    await expect(transactions).toContainText(
      /Creation activity\s+Reserved\s+2\s+#2\s+Reserved|创作作业预扣2#2已预扣/u
    );
    await expect(transactions).toContainText(
      /Creation activity\s+Reserved\s+3\s+#3\s+Settled|创作作业预扣3#3已结算/u
    );
    await expect(transactions).toContainText(
      /Creation activity\s+Refunded\s+4\s+#5\s+Refunded|创作作业预扣4#5已退回/u
    );
    await expect(transactions).toContainText(
      /Creation activity\s+Refunded\s+5\s+#4\s+Refunded|创作作业预扣5#4已退回/u
    );
    await expect(transactions).toContainText(
      /Returned 5 credits \(batch expired; not credited\)\.|已退回 5 分（批次已过期，未入账）/u
    );
    await expect(transactions).toContainText(
      /Account credit activity\s+Expired\s+50\s+#1\s+Not applicable|账户积分变动过期50#1不适用/u
    );
    await expect(detail).not.toContainText(
      /e2e-credit-detail|consume:|grant:|refund:|correlation|provider|actor|task:|lot-/iu
    );
  });
});
