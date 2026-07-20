import { expect, test } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

test.describe('assisted asset intake', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('offers all three fallbacks and confirms a fact revision through Core', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request, { role: 'admin' });
    await loginByForm(page, user);
    const assetMemoryActions: string[] = [];
    page.on('request', (browserRequest) => {
      if (!browserRequest.url().includes('/api/core/p1/commands')) return;
      const body = browserRequest.postDataJSON() as {
        action?: string;
        module?: string;
      };
      if (body.module === 'asset-memory' && body.action) {
        assetMemoryActions.push(body.action);
      }
    });

    await page.goto('/dashboard');
    await page
      .getByLabel('描述这次想创作的内容')
      .fill('https://example.invalid/login-wall');
    const panel = page.getByTestId('assisted-asset-intake');
    await expect(panel).toBeVisible();

    await panel.getByRole('button', { name: '使用已上传截图' }).click();
    await expect(panel.getByText(/请先在上方上传并授权一张截图/)).toBeVisible();
    await panel.getByRole('button', { name: '粘贴文本' }).click();
    await panel
      .getByLabel('粘贴看见的价格文字，例如：头疗团购价 239 元')
      .fill('头疗团购价 239 元');
    await panel.getByRole('button', { name: '手动选择' }).click();
    await panel.getByLabel('当前价格（元）').fill('239');
    await panel.getByRole('button', { name: '预览本次理解' }).click();

    const preview = page.getByTestId('assisted-intake-preview');
    await expect(preview).toContainText('"amount":239');
    await expect(preview).toContainText('来源');
    await expect(preview).toContainText('生效时间');
    await expect(preview).toContainText('过期日期');
    await preview.getByRole('button', { name: '确认并保存这条事实' }).click();
    await expect(preview).toContainText('已保存为事实第 1 版');
    expect(assetMemoryActions).toEqual([
      'prepare_assisted_price_intake',
      'confirm_asset_intake_fact',
    ]);
  });
});
