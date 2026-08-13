/**
 * V31-88 — authorized library assets attach into composer draft.sources.
 *
 * Do not call `seedComposerInlineAuthorize`. The gap is the missing picker,
 * not another composer upload. Full-stack run belongs to the master; this
 * file must --list.
 */
import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import {
  authorizeLatestLibraryAssetAsCustomerCase,
  pickComposerLibraryAsset,
} from '../fixtures/library-source';
import { productCommand, productState } from '../fixtures/product';
import {
  closeComposerCapsule,
  openComposerRecipeCard,
  selectComposerLens,
} from '../fixtures/ui-journey';

const CASE_PHOTO = await readFile(
  new URL(
    '../../../public/model-previews/image-beauty-preview.png',
    import.meta.url
  )
);

test.describe('V31-88 素材库挂入 composer 配方槽', () => {
  test.afterEach(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('素材页已授权资产经挑选进入 sources 后图文提交 <400', async ({
    page,
    request,
  }) => {
    test.setTimeout(360_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    await productCommand(page, {
      type: 'confirm_store',
      store: {
        accounts: [],
        address: '文三路 100 号',
        booking: '电话或微信提前一天预约',
        brandVoice: '专业、克制',
        city: '杭州',
        district: '西湖区',
        name: '盘点美发工作室',
        prohibitions: ['不虚构价格'],
        projects: [
          {
            confirmed: true,
            durationMinutes: 90,
            id: 'project-v31-88',
            name: '头皮护理',
            price: 388,
          },
        ],
        regulated: false,
      },
    });

    await page.goto('/dashboard/assets');
    await expect(page.locator('#canonical-asset-upload')).toBeAttached({
      timeout: 60_000,
    });
    await page.locator('#canonical-asset-upload').setInputFiles({
      buffer: CASE_PHOTO,
      mimeType: 'image/png',
      name: 'v31-88-case.png',
    });
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
    await expect
      .poll(
        async () =>
          (await productState(page)).assets.some(
            (asset) => asset.id === authorized.id
          ),
        { timeout: 15_000 }
      )
      .toBe(true);

    await page
      .getByTestId('composer-intent-input')
      .fill('把已授权的护理案例做成一条真实克制的小红书图文笔记');
    const submit = page.getByTestId('composer-submit');
    await expect(submit).toBeEnabled({ timeout: 60_000 });
    await expect(page.getByTestId('composer-recipe-slot-guidance')).toHaveCount(
      0
    );

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
