/** V31-11 / U7: the second paid Work must render and decide its own request. */
import { expect, test, type Page } from '@playwright/test';

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

test.describe('V31-11 Campaign paid Work confirmation (U7)', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('second paid Work requires a fresh browser confirmation', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    const firstRequestId = await submitPaidCampaignWork(
      page,
      'Campaign 第一周：生成一张夏日护理海报'
    );
    const secondRequestId = await submitPaidCampaignWork(
      page,
      'Campaign 第二周：生成一张补水护理海报'
    );

    expect(secondRequestId).not.toEqual(firstRequestId);
  });
});

async function submitPaidCampaignWork(page: Page, intentText: string) {
  await page.goto('/dashboard');
  await seedConfirmedStore(page);
  await selectComposerLens(page, 'image_text');
  const recipePanel = await openComposerRecipeCard(
    page,
    'composer-recipe-card-recipe.promotion_poster'
  );
  await closeComposerCapsule(page, recipePanel);
  const intent = page.getByTestId('composer-intent-input');
  await intent.fill(intentText);
  await expect(page.getByTestId('composer-quote-line')).toBeVisible({
    timeout: 30_000,
  });
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/core/p1/composer/submissions'),
    { timeout: 120_000 }
  );
  await page.getByTestId('composer-submit').click();
  const response = await responsePromise;
  expect(response.ok(), await response.text()).toBeTruthy();

  const card = page.getByTestId('execution-confirmation-interaction-card');
  await expect(card).toBeVisible({ timeout: 60_000 });
  const requestId = await card.getAttribute('data-request-id');
  expect(requestId).toBeTruthy();
  await expect(card.getByTestId('execution-confirmation-held')).toBeVisible();
  await expect(card.locator('select')).toHaveCount(0);
  await card.getByRole('button', { name: '确认执行' }).click();
  await expect(card).toBeHidden({ timeout: 60_000 });
  return requestId!;
}
