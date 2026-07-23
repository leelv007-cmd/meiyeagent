import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { unlockProStudio } from '../fixtures/pro-studio';

// 4x2 opaque PNG (same fixture as the K3 retouch journey): a real owned image
// the node-generation workbench can select as a context node.
const WIDE_PNG_FIXTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEklEQVR4nGP4H1DxHxkzoAsAAHjBFjFw6Q5vAAAAAElFTkSuQmCC',
  'base64'
);
const UPLOAD_INPUT =
  'input[accept="image/jpeg,image/png,image/webp,video/mp4,audio/mpeg,audio/wav"]';
// The workbench reuses #167's ResourceMentionComposer and the RuntimePanel
// renders a second one, so every workbench interaction is scoped to its region.
const WORKBENCH = '.node-generation-workbench';
const PROMPT_LABEL = '生成提示词，可输入 @ 引用已连接节点或素材';
// Provider / deployment / model / job internals must never reach merchant copy
// (G47 honest ModelPicker + unavailableModelReason redaction).
const LEAK_PATTERN =
  /provider|deployment|llm-|ws_|https?:\/\/|[a-f0-9]{8}-[a-f0-9]{4}-/iu;

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

async function selectImageNode(page: Page, nodeId: string) {
  await page.keyboard.press('Escape');
  await page.locator(`.kernel-node[data-node-id="${nodeId}"] img`).click();
  await expect(
    page.locator(`.kernel-node[data-node-id="${nodeId}"]`)
  ).toHaveClass(/is-selected/u);
}

async function enterCanvas(page: Page, request: APIRequestContext) {
  const user = await registerE2EUser(request);
  await loginByForm(page, user);
  // Visit a Main-app dashboard route first: its authenticated Main -> Core proxy
  // call runs verified-workspace provisioning (register_gift +
  // provision_model_defaults) synchronously, activating the platform default
  // models (image.generate=gpt-image-2, …) before we reach the canvas catalog.
  await page.goto('/dashboard');
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.goto('/dashboard/content').catch(() => undefined);
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
  await expect(page.getByText('Pro Studio', { exact: true })).toBeVisible();
}

async function createProjectWithImage(
  page: Page,
  projectName: string,
  uploadName: string
) {
  const imageNodes = page.locator('.kernel-node[data-node-id^="image-"]');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  const createDialog = page.getByRole('dialog', { name: '新建工程' });
  await expect(createDialog).toBeVisible();
  await createDialog.getByLabel('工程名称').fill(projectName);
  await createDialog.getByRole('button', { name: '创建工程' }).click();
  await expect(page.getByLabel('Pro Studio 高阶画布')).toBeVisible();

  // Two-step upload: the picker opens first and hosts the hidden file input;
  // assert the node (a hard fact) rather than the auto-saved status message.
  await page.getByRole('button', { name: '选择或上传' }).click();
  await page.locator(UPLOAD_INPUT).setInputFiles({
    buffer: WIDE_PNG_FIXTURE,
    mimeType: 'image/png',
    name: uploadName,
  });
  await expect(imageNodes).toHaveCount(1);
  await page.getByRole('button', { name: '关闭素材选择器' }).click();
  const sourceNodeId =
    (await imageNodes.first().getAttribute('data-node-id')) ?? '';
  expect(sourceNodeId).toBeTruthy();
  return sourceNodeId;
}

async function openWorkbench(page: Page, nodeId: string) {
  await selectImageNode(page, nodeId);
  await page
    .locator('.canvas-toolbar')
    .getByRole('button', { name: '节点生成' })
    .click();
  await expect(page.locator(WORKBENCH)).toBeVisible();
}

async function activateImageGenerate(page: Page) {
  const workbench = page.locator(WORKBENCH);
  // The image node opens on the gated image.edit action; switch to the
  // platform-seeded image.generate operation and wait for the honest picker to
  // surface available models.
  await workbench.getByRole('button', { name: '生成图片' }).click();
  const modelSelect = workbench.getByLabel('模型');
  await expect(modelSelect).toBeEnabled();
  await expect(modelSelect.locator('option')).not.toHaveCount(0);
  // G35 settings: fill every strict parameter the active model actually exposes
  // (gpt-image-2 governs width/height; a ratio-governed model would show a
  // custom ratio field instead) so the frozen quote input validates.
  const ratio = workbench.getByLabel(/画面比例/u);
  if (await ratio.count()) await ratio.fill('3:2');
  const numbers = workbench.locator(
    '.node-generation-workbench__parameters input[type="number"]'
  );
  const numberCount = await numbers.count();
  for (let i = 0; i < numberCount; i += 1) {
    await numbers.nth(i).fill('1024');
  }
}

test.describe('Pro Studio K4 node generation parity (G32-G47)', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('image.generate fan-out quotes, submits a batch, stacks jobs and rehydrates after refresh', async ({
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
    const projectName = `nodegen-ui-${randomUUID().slice(0, 8)}`;
    const uploadName = `nodegen-wide-${randomUUID().slice(0, 8)}.png`;
    const workbench = page.locator(WORKBENCH);
    const jobCards = workbench.locator('.canvas-generation-job-card');

    await enterCanvas(page, request);
    const sourceNodeId = await createProjectWithImage(
      page,
      projectName,
      uploadName
    );

    await test.step('G32/G47 opens the inline workbench and activates image.generate', async () => {
      await openWorkbench(page, sourceNodeId);
      await activateImageGenerate(page);
    });

    await test.step('G33/G34/G35/G36 configures a 2-item fan-out and freezes a batch quote', async () => {
      await workbench.getByLabel('生成数量').fill('2');
      await workbench
        .getByRole('textbox', { name: PROMPT_LABEL })
        .fill('暖白背景的美业门店新品主视觉，产品居中，柔光干净');
      const quote = workbench.getByRole('button', {
        name: /获取 \d+ 项报价/u,
      });
      await expect(quote).toBeEnabled({ timeout: 20_000 });
      await quote.click();
      const summary = workbench.getByLabel('报价汇总');
      await expect(summary).toBeVisible({ timeout: 30_000 });
      await expect(summary).toContainText('2 项');
      await expect(summary.getByText(/第 \d+ 项：已报价/u)).toHaveCount(2);
    });

    await test.step('G05/G36 confirms the batch and stacks two submitted jobs', async () => {
      const confirm = workbench.getByRole('button', {
        name: /确认提交 \d+ 项/u,
      });
      await expect(confirm).toBeEnabled();
      await confirm.click();
      const stack = workbench.getByLabel('批量生成结果');
      await expect(stack).toBeVisible({ timeout: 30_000 });
      await expect(stack).toContainText('已提交 2/2', { timeout: 30_000 });
      await workbench.getByRole('button', { name: '展开全部' }).click();
      await expect(jobCards).toHaveCount(2);
    });

    await test.step('G05 promotes a stacked result to the primary image', async () => {
      // Target the card header (a single <strong>); asserting on the whole card
      // would match the "设为主图" button, whose label contains "主图".
      const firstHeader = jobCards.first().locator('strong');
      await expect(firstHeader).toHaveText('第 1 项');
      await jobCards.first().getByRole('button', { name: '设为主图' }).click();
      await expect(firstHeader).toHaveText('主图', { timeout: 20_000 });
    });

    await test.step('the durable batch snapshot rehydrates after a refresh', async () => {
      await expect(page.locator('.canvas-toolbar')).not.toContainText(
        '未保存',
        { timeout: 30_000 }
      );
      await page.reload();
      await openProject(page, projectName);
      await openWorkbench(page, sourceNodeId);
      await expect(workbench.getByLabel('批量生成结果')).toContainText(
        '已提交 2/2',
        { timeout: 30_000 }
      );
    });

    // The workbench drives only the fixed BackendPort actions through the real
    // Core service; no fake job or client-side generation is involved.
    expect(uiActions).toEqual(
      expect.arrayContaining([
        'createProject',
        'createCheckpoint',
        'quoteGeneration',
        'submitGeneration',
      ])
    );
  });

  test('honestly gates image.edit and text.respond without leaking provider internals (G38/G47)', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    page.setDefaultTimeout(10_000);
    const projectName = `nodegen-honest-${randomUUID().slice(0, 8)}`;
    const uploadName = `nodegen-honest-${randomUUID().slice(0, 8)}.png`;
    const workbench = page.locator(WORKBENCH);
    const reason = page.locator(`${WORKBENCH} > output`);
    const quoteButton = workbench.getByRole('button', {
      name: /获取 \d+ 项报价/u,
    });

    await enterCanvas(page, request);
    const sourceNodeId = await createProjectWithImage(
      page,
      projectName,
      uploadName
    );

    await test.step('G47 image.edit defaults to a merchant-safe unavailable reason', async () => {
      await openWorkbench(page, sourceNodeId);
      await expect(
        workbench.getByRole('button', { name: '编辑图片' })
      ).toHaveAttribute('aria-pressed', 'true');
      await expect(reason).toBeVisible();
      const reasonText = ((await reason.textContent()) ?? '').trim();
      expect(reasonText).not.toBe('');
      expect(reasonText).not.toMatch(LEAK_PATTERN);
      await expect(quoteButton).toBeDisabled();
    });

    await test.step('switching to image.generate proves the picker distinguishes available supply', async () => {
      await workbench.getByRole('button', { name: '生成图片' }).click();
      await expect(workbench.getByLabel('模型')).toBeEnabled();
      await expect(reason).toHaveCount(0);
    });

    await test.step('G38 text.respond stays honestly gated on a text node', async () => {
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '文字节点' }).click();
      const textNode = page.locator('.kernel-node[data-node-id^="text-"]');
      await expect(textNode).toHaveCount(1);
      await textNode.getByText('双击后续编辑这段文案').click();
      await expect(textNode).toHaveClass(/is-selected/u);
      await page
        .locator('.canvas-toolbar')
        .getByRole('button', { name: '节点生成' })
        .click();
      await expect(workbench).toBeVisible();
      await expect(
        workbench.getByRole('button', { name: '生成文本' })
      ).toHaveAttribute('aria-pressed', 'true');
      await expect(reason).toBeVisible();
      expect((await reason.textContent()) ?? '').not.toMatch(LEAK_PATTERN);
      await expect(quoteButton).toBeDisabled();
    });
  });
});
