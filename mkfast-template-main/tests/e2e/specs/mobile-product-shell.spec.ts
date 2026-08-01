import { expect, test, type Request } from '@playwright/test';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

/**
 * T37 / M-04 (#231): the mobile 「running Copy Work → 结果路由 → 返回锚点」 journey
 * that used to live here was deleted, not skipped. It was already
 * `test.fixme`d, and its only mechanism was holding one of the retired
 * two-command creative-work pair on `/api/core/p1/commands` — commands the
 * Composer stopped emitting when T08 moved submission to
 * `/api/core/p1/composer/submissions`, so the hold could only ever time out
 * (`src/lib/e2e-hard-gate-contract.test.ts` now keeps them out). Its second
 * half also addressed `/dashboard/tasks`, which T34 retired. Relanding it
 * belongs with the task-source surface (T38); the merchant-facing mobile
 * contracts it shared with the rest of this file stay covered below.
 */

type P1Call = {
  action?: string;
  module?: string;
  payload?: Record<string, unknown>;
};

function p1Call(request: Request): P1Call | undefined {
  try {
    return request.postDataJSON() as P1Call;
  } catch {
    return undefined;
  }
}

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

test('keeps identity, assets, and camera authorization reachable on mobile', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const user = await registerE2EUser(request);
  try {
    await loginByForm(page, user);
    const mobileNav = page.getByRole('navigation', { name: '移动端导航' });
    await expect(mobileNav).toBeVisible();
    await expect(
      mobileNav.getByTestId('mobile-identity-assets-entry')
    ).toHaveAttribute('href', /^\/dashboard\/assets(?:\?|$)/u);
    // 经验 joined the bar under D-164④ (P2-13 rename); the grid is five-wide.
    // 「口吻与素材」是手机端独有的覆盖标签：product_navigation_identity_assets
    // (project.inlang/messages/zh.json:3279)，由 mobile-nav.tsx:32 挂到 assets 槽。
    for (const label of ['创作', '口吻与素材', '内容', '门店', '经验']) {
      await expect(mobileNav.getByText(label, { exact: true })).toBeVisible();
    }

    await mobileNav.getByText('口吻与素材', { exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/assets(?:\?|$)/u);
    // a539378f 把「表达身份」改名为「口吻」：region 名来自
    // marketing-identity-manager.tsx:53 的 aria-labelledby → 同文件 :56 的 h3，
    // 文案是 COPY.zh.title（:25）。
    await expect(
      page.getByRole('region', { exact: true, name: '口吻' })
    ).toBeVisible();
    await expect(page.getByText('素材', { exact: true }).first()).toBeVisible();

    await mobileNav.getByText('创作', { exact: true }).click();
    await expect(
      page.getByRole('radiogroup', { name: '创作类型' })
    ).toBeVisible();
    // The send control names which of its two jobs the next press does, so on
    // a workspace whose store facts are still open it reads 先补门店信息.
    await expect(
      page.getByRole('button', {
        name: /开始创作|先补门店信息|先补资质信息|先确认素材来源/,
      })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '拍照', exact: true })
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(390);
    await page.screenshot({
      path: 'test-results/evidence/p0-mobile-workbench.png',
      fullPage: true,
    });

    await page.goto('/dashboard/assets');
    const cameraInput = page.locator('input[type="file"]').first();
    await expect(cameraInput).toHaveAttribute('capture', 'environment');
    await expect(cameraInput).toHaveAttribute('accept', /image/);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(390);
  } finally {
    await cleanupE2EUsers(request);
  }
});

test('keeps mobile identity and assets reachable during a slow canonical query', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const user = await registerE2EUser(request);
  let releaseWorkbenchQuery = () => {};
  try {
    const workbenchQueryGate = new Promise<void>((resolve) => {
      releaseWorkbenchQuery = resolve;
    });
    let holdWorkbenchQuery = true;
    await page.route('**/api/core/p1/query', async (route) => {
      const call = p1Call(route.request());
      if (
        holdWorkbenchQuery &&
        call?.module === 'operations' &&
        call.action === 'creative_workbench'
      ) {
        await workbenchQueryGate;
      }
      await route.continue().catch(() => undefined);
    });

    await loginByForm(page, user);
    // T34 / #228: 旧任务收件箱 retired — host this on the workbench instead.
    await page.goto('/dashboard');
    const mobileNav = page.getByRole('navigation', { name: '移动端导航' });
    const identityAssetsEntry = mobileNav.getByTestId(
      'mobile-identity-assets-entry'
    );
    await expect(identityAssetsEntry).toHaveAttribute(
      'href',
      '/dashboard/assets'
    );
    await expect(page).toHaveURL(/\/dashboard\/?(?:\?.*)?$/u);

    holdWorkbenchQuery = false;
    releaseWorkbenchQuery();
    await expect(identityAssetsEntry).toHaveAttribute(
      'href',
      '/dashboard/assets'
    );
    await page.unroute('**/api/core/p1/query');
    await identityAssetsEntry.click();
    await expect(page).toHaveURL(/\/dashboard\/assets/u);
    await expect(
      page.getByRole('region', { exact: true, name: '口吻' })
    ).toBeVisible();
  } finally {
    releaseWorkbenchQuery();
    await cleanupE2EUsers(request);
  }
});
