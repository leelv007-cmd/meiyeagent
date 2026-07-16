import { expect, test } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

test.describe('P1 canonical-provider journey', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('persists a selected model through generation, derivation, canvas, and search', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const user = await registerE2EUser(request, { role: 'admin' });
    await loginByForm(page, user);

    await page.goto('/settings/models');
    await page.getByRole('tab', { name: '图片模型' }).click();
    const modelButton = page.getByRole('button', { name: '本次使用' }).first();
    await expect(modelButton).toBeEnabled();
    await modelButton.click();
    await expect(page.getByRole('button', { name: '已选中' })).toBeVisible();

    const intent = 'P1 已选模型的可恢复图文旅程';
    await page.goto('/dashboard');
    await page.getByLabel('描述这次想创作的内容').fill(intent);
    await page.getByRole('button', { name: '建立创作记录' }).click();
    const record = page.getByLabel('Agent 创作记录');
    await expect(record).toBeVisible();
    await record
      .getByRole('group', { name: '快速起步预设' })
      .getByRole('button', { name: /^图片生成/ })
      .click();
    await record.getByRole('button', { name: /^调整专业参数/ }).click();
    const selectedModel = record
      .getByRole('radiogroup', { name: '执行模型' })
      .getByRole('radio', { checked: true });
    await expect(selectedModel).toHaveCount(1);
    const selectedModelInput = selectedModel.locator(
      'xpath=following-sibling::input[@type="radio"]'
    );
    await expect(selectedModelInput).toBeChecked();
    const selectedModelId = await selectedModelInput.inputValue();
    await page.getByRole('checkbox', { name: /接受本次执行合同/ }).check();
    await page.getByRole('button', { name: '提交生成任务' }).click();

    await expect(async () => {
      const accept = page.getByRole('button', { name: '采纳为内容' }).first();
      if (await accept.isVisible()) return;
      const verify = page.getByRole('button', { name: '核验原任务' });
      await expect(verify).toBeVisible();
      await verify.click();
      await expect(accept).toBeVisible({ timeout: 2_000 });
    }).toPass({ intervals: [500, 1_000], timeout: 60_000 });
    await page.getByRole('button', { name: '采纳为内容' }).first().click();
    await expect(page.getByText('已采纳为内容', { exact: true })).toBeVisible();

    const projection = await page.evaluate(async () => {
      const response = await fetch('/api/core/p1/query', {
        body: JSON.stringify({
          action: 'creative_workbench',
          module: 'operations',
          payload: {},
        }),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      const envelope = (await response.json()) as {
        data?: {
          contents: unknown[];
          jobs: Array<{ contract: { catalogModelId: string }; status: string }>;
          works: Array<{ id: string }>;
        };
        error?: { message: string };
      };
      if (!response.ok || !envelope.data) {
        throw new Error(envelope.error?.message ?? 'Projection failed');
      }
      return envelope.data;
    });
    expect(projection.jobs).toHaveLength(1);
    expect(projection.jobs[0]).toMatchObject({
      contract: { catalogModelId: selectedModelId },
      status: 'completed',
    });
    expect(projection.contents).toHaveLength(1);
    expect(projection.works).toHaveLength(1);

    await page.getByRole('button', { name: '调整条件并另存为新创作' }).click();
    await expect(page.getByText('基于上一版调整')).toBeVisible();
    await page.getByRole('button', { name: '展开目录' }).click();
    await page.getByRole('button', { name: '新建空白画布' }).click();
    await expect(page).toHaveURL(/\/dashboard\/works\//);
    await expect(page.getByLabel('自由画布')).toBeVisible({
      timeout: 30_000,
    });

    await page.goto('/dashboard/search');
    await page.getByLabel('搜索 canonical 对象').fill(intent);
    await expect(page).toHaveURL(/q=/);
    await page.reload();
    await expect(page.getByLabel('搜索 canonical 对象')).toHaveValue(intent);
    await expect(page.getByText(intent).first()).toBeVisible();
  });
});
