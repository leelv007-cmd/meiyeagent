import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { seedConfirmedStore } from '../fixtures/product';
import { setTheme } from '../fixtures/page-health';

/**
 * T32 / #226 — 作品与对象页换壳.
 *
 * The journey the ticket buys: 完成一次创作 → 新作品面列表可见 → 详情 revision 与
 * 交付卡一致 → 导出动作成功. Everything here runs against real core: the
 * delivery card's binding and the works detail's binding are two independent
 * reads of the same canonical projection, and 「一致」 is only an assertion if
 * both are read for real.
 *
 * 四类输出 rendering has a deterministic twin in
 * src/product/works/works-list.interaction.test.tsx (fixture 产物 for all four
 * shapes); this file proves the shape the live run actually produces.
 */

type SubmissionResult = { taskId: string; workId: string };

/** Same entry the T31 card-family spec uses — one real creation, real core. */
async function startRun(page: Page, intent: string): Promise<SubmissionResult> {
  await page.goto('/dashboard');
  await page.getByTestId('composer-lens-option-copy').click();
  await page.getByTestId('composer-intent-input').fill(intent);
  await expect(page.getByTestId('composer-quote-line')).toBeVisible({
    timeout: 30_000,
  });

  const requestPromise = page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      request.url().includes('/api/core/p1/composer/submissions'),
    { timeout: 120_000 }
  );
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/core/p1/composer/submissions'),
    { timeout: 120_000 }
  );
  await page.getByTestId('composer-submit').click();

  const briefSurface = page.getByTestId('composer-brief-surface');
  const next = await Promise.race([
    briefSurface
      .waitFor({ state: 'visible', timeout: 60_000 })
      .then(() => 'brief' as const)
      .catch(() => 'submission' as const),
    requestPromise.then(() => 'submission' as const),
  ]);
  if (next === 'brief')
    await page.getByTestId('composer-brief-confirm').click();

  await requestPromise;
  const response = await responsePromise;
  const envelope = (await response.json()) as {
    data?: { work?: { id?: string }; task?: { id?: string } };
    error?: { message?: string };
  };
  expect(response.ok(), envelope.error?.message).toBeTruthy();
  return {
    taskId: envelope.data?.task?.id ?? '',
    workId: envelope.data?.work?.id ?? '',
  };
}

/** Runs the creation and returns what the 交付卡 bound itself to. */
async function deliverOnce(page: Page, intent: string) {
  const run = await startRun(page, intent);
  const deliveryTurn = page.getByTestId('composer-delivery-turn');
  await expect(deliveryTurn).toBeVisible({ timeout: 300_000 });
  const packageId = await deliveryTurn.getAttribute('data-package-id');
  const versionId = await deliveryTurn.getAttribute('data-version-id');
  const revision = await deliveryTurn.getAttribute('data-revision');
  expect(packageId, '交付卡 must bind a package').toBeTruthy();
  expect(versionId, '交付卡 must bind a version').toBeTruthy();
  return { packageId: packageId!, revision, run, versionId: versionId! };
}

test.describe('T32 作品面换壳', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('创作 → 作品列表 → 详情 revision 与交付卡一致 → 导出成功', async ({
    page,
    request,
  }) => {
    test.setTimeout(600_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    const delivered = await deliverOnce(page, '写一条新客皮肤护理到店体验文案');

    // ① 新作品面列表可见 — and it is the new surface, not the old aggregate.
    await page.goto('/dashboard/works');
    await expect(page.getByTestId('works-surface')).toBeVisible({
      timeout: 60_000,
    });
    const card = page.locator(
      `[data-testid="works-card"][data-work-id="${delivered.packageId}"]`
    );
    await expect(card).toBeVisible({ timeout: 60_000 });
    // 唯一投影: every row goes to the works route, never back to a legacy
    // object/content deep link.
    const hrefs = await page
      .getByTestId('works-card')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('href') ?? '')
      );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(href).toContain('/dashboard/works/');

    // ② 详情 revision 与交付卡一致.
    await card.click();
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/works/${delivered.packageId}`, 'u'),
      { timeout: 60_000 }
    );
    const revisionBadge = page.getByTestId('works-detail-revision');
    await expect(revisionBadge).toBeVisible({ timeout: 60_000 });
    await expect(revisionBadge).toHaveAttribute(
      'data-package-id',
      delivered.packageId
    );
    await expect(revisionBadge).toHaveAttribute(
      'data-version-id',
      delivered.versionId
    );
    if (delivered.revision !== null) {
      await expect(revisionBadge).toHaveAttribute(
        'data-revision',
        delivered.revision
      );
    }

    // 生成依据与使用导购 are on the page, in merchant words.
    await expect(page.getByTestId('works-detail-guidance')).toBeVisible();

    // ③ 导出动作成功 — the canonical result_export command, bound to this
    // revision, and a real download handed back.
    const exportRequest = page.waitForRequest(
      (candidate) =>
        candidate.method() === 'POST' &&
        candidate.url().includes('/api/core/p1/commands') &&
        JSON.stringify(candidate.postDataJSON() ?? {}).includes(
          'result_export'
        ),
      { timeout: 120_000 }
    );
    await page.getByTestId('works-action-export').click();
    const posted = (await exportRequest).postDataJSON() as {
      call?: { payload?: { packageId?: string; expectedRevision?: number } };
      payload?: { packageId?: string; expectedRevision?: number };
    };
    const serialized = JSON.stringify(posted);
    expect(serialized, '导出 must carry the confirmed package').toContain(
      delivered.packageId
    );
    await expect(page.getByTestId('works-export-download')).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByTestId('works-action-error')).toHaveCount(0);
  });

  test('轻编辑入口可达且能力核照常挂载', async ({ page, request }) => {
    test.setTimeout(600_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    const delivered = await deliverOnce(page, '写一条到店头皮护理的短文案');

    // The canonical ContentPackage → 轻编辑 seam: the same command the export
    // carrier issues (create_work_from_content_package), then the works route.
    const created = await page.evaluate(
      async (input: { packageId: string; versionId: string }) => {
        const response = await fetch('/api/core/p1/commands', {
          body: JSON.stringify({
            module: 'operations',
            action: 'create_work_from_content_package',
            payload: {
              height: 1350,
              sourcePackageId: input.packageId,
              sourceVersionId: input.versionId,
              width: 1080,
            },
          }),
          credentials: 'same-origin',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': `t32-light-edit-${input.packageId}`,
          },
          method: 'POST',
        });
        const envelope = (await response.json()) as {
          data?: { id?: string };
          error?: { message?: string };
        };
        return { id: envelope.data?.id, message: envelope.error?.message };
      },
      { packageId: delivered.packageId, versionId: delivered.versionId }
    );
    expect(created.id, created.message).toBeTruthy();

    // The 轻编辑 work is a 作品 row, so the entry is reachable from the list.
    await page.goto('/dashboard/works');
    await expect(
      page.locator(`[data-testid="works-card"][data-work-id="${created.id}"]`)
    ).toBeVisible({ timeout: 60_000 });

    await page.goto(`/dashboard/works/${created.id}`);
    await expect(page.getByTestId('works-light-edit-surface')).toBeVisible({
      timeout: 60_000,
    });
    // LightComposerCanvas itself — the KEEP capability core, unchanged.
    await expect(page.getByRole('heading', { name: '日常轻编辑' })).toBeVisible(
      {
        timeout: 60_000,
      }
    );
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`作品面在 ${theme} 主题下的桌面与移动端实走`, async ({
      page,
      request,
    }) => {
      test.setTimeout(600_000);
      const user = await registerE2EUser(request);
      await loginByForm(page, user);
      await seedConfirmedStore(page);
      await setTheme(page, theme);

      const delivered = await deliverOnce(page, '写一条周末到店护理的文案');

      for (const viewport of [
        { height: 844, label: 'mobile', width: 390 },
        { height: 900, label: 'desktop', width: 1440 },
      ]) {
        await page.setViewportSize({
          height: viewport.height,
          width: viewport.width,
        });

        await page.goto('/dashboard/works');
        await expect(page.locator('html')).toHaveClass(
          new RegExp(`\\b${theme}\\b`, 'u')
        );
        await expect(page.getByTestId('works-surface')).toBeVisible({
          timeout: 60_000,
        });
        await expect(page.getByTestId('works-shape-filter')).toBeVisible();
        await page.screenshot({
          fullPage: true,
          path: `../.scratch/t32-works-reshell-2026-07-26/works-list-${viewport.label}-${theme}.png`,
        });

        await page.goto(`/dashboard/works/${delivered.packageId}`);
        await expect(page.getByTestId('works-detail-revision')).toBeVisible({
          timeout: 60_000,
        });
        await page.screenshot({
          fullPage: true,
          path: `../.scratch/t32-works-reshell-2026-07-26/works-detail-${viewport.label}-${theme}.png`,
        });

        // Nothing may scroll the page sideways.
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth
        );
        expect(
          overflow,
          `${viewport.label}/${theme} sideways scroll`
        ).toBeLessThanOrEqual(1);
      }
    });
  }
});
