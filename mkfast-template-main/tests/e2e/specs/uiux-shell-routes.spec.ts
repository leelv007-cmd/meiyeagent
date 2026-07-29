import { expect, test } from '@playwright/test';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

// Written out rather than imported from the app: this is the list a merchant
// can actually see, and deriving it from the source would make the spec agree
// with any change by construction. 记忆 joined it under D-164④.
const businessNavigation = ['创作', '内容', '素材', '门店', '记忆'] as const;

test.afterEach(async ({ request }) => {
  await cleanupE2EUsers(request);
});

test('product shell exposes the whole business navigation and utility modes', async ({
  page,
  request,
}) => {
  const user = await registerE2EUser(request, { role: 'admin' });
  await loginByForm(page, user);

  const navigation = page.getByRole('navigation', { name: '业务导航' });
  await expect(navigation).toBeVisible();
  const labels = await navigation.getByRole('link').allTextContents();
  expect(labels.map((label) => label.trim())).toEqual([...businessNavigation]);
  await expect(page.getByRole('link', { name: '设置' })).toBeVisible();

  const productTokens = await page
    .locator('.meiye-product-shell')
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        brand: style.getPropertyValue('--product-brand').trim(),
        brandInk: style.getPropertyValue('--product-brand-ink').trim(),
        focus: style.getPropertyValue('--product-focus').trim(),
        guide: style.getPropertyValue('--product-guide').trim(),
      };
    });
  expect(productTokens).toEqual({
    brand: 'oklch(0.78 0.14 166)',
    brandInk: 'oklch(0.16 0.03 166)',
    focus: 'oklch(0.85 0.15 166)',
    guide: 'oklch(0.79 0.13 66)',
  });
  const nextActionGuide = page.getByTestId('next-action-guide');
  await expect(nextActionGuide).toBeVisible();
  expect(
    await nextActionGuide.evaluate((element) => getComputedStyle(element).color)
  ).toBe('oklch(0.79 0.13 66)');

  await page.evaluate(() => localStorage.setItem('theme', 'light'));
  await page.reload();
  await expect(navigation).toBeVisible();
  const lightTokens = await page
    .locator('.meiye-product-shell')
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        focus: style.getPropertyValue('--product-focus').trim(),
        primary: style.getPropertyValue('--primary').trim(),
        primaryForeground: style
          .getPropertyValue('--primary-foreground')
          .trim(),
        sidebarRing: style.getPropertyValue('--sidebar-ring').trim(),
      };
    });
  expect(lightTokens).toEqual({
    focus: 'oklch(0.43 0.075 188)',
    primary: 'oklch(0.43 0.075 188)',
    primaryForeground: 'oklch(0.985 0.008 190)',
    sidebarRing: 'oklch(0.85 0.15 166)',
  });
  expect(
    await page
      .getByText('今天的创作记录', { exact: true })
      .evaluate((element) => getComputedStyle(element).color)
  ).toBe('oklch(0.43 0.075 188)');

  const firstBusinessLink = navigation.getByRole('link').first();
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  for (let index = 0; index < 12; index += 1) {
    if (
      await firstBusinessLink.evaluate(
        (element) => element === document.activeElement
      )
    ) {
      break;
    }
    await page.keyboard.press('Tab');
  }
  await expect(firstBusinessLink).toBeFocused();
  const sidebarOutline = await firstBusinessLink.evaluate(
    (element) => getComputedStyle(element).outline
  );
  expect(sidebarOutline).toContain('2px');
  expect(sidebarOutline).toContain('oklch(0.85 0.15 166)');

  await page.getByRole('button', { name: /用户菜单/ }).click();
  await expect(
    page.getByRole('menuitem', { name: '进入管理模式' })
  ).toBeVisible();
});

test('canonical shell routes survive direct navigation and reload', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const user = await registerE2EUser(request, { role: 'admin' });
  await loginByForm(page, user);

  const routes = [
    // T34 / #228 — 一级导航「内容」lands here; the old task inbox is a redirect shell.
    ['/dashboard/works', '内容'],
    ['/dashboard/assets', '资产库'],
    // D-164④: 记忆 is a first-class destination now, so it has to survive a
    // typed URL and a reload like every other one.
    ['/dashboard/memory', '记忆'],
    ['/dashboard/sessions/session-proof', '创作记录'],
    ['/dashboard/works/work-proof', '作品详情'],
    ['/dashboard/jobs/job-proof', '执行详情'],
    ['/settings/account', '账户'],
    ['/settings/models', '模型'],
    ['/settings/connections', '连接'],
    ['/admin/models', '模型供应'],
    ['/admin/templates', '官方模板'],
    ['/admin/integrations', '集成治理'],
    ['/admin/plans', '套餐治理'],
    ['/admin/users', '用户管理'],
    ['/admin/audit', '高影响操作审计'],
  ] as const;

  for (const [path, heading] of routes) {
    await page.goto(path);
    await expect(
      page.getByRole('heading', { name: heading, level: 1 })
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('heading', { name: heading, level: 1 })
    ).toBeVisible();
  }
});

/**
 * D-164①: `/dashboard?view=` used to render a whole history page in place of
 * the workbench, so「the dashboard」could be a page with no way to create
 * anything on it. Both views own routes of their own; the parameter survives
 * as a redirect for links already in the wild.
 *
 * Kept separate from the canonical-route sweep above on purpose: that one walks
 * twenty routes, and an unrelated failure anywhere in the list would take this
 * evidence down with it.
 */
test('a legacy ?view= link lands on the route that owns the view', async ({
  page,
  request,
}) => {
  const user = await registerE2EUser(request);
  await loginByForm(page, user);

  for (const [path, destination, heading] of [
    ['/dashboard?view=recent', '/dashboard/recent', '最近活动'],
    ['/dashboard?view=works', '/dashboard/works', '内容'],
  ] as const) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`${destination}$`, 'u'));
    await expect(
      page.getByRole('heading', { level: 1, name: heading })
    ).toBeVisible();
    // The workbench is not what a `?view=` link opens, and the redirect has to
    // replace the entry rather than stack one — going back must not bounce.
    await expect(page.getByTestId('composer-home')).toHaveCount(0);
  }
});

test('legacy routes redirect through the fixed internal allowlist', async ({
  page,
  request,
}) => {
  const user = await registerE2EUser(request, { role: 'admin' });
  await loginByForm(page, user);

  const redirects = [
    ['/settings/files', '/dashboard/assets'],
    ['/settings/apikeys', '/settings/models'],
    ['/settings/profile', '/settings/account'],
    ['/settings/credits', '/settings/account'],
    ['/settings/integrations', '/settings/connections'],
    ['/dashboard/store?tab=assets', '/dashboard/assets'],
    ['/dashboard/content', '/dashboard/works'],
    ['/dashboard/tasks', '/dashboard'],
    ['/admin/p1?tab=templates', '/admin/templates'],
    ['/admin/p1?tab=integrations', '/admin/integrations'],
    ['/admin/p1?return=https://attacker.invalid', '/admin/models'],
  ] as const;

  for (const [legacy, canonical] of redirects) {
    await page.goto(legacy);
    await expect(page).toHaveURL(
      new RegExp(`${canonical.replace('/', '\\/')}/?(?:\\?.*)?$`)
    );
  }
});

test('non-admin users cannot discover or open management mode', async ({
  page,
  request,
}) => {
  const user = await registerE2EUser(request);
  await loginByForm(page, user);
  await page.getByRole('button', { name: /用户菜单/ }).click();
  await expect(
    page.getByRole('menuitem', { name: '进入管理模式' })
  ).toHaveCount(0);
  await page.goto('/admin/models');
  await expect(page).toHaveURL(/\/dashboard\/?$/);
});

test('shell keeps skip navigation and 200-percent zoom reachability', async ({
  page,
  request,
}) => {
  const user = await registerE2EUser(request);
  await loginByForm(page, user);
  await page.goto('/dashboard');
  const skipLink = page.getByRole('link', { name: '跳到主要内容' });
  await expect(skipLink).toBeAttached();
  await page.setViewportSize({ width: 640, height: 720 });

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth)
  ).toBeLessThanOrEqual(640);
  await page.keyboard.press('Tab');
  await expect(skipLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
});

/**
 * S7 / U07 轮 2 — 收起态下这五条链接仍然报得出名字。
 *
 * `collapsible="icon"` 把 `[data-sidebar="label"]` 收成 visibility:hidden
 * (heroui-pro/vendor/css/sidebar.css)，图标又是 aria-hidden 的装饰件，于是链接的
 * 可访问名会整个消失——读屏只播报「链接」。上面那条用例只走展开态，量不到这半边，
 * 所以缺口在这里补：名字恒挂在 aria-label 上（sidebar-main.tsx / dashboard-sidebar.tsx），
 * 词表仍是 config/sidebar-config 那一份。
 */
test('sidebar links keep their accessible names when the shell is collapsed', async ({
  page,
  request,
}) => {
  const user = await registerE2EUser(request);
  await loginByForm(page, user);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dashboard');

  const sidebar = page.locator('[data-slot="sidebar"]');
  await expect(sidebar).toHaveAttribute('data-state', 'expanded');

  // Provider 的 toggleShortcut 默认 mod+b；/dashboard 是 Composer 首页，
  // 不挂 DashboardHeader，所以这里没有 Sidebar.Trigger 可点。
  await page.keyboard.press('ControlOrMeta+b');
  await expect(sidebar).toHaveAttribute('data-state', 'collapsed');
  // 标签的 visibility 过渡带 delay：不等它真收完就断言，名字还来自可见文案，
  // 这条用例会在修复前也变绿。
  const firstBusinessLabel = sidebar
    .getByRole('navigation', { name: '业务导航' })
    .locator('a.meiye-sidebar-nav-item')
    .first()
    .locator('[data-sidebar="label"]');
  await expect(firstBusinessLabel).toBeHidden();

  // exact: name 默认是子串匹配，品牌链接「美业内容簿标志」会连「内容」一起吃掉。
  for (const label of [...businessNavigation, '设置']) {
    await expect(
      sidebar.getByRole('link', { exact: true, name: label })
    ).toBeVisible();
  }
});
