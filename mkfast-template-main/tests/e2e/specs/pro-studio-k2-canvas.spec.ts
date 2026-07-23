import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { unlockProStudio } from '../fixtures/pro-studio';

async function requireBox(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('Expected a visible canvas element');
  return box;
}

async function openProject(page: Page, projectName: string) {
  const project = page
    .locator('.project-list .project-card')
    .filter({ hasText: projectName });
  await expect(project).toBeVisible();
  await project.click();
  await expect(page.locator('.canvas-toolbar')).toContainText(projectName);
  await expect(page.getByLabel('Pro Studio 高阶画布')).toBeVisible();
}

async function clickNode(
  page: Page,
  node: Locator,
  modifiers: ('Alt' | 'Control' | 'Meta' | 'Shift')[] = []
) {
  const box = await requireBox(node);
  for (const modifier of modifiers) await page.keyboard.down(modifier);
  await page.mouse.click(box.x + 40, box.y + 40);
  for (const modifier of [...modifiers].reverse()) {
    await page.keyboard.up(modifier);
  }
}

async function dragNodeTo(
  page: Page,
  surface: Locator,
  node: Locator,
  target: { x: number; y: number }
) {
  const handle = node.locator('.node-element > div').first();
  const [surfaceBox, nodeBox, handleBox] = await Promise.all([
    requireBox(surface),
    requireBox(node),
    requireBox(handle),
  ]);
  const start = {
    x: handleBox.x + handleBox.width / 2,
    y: handleBox.y + handleBox.height / 2,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(
    start.x + (surfaceBox.x + target.x - (nodeBox.x + nodeBox.width / 2)),
    start.y + (surfaceBox.y + target.y - (nodeBox.y + nodeBox.height / 2)),
    { steps: 8 }
  );
  await page.mouse.up();
}

test.describe('Pro Studio K2 canvas acceptance', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('creates, arranges, connects, edits, and restores the K2 graph', async ({
    page,
    request,
  }) => {
    test.setTimeout(150_000);
    page.setDefaultTimeout(10_000);
    const projectName = `k2-canvas-${randomUUID().slice(0, 8)}`;
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

    const createProject = page.getByRole('button', {
      name: '新建',
      exact: true,
    });
    await expect(createProject).toBeEnabled();
    await createProject.click();
    const projectDialog = page.getByRole('dialog', { name: '新建工程' });
    await expect(projectDialog).toBeVisible();
    await projectDialog.getByLabel('工程名称').fill(projectName);
    await projectDialog
      .getByRole('button', { name: '创建工程', exact: true })
      .click();
    const surface = page.locator('[data-canvas-marquee-surface="true"]');
    await expect(surface).toBeVisible({ timeout: 20_000 });

    const placements = [
      { button: '文本', prefix: 'text', x: 190, y: 150 },
      { button: '图片', prefix: 'image', x: 570, y: 150 },
      { button: '视频', prefix: 'video', x: 190, y: 470 },
      { button: '音频', prefix: 'audio', x: 570, y: 470 },
      { button: '生成配置', prefix: 'config', x: 760, y: 310 },
    ] as const;
    const nodes = new Map<string, Locator>();
    for (const placement of placements) {
      await page
        .getByRole('button', { name: placement.button, exact: true })
        .click();
      const node = page.locator(
        `.kernel-node[data-node-id^="${placement.prefix}-"]`
      );
      await expect(node).toHaveCount(1);
      await dragNodeTo(page, surface, node, placement);
      await expect
        .poll(async () => {
          const [box, bounds] = await Promise.all([
            requireBox(node),
            requireBox(surface),
          ]);
          const center = {
            x: box.x + box.width / 2 - bounds.x,
            y: box.y + box.height / 2 - bounds.y,
          };
          return Math.max(
            Math.abs(center.x - placement.x),
            Math.abs(center.y - placement.y)
          );
        })
        .toBeLessThanOrEqual(2);
      nodes.set(placement.prefix, node);
    }
    await expect(page.locator('.kernel-node')).toHaveCount(5);

    const imageNode = nodes.get('image');
    const textNode = nodes.get('text');
    const videoNode = nodes.get('video');
    if (!imageNode || !textNode || !videoNode) {
      throw new Error('K2 nodes were not created');
    }
    await clickNode(page, imageNode);
    const imageBeforeResize = await requireBox(imageNode);
    const resizeHandle = imageNode.locator('.cursor-nwse-resize').last();
    const resizeBox = await requireBox(resizeHandle);
    const resizeStart = {
      x: resizeBox.x + resizeBox.width / 2,
      y: resizeBox.y + resizeBox.height / 2,
    };
    await resizeHandle.dispatchEvent('mousedown', {
      button: 0,
      clientX: resizeStart.x,
      clientY: resizeStart.y,
    });
    await page.evaluate(
      ({ x, y }) => {
        window.dispatchEvent(
          new MouseEvent('mousemove', { clientX: x, clientY: y })
        );
        window.dispatchEvent(
          new MouseEvent('mouseup', { clientX: x, clientY: y })
        );
      },
      { x: resizeStart.x + 70, y: resizeStart.y + 45 }
    );
    await expect
      .poll(async () => (await requireBox(imageNode)).width)
      .toBeGreaterThan(imageBeforeResize.width);

    await clickNode(page, textNode);
    await clickNode(page, imageNode, ['Shift']);
    await expect(page.locator('.kernel-node.is-selected')).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(page.locator('.kernel-node.is-selected')).toHaveCount(0);

    const [surfaceBox, textBox, videoBox] = await Promise.all([
      requireBox(surface),
      requireBox(textNode),
      requireBox(videoNode),
    ]);
    const marqueeLeft = Math.max(textBox.x, videoBox.x) + 24;
    const marqueeRight =
      Math.min(textBox.x + textBox.width, videoBox.x + videoBox.width) - 24;
    await page.keyboard.down('Control');
    await page.mouse.move(
      Math.max(surfaceBox.x + 4, marqueeLeft),
      Math.max(surfaceBox.y + 4, Math.min(textBox.y, videoBox.y) - 8)
    );
    await page.mouse.down();
    await page.mouse.move(
      Math.min(surfaceBox.x + surfaceBox.width - 4, marqueeRight),
      Math.min(
        surfaceBox.y + surfaceBox.height - 4,
        Math.max(textBox.y + textBox.height, videoBox.y + videoBox.height) + 8
      ),
      { steps: 8 }
    );
    await expect(page.locator('[data-selection-marquee="true"]')).toBeVisible();
    await page.mouse.up();
    await page.keyboard.up('Control');
    await expect(page.locator('.kernel-node.is-selected')).toHaveCount(2);
    await expect(textNode).toHaveClass(/is-selected/u);
    await expect(videoNode).toHaveClass(/is-selected/u);

    await clickNode(page, textNode);
    const sourceHandle = textNode.locator('.cursor-crosshair').last();
    const targetHandle = imageNode.locator('.cursor-crosshair').first();
    const [sourceHandleBox, targetHandleBox] = await Promise.all([
      requireBox(sourceHandle),
      requireBox(targetHandle),
    ]);
    await sourceHandle.dispatchEvent('mousedown', {
      button: 0,
      clientX: sourceHandleBox.x + sourceHandleBox.width / 2,
      clientY: sourceHandleBox.y + sourceHandleBox.height / 2,
    });
    await expect(targetHandle).toHaveClass(/pointer-events-auto/u);
    await page.mouse.move(
      targetHandleBox.x + targetHandleBox.width / 2,
      targetHandleBox.y + targetHandleBox.height / 2,
      { steps: 8 }
    );
    const imageNodeId = await imageNode.getAttribute('data-node-id');
    await expect
      .poll(() =>
        page.evaluate(
          ({ x, y }) =>
            document
              .elementFromPoint(x, y)
              ?.closest('[data-node-id]')
              ?.getAttribute('data-node-id'),
          {
            x: targetHandleBox.x + targetHandleBox.width / 2,
            y: targetHandleBox.y + targetHandleBox.height / 2,
          }
        )
      )
      .toBe(imageNodeId);
    await page.mouse.up();
    await expect(page.locator('[data-connection-id]')).toHaveCount(1);

    const blankPoint = {
      x: surfaceBox.x + surfaceBox.width - 40,
      y: surfaceBox.y + surfaceBox.height - 90,
    };
    await clickNode(page, imageNode);
    const blankSourceBox = await requireBox(
      imageNode.locator('.cursor-crosshair').last()
    );
    await imageNode
      .locator('.cursor-crosshair')
      .last()
      .dispatchEvent('mousedown', {
        button: 0,
        clientX: blankSourceBox.x + blankSourceBox.width / 2,
        clientY: blankSourceBox.y + blankSourceBox.height / 2,
      });
    await expect(textNode.locator('.cursor-crosshair').first()).toHaveClass(
      /pointer-events-auto/u
    );
    await page.mouse.move(blankPoint.x, blankPoint.y, { steps: 8 });
    await page.mouse.up();
    const createMenu = page.locator('[data-connection-create-menu="true"]');
    await expect(createMenu).toBeVisible();
    await createMenu.getByRole('button', { name: '音频', exact: true }).click();
    await expect(page.locator('.kernel-node')).toHaveCount(6);
    await expect(page.locator('[data-connection-id]')).toHaveCount(2);

    await clickNode(page, textNode);
    await clickNode(page, imageNode, ['Shift']);
    await page.keyboard.press('Meta+C');
    await page.keyboard.press('Meta+V');
    await expect(page.locator('.kernel-node')).toHaveCount(8);
    await expect(page.locator('[data-connection-id]')).toHaveCount(3);
    await page.keyboard.press('Delete');
    await expect(page.locator('.kernel-node')).toHaveCount(6);
    await page.keyboard.press('Meta+Z');
    await expect(page.locator('.kernel-node')).toHaveCount(8);
    await expect(page.locator('[data-connection-id]')).toHaveCount(3);

    const restoredNodeIds = await page
      .locator('.kernel-node')
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('data-node-id')).sort()
      );
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.locator('.status-dot')).toHaveText(/草稿 v\d+ 已保存/u);
    await page.reload();
    await openProject(page, projectName);
    await expect(page.locator('.kernel-node')).toHaveCount(8);
    await expect(page.locator('[data-connection-id]')).toHaveCount(3);
    await expect
      .poll(() =>
        page
          .locator('.kernel-node')
          .evaluateAll((elements) =>
            elements
              .map((element) => element.getAttribute('data-node-id'))
              .sort()
          )
      )
      .toEqual(restoredNodeIds);
  });
});
