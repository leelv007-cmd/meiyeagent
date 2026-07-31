import { expect, test } from '@playwright/test';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

test.describe('P1 integration product journeys', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('records a write-only BYOK request without exposing its credential', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await page.goto('/settings/models?section=byok');

    await page.getByLabel('连接名称').fill('E2E BYOK');
    await page.getByLabel('模型密钥（API Key）').fill('recorded-byok-key');
    // Capabilities now start off and the scope list is compiled from them —
    // the raw 「授权范围」 text field (publish, observe, publish.poi, …) is gone
    // from the merchant surface, so granting is an explicit switch.
    await page.getByRole('switch', { name: '模型生成权限请求能力' }).click();
    await page.getByRole('button', { name: '创建连接' }).click();
    await expect(page.getByText('连接已创建，待完成授权验证')).toBeVisible();
    await expect(page.getByLabel('模型密钥（API Key）')).toHaveValue('');
  });
});
