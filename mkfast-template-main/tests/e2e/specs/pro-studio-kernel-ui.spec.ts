import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { unlockProStudio } from '../fixtures/pro-studio';

const WIDE_PNG_FIXTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEklEQVR4nGP4H1DxHxkzoAsAAHjBFjFw6Q5vAAAAAElFTkSuQmCC',
  'base64'
);

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

test.describe('Pro Studio authorized kernel UI', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('fixture generation: UI restores, retouches, generates, and adopts one kernel project', async ({
    browser,
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
    const projectName = `kernel-ui-${randomUUID().slice(0, 8)}`;
    const deletedProjectName = `kernel-delete-${randomUUID().slice(0, 8)}`;
    const uploadName = `kernel-wide-${randomUUID().slice(0, 8)}.png`;
    let activePage = page;
    let derivedAssetId = '';
    let derivedNodeId = '';
    let generatedNodeId = '';
    let sourceAssetId = '';
    let sourceDeliveryUrl = '';
    let sourceNodeId = '';
    let textNodeId = '';

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

    await test.step('E1 creates a kernel project and restores its node graph after refresh', async () => {
      await page.getByRole('button', { name: '新建', exact: true }).click();
      const createDialog = page.getByRole('dialog', { name: '新建工程' });
      const projectNameInput = createDialog.getByLabel('工程名称');
      await expect(createDialog).toBeVisible();
      await expect(projectNameInput).toBeFocused();
      await projectNameInput.fill(projectName);
      await projectNameInput.press('Enter');
      await expect(page.getByLabel('Pro Studio 高阶画布')).toBeVisible();
      await expect(page.getByText('开始你的 Pro Studio 创作')).toBeVisible();

      await page.getByRole('button', { name: '文字节点' }).click();
      const textNode = page.locator('.kernel-node[data-node-id^="text-"]');
      await expect(textNode).toHaveCount(1);
      await expect(textNode).toContainText('双击后续编辑这段文案');
      textNodeId = (await textNode.getAttribute('data-node-id')) ?? '';
      expect(textNodeId).toBeTruthy();

      await textNode.getByText('双击后续编辑这段文案').dblclick();
      const editor = textNode.locator('textarea');
      await expect(editor).toBeVisible();
      await editor.fill('跨会话恢复的美业新品文案');
      await editor.press('Escape');
      await expect(textNode).toContainText('跨会话恢复的美业新品文案');
      await expect(page.locator('.canvas-toolbar')).toContainText('未保存');

      const beforeUnload = page.waitForEvent('dialog');
      const returnAttempt = page
        .getByRole('link', { name: '返回主产品' })
        .click({ noWaitAfter: true });
      const dialog = await beforeUnload;
      expect(dialog.type()).toBe('beforeunload');
      await dialog.dismiss();
      await returnAttempt;
      await expect(page).toHaveURL(
        (url) => url.origin === canvasOrigin && url.pathname === '/'
      );
      await expect(page.locator('.canvas-toolbar')).toContainText('未保存');

      await page.getByRole('button', { name: '保存', exact: true }).click();
      await expect(page.locator('.status-dot')).toHaveText(/草稿 v\d+ 已保存/u);

      await page.reload();
      await openProject(page, projectName);
      await expect(
        page.locator('.kernel-node[data-node-id^="text-"]')
      ).toHaveCount(1);

      await page.getByRole('button', { name: '新建', exact: true }).click();
      const deleteCreateDialog = page.getByRole('dialog', { name: '新建工程' });
      await deleteCreateDialog.getByLabel('工程名称').fill(deletedProjectName);
      await deleteCreateDialog
        .getByRole('button', { name: '创建工程' })
        .click();
      const deletedProject = page
        .locator('.project-list .project-card')
        .filter({ hasText: deletedProjectName });
      const deleteTrigger = deletedProject.getByRole('button', {
        name: `删除工程 ${deletedProjectName}`,
      });
      await expect(deletedProject).toBeVisible();
      await deleteTrigger.click();
      const deleteDialog = page.getByRole('dialog', {
        name: '删除 1 个工程？',
      });
      await expect(deleteDialog).toContainText('移入回收保留区');
      await deleteDialog.getByRole('button', { name: '取消' }).click();
      await expect(deleteTrigger).toBeFocused();
      await expect(deletedProject).toBeVisible();

      await deleteTrigger.click();
      await page
        .getByRole('dialog', { name: '删除 1 个工程？' })
        .getByRole('button', { name: '移入回收保留区' })
        .click();
      await expect(page.locator('.status-dot')).toHaveText('工程已软删除');
      await expect(deletedProject).toHaveCount(0);
      await openProject(page, projectName);
    });

    await test.step('E2 uploads, connects, square-crops, and restores owned media', async () => {
      await page
        .locator('input[accept="image/*,video/*,audio/*"]')
        .setInputFiles({
          buffer: WIDE_PNG_FIXTURE,
          mimeType: 'image/png',
          name: uploadName,
        });
      await expect(page.locator('.status-dot')).toHaveText(
        '素材已存入服务端素材库并插入画布'
      );

      const textNode = page.locator('.kernel-node[data-node-id^="text-"]');
      const imageNodes = page.locator('.kernel-node[data-node-id^="image-"]');
      await expect(imageNodes).toHaveCount(1);
      const sourceImage = imageNodes.first();
      sourceNodeId = (await sourceImage.getAttribute('data-node-id')) ?? '';
      expect(sourceNodeId).toBeTruthy();

      await textNode.getByText('跨会话恢复的美业新品文案').click();
      await sourceImage.locator('img').click({ modifiers: ['Shift'] });
      await expect(page.locator('.kernel-node.is-selected')).toHaveCount(2);
      await page.getByRole('button', { name: '连接选中' }).click();
      await expect(page.locator('[data-connection-id]')).toHaveCount(1);

      await page.keyboard.press('Escape');
      await sourceImage.locator('img').click();
      const crop = page.getByRole('button', { name: '方形裁切' });
      await expect(crop).toBeEnabled();
      await crop.click();
      await expect(page.locator('.status-dot')).toHaveText(
        '裁切结果已生成并保存'
      );
      await expect(imageNodes).toHaveCount(2);
      await expect(page.locator('[data-connection-id]')).toHaveCount(2);
      const derivedImage = imageNodes.last();
      derivedNodeId = (await derivedImage.getAttribute('data-node-id')) ?? '';
      expect(derivedNodeId).toBeTruthy();

      const sourceImageElement = sourceImage.locator('img');
      const derivedImageElement = derivedImage.locator('img');
      sourceDeliveryUrl = (await sourceImageElement.getAttribute('src')) ?? '';
      const derivedDeliveryUrl =
        (await derivedImageElement.getAttribute('src')) ?? '';
      expect(sourceDeliveryUrl).toBeTruthy();
      expect(derivedDeliveryUrl).toBeTruthy();
      expect(derivedDeliveryUrl).not.toBe(sourceDeliveryUrl);
      sourceAssetId =
        new URL(sourceDeliveryUrl, canvasOrigin).searchParams.get('assetId') ??
        '';
      derivedAssetId =
        new URL(derivedDeliveryUrl, canvasOrigin).searchParams.get('assetId') ??
        '';
      expect(sourceAssetId).toBeTruthy();
      expect(derivedAssetId).toBeTruthy();
      expect(derivedAssetId).not.toBe(sourceAssetId);
      await expect(sourceImageElement).toHaveJSProperty('naturalWidth', 4);
      await expect(sourceImageElement).toHaveJSProperty('naturalHeight', 2);
      await expect(derivedImageElement).toHaveJSProperty('naturalWidth', 2);
      await expect(derivedImageElement).toHaveJSProperty('naturalHeight', 2);

      await test.step('K03 marquee-selects, multi-drags, undoes, and redoes nodes through visible controls', async () => {
        const requireBox = async (locator: typeof textNode) => {
          const box = await locator.boundingBox();
          expect(box).not.toBeNull();
          if (!box) throw new Error('Canvas node must have visible bounds');
          return box;
        };
        const surface = page.locator('[data-canvas-marquee-surface="true"]');
        const surfaceBox = await requireBox(surface);
        await page.mouse.click(
          surfaceBox.x + surfaceBox.width - 8,
          surfaceBox.y + surfaceBox.height - 8
        );
        await expect(page.locator('.kernel-node.is-selected')).toHaveCount(0);

        const textBefore = await requireBox(textNode);
        const sourceBefore = await requireBox(sourceImage);
        const marqueeStart = {
          x: Math.max(
            surfaceBox.x + 4,
            Math.min(textBefore.x, sourceBefore.x) - 8
          ),
          y: Math.max(
            surfaceBox.y + 4,
            Math.min(textBefore.y, sourceBefore.y) - 8
          ),
        };
        const marqueeEnd = {
          x: Math.min(
            surfaceBox.x + surfaceBox.width - 4,
            Math.max(
              textBefore.x + textBefore.width,
              sourceBefore.x + sourceBefore.width
            ) + 8
          ),
          y: Math.min(
            surfaceBox.y + surfaceBox.height - 4,
            Math.max(
              textBefore.y + textBefore.height,
              sourceBefore.y + sourceBefore.height
            ) + 8
          ),
        };
        await page.keyboard.down('Control');
        await page.mouse.move(marqueeStart.x, marqueeStart.y);
        await page.mouse.down();
        await page.mouse.move(marqueeEnd.x, marqueeEnd.y, { steps: 8 });
        await expect(
          page.locator('[data-selection-marquee="true"]')
        ).toBeVisible();
        await page.mouse.up();
        await page.keyboard.up('Control');

        await expect(page.locator('.kernel-node.is-selected')).toHaveCount(2);
        await expect(textNode).toHaveClass(/is-selected/u);
        await expect(sourceImage).toHaveClass(/is-selected/u);
        await expect(derivedImage).not.toHaveClass(/is-selected/u);

        const dragDelta = { x: 36, y: 28 };
        const selectedPositions = async () => {
          const [textBox, sourceBox] = await Promise.all([
            textNode.boundingBox(),
            sourceImage.boundingBox(),
          ]);
          if (!textBox || !sourceBox) return null;
          return {
            sourceX: Math.round(sourceBox.x - sourceBefore.x),
            sourceY: Math.round(sourceBox.y - sourceBefore.y),
            textX: Math.round(textBox.x - textBefore.x),
            textY: Math.round(textBox.y - textBefore.y),
          };
        };
        const movedPositions = {
          sourceX: dragDelta.x,
          sourceY: dragDelta.y,
          textX: dragDelta.x,
          textY: dragDelta.y,
        };
        const originalPositions = {
          sourceX: 0,
          sourceY: 0,
          textX: 0,
          textY: 0,
        };
        const dragHandle = await requireBox(
          textNode.getByText('跨会话恢复的美业新品文案')
        );
        await page.mouse.move(
          dragHandle.x + dragHandle.width / 2,
          dragHandle.y + dragHandle.height / 2
        );
        await page.mouse.down();
        await page.mouse.move(
          dragHandle.x + dragHandle.width / 2 + dragDelta.x,
          dragHandle.y + dragHandle.height / 2 + dragDelta.y,
          { steps: 8 }
        );
        await page.mouse.up();
        await expect.poll(selectedPositions).toEqual(movedPositions);

        const undo = page.locator('[data-canvas-undo="true"]');
        const redo = page.locator('[data-canvas-redo="true"]');
        await expect(undo).toBeEnabled();
        await undo.click();
        await expect.poll(selectedPositions).toEqual(originalPositions);
        await expect(redo).toBeEnabled();
        await redo.click();
        await expect.poll(selectedPositions).toEqual(movedPositions);

        await page.getByRole('button', { name: '保存', exact: true }).click();
        await expect(page.locator('.status-dot')).toHaveText(
          /草稿 v\d+ 已保存/u
        );
      });

      await page.reload();
      await openProject(page, projectName);
      await expect(
        page.locator('.kernel-node[data-node-id^="text-"]')
      ).toHaveCount(1);
      await expect(
        page.locator('.kernel-node[data-node-id^="image-"]')
      ).toHaveCount(2);
      await expect(page.locator('[data-connection-id]')).toHaveCount(2);
      await expect(page.locator('.kernel-node img')).toHaveCount(2);
      await expect(page.locator('.kernel-node img').first()).toBeVisible();
      await expect(page.locator('.kernel-node img').last()).toBeVisible();
    });

    await test.step('K11 restores the same server project in a cookie-clean browser context', async () => {
      const mainOrigin =
        process.env.PLAYWRIGHT_BASE_URL ??
        `http://localhost:${process.env.PORT ?? '3000'}`;
      const restoredContext = await browser.newContext({
        baseURL: mainOrigin,
        viewport: { height: 900, width: 1440 },
      });
      expect(await restoredContext.cookies()).toEqual([]);
      const restoredPage = await restoredContext.newPage();
      restoredPage.setDefaultTimeout(10_000);
      collectCanvasUiActions(restoredPage, uiActions);

      await loginByForm(restoredPage, user);
      await restoredPage.goto('/pro-studio');
      await restoredPage.getByRole('button', { name: '一键进入' }).click();
      await expect(restoredPage).toHaveURL(
        (url) => url.origin === canvasOrigin && url.pathname === '/',
        { timeout: 20_000 }
      );
      await openProject(restoredPage, projectName);

      await expect(
        restoredPage.locator(`.kernel-node[data-node-id="${textNodeId}"]`)
      ).toContainText('跨会话恢复的美业新品文案');
      await expect(
        restoredPage.locator(`.kernel-node[data-node-id="${sourceNodeId}"] img`)
      ).toHaveAttribute('src', sourceDeliveryUrl);
      await expect(
        restoredPage.locator(
          `.kernel-node[data-node-id="${derivedNodeId}"] img`
        )
      ).toHaveAttribute('src', new RegExp(derivedAssetId, 'u'));
      await expect(restoredPage.locator('.kernel-node img')).toHaveCount(2);
      await expect(restoredPage.locator('[data-connection-id]')).toHaveCount(2);
      activePage = restoredPage;
    });

    await test.step('fixture generation survives refresh and inserts through the UI', async () => {
      const textAnchor = activePage.locator(
        `.kernel-node[data-node-id="${textNodeId}"]`
      );
      await textAnchor.getByText('跨会话恢复的美业新品文案').click();
      await expect(textAnchor).toHaveClass(/is-selected/u);
      await expect(
        activePage.locator(`[data-generation-input-node-id="${sourceNodeId}"]`)
      ).toBeVisible();
      const edgeCountBeforeGeneration = await activePage
        .locator('[data-connection-id]')
        .count();
      expect(edgeCountBeforeGeneration).toBe(2);

      await activePage
        .getByRole('button', { name: '检查点', exact: true })
        .click();
      await expect(activePage.locator('.status-dot')).toHaveText(
        '不可变检查点已创建'
      );

      const imageGenerate = activePage
        .locator('.capability-grid button')
        .filter({ hasText: '图片生成' });
      await expect(imageGenerate).toContainText('可用');
      await imageGenerate.click();
      await activePage
        .getByPlaceholder('选择提示词或输入生成指令')
        .fill('暖白背景的美业门店新品主视觉，产品居中，干净柔光');

      const quote = activePage.getByRole('button', { name: '获取报价' });
      await expect(quote).toBeEnabled();
      await quote.click();
      await expect(activePage.getByText(/报价已固定/u)).toBeVisible();

      const submit = activePage.getByRole('button', { name: '确认提交' });
      await expect(submit).toBeEnabled();
      await submit.click();
      await expect(activePage.getByText('生成任务已提交。')).toBeVisible();

      const insert = activePage.getByRole('button', { name: '插入画布' });
      await expect(insert).toBeVisible({ timeout: 90_000 });

      await activePage.reload();
      await openProject(activePage, projectName);
      await expect(
        activePage.getByRole('button', { name: '插入画布' })
      ).toBeVisible({ timeout: 20_000 });
      await activePage.getByRole('button', { name: '插入画布' }).click();
      await expect(activePage.locator('.status-dot')).toHaveText(
        '生成结果已插入画布并保存'
      );
      const generatedNode = activePage.locator(
        '.kernel-node[data-node-id^="generated-"]'
      );
      await expect(generatedNode).toHaveCount(1);
      generatedNodeId =
        (await generatedNode.getAttribute('data-node-id')) ?? '';
      expect(generatedNodeId).toBeTruthy();
      await expect(activePage.locator('[data-connection-id]')).toHaveCount(
        edgeCountBeforeGeneration + 1
      );
      await expect(
        activePage.locator(
          `g[data-edge-source="${sourceNodeId}"][data-edge-target="${generatedNodeId}"]`
        )
      ).toHaveCount(1);

      await activePage.reload();
      await openProject(activePage, projectName);
      await expect(
        activePage.locator(`.kernel-node[data-node-id="${generatedNodeId}"]`)
      ).toHaveCount(1);
      await expect(
        activePage.locator(
          `g[data-edge-source="${sourceNodeId}"][data-edge-target="${generatedNodeId}"]`
        )
      ).toHaveCount(1);
    });

    await test.step('E4 adopts the ordered canvas selection and opens the same ContentPackage', async () => {
      const textNode = activePage.locator(
        `.kernel-node[data-node-id="${textNodeId}"]`
      );
      const generatedNode = activePage.locator(
        `.kernel-node[data-node-id="${generatedNodeId}"]`
      );

      await textNode.getByText('跨会话恢复的美业新品文案').click();
      await generatedNode.locator('img').click({ modifiers: ['Shift'] });
      await expect(activePage.locator('.kernel-node.is-selected')).toHaveCount(
        2
      );
      await expect(
        activePage.getByText('将按当前画布选中顺序采用 2 个节点。', {
          exact: true,
        })
      ).toBeVisible();

      const adopt = activePage.getByRole('button', {
        name: '采用当前生成节点',
      });
      await expect(adopt).toBeEnabled();
      await adopt.click();
      await expect(
        activePage.getByText('已采用为主产品 ContentPackage。')
      ).toBeVisible();

      const adoptionLink = activePage.locator('.adoption-list a').first();
      await expect(adoptionLink).toBeVisible();
      const href = await adoptionLink.getAttribute('href');
      expect(href).toBeTruthy();
      const packageId = new URL(href!).searchParams.get('packageId');
      expect(packageId).toBeTruthy();
      await expect(generatedNode).toContainText('已采用');

      await activePage.screenshot({
        fullPage: true,
        path: resolve(
          process.cwd(),
          '..',
          'docs/evidence/pro-studio/kernel-v1-ui-smoke.png'
        ),
      });

      await adoptionLink.click();
      await expect(activePage).toHaveURL(
        (url) =>
          url.pathname === '/dashboard/content' &&
          url.searchParams.get('packageId') === packageId,
        { timeout: 20_000 }
      );
      await expect(
        activePage.locator(`[data-content-package-id="${packageId}"]`)
      ).toBeVisible({ timeout: 20_000 });
    });

    expect(uiActions).toEqual(
      expect.arrayContaining([
        'createProject',
        'saveProjectDraft',
        'persistLocalCanvasArtifact',
        'createCheckpoint',
        'quoteGeneration',
        'submitGeneration',
        'listProjectGenerations',
        'adoptAdvancedCanvasOutput',
      ])
    );
    if (activePage !== page) await activePage.context().close();
  });
});
