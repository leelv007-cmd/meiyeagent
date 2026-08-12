import { expect, test } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { productState, seedConfirmedStore } from '../fixtures/product';
import {
  assertThreeModalDiscovery,
  closeComposerCapsule,
  ensureComposerSecondaryCapsules,
  openComposerCapsule,
  openComposerRecipeCard,
  selectComposerLens,
} from '../fixtures/ui-journey';

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
    '先核对信息'
  );
  await expect(page.getByTestId('composer-submit')).toBeEnabled();
  // The Idle home carries no transcript. `composer-conversation` returns null
  // while the session has no turns and no identity slot
  // (composer-conversation.tsx:584), and `79f9a4e7` moved the identity card out
  // of the stream into the @ capsule (L3-2), so the cold surface stopped
  // mounting an empty pane. Both halves of "no merchant submission yet" are
  // pinned here: no transcript, and no merchant turn anywhere on the page.
  await expect(page.getByTestId('composer-conversation')).toHaveCount(0);
  await expect(page.getByTestId('composer-turn-merchant')).toHaveCount(0);
  // A cold Composer must still be the thing that would open one — the capsule
  // bar and submit control are live, they are just not a conversation yet.
  await ensureComposerSecondaryCapsules(page);
  await expect(page.getByTestId('composer-capsule-lens')).toBeVisible();
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
  await selectComposerLens(page, 'copy');
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
  await selectComposerLens(page, 'image_text');
  const recipePanel = await openComposerRecipeCard(
    page,
    'composer-recipe-card-recipe.case_to_xhs_note'
  );
  const applyRecipe = page.getByRole('button', {
    name: '套用并更新设置',
  });
  const recipeApplied = page.getByTestId('composer-recipe-apply-undo');
  await expect(recipeApplied.or(applyRecipe)).toBeVisible();
  if (await applyRecipe.isVisible()) await applyRecipe.click();
  await expect(recipeApplied).toBeVisible();
  // Apply tip lives inside the recipe panel; close before free-mode params outside.
  await closeComposerCapsule(page, recipePanel);

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
  // Switching lens with a recipe on may open a confirm dialog before the radio
  // is checked — cannot use selectComposerLens (it asserts checked immediately).
  await openComposerCapsule(page, 'lens');
  await page.getByTestId('composer-lens-option-copy').click();
  const confirmCopySwitch = page.getByRole('button', {
    name: '切换到文案',
  });
  await expect(confirmCopySwitch).toBeVisible();
  await confirmCopySwitch.click();
  // Re-open if the confirm path unmounted the panel; keep the radio assertion
  // (not the capsule face) so this still proves the checked state after confirm.
  const lensPanel = await openComposerCapsule(page, 'lens');
  await expect(page.getByTestId('composer-lens-option-copy')).toBeChecked();
  await closeComposerCapsule(page, lensPanel);
  await expect(page.getByTestId('composer-generation-params')).toHaveCount(0);
});
