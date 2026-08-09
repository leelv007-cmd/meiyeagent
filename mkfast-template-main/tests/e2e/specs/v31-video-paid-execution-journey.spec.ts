import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import {
  seedComposerInlineAuthorize,
  seedConfirmedStore,
} from '../fixtures/product';
import {
  closeComposerCapsule,
  openComposerRecipeCard,
  selectComposerLens,
} from '../fixtures/ui-journey';

/**
 * V31-14 / V3.1 §37.4-D — 视频付费执行 journey.
 *
 * §37.4-D original text: Plan 显示时长/分镜/积分、Interrupt、关标签页、恢复、
 * 部分失败、字幕封面 assisted fallback.
 *
 * Asserted here (all four exist on this HEAD): the Plan carries 预计积分 and
 * 预计时长 before Make can spend anything, the paid start raises a typed
 * interrupt, closing the tab does not lose it, and reopening resumes the same
 * interruptId+revision through to a delivered 成片 with exactly one debit.
 *
 * Three §37.4-D legs cannot be asserted against this HEAD and are declared as
 * `test.fixme` below rather than approximated — each names its blocker and the
 * ticket that owns the debt (V31-35 / V31-36 / V31-37), so a reader can tell a
 * product gap from a missing test:
 *   1. 分镜 in the *Plan* — V31-35. `planDeliverableSchema`
 *      (`packages/contracts/src/agent-domain.ts:444-452`) is `.strict()` and
 *      carries kind/platform/quantity/purpose only, and the five Living Plan
 *      sections (`plan/living-plan-model.ts:17-33`) have no storyboard row.
 *      The shot list only exists downstream, on the worksurface
 *      (`results/video/video-worksurface.tsx:154-164`).
 *   2. 部分失败 — V31-36. Core has no video scene-failure path at all: the only partial
 *      delivery machinery is note pages (`harness/workflow-core.ts:173,2406`
 *      `unresolvedPageIds`), and the only fixture trigger is the image_text
 *      theme anchor at `model-supply/ai-sdk-runner.ts:1604`.
 *   3. 字幕/封面 assisted fallback — V31-37. #264 retired the product-owned subtitle
 *      track (`results/video/video-worksurface.tsx:117`) and its interaction
 *      test pins `video-subtitle-panel` / `video-cover-panel` as absent. The
 *      surviving per-scene surface belongs to V31-15
 *      (`agent-workbench/artifact/video-artifact.tsx:111-115`), which the
 *      2026-08-09 deep review lists as having no production producer.
 *
 * Real browser run is owned by the merge controller. Do not run full e2e here.
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

/** Submits one paid douyin 成片 and returns its server-owned taskId. */
async function submitPaidVideo(page: Page) {
  await page.goto('/dashboard');
  await seedConfirmedStore(page);
  await selectComposerLens(page, 'video');
  const authorized = await seedComposerInlineAuthorize(page, {
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
  await seedComposerInlineAuthorize(page, {
    expectedAssetId: authorized.id,
    fileName: `v31-video-${crypto.randomUUID()}.png`,
  });
  await page
    .getByTestId('composer-intent-input')
    .fill('把这张门店案例图做成一条可直接发布的抖音项目成片');
  await expect(page.getByTestId('composer-quote-line')).toBeVisible({
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
    data?: { task?: { id?: string } };
    error?: { message?: string };
  };
  expect(response.ok(), envelope.error?.message).toBeTruthy();
  expect(envelope.data?.task?.id).toBeTruthy();
  return envelope.data!.task!.id!;
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

    const taskId = await submitPaidVideo(page);

    // §37.4-D leg 1 (partial: 积分 + 时长; 分镜 is fixme'd below): the merchant
    // reads what the run will cost and how long it will be before any spend.
    const cost = page.getByTestId('agent-plan-section-cost_duration');
    await expect(cost).toBeVisible({ timeout: 120_000 });
    await expect(cost).toContainText(/预计积分\s*\d+\s*分/u);
    await expect(cost).toContainText(/预计时长/u);

    // §37.4-D leg 2: the paid start raises a typed interrupt, not a silent run.
    const start = page.getByTestId('agent-commit-strip-start');
    await expect(start).toBeEnabled({ timeout: 120_000 });
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

    const pending = page.getByTestId('agent-pending-interrupt');
    await expect(pending).toBeVisible({ timeout: 180_000 });
    const interruptId = await pending.getAttribute('data-interrupt-id');
    const revision = await pending.getAttribute('data-interrupt-revision');
    expect(interruptId).toBeTruthy();
    expect(revision).toMatch(/^\d+$/u);

    // §37.4-D leg 3 + 4: 关标签页 then 恢复 — the same interrupt, by id and
    // revision, must be waiting in a brand new tab.
    await page.close();
    const resumed = await context.newPage();
    await resumed.goto('/dashboard');
    const resumedPending = resumed.getByTestId('agent-pending-interrupt');
    await expect(resumedPending).toHaveAttribute(
      'data-interrupt-id',
      interruptId!,
      { timeout: 180_000 }
    );
    await expect(resumedPending).toHaveAttribute(
      'data-interrupt-revision',
      revision!
    );
    await resumedPending.getByTestId('agent-interrupt-accept').click();
    await expect(
      resumed.locator(
        `[data-testid="agent-pending-interrupt"][data-interrupt-id="${interruptId}"]`
      )
    ).toHaveCount(0, { timeout: 180_000 });

    // The resumed run reaches a real 成片, and the shot list is readable —
    // on the worksurface, which is where this HEAD renders it.
    await expect(resumed.getByTestId('composer-delivery-card')).toBeVisible({
      timeout: 480_000,
    });
    await expect(resumed.getByTestId('video-worksurface')).toBeVisible({
      timeout: 120_000,
    });
    await expect(resumed.getByTestId('video-shot').first()).toBeVisible();

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

  test.fixme(
    '§37.4-D 分镜 is readable in the Plan before confirmation (blocked by V31-35: planDeliverableSchema carries no scene field)',
    async () => {
      // Needs a storyboard coordinate on the plan revision contract plus a
      // Living Plan row projecting it. Until then the shot list only exists
      // after Make, on video-worksurface / the V31-15 artifact.
    }
  );

  test.fixme(
    '§37.4-D 部分失败 delivers the scenes that succeeded (blocked by V31-36: Core has no video scene-failure path)',
    async () => {
      // Needs a scene-level partial result in the video harness, mirroring the
      // note path's unresolvedPageIds, before a journey can produce one.
    }
  );

  test.fixme(
    '§37.4-D 字幕/封面 fall back to assisted (blocked by V31-37: #264 retired the panels; the artifact surface has no producer)',
    async () => {
      // Needs either a §37.4 amendment recognising #264, or a production
      // producer for the V31-15 per-scene subtitle/cover artifact fields.
    }
  );
});
