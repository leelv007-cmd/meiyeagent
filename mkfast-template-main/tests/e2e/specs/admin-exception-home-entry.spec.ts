/**
 * Spec F / #383 — merchant shell「进入管理模式」lands on exception-first home.
 * Entry uses router.navigate (not href); assert URL + title after click.
 */
import { expect, test } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

test.describe('admin exception-home entry (#383)', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('进入管理模式 navigates to /admin and shows the exception home title', async ({
    page,
    request,
  }) => {
    const admin = await registerE2EUser(request, { role: 'admin' });
    await loginByForm(page, admin);
    await page.goto('/dashboard');

    await page.getByRole('button', { name: /用户菜单/ }).click();
    const enterAdmin = page.getByRole('menuitem', { name: '进入管理模式' });
    await expect(enterAdmin).toBeVisible();
    // Programmatic navigation — do not assert href on the menuitem.
    await enterAdmin.click();

    await expect(page).toHaveURL(/\/admin\/?$/u);
    await expect(
      page.getByRole('heading', { name: '异常优先首页', level: 1 })
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('exception-home-panel')).toBeVisible({
      timeout: 30_000,
    });
  });
});
