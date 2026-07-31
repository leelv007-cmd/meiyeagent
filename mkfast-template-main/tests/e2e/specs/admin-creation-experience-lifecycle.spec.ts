import { expect, test } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

test.afterEach(async ({ request }) => {
  await cleanupE2EUsers(request);
});

test('admin visually publishes and rolls back Recipe and Surface revisions', async ({
  page,
  request,
}) => {
  const user = await registerE2EUser(request, { role: 'admin' });
  await loginByForm(page, user);
  const suffix = `${Date.now()}`;
  const recipeId = `recipe.e2e.${suffix}`;
  const surfaceId = `surface.e2e.${suffix}`;

  await page.goto('/admin/templates');
  await page.getByLabel('Recipe ID').fill(recipeId);
  await page.getByLabel('标题').fill('E2E 门店活动图文');
  await page.getByLabel('摘要').fill('用于验收 Recipe 发布生命周期');
  await page.getByLabel('Prompt revision').fill('prompt.e2e@1');
  await page.getByLabel('变更原因').fill('E2E lifecycle acceptance');

  await page.getByRole('button', { name: '保存 Recipe 草稿' }).click();
  await expect(page.getByTestId('recipe-lifecycle-status')).toHaveText(
    'draft · r1'
  );
  await expect(page.getByTestId('recipe-visual-preview')).toContainText(
    'E2E 门店活动图文'
  );
  await page.getByRole('button', { name: '生成 Recipe 预览' }).click();
  await expect(page.getByTestId('recipe-lifecycle-status')).toHaveText(
    'preview · r2'
  );
  await page.getByRole('button', { name: '发布 Recipe' }).click();
  await expect(page.getByTestId('recipe-lifecycle-status')).toHaveText(
    'published · r3'
  );

  await page.getByLabel('摘要').fill('用于验收 Recipe 回滚生命周期');
  await page.getByRole('button', { name: '保存 Recipe 草稿' }).click();
  await page.getByRole('button', { name: '生成 Recipe 预览' }).click();
  await page.getByRole('button', { name: '发布 Recipe' }).click();
  await expect(page.getByTestId('recipe-lifecycle-status')).toHaveText(
    'published · r6'
  );
  await page.getByLabel('Recipe 回滚版本').selectOption('3');
  await page.getByRole('button', { name: '回滚 Recipe' }).click();
  await expect(page.getByTestId('recipe-lifecycle-status')).toHaveText(
    'published · r7'
  );

  await page.getByRole('tab', { name: 'Surface 编辑' }).click();
  const surfaceEditor = page.getByTestId('surface-editor');
  await surfaceEditor.getByLabel('Surface ID').fill(surfaceId);
  await surfaceEditor.getByLabel('Recipe revision ID').fill(`${recipeId}@7`);
  await surfaceEditor.getByLabel('变更原因').fill('E2E surface acceptance');
  await surfaceEditor.getByLabel('展示 Pro Studio').check();
  await expect(surfaceEditor.getByText('批量去背景')).toHaveCount(0);

  await surfaceEditor
    .getByRole('button', { name: '保存 Surface 草稿' })
    .click();
  await expect(page.getByTestId('surface-lifecycle-status')).toHaveText(
    'draft · r1'
  );
  await expect(page.getByTestId('surface-visual-preview')).toContainText(
    `${recipeId}@7`
  );
  await surfaceEditor
    .getByRole('button', { name: '生成 Surface 预览' })
    .click();
  await expect(page.getByTestId('surface-lifecycle-status')).toHaveText(
    'preview · r2'
  );
  await surfaceEditor.getByRole('button', { name: '发布 Surface' }).click();
  await expect(page.getByTestId('surface-lifecycle-status')).toHaveText(
    'published · r3'
  );

  await surfaceEditor.getByLabel('Recipe revision ID').fill(`${recipeId}@3`);
  await surfaceEditor
    .getByRole('button', { name: '保存 Surface 草稿' })
    .click();
  await surfaceEditor
    .getByRole('button', { name: '生成 Surface 预览' })
    .click();
  await surfaceEditor.getByRole('button', { name: '发布 Surface' }).click();
  const surfaceStatus = page.getByTestId('surface-lifecycle-status');
  await expect(surfaceStatus).toHaveText(/^published · r\d+$/);
  await expect(page.getByTestId('surface-visual-preview')).toContainText(
    `${recipeId}@3`
  );
  const surfaceRevisionBeforeRollback = Number(
    (await surfaceStatus.textContent())?.match(/r(\d+)/)?.[1]
  );
  await surfaceEditor.getByLabel('Surface 回滚版本').selectOption('3');
  await surfaceEditor.getByRole('button', { name: '回滚 Surface' }).click();
  // D-078/D-082 require a new revision that restores the immutable target;
  // the absolute head number is not part of the rollback contract.
  await expect
    .poll(async () =>
      Number((await surfaceStatus.textContent())?.match(/r(\d+)/)?.[1])
    )
    .toBeGreaterThan(surfaceRevisionBeforeRollback);
  await expect(surfaceStatus).toHaveText(/^published · r\d+$/);
  await expect(surfaceEditor.getByText(/回滚自 r3/)).toBeVisible();
  await expect(page.getByTestId('surface-visual-preview')).toContainText(
    `${recipeId}@7`
  );
});
