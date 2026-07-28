/**
 * T35 acceptance: 运营后台 on the D-130 template-dashboard shell.
 *
 * Four journeys, all against the live stack — the admin surfaces read the real
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
 *   4. the wired merchant decision hold opens a bounded control and persists
 *      through the same reviewed, audited admin-config path.
 */
import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

const ADMIN_ROUTES = [
  ['/admin', '异常收口'],
  ['/admin/supply', '供应运行'],
  ['/admin/supply/views/model', '供应关联视图'],
  ['/admin/supply/tasks/task-does-not-exist', '供应任务详情'],
  ['/admin/capabilities', '能力目录'],
  ['/admin/recipe-studio', 'Recipe Studio'],
  ['/admin/skills', 'Skills'],
  ['/admin/models', '模型供应'],
  ['/admin/templates', '官方模板'],
  ['/admin/integrations', '集成治理'],
  ['/admin/plans', '套餐治理'],
  ['/admin/redemptions', '兑换治理'],
  ['/admin/users', '用户管理'],
  ['/admin/audit', '高影响操作审计'],
  ['/admin/cloudflare', 'Cloudflare 资源'],
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

      // Sample both themes and require them to actually differ. Asserting each
      // one is merely non-transparent is close to tautological — the shell root
      // carries bg-background, so it resolves to something whether or not the
      // Glass sheet loaded and whether or not the token bridge matched. Two
      // readings that come back equal mean dark mode never took, which is the
      // failure this assertion exists to catch.
      const backgrounds: Record<string, string> = {};
      for (const theme of ['light', 'dark'] as const) {
        await setTheme(page, theme);
        backgrounds[theme] = await page
          .locator('.meiye-heroui-glass')
          .evaluate((node) => getComputedStyle(node).backgroundColor);
        expect(backgrounds[theme], `${path} @ ${theme}`).not.toBe(
          'rgba(0, 0, 0, 0)'
        );
      }
      expect(
        backgrounds.light,
        `${path}: the shell background did not change between themes`
      ).not.toBe(backgrounds.dark);
      await setTheme(page, 'light');
    }
  } finally {
    await cleanupE2EUsers(request);
  }
});

/**
 * Move the trial copy allowance through the governed path an operator uses, and
 * return once the CAS revision has advanced. Shared by the journey and by its
 * restore, so putting the shared number back cannot become a back door that
 * skips impact review.
 *
 * `pick` receives the currently stored value so callers can choose a target
 * relative to it; the stored value is only readable once the editor has settled.
 */
async function applyTrialCopyAllowance(
  page: Page,
  reason: string,
  pick: (stored: number) => number
) {
  await page.goto('/admin/plans');
  const copyField = page.locator('#plan-trial-copy');
  await expect(copyField).toBeVisible({ timeout: 30_000 });
  const trialForm = copyField.locator('xpath=ancestor::form[1]');

  // Settle the editor before typing. It re-runs form.reset when the
  // admin-config row lands, so a value entered beforehand is silently reverted
  // and the submit then writes the unchanged number — a no-op that never
  // advances the CAS revision, which surfaces 30s later as a product failure
  // rather than as the race it is. The audit meta line only renders once that
  // row is in hand, so it is the signal to wait on.
  const revisionLine = trialForm.getByText(/^v\d+ · /);
  await expect(revisionLine).toBeVisible({ timeout: 30_000 });
  const revisionBefore = await revisionLine.innerText();

  const stored = Number(await copyField.inputValue());
  const target = pick(stored);
  await copyField.fill(String(target));

  // Fail loudly rather than hang: the editor goes read-only when admin-config
  // carries no revision for the key, and a disabled button would otherwise just
  // burn the test timeout.
  const saveButton = trialForm.getByRole('button', { name: '审阅套餐变更' });
  await expect(saveButton).toBeEnabled({ timeout: 30_000 });
  // Last check before the write: whatever we are about to submit is still the
  // number we typed.
  await expect(copyField).toHaveValue(String(target));

  await saveButton.click();

  // Every governed write goes through impact review, and the reason is what
  // lands in the audit trail — there is no un-audited path to the number.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.getByLabel('执行原因（写入审计）').fill(reason);
  // Plan changes override the dialog's generic confirm label, and the suite
  // sets no actionTimeout, so assert the button before clicking — otherwise a
  // label mismatch hangs the click until the test-level timeout instead of
  // failing here with something readable.
  const confirmButton = dialog.getByRole('button', { name: '确认配置变更' });
  await expect(confirmButton).toBeVisible({ timeout: 15_000 });
  await confirmButton.click();
  await expect(dialog).toBeHidden();

  // CAS revision advanced: the editor's audit meta line changed.
  await expect
    .poll(async () => revisionLine.innerText(), { timeout: 30_000 })
    .not.toBe(revisionBefore);

  return { stored, target };
}

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
  // Unique per run: a fixed string would already be sitting in the audit trail
  // from an earlier run, so the audit assertion below would pass even if this
  // run never wrote anything.
  const reason = `T35 acceptance ${Date.now()}: move the trial copy allowance through admin-config`;
  let appliedFrom: number | undefined;
  try {
    await loginByForm(page, admin);

    // 71-79 collides with no seed: the shipped copy allowances are 5/30/100/300
    // and the add-on quantities 20/10, so a stale fallback cannot fake this
    // green. Always move off the stored value — this config is global and
    // outlives the run, so re-entering it would be a no-op write.
    const { stored, target } = await applyTrialCopyAllowance(
      page,
      reason,
      (current) => (current >= 71 && current < 79 ? current + 1 : 71)
    );
    appliedFrom = stored;

    // The other half of the acceptance: the reason reached the audit record,
    // not just the form. /admin/audit is the wrong surface for this — it is fed
    // by revision_rollback_audits and catalog_revisions, so it carries template
    // and catalog events only. admin-config keeps its trail per key, readable
    // through config_history behind the advanced-config disclosure, and that is
    // where an operator would go looking for who changed an allowance and why.
    await page.getByText('高级配置与版本历史').click();
    await page.selectOption(
      '#admin-runtime-config-key',
      'plan.allowances.trial'
    );
    await expect(page.getByText(reason, { exact: true })).toBeVisible({
      timeout: 30_000,
    });

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
    const restoreTo = appliedFrom;
    if (restoreTo !== undefined) {
      // Put the shared number back. This config is workspace-wide and outlives
      // the run, so without this every run walks the trial allowance upward for
      // every other lane and for anyone eyeballing the admin surface. Restoring
      // through the same governed path keeps it audited; its own catch so a
      // restore failure cannot mask the assertion that actually failed.
      await applyTrialCopyAllowance(
        page,
        `${reason} (restore to ${restoreTo})`,
        () => restoreTo
      ).catch(() => undefined);
    }
    await cleanupE2EUsers(request);
  }
});

test('the wired merchant decision hold is editable through governed config', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const admin = await registerE2EUser(request, { role: 'admin' });
  const key = 'harness.confirmation_card.hold_timeout_seconds';
  const reason = `C1 acceptance ${Date.now()}: change merchant decision hold`;
  let original: number | undefined;

  const applyHold = async (value: number, auditReason: string) => {
    const advanced = page.locator('details', {
      hasText: '高级配置与版本历史',
    });
    if ((await advanced.getAttribute('open')) === null) {
      await advanced.getByText('高级配置与版本历史').click();
    }
    await advanced.locator('#admin-runtime-config-key').selectOption(key);
    const form = advanced.getByTestId(`admin-config-form-${key}`);
    await expect(form).toBeVisible({ timeout: 30_000 });
    const input = form.getByRole('textbox', {
      name: '商家决策保留期（秒）',
    });
    await expect(input).toBeVisible();
    await input.fill(String(value));
    await advanced.getByRole('button', { name: '审阅并记录' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('执行原因（写入审计）').fill(auditReason);
    await dialog.getByRole('button', { name: '确认记录配置' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(auditReason, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
  };

  try {
    await loginByForm(page, admin);
    await page.goto('/admin/plans');
    const advanced = page.locator('details', {
      hasText: '高级配置与版本历史',
    });
    await advanced.getByText('高级配置与版本历史').click();
    await advanced.locator('#admin-runtime-config-key').selectOption(key);
    const form = advanced.getByTestId(`admin-config-form-${key}`);
    await expect(form).toBeVisible({ timeout: 30_000 });
    const input = form.getByRole('textbox', {
      name: '商家决策保留期（秒）',
    });
    original = Number((await input.inputValue()).replaceAll(',', ''));
    expect(original).toBeGreaterThanOrEqual(3_600);
    expect(original).toBeLessThanOrEqual(172_800);
    const target = original === 3_600 ? 3_601 : 3_600;
    await applyHold(target, reason);
  } finally {
    if (original !== undefined) {
      await applyHold(original, `${reason} (restore to ${original})`).catch(
        () => undefined
      );
    }
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
