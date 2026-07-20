import { expect, test } from '@playwright/test';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { createE2EUser } from '../fixtures/test-data';

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
