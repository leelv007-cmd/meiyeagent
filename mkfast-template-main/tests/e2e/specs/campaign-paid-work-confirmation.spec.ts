/** V31 U7: one visible Campaign creates two sequential paid Works. */
import { expect, test, type Locator } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { seedConfirmedStore } from '../fixtures/product';
import {
  chooseImageTextDirection,
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

    await chooseImageTextDirection(page);
    const firstCard = page.getByTestId(
      'execution-confirmation-interaction-card'
    );
    await expect(firstCard).toBeVisible({ timeout: 90_000 });
    const firstRequestId = await requiredAttribute(
      firstCard,
      'data-request-id'
    );
    await expect(
      firstCard.getByTestId('execution-confirmation-held')
    ).toBeVisible();
    await firstCard.getByRole('button', { name: '确认执行' }).click();
    await expect(firstCard).toBeHidden({ timeout: 60_000 });

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
    await chooseImageTextDirection(page);

    const secondCard = page.getByTestId(
      'execution-confirmation-interaction-card'
    );
    await expect(secondCard).toBeVisible({ timeout: 90_000 });
    const secondRequestId = await requiredAttribute(
      secondCard,
      'data-request-id'
    );
    expect(secondRequestId).not.toEqual(firstRequestId);
    await expect(
      secondCard.getByTestId('execution-confirmation-held')
    ).toBeVisible();

    const secondWorkId = await requiredAttribute(work2, 'data-work-id');
    const secondDelivery = page.locator(
      `[data-testid="composer-delivery-card"][data-work-id="${secondWorkId}"]`
    );
    await expect(secondDelivery).toHaveCount(0);
    await page.waitForTimeout(1_000);
    await expect(secondCard).toBeVisible();
    await expect(secondDelivery).toHaveCount(0);

    await secondCard.getByRole('button', { name: '确认执行' }).click();
    await expect(secondCard).toBeHidden({ timeout: 60_000 });
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
