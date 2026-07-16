import { expect, test } from '@playwright/test';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

const businessNavigation = ['创作', '内容', '素材', '门店'] as const;

test.afterEach(async ({ request }) => {
  await cleanupE2EUsers(request);
});

test('product shell exposes the collapsed four-item navigation and utility modes', async ({
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
    ['/dashboard/tasks', '内容任务'],
    ['/dashboard/assets', '资产库'],
    ['/dashboard?view=recent', '最近活动'],
    ['/dashboard?view=works', '作品历史'],
    ['/dashboard/leads/lead-proof', '线索详情'],
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
