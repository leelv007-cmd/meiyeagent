import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { unlockProStudio } from '../fixtures/pro-studio';

// 4x2 opaque PNG: wide enough that 1K/2K/4K upscale targets stay enabled and a
// 2x2 split yields four non-empty pieces.
const WIDE_PNG_FIXTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEklEQVR4nGP4H1DxHxkzoAsAAHjBFjFw6Q5vAAAAAElFTkSuQmCC',
  'base64'
);
const UPLOAD_INPUT =
  'input[accept="image/jpeg,image/png,image/webp,video/mp4,audio/mpeg,audio/wav"]';

function collectCanvasUiActions(page: Page, actions: string[] = []) {
  page.on('request', (request) => {
    const match = new URL(request.url()).pathname.match(
      /^\/api\/canvas\/([^/]+)$/u
    );
    if (match?.[1]) actions.push(match[1]);
  });
  return actions;
}

async function openProject(page: Page, projectName: string) {
  const project = page
    .locator('.project-list .project-card')
    .filter({ hasText: projectName });
  await expect(project).toBeVisible();
  await project.locator('.project-card-open').click();
  await expect(page.locator('.canvas-toolbar')).toContainText(projectName);
  await expect(page.getByLabel('Pro Studio 高阶画布')).toBeVisible();
}

async function selectSourceImage(page: Page, sourceNodeId: string) {
  await page.keyboard.press('Escape');
  await page
    .locator(`.kernel-node[data-node-id="${sourceNodeId}"] img`)
    .click();
  await expect(
    page.locator(`.kernel-node[data-node-id="${sourceNodeId}"]`)
  ).toHaveClass(/is-selected/u);
}

test.describe('Pro Studio K3 image retouch parity (G26-G31)', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('interactive crop, upscale and split each derive a lineage child that survives refresh', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    page.setDefaultTimeout(10_000);
    test.info().annotations.push({
      type: 'generation-mode',
      description: 'MODEL_EXECUTION_MODE=fixture',
    });
    const uiActions = collectCanvasUiActions(page);
    const projectName = `retouch-ui-${randomUUID().slice(0, 8)}`;
    const uploadName = `retouch-wide-${randomUUID().slice(0, 8)}.png`;
    const imageNodes = page.locator('.kernel-node[data-node-id^="image-"]');
    const edges = page.locator('[data-connection-id]');
    let sourceNodeId = '';

    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await page.goto('/pro-studio');
    await unlockProStudio(page);
    await page.reload();
    await page.getByRole('button', { name: '一键进入' }).click();

    const canvasOrigin = `http://localhost:${
      process.env.PLAYWRIGHT_CANVAS_PORT ?? '4200'
    }`;
    await expect(page).toHaveURL(
      (url) => url.origin === canvasOrigin && url.pathname === '/',
      { timeout: 20_000 }
    );
    await expect(page.getByText('Pro Studio', { exact: true })).toBeVisible();

    await test.step('creates a project and uploads one owned source image', async () => {
      await page.getByRole('button', { name: '新建', exact: true }).click();
      const createDialog = page.getByRole('dialog', { name: '新建工程' });
      await expect(createDialog).toBeVisible();
      await createDialog.getByLabel('工程名称').fill(projectName);
      await createDialog.getByRole('button', { name: '创建工程' }).click();
      await expect(page.getByLabel('Pro Studio 高阶画布')).toBeVisible();

      // Upload flow: the picker opens first, then hosts a hidden file input;
      // the upload auto-persists and inserts a node, so assert the node (a hard
      // fact) rather than the status message, which auto-save overwrites.
      await page.getByRole('button', { name: '选择或上传' }).click();
      await page.locator(UPLOAD_INPUT).setInputFiles({
        buffer: WIDE_PNG_FIXTURE,
        mimeType: 'image/png',
        name: uploadName,
      });
      await expect(imageNodes).toHaveCount(1);
      await page.getByRole('button', { name: '关闭素材选择器' }).click();
      sourceNodeId =
        (await imageNodes.first().getAttribute('data-node-id')) ?? '';
      expect(sourceNodeId).toBeTruthy();
    });

    await test.step('G26 interactive crop dialog exposes 8 handles, live size and ratio lock, then derives a child', async () => {
      await selectSourceImage(page, sourceNodeId);
      await page.getByRole('button', { name: '裁剪', exact: true }).click();
      const cropDialog = page.getByRole('dialog', { name: '裁剪图片' });
      await expect(cropDialog).toBeVisible();
      // G26 interactive crop UI proof (drag geometry itself is unit-tested in
      // retouch-crop.test.ts): 8 resize handles, live pixel size, ratio lock.
      await expect(
        cropDialog.getByRole('button', { name: '调整裁剪框' })
      ).toHaveCount(8);
      await expect(cropDialog.getByText(/裁剪尺寸/u)).toBeVisible();
      await expect(
        cropDialog.getByRole('button', { name: /比例/u })
      ).toBeVisible();
      await cropDialog.getByRole('button', { name: '确认裁剪' }).click();
      await expect(cropDialog).toBeHidden();
      await expect(imageNodes).toHaveCount(2);
      await expect(edges).toHaveCount(1);
    });

    await test.step('G28 upscale dialog picks a 4K target and derives a child', async () => {
      await selectSourceImage(page, sourceNodeId);
      await page.getByRole('button', { name: '2K放大' }).click();
      const upscaleDialog = page.getByRole('dialog', { name: '图片放大' });
      await expect(upscaleDialog).toBeVisible();
      await upscaleDialog.getByText('4K · 4096px').click();
      const generate = upscaleDialog.getByRole('button', {
        name: '生成放大图',
      });
      await expect(generate).toBeEnabled();
      await generate.click();
      await expect(upscaleDialog).toBeHidden();
      await expect(imageNodes).toHaveCount(3);
      await expect(edges).toHaveCount(2);
    });

    await test.step('G29 split dialog previews a 2x2 grid and derives four children', async () => {
      await selectSourceImage(page, sourceNodeId);
      await page.getByRole('button', { name: '2×2切分' }).click();
      const splitDialog = page.getByRole('dialog', { name: '切分图片' });
      await expect(splitDialog).toBeVisible();
      await expect(splitDialog.getByText('子节点 4 个')).toBeVisible();
      await splitDialog.getByRole('button', { name: '生成子节点' }).click();
      await expect(splitDialog).toBeHidden();
      await expect(imageNodes).toHaveCount(7);
      await expect(edges).toHaveCount(6);
    });

    await test.step('all derived retouch children and edges survive a refresh', async () => {
      // Each retouch already auto-persists the draft; wait for the toolbar to
      // settle clean, then reload to prove the lineage is server-durable.
      await expect(page.locator('.canvas-toolbar')).not.toContainText('未保存');
      await page.reload();
      await openProject(page, projectName);
      await expect(imageNodes).toHaveCount(7);
      await expect(edges).toHaveCount(6);
    });

    expect(uiActions).toEqual(
      expect.arrayContaining([
        'createProject',
        'persistLocalCanvasArtifact',
        'saveProjectDraft',
      ])
    );
  });

  test('mask, angle and reverse-prompt stay reachable but honestly report unavailable without an activated edit capability', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    page.setDefaultTimeout(10_000);
    const projectName = `retouch-honest-${randomUUID().slice(0, 8)}`;
    const uploadName = `retouch-honest-${randomUUID().slice(0, 8)}.png`;
    const imageNodes = page.locator('.kernel-node[data-node-id^="image-"]');
    let sourceNodeId = '';

    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    // Provision the workspace first (a Main -> Core proxy runs on any dashboard
    // route) so the platform-default image.generate model activates. This lets
    // the capability panel below prove it distinguishes an ACTIVE capability
    // from the gated ones, rather than a uniformly-grey "nothing provisioned"
    // board where image.edit/text.respond would read inactive for the wrong
    // reason.
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.goto('/pro-studio');
    await unlockProStudio(page);
    await page.reload();
    await page.getByRole('button', { name: '一键进入' }).click();
    const canvasOrigin = `http://localhost:${
      process.env.PLAYWRIGHT_CANVAS_PORT ?? '4200'
    }`;
    await expect(page).toHaveURL(
      (url) => url.origin === canvasOrigin && url.pathname === '/',
      { timeout: 20_000 }
    );

    await page.getByRole('button', { name: '新建', exact: true }).click();
    const createDialog = page.getByRole('dialog', { name: '新建工程' });
    await createDialog.getByLabel('工程名称').fill(projectName);
    await createDialog.getByRole('button', { name: '创建工程' }).click();
    await expect(page.getByLabel('Pro Studio 高阶画布')).toBeVisible();
    await page.getByRole('button', { name: '选择或上传' }).click();
    await page.locator(UPLOAD_INPUT).setInputFiles({
      buffer: WIDE_PNG_FIXTURE,
      mimeType: 'image/png',
      name: uploadName,
    });
    await expect(imageNodes).toHaveCount(1);
    await page.getByRole('button', { name: '关闭素材选择器' }).click();
    sourceNodeId =
      (await imageNodes.first().getAttribute('data-node-id')) ?? '';
    expect(sourceNodeId).toBeTruthy();

    await test.step('capability panel distinguishes the active image.generate from the gated image.edit / text.respond', async () => {
      const grid = page.locator('.capability-grid');
      const imageGenerate = grid.locator('button', { hasText: '图片生成' });
      const imageEdit = grid.locator('button', { hasText: '图片编辑' });
      const freeText = grid.locator('button', { hasText: '自由文本' });
      // Positive side: the platform-seeded image.generate provisioned above is
      // active — proves the board reflects real per-capability supply, not a
      // uniformly-inactive "nothing provisioned" state (this is what test2
      // previously could not show; K4 test2 corroborates the same distinction).
      await expect(imageGenerate).toContainText('可用');
      // Gated side: image.edit / text.respond are never platform-seeded, so they
      // stay inactive even with the workspace fully provisioned.
      await expect(imageEdit).toContainText('未激活');
      await expect(freeText).toContainText('未激活');
      // Selecting the gated capability surfaces an honest reason, not a price.
      await imageEdit.click();
      await expect(page.getByText('非假可用')).toBeVisible();
    });

    await test.step('G27/G30/G31 surfaces stay mounted and reachable while the job path is gated', async () => {
      await selectSourceImage(page, sourceNodeId);
      await page.getByRole('button', { name: '局部编辑' }).click();
      await expect(
        page.getByRole('dialog', { name: '局部遮罩编辑' })
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(
        page.getByRole('dialog', { name: '局部遮罩编辑' })
      ).toBeHidden();

      await selectSourceImage(page, sourceNodeId);
      await page.getByRole('button', { name: 'AI多角度' }).click();
      await expect(
        page.getByRole('dialog', { name: 'AI 多角度' })
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(
        page.getByRole('dialog', { name: 'AI 多角度' })
      ).toBeHidden();

      // G31 reverse-prompt entry is reachable from the same image selection.
      await expect(
        page.getByRole('button', { name: '反推提示词' })
      ).toBeVisible();
    });
  });
});
