/**
 * T34 / #228 — 内容页＋运营旧面换壳下线，旅程级验收.
 *
 * 店主的「内容」一级导航与日常任务面收敛进新主线 (D-127, 无新旧双轨期). This spec
 * walks that convergence end to end: content browsing lands on the reshelled
 * surface, the four retired addresses forward instead of rendering, 待办 exist in
 * exactly one place, and 模板浏览 has exactly one doorway — in both themes and at
 * a phone viewport.
 *
 * Written as one journey rather than four unit assertions because the failure
 * this guards against is a *reachable* old page, and reachability only shows up
 * when you actually walk the shell.
 */

import { expect, test } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import {
  installPageHealthMonitor,
  setTheme,
  type ThemeMode,
} from '../fixtures/page-health';

const RETIRED_ADDRESSES = [
  // [retired address, where it must land]
  ['/dashboard/content', /\/dashboard\/works\/?(?:\?.*)?$/u],
  ['/dashboard/tasks', /\/dashboard\/?(?:\?.*)?$/u],
  ['/dashboard/tasks/task-does-not-exist', /\/dashboard\/?(?:\?.*)?$/u],
] as const;

test.describe('T34 内容页＋运营旧面换壳下线', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('内容导航进新内容面，四条旧地址不再渲染旧页', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const monitor = installPageHealthMonitor(page);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    // 一级导航「内容」— the label stays, the surface underneath is the new one.
    const contentNav = page
      .getByRole('navigation', { name: '业务导航' })
      .getByRole('link', { name: '内容', exact: true });
    await expect(contentNav).toHaveAttribute(
      'href',
      /^\/dashboard\/works(?:\?|$)/u
    );
    await contentNav.click();
    await expect(page).toHaveURL(/\/dashboard\/works\/?(?:\?.*)?$/u);
    await expect(page.getByTestId('works-surface')).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 1, name: '内容' })
    ).toBeVisible();

    for (const [retired, destination] of RETIRED_ADDRESSES) {
      await test.step(retired, async () => {
        await page.goto(retired);
        await expect(page).toHaveURL(destination);
      });
    }

    // The package address keeps its target: the detail route resolves a
    // ContentPackage id directly, so this is a forward, not a drop to the list.
    await page.goto('/dashboard/content/content-package-does-not-exist');
    await expect(page).toHaveURL(
      /\/dashboard\/works\/content-package-does-not-exist$/u
    );

    monitor.expectNoErrors('T34 retired address forwarding');
  });

  test('待办不再散落在旧任务面，模板浏览只有 Composer 全屏目录一个入口', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    // Nothing in the shell still offers the retired task inbox. The inbox that
    // replaces it is the workbench's own task drawer — it owns no route, so its
    // absence from every href is the point, not an omission. (The drawer only
    // renders once there is something to settle; the projection contract for
    // its 恰一次消费 lives in pending-actions-inbox.spec.ts.)
    for (const surface of [
      '/dashboard',
      '/dashboard/works',
      '/dashboard/assets',
    ]) {
      await test.step(surface, async () => {
        await page.goto(surface);
        await expect(page.locator('body')).toBeVisible();
        await expect(page.locator('a[href^="/dashboard/tasks"]')).toHaveCount(
          0
        );
      });
    }

    // 模板浏览: exactly one doorway, the Composer fullscreen catalog.
    await page.goto('/dashboard/catalog');
    await expect(page).toHaveURL(/\/dashboard\/catalog/u);
    await expect(page.getByTestId('dashboard-catalog-page')).toBeVisible();
    await expect(page.getByTestId('composer-fullscreen-catalog')).toBeVisible();
  });

  test('新内容面在双主题与移动端视口下无破损', async ({ page, request }) => {
    test.setTimeout(120_000);
    const monitor = installPageHealthMonitor(page);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    for (const theme of ['light', 'dark'] as const satisfies ThemeMode[]) {
      await setTheme(page, theme);

      for (const viewport of [
        { height: 900, name: 'desktop', width: 1440 },
        { height: 844, name: 'mobile', width: 390 },
      ]) {
        await test.step(`${theme} / ${viewport.name}`, async () => {
          await page.setViewportSize({
            height: viewport.height,
            width: viewport.width,
          });
          monitor.reset();
          await page.goto('/dashboard/works');
          await expect(page.getByTestId('works-surface')).toBeVisible();
          await expect(
            page.getByRole('heading', { level: 1, name: '内容' })
          ).toBeVisible();
          await expect(page.locator('html')).toHaveClass(
            new RegExp(`\\b${theme}\\b`)
          );

          // 门店橱窗 lays surfaces out in one column of the viewport; a page that
          // scrolls sideways is the classic reshell break at 390px.
          const overflow = await page.evaluate(
            () =>
              document.documentElement.scrollWidth -
              document.documentElement.clientWidth
          );
          expect(overflow, 'surface must not scroll horizontally').toBeLessThan(
            2
          );
          monitor.expectNoErrors(`content surface ${theme}/${viewport.name}`);
        });
      }
    }
  });
});
