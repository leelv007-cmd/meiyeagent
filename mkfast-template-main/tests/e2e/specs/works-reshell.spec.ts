import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { measureContrast } from '../fixtures/contrast';
import { seedConfirmedStore } from '../fixtures/product';
import { setTheme } from '../fixtures/page-health';
import { installWorksBrowserFixtures } from '../fixtures/works';

/**
 * T32 / #226 — 作品与对象页换壳.
 *
 * The journey the ticket buys: 完成一次创作 → 新作品面列表可见 → 详情 revision 与
 * 交付卡一致 → 导出动作成功. Everything here runs against real core: the
 * delivery card's binding and the works detail's binding are two independent
 * reads of the same canonical projection, and 「一致」 is only an assertion if
 * both are read for real.
 *
 * Four-output rendering has both a deterministic component test and a runnable
 * browser fixture below. The live journey separately proves the shape produced
 * by the real creation and delivery chain.
 */

type SubmissionResult = { taskId: string; workId: string };

/**
 * 图文 setup — the 促销海报 recipe on a 0-source run, which is the shape the
 * image-intent journeys prove adopts and `result_export`s end to end. The
 * recipe takes its facts from the intent, so nothing has to be uploaded: an
 * upload left half-confirmed only puts `submitDisabled` back on through
 * `!uploadsReady`.
 */
async function applyImageNoteRecipe(page: Page) {
  await page
    .getByTestId('composer-recipe-card-recipe.promotion_poster')
    .click();
  // The composer asks first only when the recipe would rewrite settings the
  // merchant can already see (发到哪 / 交付物 / 生成方式); when they already match
  // it applies straight away. Both endings are correct, so wait for either —
  // and an unanswered dialog would block every control underneath it.
  const patchPreview = page.getByTestId('composer-recipe-patch-preview');
  const applied = page.getByTestId('composer-recipe-apply-undo');
  await expect(patchPreview.or(applied).first()).toBeVisible({
    timeout: 30_000,
  });
  if (await patchPreview.isVisible()) {
    await page.getByTestId('composer-patch-confirm').click();
  }
  await expect(applied).toBeVisible({ timeout: 30_000 });
}

/** Same entry the T31 card-family spec uses — one real creation, real core. */
async function startRun(
  page: Page,
  intent: string,
  lens: 'copy' | 'image_text' = 'copy'
): Promise<SubmissionResult> {
  await page.goto('/dashboard');
  await page.getByTestId(`composer-lens-option-${lens}`).click();
  if (lens === 'image_text') await applyImageNoteRecipe(page);
  await page.getByTestId('composer-intent-input').fill(intent);
  if (lens === 'image_text') {
    // 促销海报 lands on 线下物料; the 作品 has to be bound to a platform core can
    // export, and 小红书 is the one the image journeys export. The reshelled
    // composer asks 发到哪 with chips — the older `#composer-setting-input-
    // platform` select the image-intent spec still drives is gone.
    const destination = page.getByTestId(
      'composer-destination-option-xiaohongshu'
    );
    await expect(destination).toBeVisible({ timeout: 30_000 });
    if ((await destination.getAttribute('aria-pressed')) !== 'true') {
      await destination.click();
    }
    await expect(destination).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(page.getByTestId('composer-quote-line')).toBeVisible({
    timeout: 30_000,
  });
  // A disabled 提交 would otherwise surface as a request that never happens.
  await expect(page.getByTestId('composer-submit')).toBeEnabled({
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
async function deliverOnce(
  page: Page,
  intent: string,
  lens: 'copy' | 'image_text' = 'copy'
) {
  const run = await startRun(page, intent, lens);
  const deliveryTurn = page.getByTestId('composer-delivery-turn');
  await expect(deliveryTurn).toBeVisible({ timeout: 300_000 });
  const packageId = await deliveryTurn.getAttribute('data-package-id');
  const versionId = await deliveryTurn.getAttribute('data-version-id');
  const revision = await deliveryTurn.getAttribute('data-revision');
  expect(packageId, '交付卡 must bind a package').toBeTruthy();
  expect(versionId, '交付卡 must bind a version').toBeTruthy();
  return { packageId: packageId!, revision, run, versionId: versionId! };
}

/**
 * 采用 through the canonical `adopt_harness_candidate` command — the same one
 * Result Center issues for a harness-selected candidate. Adoption is what moves
 * a ContentPackage to `accepted`, which is core's precondition for any export.
 */
async function adoptDelivered(page: Page, packageId: string) {
  return page.evaluate(async (id: string) => {
    const read = await fetch('/api/core/p1/query', {
      body: JSON.stringify({
        module: 'operations',
        action: 'content_packages',
        payload: {},
      }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const projection = (await read.json()) as {
      data?: Array<{
        id: string;
        currentVersionId?: string;
        harnessSelection?: { recommendedCandidateId?: string };
        revision: number;
        versions: Array<{ id: string; harnessCandidateId?: string }>;
      }>;
    };
    const target = projection.data?.find((item) => item.id === id);
    const candidateId =
      target?.harnessSelection?.recommendedCandidateId ??
      target?.versions.find((version) => version.id === target.currentVersionId)
        ?.harnessCandidateId;
    if (!target || !candidateId) {
      return { message: 'no harness candidate to adopt', ok: false };
    }
    const response = await fetch('/api/core/p1/commands', {
      body: JSON.stringify({
        module: 'operations',
        action: 'adopt_harness_candidate',
        payload: {
          candidateId,
          expectedRevision: target.revision,
          packageId: id,
        },
      }),
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': `t32-adopt:${id}:${target.revision}`,
      },
      method: 'POST',
    });
    const envelope = (await response.json()) as {
      error?: { message?: string };
    };
    return { message: envelope.error?.message ?? '', ok: response.ok };
  }, packageId);
}

test.describe('T32 作品面换壳', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('创作 → 作品列表 → 详情 revision 与交付卡一致 → 导出成功', async ({
    page,
    request,
  }) => {
    test.setTimeout(600_000);
    // The surface never shows a merchant a server sentence (D-116), so a failed
    // canonical command would otherwise be invisible here too.
    const commandFailures: string[] = [];
    page.on('response', async (response) => {
      if (response.ok() || !response.url().includes('/api/core/p1/commands'))
        return;
      commandFailures.push(
        `${response.status()} ${await response.text().catch(() => '')}`
      );
    });
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    // 图文, not 文案: core builds the delivery ZIP out of the variant's images
    // and refuses to build one without any, so 导出动作成功 can only be proven
    // on a 作品 that carries media.
    const delivered = await deliverOnce(
      page,
      '生成一张门店夏日护理海报',
      'image_text'
    );

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

    // Straight out of a run the 成品 is delivered but not adopted, and core
    // exports an adopted 成品 only. The surface must say so — 采用 doorway, no
    // 导出 button that would only produce a server error.
    await expect(page.getByTestId('works-action-adopt')).toBeVisible();
    await expect(page.getByTestId('works-action-export')).toHaveCount(0);

    // Adopt through the canonical command (the same one Result Center issues),
    // then the 作品 is exportable.
    const adopted = await adoptDelivered(page, delivered.packageId);
    expect(adopted.ok, adopted.message).toBeTruthy();
    await page.reload();

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
    await expect(async () => {
      expect(
        commandFailures,
        '导出 must not fail on the canonical seam'
      ).toEqual([]);
      await expect(page.getByTestId('works-export-download')).toBeVisible({
        timeout: 1_000,
      });
    }).toPass({ timeout: 120_000 });
    await expect(page.getByTestId('works-action-error')).toHaveCount(0);
  });

  test('浏览器逐一呈现文案、图片、图文和视频四类 canonical fixture', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await installWorksBrowserFixtures(page);
    await loginByForm(page, user);

    await page.goto('/dashboard/works');
    await expect(page.getByTestId('works-list')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId('works-card')).toHaveCount(4);
    await expect
      .poll(() =>
        page
          .getByTestId('works-card')
          .evaluateAll((cards) =>
            cards.map((card) => card.getAttribute('data-output-shape'))
          )
      )
      .toEqual(['copy', 'image', 'note', 'video']);

    const shapes = [
      {
        id: 'fixture-copy',
        label: '文案',
        mediaKind: null,
        title: '护理预约文案',
      },
      {
        id: 'fixture-image',
        label: '图片',
        mediaKind: 'image',
        title: '门店护理主图',
      },
      {
        id: 'fixture-note',
        label: '图文',
        mediaKind: 'image',
        title: '夏日护理图文笔记',
      },
      {
        id: 'fixture-video',
        label: '视频',
        mediaKind: 'video',
        title: '到店护理成片',
      },
    ] as const;

    for (const shape of shapes) {
      await test.step(shape.label, async () => {
        await page.goto(`/dashboard/works/${shape.id}`);
        await expect(page.getByTestId('works-detail-shape')).toHaveText(
          shape.label
        );
        await expect(
          page.getByRole('heading', { name: shape.title })
        ).toBeVisible();
        await expect(page.getByTestId('works-detail-revision')).toHaveAttribute(
          'data-revision',
          '7'
        );
        await expect(page.getByTestId('works-detail-guidance')).toBeVisible();
        await expect(page.getByTestId('works-action-copy')).toBeVisible();
        if (shape.mediaKind) {
          await expect(
            page.locator(
              `[data-testid="works-media-gallery"] [data-media-kind="${shape.mediaKind}"]`
            )
          ).toBeVisible();
        } else {
          await expect(page.getByTestId('works-media-gallery')).toHaveCount(0);
        }
        if (shape.id === 'fixture-video') {
          const video = page.locator(
            '[data-testid="works-media-gallery"] [data-media-kind="video"] video'
          );
          await expect(video).toHaveAttribute('src', /fixture-video-asset/u);
          const playback = await video.evaluate(async (element) => {
            const media = element as HTMLVideoElement;
            media.loop = true;
            media.currentTime = 0;
            if (media.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
              await new Promise<void>((resolve, reject) => {
                media.addEventListener('canplay', () => resolve(), {
                  once: true,
                });
                media.addEventListener(
                  'error',
                  () => reject(media.error ?? new Error('video load failed')),
                  { once: true }
                );
              });
            }
            await media.play();
            const presentedFrames = await new Promise<number>((resolve) => {
              media.requestVideoFrameCallback((_now, metadata) => {
                resolve(metadata.presentedFrames);
              });
            });
            return {
              duration: media.duration,
              ended: media.ended,
              paused: media.paused,
              presentedFrames,
              readyState: media.readyState,
            };
          });
          expect(playback.readyState).toBeGreaterThanOrEqual(2);
          expect(playback.duration).toBeGreaterThan(0);
          expect(playback.ended).toBe(false);
          expect(playback.paused).toBe(false);
          expect(playback.presentedFrames).toBeGreaterThan(0);
          await expect(page.getByTestId('works-video-readonly')).toContainText(
            '历史档案'
          );
          await expect(page.getByTestId('works-video-readonly')).toContainText(
            '只读'
          );
          await expect(page.getByTestId('works-video-readonly')).toContainText(
            '不能继续确认、编辑或导出'
          );
          await expect(
            page.getByTestId('works-video-confirm-unavailable')
          ).toBeDisabled();
          await expect(page.getByTestId('works-action-export')).toHaveCount(0);
          await expect(page.getByTestId('works-action-adopt')).toHaveCount(0);
          await expect(page.getByTestId('works-action-handoff')).toHaveCount(0);
          await expect(page.getByTestId('works-action-light-edit')).toHaveCount(
            0
          );
          await expect(page.getByText('继续调整', { exact: true })).toHaveCount(
            0
          );
        }
      });
    }
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
        // Screenshot the loaded 作品 面, not the moment before the rows arrive —
        // an empty list is no evidence of a walkthrough.
        await expect(
          page.locator(
            `[data-testid="works-card"][data-work-id="${delivered.packageId}"]`
          )
        ).toBeVisible({ timeout: 60_000 });

        // 四类输出筛选器 is a vendored component painted with HeroUI's `--muted`;
        // measured, not assumed (DESIGN.md:259 holds component output to the
        // same contrast rule as hand-written markup).
        const filterContrast = await measureContrast(page, 'works-shape-copy');
        // eslint-disable-next-line no-console
        console.log(
          `[contrast] ${theme}/${viewport.label} works-shape-copy = ${filterContrast.ratio}:1 ` +
            `color=${filterContrast.color} ${filterContrast.tokens} ` +
            `fg=${filterContrast.foreground} bg=${filterContrast.backdrop}`
        );
        expect(
          filterContrast.ratio,
          `${theme}/${viewport.label} 四类输出筛选器 contrast`
        ).toBeGreaterThanOrEqual(4.5);

        await page.screenshot({
          fullPage: true,
          path: `../.scratch/t32-works-reshell-2026-07-26/works-list-${viewport.label}-${theme}.png`,
        });

        await page.goto(`/dashboard/works/${delivered.packageId}`);
        await expect(page.getByTestId('works-detail-revision')).toBeVisible({
          timeout: 60_000,
        });

        // 氛围层页头 — DESIGN.md:251 requires ≥4.5:1 measured in both themes for
        // every .meiye-ambient-copy header, and these two are the ticket's
        // headline binding.
        for (const testId of ['works-detail-status', 'works-detail-revision']) {
          const sample = await measureContrast(page, testId);
          // eslint-disable-next-line no-console
          console.log(
            `[contrast] ${theme}/${viewport.label} ${testId} = ${sample.ratio}:1 ` +
              `color=${sample.color} ${sample.tokens} ` +
              `fg=${sample.foreground} bg=${sample.backdrop}`
          );
          expect(
            sample.ratio,
            `${theme}/${viewport.label} ${testId} contrast`
          ).toBeGreaterThanOrEqual(4.5);
        }

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
