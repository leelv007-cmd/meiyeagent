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
  // #376: same-page success panel, no new route.
  await expect(page.getByTestId('recipe-publish-success-panel')).toBeVisible();
  await expect(
    page.getByTestId('recipe-publish-success-revision')
  ).toContainText(`${recipeId}@3`);
  await expect(page).toHaveURL(/\/admin\/templates/);

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

  // Seed Surface via Core command so recipe_published_revisions has an anchor,
  // then load and edit only through published-revision candidates (no free text).
  const seedResponse = await page.request.post('/api/core/p1/commands', {
    data: {
      action: 'surface_draft',
      module: 'creation-experience',
      payload: {
        surfaceId,
        expectedRevision: null,
        reason: 'E2E seed surface for candidate dropdown',
        body: {
          recipeRefs: [
            {
              recipeRevisionId: `${recipeId}@7`,
              lensId: 'image_text',
              order: 1,
              featured: true,
              visible: true,
            },
          ],
        },
      },
    },
    headers: { 'idempotency-key': `e2e-surface-seed:${surfaceId}` },
  });
  expect(seedResponse.ok(), await seedResponse.text()).toBeTruthy();

  await page.getByRole('tab', { name: 'Surface 编辑' }).click();
  const surfaceEditor = page.getByTestId('surface-editor');
  await surfaceEditor.getByLabel('Surface ID').fill(surfaceId);
  await surfaceEditor.getByRole('button', { name: '加载 Surface' }).click();
  await expect(page.getByTestId('surface-lifecycle-status')).toHaveText(
    /draft · r\d+/
  );
  // Free-text revision input is retired (#376).
  await expect(surfaceEditor.getByLabel('Recipe revision ID')).toHaveCount(0);
  const revisionSelect = surfaceEditor.getByTestId('surface-recipe-revision-0');
  await expect(revisionSelect).toBeVisible();
  await revisionSelect.selectOption(`${recipeId}@7`);
  await surfaceEditor.getByLabel('变更原因').fill('E2E surface acceptance');
  await expect(surfaceEditor.getByText('批量去背景')).toHaveCount(0);

  await surfaceEditor
    .getByRole('button', { name: '保存 Surface 草稿' })
    .click();
  await expect(page.getByTestId('surface-lifecycle-status')).toHaveText(
    /draft · r\d+/
  );
  await expect(page.getByTestId('surface-visual-preview')).toContainText(
    `${recipeId}@7`
  );
  await surfaceEditor
    .getByRole('button', { name: '生成 Surface 预览' })
    .click();
  await expect(page.getByTestId('surface-lifecycle-status')).toHaveText(
    /preview · r\d+/
  );
  await surfaceEditor.getByRole('button', { name: '发布 Surface' }).click();
  await expect(page.getByTestId('surface-lifecycle-status')).toHaveText(
    /published · r\d+/
  );

  await revisionSelect.selectOption(`${recipeId}@3`);
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
  const publishedOption = await surfaceEditor
    .getByLabel('Surface 回滚版本')
    .locator('option')
    .filter({ hasText: /^r\d+$/ })
    .first()
    .getAttribute('value');
  expect(publishedOption).toBeTruthy();
  await surfaceEditor
    .getByLabel('Surface 回滚版本')
    .selectOption(publishedOption!);
  await surfaceEditor.getByRole('button', { name: '回滚 Surface' }).click();
  // D-078/D-082 require a new revision that restores the immutable target;
  // the absolute head number is not part of the rollback contract.
  await expect
    .poll(async () =>
      Number((await surfaceStatus.textContent())?.match(/r(\d+)/)?.[1])
    )
    .toBeGreaterThan(surfaceRevisionBeforeRollback);
  await expect(surfaceStatus).toHaveText(/^published · r\d+$/);
  await expect(surfaceEditor.getByText(/回滚自 r/)).toBeVisible();
});

/**
 * Fixed-version frontend acceptance (#376 / Spec D5):
 * Recipe publish alone must not move browser projection; only Surface
 * re-publish of the new recipeRevisionId makes the new revision visible.
 * Driver runs this e2e (lane agents do not start the fixture stack).
 */
test('fixed recipe revision stays on frontend until Surface re-publish', async ({
  page,
  request,
}) => {
  const user = await registerE2EUser(request, { role: 'admin' });
  await loginByForm(page, user);
  const suffix = `${Date.now()}`;
  const recipeId = `recipe.e2e.fixed.${suffix}`;
  const surfaceId = `surface.e2e.fixed.${suffix}`;

  await page.goto('/admin/templates');
  await page.getByLabel('Recipe ID').fill(recipeId);
  await page.getByLabel('标题').fill('固定版本 v1');
  await page.getByLabel('摘要').fill('Surface 钉住的旧 revision');
  await page.getByLabel('Prompt revision').fill('prompt.e2e.fixed@1');
  await page.getByLabel('变更原因').fill('E2E fixed-version v1');
  await page.getByRole('button', { name: '保存 Recipe 草稿' }).click();
  await page.getByRole('button', { name: '生成 Recipe 预览' }).click();
  await page.getByRole('button', { name: '发布 Recipe' }).click();
  await expect(page.getByTestId('recipe-lifecycle-status')).toHaveText(
    'published · r3'
  );
  const recipeV1RevisionId = `${recipeId}@3`;

  // Publish Surface pinned to v1.
  const surfaceSeed = await page.request.post('/api/core/p1/commands', {
    data: {
      action: 'surface_draft',
      module: 'creation-experience',
      payload: {
        surfaceId,
        expectedRevision: null,
        reason: 'E2E pin surface to recipe v1',
        body: {
          recipeRefs: [
            {
              recipeRevisionId: recipeV1RevisionId,
              lensId: 'image_text',
              order: 1,
              featured: true,
              visible: true,
            },
          ],
        },
      },
    },
    headers: { 'idempotency-key': `e2e-fixed-seed:${surfaceId}` },
  });
  expect(surfaceSeed.ok(), await surfaceSeed.text()).toBeTruthy();
  const seedBody = (await surfaceSeed.json()) as {
    data?: { revision?: number };
  };
  const previewSurface = await page.request.post('/api/core/p1/commands', {
    data: {
      action: 'surface_preview',
      module: 'creation-experience',
      payload: {
        surfaceId,
        expectedRevision: seedBody.data?.revision,
        reason: 'E2E preview surface v1',
      },
    },
    headers: { 'idempotency-key': `e2e-fixed-preview:${surfaceId}` },
  });
  expect(previewSurface.ok(), await previewSurface.text()).toBeTruthy();
  const previewBody = (await previewSurface.json()) as {
    data?: { revision?: number };
  };
  const publishSurface = await page.request.post('/api/core/p1/commands', {
    data: {
      action: 'surface_publish',
      module: 'creation-experience',
      payload: {
        surfaceId,
        expectedRevision: previewBody.data?.revision,
        reason: 'E2E publish surface v1',
      },
    },
    headers: { 'idempotency-key': `e2e-fixed-publish:${surfaceId}` },
  });
  expect(publishSurface.ok(), await publishSurface.text()).toBeTruthy();

  const browserBefore = await page.request.post('/api/core/p1/query', {
    data: {
      action: 'surface_browser',
      module: 'creation-experience',
      payload: { surfaceId },
    },
  });
  expect(browserBefore.ok(), await browserBefore.text()).toBeTruthy();
  const beforeProjection = (
    (await browserBefore.json()) as {
      data?: {
        recipeRefs?: Array<{ recipeRevisionId?: string }>;
        recipes?: Array<{
          revisionId?: string;
          presentation?: { title?: string };
        }>;
      };
    }
  ).data;
  expect(beforeProjection?.recipeRefs?.[0]?.recipeRevisionId).toBe(
    recipeV1RevisionId
  );
  expect(beforeProjection?.recipes?.[0]?.presentation?.title).toBe(
    '固定版本 v1'
  );

  // Publish Recipe v2 — must NOT move browser projection by itself.
  await page.getByLabel('标题').fill('固定版本 v2');
  await page.getByLabel('摘要').fill('新 revision，Surface 尚未更新');
  await page.getByLabel('变更原因').fill('E2E fixed-version v2 recipe only');
  await page.getByRole('button', { name: '保存 Recipe 草稿' }).click();
  await page.getByRole('button', { name: '生成 Recipe 预览' }).click();
  await page.getByRole('button', { name: '发布 Recipe' }).click();
  await expect(page.getByTestId('recipe-lifecycle-status')).toHaveText(
    'published · r6'
  );
  const recipeV2RevisionId = `${recipeId}@6`;
  await expect(page.getByTestId('recipe-publish-success-panel')).toBeVisible();
  // Recipe publish success is not Surface publish evidence.
  await expect(
    page.getByTestId('recipe-publish-success-revision')
  ).toContainText(recipeV2RevisionId);

  const browserAfterRecipeOnly = await page.request.post('/api/core/p1/query', {
    data: {
      action: 'surface_browser',
      module: 'creation-experience',
      payload: { surfaceId },
    },
  });
  expect(
    browserAfterRecipeOnly.ok(),
    await browserAfterRecipeOnly.text()
  ).toBeTruthy();
  const midProjection = (
    (await browserAfterRecipeOnly.json()) as {
      data?: {
        recipeRefs?: Array<{ recipeRevisionId?: string }>;
        recipes?: Array<{
          revisionId?: string;
          presentation?: { title?: string };
        }>;
      };
    }
  ).data;
  expect(midProjection?.recipeRefs?.[0]?.recipeRevisionId).toBe(
    recipeV1RevisionId
  );
  expect(midProjection?.recipes?.[0]?.presentation?.title).toBe('固定版本 v1');

  // Bridge via success panel → update Surface refs → explicit Surface publish.
  await page.getByTestId('publish-success-surface-id').fill(surfaceId);
  await page.getByTestId('update-surface-refs-button').click();
  const surfaceEditor = page.getByTestId('surface-editor');
  await expect(
    surfaceEditor.getByTestId('surface-ref-update-notice')
  ).toContainText(/已更新|未引用/);
  await expect(
    surfaceEditor.getByTestId('surface-recipe-revision-0')
  ).toHaveValue(recipeV2RevisionId);
  await surfaceEditor.getByLabel('变更原因').fill('E2E promote surface to v2');
  await surfaceEditor
    .getByRole('button', { name: '保存 Surface 草稿' })
    .click();
  await surfaceEditor
    .getByRole('button', { name: '生成 Surface 预览' })
    .click();
  await surfaceEditor.getByRole('button', { name: '发布 Surface' }).click();
  await expect(page.getByTestId('surface-lifecycle-status')).toHaveText(
    /^published · r\d+$/
  );

  const browserAfterSurface = await page.request.post('/api/core/p1/query', {
    data: {
      action: 'surface_browser',
      module: 'creation-experience',
      payload: { surfaceId },
    },
  });
  expect(
    browserAfterSurface.ok(),
    await browserAfterSurface.text()
  ).toBeTruthy();
  const afterProjection = (
    (await browserAfterSurface.json()) as {
      data?: {
        recipeRefs?: Array<{ recipeRevisionId?: string }>;
        recipes?: Array<{
          revisionId?: string;
          presentation?: { title?: string };
        }>;
      };
    }
  ).data;
  expect(afterProjection?.recipeRefs?.[0]?.recipeRevisionId).toBe(
    recipeV2RevisionId
  );
  expect(afterProjection?.recipes?.[0]?.presentation?.title).toBe(
    '固定版本 v2'
  );
});
