import { expect, test } from '@playwright/test';
import {
  ageE2EUserSessions,
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { createE2EUser } from '../fixtures/test-data';

function setCookieHeaders(response: {
  headersArray(): Array<{ name: string; value: string }>;
}) {
  return response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === 'set-cookie')
    .map((header) => header.value);
}

function hasCookie(headers: readonly string[], name: string) {
  return headers.some((header) => header.split('=', 1)[0]?.includes(name));
}

test.describe('authentication and protected routes', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('redirects guests from dashboard to login', async ({ page }) => {
    await page.goto('/dashboard');

    await expect(page).toHaveURL(/\/auth\/login/);
    await expect(page.locator('input[name="email"]')).toBeVisible();
  });

  test('allows a verified user to sign in and view dashboard', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);

    await loginByForm(page, user);
    await expect(
      page
        .getByRole('navigation', { name: '业务导航' })
        .getByRole('link', { name: '创作', exact: true })
    ).toBeVisible();
  });

  test('preserves complete Set-Cookie headers for login, refresh and logout', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await page.goto('/auth/login');
    const origin = new URL(page.url()).origin;

    const loginResponse = await page.request.post('/api/auth/sign-in/email', {
      data: {
        email: user.email,
        password: user.password,
        callbackURL: '/dashboard',
      },
      headers: {
        Origin: origin,
        Referer: `${origin}/auth/login`,
      },
    });
    expect(loginResponse.ok(), await loginResponse.text()).toBeTruthy();
    const loginCookies = setCookieHeaders(loginResponse);
    expect(hasCookie(loginCookies, 'session_token')).toBeTruthy();
    expect(hasCookie(loginCookies, 'session_data')).toBeTruthy();

    await page.context().clearCookies({ name: /session_data/u });
    const refreshResponse = await page.request.get('/api/auth/get-session');
    expect(refreshResponse.ok(), await refreshResponse.text()).toBeTruthy();
    const refreshCookies = setCookieHeaders(refreshResponse);
    expect(hasCookie(refreshCookies, 'session_data')).toBeTruthy();

    const logoutResponse = await page.request.post('/api/auth/sign-out', {
      data: {},
      headers: {
        Origin: origin,
        Referer: `${origin}/dashboard`,
      },
    });
    expect(logoutResponse.ok(), await logoutResponse.text()).toBeTruthy();
    const logoutCookies = setCookieHeaders(logoutResponse);
    expect(hasCookie(logoutCookies, 'session_token')).toBeTruthy();
    expect(hasCookie(logoutCookies, 'session_data')).toBeTruthy();
    expect(
      logoutCookies
        .filter(
          (header) =>
            header.includes('session_token') || header.includes('session_data')
        )
        .every(
          (header) =>
            /Max-Age=0/iu.test(header) ||
            /Expires=Thu, 01 Jan 1970 00:00:00 GMT/iu.test(header)
        )
    ).toBeTruthy();
  });

  test('requires step-up for sensitive commands despite a fresh cookie cache', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request, { role: 'admin' });
    await page.goto('/auth/login');
    const origin = new URL(page.url()).origin;
    const loginResponse = await page.request.post('/api/auth/sign-in/email', {
      data: { email: user.email, password: user.password },
      headers: {
        Origin: origin,
        Referer: `${origin}/auth/login`,
      },
    });
    expect(loginResponse.ok(), await loginResponse.text()).toBeTruthy();
    const currentSession = (await loginResponse.json()) as {
      user: { id: string };
    };
    await ageE2EUserSessions(
      request,
      user.email,
      new Date(Date.now() - 16 * 60 * 1000).toISOString()
    );

    for (const command of [
      {
        action: 'admin_store_provider_credential',
        module: 'integrations',
      },
      { action: 'config_apply', module: 'admin-config' },
      { action: 'create', module: 'redemptions' },
    ]) {
      const response = await page.request.post('/api/core/p1/commands', {
        data: { ...command, payload: {} },
        headers: { 'idempotency-key': crypto.randomUUID() },
      });
      expect(response.status(), `${command.module}.${command.action}`).toBe(
        403
      );
      expect(await response.json()).toMatchObject({
        code: 'RECENT_AUTHENTICATION_REQUIRED',
      });
    }

    for (const endpoint of [
      {
        body: { role: 'user', userId: currentSession.user.id },
        path: '/api/auth/admin/set-role',
      },
      {
        body: { userId: currentSession.user.id },
        path: '/api/auth/admin/ban-user',
      },
      {
        body: { sessionToken: 'not-used-before-step-up' },
        path: '/api/auth/admin/revoke-user-session',
      },
    ]) {
      const response = await page.request.post(endpoint.path, {
        data: endpoint.body,
        headers: {
          Origin: origin,
          Referer: `${origin}/admin/users`,
        },
      });
      expect(response.status(), endpoint.path).toBe(403);
      expect(await response.json()).toMatchObject({
        code: 'RECENT_AUTHENTICATION_REQUIRED',
      });
    }
  });

  test('allows a user to register from the register page', async ({ page }) => {
    const user = createE2EUser();

    await page.goto('/auth/register');
    await page.waitForLoadState('networkidle');
    await page.locator('input[name="name"]').fill(user.name);
    await page.locator('input[name="email"]').fill(user.email);
    await page.locator('input[name="password"]').fill(user.password);
    await page.getByRole('button', { name: /^sign up$|^注册$/i }).click();

    await expect
      .poll(() =>
        page.evaluate(async () => {
          const response = await fetch('/api/auth/get-session', {
            credentials: 'same-origin',
          });
          if (!response.ok) return null;
          const session = (await response.json()) as {
            user?: { email?: string };
          } | null;
          return session?.user?.email ?? null;
        })
      )
      .toBe(user.email);

    const signOutResponse = await page.evaluate(async () => {
      const response = await fetch('/api/auth/sign-out', {
        body: '{}',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      return { body: await response.text(), ok: response.ok };
    });
    expect(signOutResponse.ok, signOutResponse.body).toBeTruthy();

    await loginByForm(page, user);
    await expect(
      page
        .getByRole('navigation', { name: '业务导航' })
        .getByRole('link', { name: '创作', exact: true })
    ).toBeVisible();
  });

  test('redirects non-admin users away from admin pages', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);

    await loginByForm(page, user);
    await page.goto('/admin/users');

    await expect(page).toHaveURL(/\/dashboard\/?$/);
  });

  test('allows admin users to view the users dashboard', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request, { role: 'admin' });

    await loginByForm(page, user);
    await page.goto('/admin/users');

    await expect(page).toHaveURL(/\/admin\/users\/?$/);
    await expect(
      page.getByRole('table').getByText(user.email).first()
    ).toBeVisible();
  });
});
