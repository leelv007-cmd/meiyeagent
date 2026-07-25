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
 *      a store registering afterwards is provisioned with that number, with
 *      nothing redeployed;
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
  const pageErrors: string[] = [];
  page.on('pageerror', (error) =>
    pageErrors.push(`${page.url()} :: ${error.stack ?? error.message}`)
  );
  try {
    await loginByForm(page, admin);

    for (const [path] of ADMIN_ROUTES) {
      await page.goto(path);

      // The token bridge keys off this class; without it every HeroUI surface
      // silently falls back to the library's own palette. Generous timeout:
      // the first admin hit compiles the route and the Glass sheet cold.
      await expect(
        page.locator('.meiye-heroui-glass'),
        `${path} lost the shell. Page errors so far:\n${pageErrors.join('\n')}`
      ).toBeVisible({ timeout: 60_000 });
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

/**
 * The governed key `plan.allowances.trial` feeds the catalog
 * (entitlement-catalog-source.ts); workspace-provision reads that catalog when
 * it activates the trial and materialises the number into the workspace's plan
 * event, which is what entitlement-service projects. Editing the config
 * therefore never rewrites an already-provisioned workspace — the hand-entered
 * number shows up for a store provisioned after the change. That is the chain
 * this journey walks.
 */
test('a hand-entered three-bucket number reaches the merchant through governed config', async ({
  baseURL,
  browser,
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const admin = await registerE2EUser(request, { role: 'admin' });
  try {
    await loginByForm(page, admin);

    await page.goto('/admin/plans');
    const copyField = page.locator('#plan-trial-copy');
    await expect(copyField).toBeVisible({ timeout: 30_000 });
    const trialForm = copyField.locator('xpath=ancestor::form[1]');

    // Settle the editor before typing. It re-runs form.reset when the
    // admin-config row lands, so a value entered beforehand is silently
    // reverted and the submit then writes the unchanged number — a no-op that
    // never advances the CAS revision, which surfaces 30s later as a product
    // failure rather than as the race it is. The audit meta line only renders
    // once that row is in hand, so it is the signal to wait on.
    const revisionLine = trialForm.getByText(/^v\d+ · /);
    await expect(revisionLine).toBeVisible({ timeout: 30_000 });
    const revisionBefore = await revisionLine.innerText();

    // 71-79 collides with no seed: the shipped copy allowances are 5/30/100/300
    // and the add-on quantities 20/10, so a stale fallback cannot fake this
    // green. Always move off the stored value — this config is global and
    // outlives the run, so re-entering it would be that same no-op.
    const stored = Number(await copyField.inputValue());
    const target = stored >= 71 && stored < 79 ? stored + 1 : 71;
    await copyField.fill(String(target));

    // Fail loudly rather than hang: the editor goes read-only when
    // admin-config carries no revision for the key, and a disabled button
    // would otherwise just burn the test timeout.
    const saveButton = trialForm.getByRole('button', {
      name: '审阅套餐变更',
    });
    await expect(saveButton).toBeEnabled({ timeout: 30_000 });
    // Last check before the write: whatever we are about to submit is still
    // the number we typed.
    await expect(copyField).toHaveValue(String(target));

    await saveButton.click();

    // Every governed write goes through impact review, and the reason is what
    // lands in the audit trail — there is no un-audited path to the number.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page
      .getByLabel('执行原因（写入审计）')
      .fill(
        'T35 acceptance: move the trial copy allowance through admin-config'
      );
    // Plan changes override the dialog's generic confirm label, and the suite
    // sets no actionTimeout, so assert the button before clicking — otherwise a
    // label mismatch hangs the click until the test-level timeout instead of
    // failing here with something readable.
    const confirmButton = dialog.getByRole('button', {
      name: '确认配置变更',
    });
    await expect(confirmButton).toBeVisible({ timeout: 15_000 });
    await confirmButton.click();
    await expect(dialog).toBeHidden();

    // CAS revision advanced: the editor's audit meta line changed.
    await expect
      .poll(async () => revisionLine.innerText(), { timeout: 30_000 })
      .not.toBe(revisionBefore);

    // …and a store registering now is provisioned off the edited catalog, with
    // nothing redeployed. Its own context so the admin session stays intact.
    const merchant = await registerE2EUser(request);
    // newContext() does not inherit use.baseURL, so pass it through or the
    // relative goto below would throw on an invalid URL.
    const merchantContext = await browser.newContext({ baseURL });
    try {
      const merchantPage = await merchantContext.newPage();
      await loginByForm(merchantPage, merchant);
      await merchantPage.goto('/settings/account');
      // Assert on what the merchant actually reads, not an internal field.
      const merchantCopyAllowance = merchantPage
        .locator('section', {
          has: merchantPage.getByRole('heading', { name: '文案条数' }),
        })
        .getByText(/^套餐总量 \d+$/)
        .first();
      await expect(merchantCopyAllowance).toBeVisible({ timeout: 30_000 });
      await expect(merchantCopyAllowance).toHaveText(`套餐总量 ${target}`, {
        timeout: 30_000,
      });
    } finally {
      await merchantContext.close();
    }
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
      await expect(
        layer.getByText(own, { exact: false }).first()
      ).toBeVisible();
      await expect(layer.getByText(foreign, { exact: false })).toHaveCount(0);
    }
  } finally {
    await cleanupE2EUsers(request);
  }
});
