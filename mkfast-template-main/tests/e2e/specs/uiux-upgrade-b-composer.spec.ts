import { expect, test } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { productState, seedConfirmedStore } from '../fixtures/product';
import { assertThreeModalDiscovery } from '../fixtures/ui-journey';

test.afterEach(async ({ request }) => {
  await cleanupE2EUsers(request);
});

test('cold Composer exposes the required lenses without a merchant submission', async ({
  page,
  request,
}) => {
  const user = await registerE2EUser(request);
  await loginByForm(page, user);

  await assertThreeModalDiscovery(page);
  await expect(page.getByTestId('composer-intent-input')).toBeVisible();
  await expect(page.getByTestId('composer-submit')).toHaveAccessibleName(
    '先补门店信息'
  );
  await expect(page.getByTestId('composer-submit')).toBeEnabled();
  await expect(page.getByTestId('composer-conversation')).toBeVisible();
  await expect(page.getByTestId('composer-turn-merchant')).toHaveCount(0);
});

test('lens and intent bind a quote without writing a product record', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const user = await registerE2EUser(request);
  await loginByForm(page, user);
  await seedConfirmedStore(page);
  await page.goto('/dashboard');

  const before = await productState(page);
  const lens = page.getByTestId('composer-lens-option-copy');
  await lens.click();
  await expect(lens).toBeChecked();
  await page
    .getByTestId('composer-intent-input')
    .fill('为到店护理写一条朋友圈项目介绍');
  await expect(page.getByTestId('composer-quote-line')).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId('composer-submit')).toBeEnabled();

  const after = await productState(page);
  expect(after.assets).toEqual(before.assets);
  expect(after.contents).toEqual(before.contents);
});

test('XHS note generation exposes role and thinking only in free mode', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const user = await registerE2EUser(request);
  await loginByForm(page, user);
  await seedConfirmedStore(page);
  await page.goto('/dashboard');

  await page.getByTestId('composer-creation-mode-free').click();
  await expect(page.getByTestId('composer-generation-params')).toHaveCount(0);
  await page.getByTestId('composer-lens-option-image_text').click();
  await page
    .getByTestId('composer-recipe-card-recipe.case_to_xhs_note')
    .click();
  const applyRecipe = page.getByRole('button', {
    name: '套用并更新设置',
  });
  const recipeApplied = page.getByTestId('composer-recipe-apply-undo');
  await expect(recipeApplied.or(applyRecipe)).toBeVisible();
  if (await applyRecipe.isVisible()) await applyRecipe.click();
  await expect(recipeApplied).toBeVisible();

  await expect(page.getByTestId('composer-generation-params')).toBeVisible();
  await page.getByTestId('composer-beauty-voice-role-customer').click();
  await page.getByTestId('composer-thinking-level-deep').click();
  await expect(
    page.getByTestId('composer-beauty-voice-role-customer')
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByTestId('composer-thinking-level-deep')
  ).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('composer-creation-mode-customized').click();
  await expect(page.getByTestId('composer-generation-params')).toHaveCount(0);
  await page.getByTestId('composer-creation-mode-free').click();
  await expect(page.getByTestId('composer-generation-params')).toBeVisible();
  await page.getByTestId('composer-lens-option-copy').click();
  const confirmCopySwitch = page.getByRole('button', {
    name: '切换到文案',
  });
  await expect(confirmCopySwitch).toBeVisible();
  await confirmCopySwitch.click();
  await expect(page.getByTestId('composer-lens-option-copy')).toBeChecked();
  await expect(page.getByTestId('composer-generation-params')).toHaveCount(0);
});
