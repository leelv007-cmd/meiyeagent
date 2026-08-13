/**
 * V31-84 — Day-0 five-step intake: say a sentence, confirm the draft, unlock
 * the store profile, then pass the asset-library gate and submit an image-text
 * recipe. Full-stack run belongs to the master; this file must `--list`.
 */
import { readFile } from 'node:fs/promises';

import { expect, test, type Page, type Request } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import {
  authorizeLatestLibraryAssetAsCustomerCase,
  pickComposerLibraryAsset,
} from '../fixtures/library-source';
import { productState } from '../fixtures/product';
import {
  closeComposerCapsule,
  openComposerRecipeCard,
  selectComposerLens,
} from '../fixtures/ui-journey';

const AUDIT_SENTENCE =
  '我们店叫盘点美发工作室，在市中心，主打染发和头皮护理，染发套餐日常价 388 元';

const PRICE_LIST_PHOTO = await readFile(
  new URL(
    '../../../public/model-previews/image-beauty-preview.png',
    import.meta.url
  )
);

type ModuleRequest = {
  action?: string;
  module?: string;
};

function moduleRequest(request: Request): ModuleRequest | null {
  if (
    request.method() !== 'POST' ||
    !request.url().includes('/api/core/p1/commands')
  ) {
    return null;
  }
  try {
    return request.postDataJSON() as ModuleRequest;
  } catch {
    return null;
  }
}

function isAction(request: Request, action: string) {
  return moduleRequest(request)?.action === action;
}

async function walkToStep(page: Page, step: string) {
  const wizard = page.getByTestId('store-intake-wizard-store');
  for (let index = 0; index < 5; index += 1) {
    const current = await wizard
      .locator('li[aria-current="step"]')
      .getAttribute('data-step');
    if (current === step) return;
    await wizard.getByTestId('store-intake-next').click();
  }
  throw new Error(`step ${step} was never reached`);
}

test.describe('V31-84 store onboarding capture and confirm', () => {
  test.afterEach(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('saying one sentence confirms the store, unlocks asset upload, and lets an image-text recipe submit', async ({
    page,
    request,
  }) => {
    test.setTimeout(360_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    const finalizations: ModuleRequest[] = [];
    page.on('request', (outgoing) => {
      if (!isAction(outgoing, 'finalize_store_intake')) return;
      finalizations.push(moduleRequest(outgoing)!);
    });

    await page.goto('/dashboard/store');
    const wizard = page.getByTestId('store-intake-wizard-store');
    await expect(wizard).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByTestId('store-profile-empty-description')
    ).toBeVisible();

    await walkToStep(page, 'say_or_upload');
    await wizard.getByTestId('store-intake-sentence').fill(AUDIT_SENTENCE);

    await walkToStep(page, 'confirm_each');
    await expect(wizard.getByTestId('store-intake-field-name')).toHaveValue(
      '盘点美发工作室'
    );
    await expect(
      wizard.getByTestId('store-intake-provenance-name')
    ).toBeVisible();
    await expect(wizard.getByTestId('store-intake-confirm-name')).toHaveCount(
      0
    );
    await wizard
      .getByTestId('store-intake-field-projectPriceValidity-long-term')
      .click();
    await expect(wizard.getByTestId('store-intake-save')).toBeEnabled();

    const finalizeResponse = page.waitForResponse(
      (response) =>
        isAction(response.request(), 'finalize_store_intake') &&
        response.status() < 400,
      { timeout: 90_000 }
    );
    await wizard.getByTestId('store-intake-save').click();
    expect((await finalizeResponse).ok()).toBeTruthy();
    await expect(wizard.getByTestId('store-intake-saved')).toBeVisible({
      timeout: 60_000,
    });
    expect(finalizations).toHaveLength(1);

    await expect
      .poll(async () => (await productState(page)).store?.name, {
        timeout: 60_000,
      })
      .toBe('盘点美发工作室');
    await expect(
      page.getByTestId('store-profile-empty-description')
    ).toHaveCount(0);
    await expect(page.getByText('盘点美发工作室').first()).toBeVisible();

    await page.goto('/dashboard/assets');
    await expect(page.locator('#canonical-asset-upload')).toBeAttached({
      timeout: 60_000,
    });
    await page.locator('#canonical-asset-upload').setInputFiles({
      buffer: PRICE_LIST_PHOTO,
      mimeType: 'image/png',
      name: 'v31-84-case.png',
    });
    await expect(page.getByText('请先确认门店档案')).toHaveCount(0);
    await expect
      .poll(async () => (await productState(page)).assets.length, {
        timeout: 60_000,
      })
      .toBeGreaterThan(0);
    const authorized = await authorizeLatestLibraryAssetAsCustomerCase(page);

    await page.goto('/dashboard');
    await selectComposerLens(page, 'image_text');
    const recipePanel = await openComposerRecipeCard(
      page,
      'composer-recipe-card-recipe.case_to_xhs_note'
    );
    const applyRecipe = page.getByRole('button', { name: '套用并更新设置' });
    const recipeApplied = page.getByTestId('composer-recipe-apply-undo');
    await expect(recipeApplied.or(applyRecipe)).toBeVisible();
    if (await applyRecipe.isVisible()) await applyRecipe.click();
    await expect(recipeApplied).toBeVisible();
    await closeComposerCapsule(page, recipePanel);
    await pickComposerLibraryAsset(page, authorized.id);

    await page
      .getByTestId('composer-intent-input')
      .fill('把已授权的护理案例做成一条真实克制的小红书图文笔记');
    const submit = page.getByTestId('composer-submit');
    await expect(submit).toBeEnabled({ timeout: 60_000 });
    const submission = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/core/p1/composer/submissions'),
      { timeout: 180_000 }
    );
    await submit.click();
    const submitted = await submission;
    expect(submitted.status(), await submitted.text()).toBeLessThan(400);
  });
});
