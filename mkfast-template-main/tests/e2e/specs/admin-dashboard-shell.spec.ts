/**
 * T35 acceptance: 运营后台 on the D-130 template-dashboard shell.
 *
 * Three journeys, all against the live stack — the admin surfaces read the real
 * admin-config / model-supply / job-runtime projections, so none of this can go
 * green on fixture data (ADR-0019 / D-131).
 *
 *   1. every admin page renders the new shell in both themes, and the merchant
 *      shell no longer wraps /admin;
 *   2. the hand-entry panel moves a three-bucket number through the governed
 *      admin-config API (CAS revision advances, reason lands in the audit) and
 *      the merchant-side allowance follows without a release;
 *   3. the model assembly page presents CatalogModel and ExecutionChannel as two
 *      layers, each separately operable.
 */
import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

const ADMIN_ROUTES = [
  ['/admin', '异常收口'],
  ['/admin/models', '模型供应'],
  ['/admin/templates', '官方模板'],
  ['/admin/integrations', '集成治理'],
  ['/admin/plans', '套餐治理'],
  ['/admin/users', '用户管理'],
  ['/admin/audit', '高影响操作审计'],
] as const;

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((next) => {
    document.documentElement.classList.toggle('dark', next === 'dark');
  }, theme);
}

test('every admin page renders the template-dashboard shell in both themes', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const admin = await registerE2EUser(request, { role: 'admin' });
  try {
    await loginByForm(page, admin);

    for (const [path] of ADMIN_ROUTES) {
      await page.goto(path);

      // The token bridge keys off this class; without it every HeroUI surface
      // silently falls back to the library's own palette.
      await expect(page.locator('.meiye-heroui-glass')).toBeVisible();
      await expect(
        page.locator('[data-slot="sidebar-menu-item"]').first()
      ).toBeVisible();
      // The merchant shell must not wrap 后台 any more (dev spec §56).
      await expect(page.locator('[data-shell-mode="admin"]')).toHaveCount(0);

      for (const theme of ['light', 'dark'] as const) {
        await setTheme(page, theme);
        const background = await page
          .locator('.meiye-heroui-glass')
          .evaluate((node) => getComputedStyle(node).backgroundColor);
        expect(background, `${path} @ ${theme}`).not.toBe('rgba(0, 0, 0, 0)');
      }
      await setTheme(page, 'light');
    }
  } finally {
    await cleanupE2EUsers(request);
  }
});

test('a hand-entered three-bucket number reaches the merchant through governed config', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const admin = await registerE2EUser(request, { role: 'admin' });
  try {
    await loginByForm(page, admin);

    // Baseline: the copy bucket's allowance as the merchant reads it.
    const merchantCopyAllowance = page
      .locator('section', { has: page.getByRole('heading', { name: '文案条数' }) })
      .getByText(/^套餐总量 \d+$/)
      .first();
    const readMerchantAllowance = async () => {
      await page.goto('/settings/account');
      await expect(merchantCopyAllowance).toBeVisible({ timeout: 30_000 });
      return Number(
        (await merchantCopyAllowance.innerText()).replace(/\D+/gu, '')
      );
    };
    const before = await readMerchantAllowance();
    expect(Number.isFinite(before)).toBe(true);

    await page.goto('/admin/plans');
    const copyField = page.locator('#plan-trial-copy');
    await expect(copyField).toBeVisible();
    const target = before + 7;
    await copyField.fill(String(target));

    const trialForm = copyField.locator('xpath=ancestor::form[1]');
    const revisionLine = trialForm.getByText(/^v\d+ · /);
    const revisionBefore = await revisionLine.innerText();

    await trialForm.getByRole('button', { name: '审阅套餐变更' }).click();

    // Every governed write goes through impact review, and the reason is what
    // lands in the audit trail — there is no un-audited path to the number.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page
      .getByLabel('执行原因（写入审计）')
      .fill('T35 acceptance: move the trial copy allowance through admin-config');
    await dialog.getByRole('button', { name: '确认执行' }).click();
    await expect(dialog).toBeHidden();

    // CAS revision advanced: the editor's audit meta line changed.
    await expect
      .poll(async () => revisionLine.innerText(), { timeout: 30_000 })
      .not.toBe(revisionBefore);

    // …and the merchant reads the new allowance with nothing redeployed.
    expect(await readMerchantAllowance()).toBe(target);
  } finally {
    await cleanupE2EUsers(request);
  }
});

test('model assembly separates the catalog layer from the channel layer', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const admin = await registerE2EUser(request, { role: 'admin' });
  try {
    await loginByForm(page, admin);
    await page.goto('/admin/models');

    const catalogLayer = page.getByTestId('admin-models-catalog-layer');
    const channelLayer = page.getByTestId('admin-models-channel-layer');
    await expect(catalogLayer).toBeVisible();
    await expect(channelLayer).toBeVisible();

    // Separately operable: each layer carries its own governed-config control,
    // and neither offers the other layer's keys.
    for (const [layer, own, foreign] of [
      [catalogLayer, 'platform.defaultModel.copy', 'model.execution.mode'],
      [channelLayer, 'model.execution.mode', 'platform.defaultModel.copy'],
    ] as const) {
      await expect(layer.getByText(own, { exact: false }).first()).toBeVisible();
      await expect(layer.getByText(foreign, { exact: false })).toHaveCount(0);
    }
  } finally {
    await cleanupE2EUsers(request);
  }
});
