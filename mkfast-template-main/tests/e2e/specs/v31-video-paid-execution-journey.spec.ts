import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { attachComposerSourceViaLibrary } from '../fixtures/library-source';
import { seedConfirmedStore } from '../fixtures/product';
import {
  closeComposerCapsule,
  openComposerRecipeCard,
  selectComposerLens,
} from '../fixtures/ui-journey';

/**
 * V31-14 / V3.1 §37.4-D — 视频付费执行 journey.
 *
 * §37.4-D current text (amended 2026-08-11, V31-35 void + V31-37 path A):
 * Plan 显示时长/积分、Interrupt、关标签页、恢复、部分失败；字幕/封面不交付——
 * 旅程断言「不承诺字幕轨/封面面板」（#264 retirement acknowledged; captions
 * are owned by the publishing platforms). 分镜 is not a Plan-phase promise:
 * upstream providers have no per-scene billing rule, storyboards only feed
 * prompt generation, so merchants are not shown storyboard/credit relations
 * (V31-35 voided by the same decision; the shot list still renders after Make
 * on the worksurface and the V31-15 artifact).
 *
 * Asserted here: the Plan carries 预计积分 and billed 成片 预计时长 (seconds
 * from the signed deliverable — not a wait-time invention; V31-35 voided
 * 分镜) before Make can spend anything. V31-56 开始制作 is billing consent
 * (video has no in-run 图文方向 interrupt). Closing the tab after delivery
 * restores the same workId with exactly one debit. The delivered surface
 * promises no subtitle track or cover panel (V31-37 decision, 2026-08-11).
 *
 * §37.4-D 部分失败 (V31-36): Core now owns scene-level results + partial
 * settlement. The journey body below drives the deterministic fixture anchor
 * `视频部分失败样本` and asserts Core-authored report + ProductUsage (not
 * client file-missing inference). Real browser run is owned by the merge
 * controller; do not run full e2e in local ticket lanes.
 */

type ProductUsageReceipt = {
  refundedCredits?: number;
  reservedCredits?: number;
  settledCredits?: number;
  status?: string;
};

async function p1Query<T>(
  page: Page,
  module: string,
  action: string,
  payload: Record<string, unknown> = {}
): Promise<T> {
  return page.evaluate(
    async ({ queryAction, queryModule, queryPayload }) => {
      const response = await fetch('/api/core/p1/query', {
        body: JSON.stringify({
          action: queryAction,
          module: queryModule,
          payload: queryPayload,
        }),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      const envelope = (await response.json()) as {
        data?: unknown;
        error?: { message?: string };
      };
      if (!response.ok || envelope.data === undefined) {
        throw new Error(
          envelope.error?.message ??
            `${queryModule}.${queryAction} query failed`
        );
      }
      return envelope.data;
    },
    { queryAction: action, queryModule: module, queryPayload: payload }
  ) as Promise<T>;
}

async function productUsage(page: Page, taskId: string) {
  return p1Query<ProductUsageReceipt>(page, 'product-billing', 'get_usage', {
    taskId,
  });
}

/** Submits one paid douyin 成片 and returns server-owned task/work ids. */
async function submitPaidVideo(page: Page) {
  await page.goto('/dashboard');
  await seedConfirmedStore(page);
  await selectComposerLens(page, 'video');
  const authorized = await attachComposerSourceViaLibrary(page, {
    fileName: `v31-video-${crypto.randomUUID()}.png`,
  });
  // A reload unmounts every capsule, so re-select the lens before the recipe.
  await page.reload();
  await selectComposerLens(page, 'video');
  const recipePanel = await openComposerRecipeCard(
    page,
    'composer-recipe-card-recipe.douyin_project_video'
  );
  await expect(page.getByTestId('composer-recipe-apply-undo')).toBeVisible();
  await closeComposerCapsule(page, recipePanel);
  await attachComposerSourceViaLibrary(page, {
    expectedAssetId: authorized.id,
    fileName: `v31-video-${crypto.randomUUID()}.png`,
  });
  await page
    .getByTestId('composer-intent-input')
    .fill('把这张门店案例图做成一条可直接发布的抖音项目成片');
  await expect(
    page
      .getByTestId('workbench-credit-quote')
      .or(page.getByTestId('composer-quote-line'))
  ).toBeVisible({
    timeout: 60_000,
  });
  const submission = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/core/p1/composer/submissions'),
    { timeout: 120_000 }
  );
  await page.getByTestId('composer-submit').click();

  // The video contract confirms a Brief before the submission lands
  // (JOURNEY_CONTRACTS video = lens + submit + Brief confirm + 确认执行).
  const brief = page.getByTestId('composer-brief-surface');
  await expect(brief).toBeVisible({ timeout: 60_000 });
  const confirmBrief = brief.getByTestId('composer-brief-confirm');
  await expect(confirmBrief).toBeEnabled();
  await confirmBrief.click();

  const response = await submission;
  const envelope = (await response.json()) as {
    data?: { task?: { id?: string }; work?: { id?: string } };
    error?: { message?: string };
  };
  expect(response.ok(), envelope.error?.message).toBeTruthy();
  expect(envelope.data?.task?.id).toBeTruthy();
  expect(envelope.data?.work?.id).toBeTruthy();
  return {
    taskId: envelope.data!.task!.id!,
    workId: envelope.data!.work!.id!,
  };
}

test.describe('V31-14 paid video execution journey (§37.4-D)', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('the Plan prices the 成片 before Make, and a closed tab resumes the same interrupt through to delivery', async ({
    context,
    page,
    request,
  }) => {
    test.setTimeout(600_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    const { taskId, workId } = await submitPaidVideo(page);

    // §37.4-D leg 1 (积分 + billed 成片 seconds; 分镜 is not a Plan-phase
    // promise since the 2026-08-11 V31-35 void).
    const cost = page.getByTestId('agent-plan-section-cost_duration');
    await expect(cost).toBeVisible({ timeout: 120_000 });
    await expect(cost).toContainText(/预计积分\s*\d+\s*分/u);
    await expect(cost).toContainText(/预计时长\s*\d+\s*秒/u);

    // §37.4-D leg 2: the paid start raises a typed interrupt, not a silent run.
    const start = page.getByTestId('agent-commit-strip-start');
    await expect(page.getByTestId('agent-commit-strip')).toHaveAttribute(
      'data-start-disabled',
      'false',
      { timeout: 120_000 }
    );
    await expect(start).toBeEnabled();
    const startResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/api\/core\/p1\/composer\/tasks\/[^/]+\/start$/u.test(
          new URL(response.url()).pathname
        ),
      { timeout: 120_000 }
    );
    await start.click();
    expect((await startResponse).ok()).toBeTruthy();

    // V31-56: 开始制作 is billing consent. Video has no in-run 图文方向
    // interrupt. The 202 above is the durable boundary — Core has persisted
    // the start — so close the tab right here, which is the deepest point
    // inside the in-flight window (fixture video leaves it ~6.5s wide) and
    // keeps 关标签页/恢复 an in-flight paid run rather than a finished persist
    // that never re-emits delivery.
    //
    // Do not gate this on commit-strip copy: since f90b29725 (2026-08-20) the
    // strip freezes only on delivered/failed (已经做好 / 没做成) and carries no
    // in-flight state at all. §5.4 never promised one, and §5.5 puts 当前阶段
    // on the Workstream, which does narrate the run while it is in flight.
    await page.close();
    const resumed = await context.newPage();
    await resumed.goto('/dashboard');
    const resumedDelivery = resumed.locator(
      `[data-testid="composer-delivery-card"][data-work-id="${workId}"]`
    );
    await expect(resumedDelivery).toBeVisible({ timeout: 480_000 });
    await expect(resumed.getByTestId('agent-artifact-video')).toBeVisible({
      timeout: 120_000,
    });
    await expect(
      resumed.getByTestId('agent-artifact-video-scene').first()
    ).toBeVisible();

    // §37.4-D 字幕/封面 (amended 2026-08-11, V31-37 path A): the delivered
    // surface must not promise a subtitle track or cover panel — #264 retired
    // them; captions are owned by the publishing platforms.
    await expect(resumed.getByTestId('video-subtitle-panel')).toHaveCount(0);
    await expect(resumed.getByTestId('video-cover-panel')).toHaveCount(0);
    await expect(
      resumed.getByTestId('agent-artifact-scene-subtitle')
    ).toHaveCount(0);
    await expect(resumed.getByTestId('agent-artifact-scene-cover')).toHaveCount(
      0
    );

    // One paid Work, one debit — a resume must not re-charge.
    await expect
      .poll(async () => (await productUsage(resumed, taskId)).status, {
        timeout: 180_000,
      })
      .toBe('committed');
    const usage = await productUsage(resumed, taskId);
    expect(usage.settledCredits).toBe(usage.reservedCredits);
    expect(usage.refundedCredits ?? 0).toBe(0);
  });

  test('§37.4-D 部分失败 delivers the scenes that succeeded (V31-36 Core scene result + settlement)', async ({
    page,
    request,
  }) => {
    test.setTimeout(600_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    // Fixture anchor → three scenes, last fails not_called (bill 2 of 3).
    await page.goto('/dashboard');
    await seedConfirmedStore(page);
    await selectComposerLens(page, 'video');
    const authorized = await attachComposerSourceViaLibrary(page, {
      fileName: `v31-video-partial-${crypto.randomUUID()}.png`,
    });
    await page.reload();
    await selectComposerLens(page, 'video');
    const recipePanel = await openComposerRecipeCard(
      page,
      'composer-recipe-card-recipe.douyin_project_video'
    );
    await expect(page.getByTestId('composer-recipe-apply-undo')).toBeVisible();
    await closeComposerCapsule(page, recipePanel);
    await attachComposerSourceViaLibrary(page, {
      expectedAssetId: authorized.id,
      fileName: `v31-video-partial-${crypto.randomUUID()}.png`,
    });
    await page
      .getByTestId('composer-intent-input')
      .fill(
        '把这张门店案例图做成抖音项目成片，视频部分失败样本，用于验收场景级部分失败'
      );
    await expect(
      page
        .getByTestId('workbench-credit-quote')
        .or(page.getByTestId('composer-quote-line'))
    ).toBeVisible({
      timeout: 60_000,
    });
    const submission = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/core/p1/composer/submissions'),
      { timeout: 120_000 }
    );
    await page.getByTestId('composer-submit').click();
    const brief = page.getByTestId('composer-brief-surface');
    await expect(brief).toBeVisible({ timeout: 60_000 });
    await brief.getByTestId('composer-brief-confirm').click();
    const response = await submission;
    const envelope = (await response.json()) as {
      data?: { task?: { id?: string } };
      error?: { message?: string };
    };
    expect(response.ok(), envelope.error?.message).toBeTruthy();
    const taskId = envelope.data!.task!.id!;

    const start = page.getByTestId('agent-commit-strip-start');
    await expect(page.getByTestId('agent-commit-strip')).toHaveAttribute(
      'data-start-disabled',
      'false',
      { timeout: 120_000 }
    );
    await expect(start).toBeEnabled();
    await start.click();

    // V31-56: video Make does not raise agent-pending-interrupt. The fixture
    // must surface Core's partial report (usable scenes may still show a 成片).
    const report = page.getByTestId('composer-report-card');
    await expect(report).toBeVisible({ timeout: 480_000 });
    await expect(report).toHaveAttribute('data-report-kind', 'partial');
    await expect(page.getByTestId('composer-report-reason')).toContainText(
      /第\s*3\s*个镜头没有做成|已完成\s*2\s*个镜头/u
    );

    // Artifact consumes Core keyframeStatus — failed scene is named by index.
    const failedScene = page.locator(
      '[data-testid="agent-artifact-video-scene"][data-keyframe-status="failed"]'
    );
    await expect(failedScene.first()).toBeVisible({ timeout: 120_000 });
    await expect(failedScene.first()).toHaveAttribute('data-scene-index', '2');

    // Settlement: partial not_called bills fewer units than reserved when
    // failureRefundsCredits is on; at minimum status is not a full silent charge.
    await expect
      .poll(async () => (await productUsage(page, taskId)).status, {
        timeout: 180_000,
      })
      .toMatch(/committed|partially_refunded/u);
    const usage = await productUsage(page, taskId);
    if (
      typeof usage.settledCredits === 'number' &&
      typeof usage.reservedCredits === 'number' &&
      usage.reservedCredits > 0
    ) {
      // 2 of 3 billable → settled ≤ reserved; not_called must not full-charge.
      expect(usage.settledCredits).toBeLessThanOrEqual(usage.reservedCredits);
    }
  });
});
