import { expect, test, type Page } from '@playwright/test';
import { createHmac, randomUUID } from 'node:crypto';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

/**
 * R-08 / #211: the workbench entry states the canonical entitlement truth.
 * A merchant without the entitlement is never invited into the workspace and
 * then refused by the gate; a merchant with it enters in one click.
 */
async function unlockProStudio(page: Page) {
  const suffix = randomUUID();
  const payload = JSON.stringify({
    data: {
      object: {
        id: `e2e-pro-studio-checkout-${suffix}`,
        mode: 'payment',
        payment_status: 'paid',
      },
    },
    id: `e2e-pro-studio-event-${suffix}`,
    type: 'checkout.session.completed',
  });
  const signature = createHmac('sha256', 'mkfast-e2e-pro-studio-webhook-secret')
    .update(payload)
    .digest('hex');
  const response = await page.request.post('/api/e2e/pro-studio-payment', {
    data: payload,
    headers: {
      'content-type': 'application/json',
      'x-e2e-secret': 'mkfast-e2e-secret',
      'x-e2e-webhook-signature': signature,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

test.describe('Pro Studio entitlement checkout', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('a tenant without the entitlement sees a locked workbench entry that never enters the workspace', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await page.goto('/dashboard');

    const banner = page.getByTestId('composer-pro-studio-banner');
    // The entry stays on the workbench while Pro Studio is frozen (D-127)…
    await expect(banner).toBeVisible();
    // …but it reports the real entitlement, not a seeded default.
    await expect(banner).toHaveAttribute('data-status', 'locked', {
      timeout: 15_000,
    });
    await expect(banner).toHaveAttribute('data-can-enter', 'false');
    await expect(banner).toContainText('了解并解锁');
    await expect(banner).not.toContainText('进入专业工作区');

    await banner.click();

    // The click lands on the canonical gate, never inside the workspace.
    await expect(page).toHaveURL(/\/pro-studio$/u);
    const gate = page.getByTestId('pro-studio-entry-gate');
    await expect(gate).toHaveAttribute('data-entitlement-state', 'locked');
    await expect(gate).toHaveAttribute('data-can-enter', 'false');
    await expect(page.getByText('独立加购项')).toBeVisible();
    await expect(page.getByText('工作区已解锁')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '一键进入' })).toHaveCount(0);

    const canvasOrigin = `http://localhost:${
      process.env.PLAYWRIGHT_CANVAS_PORT ?? '4200'
    }`;
    expect(new URL(page.url()).origin).not.toBe(canvasOrigin);
  });

  test('a tenant with the entitlement sees an active workbench entry that enters the workspace', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await page.goto('/dashboard');
    await expect(
      page.getByTestId('composer-pro-studio-banner')
    ).toHaveAttribute('data-status', 'locked', { timeout: 15_000 });

    await unlockProStudio(page);

    await page.goto('/dashboard');
    const banner = page.getByTestId('composer-pro-studio-banner');
    await expect(banner).toHaveAttribute('data-status', 'active', {
      timeout: 15_000,
    });
    await expect(banner).toHaveAttribute('data-can-enter', 'true');
    await expect(banner).toContainText('进入专业工作区');

    await banner.click();
    await expect(page).toHaveURL(/\/pro-studio$/u);
    const gate = page.getByTestId('pro-studio-entry-gate');
    await expect(gate).toHaveAttribute('data-entitlement-state', 'active');
    await expect(page.getByText('工作区已解锁')).toBeVisible();
    await expect(page.getByRole('button', { name: '一键进入' })).toBeVisible();
  });

  test('unpurchased Owner sees the dedicated offer and server-owned checkout action', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await page.goto('/pro-studio');

    await expect(page.getByText('独立加购项')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: '¥299 一次性' })
    ).toBeVisible();
    await expect(page.getByRole('link', { name: '查看演示' })).toBeVisible();
    const purchase = page.getByRole('button', { name: 'Owner 立即购买' });
    await expect(purchase).toBeVisible();
    await expect(purchase.locator('xpath=ancestor::form')).toHaveAttribute(
      'action',
      '/api/pro-studio/checkout'
    );
  });

  test('fixture-signed webhook unlocks Pro Studio and exposes one-click entry', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await page.goto('/pro-studio');
    await expect(
      page.getByRole('button', { name: 'Owner 立即购买' })
    ).toBeVisible();

    await unlockProStudio(page);

    await page.reload();
    await expect(page.getByText('工作区已解锁')).toBeVisible();
    const enter = page.getByRole('button', { name: '一键进入' });
    await expect(enter).toBeVisible();
    await enter.click();

    const canvasOrigin = `http://localhost:${
      process.env.PLAYWRIGHT_CANVAS_PORT ?? '4200'
    }`;
    await expect(page).toHaveURL(
      (url) => url.origin === canvasOrigin && url.pathname === '/',
      { timeout: 15_000 }
    );
    await expect(page.getByText('Pro Studio', { exact: true })).toBeVisible();
    await expect(page.getByText(/^工作区 /u)).toBeVisible();
    const canvasCookies = await page.context().cookies(canvasOrigin);
    expect(canvasCookies.map((cookie) => cookie.name)).toEqual(
      expect.arrayContaining(['__Host-canvas-session', '__Host-canvas-csrf'])
    );
  });

  test('real provider hosted-checkout smoke remains opt-in', async ({
    page,
  }) => {
    test.skip(
      process.env.PLAYWRIGHT_REAL_PRO_STUDIO_PAYMENT !== 'true',
      'Requires hosted provider checkout and signed webhook credentials.'
    );
    const checkoutUrl = process.env.PLAYWRIGHT_REAL_PRO_STUDIO_CHECKOUT_URL;
    expect(
      checkoutUrl,
      'Set PLAYWRIGHT_REAL_PRO_STUDIO_CHECKOUT_URL'
    ).toBeTruthy();
    await page.goto(checkoutUrl as string);
    await expect(page).not.toHaveURL(/\/pro-studio(?:\?|$)/u);
  });
});
