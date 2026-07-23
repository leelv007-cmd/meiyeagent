import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { unlockProStudio } from '../fixtures/pro-studio';

// 4x2 opaque PNG reused from the K3 retouch journey: a valid owned image upload.
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

async function enterCanvas(
  page: Page,
  request: Parameters<typeof registerE2EUser>[0]
) {
  const user = await registerE2EUser(request);
  await loginByForm(page, user);
  // The dashboard's authenticated Core requests run verified-workspace
  // provisioning inline (activates the platform default generation models). The
  // pro-studio → canvas launch path never issues a Main→Core request, so it must
  // be triggered here or every creative capability stays honestly inactive.
  await page.goto('/dashboard');
  await expect(page.getByLabel('描述这次想创作的内容')).toBeVisible({
    timeout: 30_000,
  });
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
}

async function createProject(page: Page, projectName: string) {
  await page.getByRole('button', { name: '新建', exact: true }).click();
  const createDialog = page.getByRole('dialog', { name: '新建工程' });
  await expect(createDialog).toBeVisible();
  await createDialog.getByLabel('工程名称').fill(projectName);
  await createDialog.getByRole('button', { name: '创建工程' }).click();
  await expect(page.getByLabel('Pro Studio 高阶画布')).toBeVisible();
}

// After dashboard provisioning the workspace catalog reports image.generate as
// active; the RuntimePanel fetches it on mount, so wait for the honest "可用"
// state before driving capability-gated surfaces.
async function expectImageGenerateActive(page: Page) {
  const imageGenerate = page
    .locator('.capability-grid button')
    .filter({ hasText: '图片生成' });
  await expect(imageGenerate).toBeVisible();
  await expect(imageGenerate).toContainText('可用', { timeout: 30_000 });
}

test.describe('Pro Studio K5 prompt library, @mention and assets (G39-G41)', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('G39: governed prompt library loads the product-owned seeds (no 503) and inserts a compatible one into the composer', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    page.setDefaultTimeout(10_000);
    const uiActions = collectCanvasUiActions(page);
    await enterCanvas(page, request);
    await expectImageGenerateActive(page);

    await page.getByRole('button', { name: '提示词库' }).click();
    const dialog = page.getByRole('dialog', { name: '提示词库' });
    await expect(dialog).toBeVisible();

    const cards = dialog.locator('.resource-prompt-card');
    await expect(cards.first()).toBeVisible({ timeout: 20_000 });
    // The wired prompts provider serves all 40 product-owned seeds on one page,
    // proving the PROMPT_CATALOG_UNAVAILABLE (503) bug is fixed.
    await expect(cards).toHaveCount(40, { timeout: 20_000 });
    await expect(
      dialog.getByText('提示词暂时无法载入，请稍后重试。')
    ).toBeHidden();
    // The category tab derives from the seed capability marker (视觉 → 营销画面).
    await expect(dialog.getByRole('tab', { name: '营销画面' })).toBeVisible();
    expect(uiActions).toContain('listPrompts');

    // With image.generate active the seeds are insertable, and choosing one
    // fills the governed composer prompt.
    const insert = dialog
      .getByRole('button', { name: '插入', exact: true })
      .first();
    await expect(insert).toBeVisible({ timeout: 20_000 });
    await insert.click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.resource-mention-editor')).not.toHaveText('');

    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/pro-studio/k5-prompt-library.png',
    });
  });

  test('G40/G41: asset picker inserts a listed asset and the @mention composer references it', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    page.setDefaultTimeout(10_000);
    const uiActions = collectCanvasUiActions(page);
    const projectName = `prompts-assets-${randomUUID().slice(0, 8)}`;
    const uploadName = `asset-${randomUUID().slice(0, 8)}.png`;
    const imageNodes = page.locator('.kernel-node[data-node-id^="image-"]');

    await enterCanvas(page, request);
    await createProject(page, projectName);
    await expectImageGenerateActive(page);

    // Upload one owned image through the picker. The upload path inserts a first
    // node and refreshes the picker list so the asset becomes re-selectable.
    await page.getByRole('button', { name: '选择或上传' }).click();
    const picker = page.getByRole('dialog', { name: '素材选择器' });
    await expect(picker).toBeVisible();
    await page.locator(UPLOAD_INPUT).setInputFiles({
      buffer: WIDE_PNG_FIXTURE,
      mimeType: 'image/png',
      name: uploadName,
    });
    await expect(imageNodes).toHaveCount(1);

    await test.step('G41: "插入画布" inserts the listed asset as a second node', async () => {
      const assetCard = picker.locator('.resource-asset-card').first();
      await expect(assetCard).toBeVisible({ timeout: 20_000 });
      await assetCard.getByRole('button', { name: '插入画布' }).click();
      await expect(picker).toBeHidden();
      await expect(imageNodes).toHaveCount(2);
    });
    expect(uiActions).toContain('listAssets');

    await test.step('G40: @ opens the mention menu and inserts an asset reference', async () => {
      await page.getByRole('button', { name: '@ 引用资源' }).click();
      const mentionMenu = page.getByRole('listbox', { name: '资源引用候选' });
      const option = mentionMenu.getByRole('option').first();
      await expect(option).toBeVisible({ timeout: 20_000 });
      await option.click();
      const chips = page.getByRole('list', { name: '已引用资源' });
      await expect(chips).toBeVisible();
      await expect(
        chips.getByRole('button', { name: /移除/u }).first()
      ).toBeVisible();
    });

    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/pro-studio/k5-assets-mention.png',
    });
  });
});
