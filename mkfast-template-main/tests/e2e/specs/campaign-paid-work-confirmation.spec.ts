/** V31 U7: one visible Campaign creates two sequential paid Works. */
import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { seedConfirmedStore } from '../fixtures/product';
import {
  closeComposerCapsule,
  openComposerRecipeCard,
  selectComposerLens,
} from '../fixtures/ui-journey';

test.describe('V31 Campaign paid Work lifecycle (U7)', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('one visible Campaign gates plan_only, Work 1 and Work 2 independently', async ({
    page,
    request,
  }) => {
    test.setTimeout(420_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await page.goto('/dashboard');
    await seedConfirmedStore(page);
    // promotion_poster is offline_material poster (studio kind `image`), not
    // image_text_note — product has no 图文方向 fork on this recipe
    // (image-intent-service-journeys documents the same).
    await selectComposerLens(page, 'image_text');
    const recipePanel = await openComposerRecipeCard(
      page,
      'composer-recipe-card-recipe.promotion_poster'
    );
    await closeComposerCapsule(page, recipePanel);

    await page.getByTestId('campaign-paid-work-toggle').check();
    await page
      .getByTestId('campaign-second-work-intent')
      .fill('Campaign 第二周：生成一张补水护理海报');
    await page
      .getByTestId('composer-intent-input')
      .fill('Campaign 第一周：生成一张夏日护理海报');
    await expect(page.getByTestId('composer-quote-line')).toBeVisible({
      timeout: 60_000,
    });
    const balanceBeforePlan = await page
      .getByTestId('workbench-credit-topbar-balance')
      .textContent();
    expect(balanceBeforePlan).toBeTruthy();

    const campaignResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/core/p1/campaigns/paid-works'),
      { timeout: 120_000 }
    );
    await page.getByTestId('composer-submit').click();
    const started = await campaignResponse;
    expect(started.status(), await started.text()).toBe(202);

    const plan = page.getByTestId('campaign-plan-confirmation');
    await expect(plan).toBeVisible({ timeout: 30_000 });
    await expect(plan).toHaveAttribute('data-approval-scope', 'plan_only');
    await expect(plan).toContainText('本确认只批准计划排期，不含扣费');
    await expect(page.getByTestId('campaign-plan-reserved-credits')).toHaveText(
      '预留积分：0'
    );
    await expect(
      page.getByTestId('workbench-credit-topbar-balance')
    ).toHaveText(balanceBeforePlan!);
    await expect(page.getByTestId('campaign-work-1')).toContainText(
      'awaiting_plan_confirmation'
    );
    await expect(page.getByTestId('campaign-work-2')).toHaveCount(0);

    await page.getByTestId('campaign-plan-confirm').click();
    const work1 = page.getByTestId('campaign-work-1');
    await expect(work1).toHaveAttribute('data-work-id', /.+/u, {
      timeout: 90_000,
    });
    await assertCampaignWork(
      work1,
      1,
      await plan.getAttribute('data-campaign-plan-ref')
    );
    await expect(page.getByTestId('campaign-work-2')).toHaveCount(0);

    const firstTaskId = await requiredAttribute(work1, 'data-task-id');
    const firstAdmit = await admitPromotionPosterMake(page, firstTaskId);

    const firstWorkId = await requiredAttribute(work1, 'data-work-id');
    await expect(
      page.locator(
        `[data-testid="composer-delivery-card"][data-work-id="${firstWorkId}"]`
      )
    ).toBeVisible({ timeout: 180_000 });

    const work2 = page.getByTestId('campaign-work-2');
    await expect(work2).toHaveAttribute('data-work-id', /.+/u, {
      timeout: 90_000,
    });
    await assertCampaignWork(
      work2,
      2,
      await plan.getAttribute('data-campaign-plan-ref')
    );
    const secondTaskId = await requiredAttribute(work2, 'data-task-id');
    expect(secondTaskId).not.toEqual(firstTaskId);

    const secondWorkId = await requiredAttribute(work2, 'data-work-id');
    const secondDelivery = page.locator(
      `[data-testid="composer-delivery-card"][data-work-id="${secondWorkId}"]`
    );
    // Work 2 must not deliver before its own admit (independent single_work).
    await expect(secondDelivery).toHaveCount(0);
    const secondAdmit = await admitPromotionPosterMake(page, secondTaskId);
    expect(
      secondAdmit.proof,
      'Work 2 must take its own paid admit path, not reuse Work 1'
    ).not.toEqual(firstAdmit.proof);
    await expect(secondDelivery).toBeVisible({ timeout: 180_000 });
  });
});

async function assertCampaignWork(
  work: Locator,
  ordinal: number,
  campaignPlanRef: string | null
) {
  expect(campaignPlanRef).toBeTruthy();
  await expect(work).toHaveAttribute('data-approval-scope', 'single_work');
  await expect(work).toHaveAttribute(
    'data-campaign-plan-ref',
    campaignPlanRef!
  );
  await expect(work).toHaveAttribute('data-work-ordinal', String(ordinal));
}

async function requiredAttribute(locator: Locator, name: string) {
  const value = await locator.getAttribute(name);
  expect(value, `${name} must be present`).toBeTruthy();
  return value!;
}

/**
 * Admit Make for a promotion_poster Campaign Work.
 *
 * Product contract:
 * - poster / offline_material has no 图文方向 (note_style) fork;
 * - Living Plan commit strip decide→start records the paid confirmation and
 *   must not re-suspend on execution_confirmation (V31-56);
 * - stream-side execution_confirm remains the fallback when Living Plan is
 *   not the authority surface for this submission.
 */
async function admitPromotionPosterMake(
  page: Page,
  taskId: string
): Promise<{ proof: string }> {
  const livingStart = page.getByTestId('agent-commit-strip-start');
  const confirmation = page.getByTestId(
    'execution-confirmation-interaction-card'
  );
  // Do not click Work 1's leftover 开始制作. The host data-task-id tracks the
  // bound Campaign Work (explicitTaskId from session.task).
  await expect(
    page.getByTestId('agent-workbench-host'),
    'Living Plan start must bind this Work before 开始制作'
  ).toHaveAttribute('data-task-id', taskId, { timeout: 120_000 });
  // Plan SSE can lag the campaign work projection; wait for either admit surface.
  await expect(
    livingStart.or(confirmation).first(),
    'paid poster Work must surface Living Plan start or stream execution_confirm'
  ).toBeVisible({ timeout: 120_000 });

  if (await livingStart.isVisible().catch(() => false)) {
    await expect(livingStart).toBeEnabled({ timeout: 60_000 });
    const startResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response
          .url()
          .includes(
            `/api/core/p1/composer/tasks/${encodeURIComponent(taskId)}/start`
          ),
      { timeout: 120_000 }
    );
    await livingStart.click();
    const startResponse = await startResponsePromise;
    const startText = await startResponse.text();
    expect(
      startResponse.status(),
      `explicit start must be accepted with 202; body=${startText}`
    ).toBe(202);
    expect(
      (JSON.parse(startText) as { data?: { makeReady?: boolean } }).data
        ?.makeReady,
      'explicit start is what admits Make'
    ).toBe(true);
    // Poster path: no 图文方向. Living Plan decide→start already confirmed spend.
    await expect(
      page.getByTestId('ask-merchant-group-card').filter({
        hasText: /两种图文方向/u,
      })
    ).toHaveCount(0);
    return { proof: `living-plan-start:${taskId}` };
  }

  // Legacy stream path (pre–Living Plan park): only 确认执行.
  await expect(confirmation).toBeVisible({ timeout: 30_000 });
  const requestId = await requiredAttribute(confirmation, 'data-request-id');
  await expect(
    confirmation.getByTestId('execution-confirmation-held')
  ).toBeVisible();
  await confirmation.getByRole('button', { name: '确认执行' }).click();
  await expect(confirmation).toBeHidden({ timeout: 60_000 });
  return { proof: `execution-confirm:${requestId}` };
}
