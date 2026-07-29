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

/**
 * 两条内联 color 断言在这一轮被删掉，不是降标准，是宿主没了：
 *
 *  - `next-action-guide` 挂在 operations-rail 上，27e74740（§1A 死码退役）把整个
 *    组件删了，全仓只剩这份 spec 还在找这个 testid；它量的 `--product-guide`
 *    (styles.css:181) 如今零消费者。
 *  - 「今天的创作记录」只剩 `dashboard_pending_eyebrow` 一处渲染，在
 *    routes/dashboard.tsx:38 的 pendingComponent 里。上面那句
 *    `expect(navigation).toBeVisible()` 一过，加载态就已卸载，这条断言只会等超时。
 *
 * 两处都无同义后继可改指，硬要重基线只能写出一条恒红的断言，所以留证据在这里，
 * 由属主决定要不要给这两个 token 补新的渲染宿主。
 */
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
  // 门店橱窗 palette，src/styles.css:179-182 的 `.meiye-product-shell` 基础块。
  // 默认主题就是 light（config/website.ts:40 defaultMode），所以这一组读到的
  // 是基础块原值，下面那组显式 light 读到的也是同一份。
  expect(productTokens).toEqual({
    brand: 'oklch(0.63 0.13 18)',
    brandInk: 'oklch(0.98 0.008 18)',
    focus: 'oklch(0.22 0 0)',
    guide: 'oklch(0 0 0 / 0.6)',
  });

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
  // --primary / --primary-foreground / --sidebar-ring 在壳里都是 var() 链
  // (styles.css:230/231/249)，自定义属性的计算值会把 var() 代换掉，所以量到的是
  // 链尾的字面量：--ink (styles.css:183) 与 --paper (styles.css:187)。
  expect(lightTokens).toEqual({
    focus: 'oklch(0.22 0 0)',
    primary: 'oklch(0.22 0 0)',
    primaryForeground: 'oklch(1 0 0)',
    sidebarRing: 'oklch(0.22 0 0)',
  });

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
  // 这条是本用例里唯一还量得到「token 真的落到渲染件上」的证据：两条内联 color
  // 断言的宿主都已不在（见用例头注释）。焦点环走 styles.css:340-343 的
  // `outline: 2px solid var(--ink) !important`，light 下 --ink = styles.css:183，
  // 它压过 custom.css:92 的 --sidebar-ring 那条。
  const sidebarOutline = await firstBusinessLink.evaluate(
    (element) => getComputedStyle(element).outline
  );
  expect(sidebarOutline).toContain('2px');
  expect(sidebarOutline).toContain('oklch(0.22 0 0)');

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
    // h1 走 canonical-history-page.tsx:527 的 `page.title()`，assets 档取
    // product_navigation_assets（同文件 :148）＝「素材」，与侧栏标签同名。
    ['/dashboard/assets', '素材'],
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
