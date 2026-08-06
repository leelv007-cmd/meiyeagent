import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

/**
 * Spec A / #364 — ban must take effect on the merchant's next request even
 * while Better Auth cookie cache remains enabled (60m window).
 *
 * Driver executes this Playwright file; the lane only authors it.
 */

function setCookieHeaders(response: {
  headersArray(): Array<{ name: string; value: string }>;
}) {
  return response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === 'set-cookie')
    .map((header) => header.value);
}

function cookiesCleared(headers: readonly string[]) {
  const sessionCookies = headers.filter(
    (header) =>
      header.includes('session_token') || header.includes('session_data')
  );
  if (sessionCookies.length === 0) return false;
  return sessionCookies.every(
    (header) =>
      /Max-Age=0/iu.test(header) ||
      /Expires=Thu, 01 Jan 1970 00:00:00 GMT/iu.test(header)
  );
}

async function readSessionUserId(page: Page) {
  const response = await page.request.get('/api/auth/get-session');
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = (await response.json()) as { user?: { id?: string } } | null;
  expect(body?.user?.id).toBeTruthy();
  return body!.user!.id as string;
}

async function banUser(adminPage: Page, userId: string, origin: string) {
  const response = await adminPage.request.post('/api/auth/admin/ban-user', {
    data: { userId, banReason: 'e2e-ban-immediacy' },
    headers: {
      Origin: origin,
      Referer: `${origin}/admin/users`,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function unbanUser(adminPage: Page, userId: string, origin: string) {
  const response = await adminPage.request.post('/api/auth/admin/unban-user', {
    data: { userId },
    headers: {
      Origin: origin,
      Referer: `${origin}/admin/users`,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

test.describe('admin ban session immediacy', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('ban rejects the merchant next page and API request and unban allows re-login', async ({
    browser,
    request,
  }) => {
    const admin = await registerE2EUser(request, { role: 'admin' });
    const merchant = await registerE2EUser(request);

    let adminContext: BrowserContext | undefined;
    let merchantContext: BrowserContext | undefined;

    try {
      adminContext = await browser.newContext();
      merchantContext = await browser.newContext();
      const adminPage = await adminContext.newPage();
      const merchantPage = await merchantContext.newPage();

      await loginByForm(adminPage, admin);
      await loginByForm(merchantPage, merchant);

      const origin = new URL(merchantPage.url()).origin;
      const merchantUserId = await readSessionUserId(merchantPage);

      // Merchant is productive before the ban.
      await merchantPage.goto('/dashboard');
      await expect(
        merchantPage
          .getByRole('navigation', { name: '业务导航' })
          .getByRole('link', { name: '创作', exact: true })
      ).toBeVisible();

      const preBanApi = await merchantPage.request.post('/api/core/p1/query', {
        data: {
          action: 'config_defaults',
          module: 'admin-config',
          payload: {},
        },
        headers: { 'idempotency-key': crypto.randomUUID() },
      });
      // May be 200 (forwarded) or 4xx from Core; must not be unauthenticated 401.
      expect(preBanApi.status(), await preBanApi.text()).not.toBe(401);

      await banUser(adminPage, merchantUserId, origin);

      // Next page request: protected shell must refuse and land on login.
      await merchantPage.goto('/dashboard');
      await expect(merchantPage).toHaveURL(/\/auth\/login/);

      // Next API request: rejected and session cookies expired.
      const postBanApi = await merchantPage.request.post('/api/core/p1/query', {
        data: {
          action: 'config_defaults',
          module: 'admin-config',
          payload: {},
        },
        headers: { 'idempotency-key': crypto.randomUUID() },
      });
      expect(postBanApi.status(), await postBanApi.text()).toBe(401);
      expect(cookiesCleared(setCookieHeaders(postBanApi))).toBeTruthy();

      const residualSession = await merchantPage.request.get(
        '/api/auth/get-session'
      );
      const residualBody = (await residualSession.json()) as {
        user?: { id?: string };
      } | null;
      expect(residualBody?.user?.id ?? null).toBeNull();

      await unbanUser(adminPage, merchantUserId, origin);

      // Old sessions stay dead; a fresh login is the first successful request.
      await loginByForm(merchantPage, merchant);
      await expect(
        merchantPage
          .getByRole('navigation', { name: '业务导航' })
          .getByRole('link', { name: '创作', exact: true })
      ).toBeVisible();

      const postUnbanApi = await merchantPage.request.post(
        '/api/core/p1/query',
        {
          data: {
            action: 'config_defaults',
            module: 'admin-config',
            payload: {},
          },
          headers: { 'idempotency-key': crypto.randomUUID() },
        }
      );
      expect(postUnbanApi.status(), await postUnbanApi.text()).not.toBe(401);
    } finally {
      await merchantContext?.close();
      await adminContext?.close();
    }
  });
});
