import { expect, test, type Page } from '@playwright/test';
import type { ContentPackage } from '@meiye/contracts';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { seedConfirmedStore } from '../fixtures/product';
import {
  closeComposerCapsule,
  openComposerCapsule,
  openComposerRecipeCard,
  selectComposerLens,
} from '../fixtures/ui-journey';

type ComposerSubmission = {
  packageId: string;
  workId: string;
};

async function contentPackage(page: Page, packageId: string) {
  return page.evaluate(async (id) => {
    const response = await fetch('/api/core/p1/query', {
      body: JSON.stringify({
        action: 'content_packages',
        module: 'operations',
        payload: {},
      }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const envelope = (await response.json()) as {
      data?: ContentPackage[];
      error?: { message?: string };
    };
    if (!response.ok || !envelope.data) {
      throw new Error(
        envelope.error?.message ?? 'Content package query failed'
      );
    }
    return envelope.data.find((candidate) => candidate.id === id);
  }, packageId);
}

async function submitComposerImageText(
  page: Page,
  intent: string
): Promise<ComposerSubmission> {
  await page.goto('/dashboard');
  await selectComposerLens(page, 'image_text');
  const recipePanel = await openComposerRecipeCard(
    page,
    'composer-recipe-card-recipe.promotion_poster'
  );
  const patchPreview = page.getByTestId('composer-recipe-patch-preview');
  const applied = page.getByTestId('composer-recipe-apply-undo');
  await expect(patchPreview.or(applied).first()).toBeVisible({
    timeout: 30_000,
  });
  if (await patchPreview.isVisible()) {
    await page.getByTestId('composer-patch-confirm').click();
  }
  await expect(applied).toBeVisible({ timeout: 30_000 });
  await closeComposerCapsule(page, recipePanel);

  await page.getByTestId('composer-intent-input').fill(intent);
  const destinationPanel = await openComposerCapsule(page, 'destination');
  const destination = page.getByTestId(
    'composer-destination-option-xiaohongshu'
  );
  if ((await destination.getAttribute('aria-pressed')) !== 'true') {
    await destination.click();
  }
  await closeComposerCapsule(page, destinationPanel);
  await expect(page.getByTestId('composer-quote-line')).toBeVisible({
    timeout: 60_000,
  });

  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/core/p1/composer/submissions'),
    { timeout: 120_000 }
  );
  await page.getByTestId('composer-submit').click();
  const brief = page.getByTestId('composer-brief-surface');
  const next = await Promise.race([
    responsePromise.then(() => 'submission' as const),
    brief
      .waitFor({ state: 'visible', timeout: 60_000 })
      .then(() => 'brief' as const),
  ]);
  if (next === 'brief') {
    await page.getByTestId('composer-brief-confirm').click();
  }

  const response = await responsePromise;
  const envelope = (await response.json()) as {
    data?: {
      contentPackage?: { id?: string };
      work?: { id?: string };
    };
    error?: { message?: string };
  };
  expect(response.status(), envelope.error?.message).toBe(202);
  const submission = {
    packageId: envelope.data?.contentPackage?.id ?? '',
    workId: envelope.data?.work?.id ?? '',
  };
  expect(submission.packageId).toBeTruthy();
  expect(submission.workId).toBeTruthy();
  return submission;
}

test.describe('P1 canonical-provider journey', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('runs an available image model through Composer, work recovery, and search', async ({
    page,
    request,
  }) => {
    test.setTimeout(360_000);
    const user = await registerE2EUser(request, { role: 'admin' });
    await loginByForm(page, user);

    await page.goto('/settings/models');
    await page.getByRole('tab', { name: '图片模型' }).click();
    const modelGroup = page.getByRole('radiogroup', { name: '本次使用' });
    const modelRadios = modelGroup.getByRole('radio');
    await expect.poll(() => modelRadios.count()).toBeGreaterThan(1);
    const selectedRadio = modelRadios.nth(1);
    const selectedModelInput = selectedRadio.locator(
      'xpath=following-sibling::input[@type="radio"]'
    );
    await selectedRadio.click();
    await expect(selectedModelInput).toBeChecked();
    await expect(
      page.getByText('已记录本次模型选择', { exact: true })
    ).toBeVisible();

    const intent = 'P1 已选模型的可恢复图文旅程';
    await seedConfirmedStore(page);
    const submission = await submitComposerImageText(page, intent);
    await page.goto(
      `/dashboard/results/${encodeURIComponent(submission.workId)}`
    );
    const accept = page.getByTestId('result-primary-action');
    await expect(accept).toHaveText('采用这组', { timeout: 240_000 });
    await accept.click();
    await expect
      .poll(
        async () => (await contentPackage(page, submission.packageId))?.status,
        { timeout: 60_000 }
      )
      .toBe('accepted');

    await page.goto('/dashboard');
    const continueSection = page.getByTestId('dashboard-section-continue');
    await expect(continueSection).toBeVisible({ timeout: 30_000 });
    const continuation = continueSection.getByRole('link', { name: intent });
    await expect(continuation).toHaveAttribute('href', /\/dashboard\/works\//);
    await continuation.click();
    await expect(page).toHaveURL(/\/dashboard\/works\//);

    await page.goto('/dashboard/search');
    await page.getByLabel('搜索内容历史').fill(intent);
    await expect(page).toHaveURL(/q=/);
    await page.reload();
    await expect(page.getByLabel('搜索内容历史')).toHaveValue(intent);
    await expect(page.getByText(intent).first()).toBeVisible();
  });
});
