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

  test('runs strict BYOK and a published Feishu tool through recorded adapters', async ({
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

    await expect(
      page.getByText('Strict BYOK 执行', { exact: true })
    ).toBeVisible();
    await expect(page.getByText('演示执行', { exact: true })).toBeVisible();
    await page.getByLabel('执行内容').fill('为暮色美甲写一句克制的预约文案');
    await page.getByRole('button', { name: '执行 Strict BYOK' }).click();
    await expect(page.getByText(/结果：已完成/)).toBeVisible();
    await expect(page.getByText(/供应商另行计费/)).toBeVisible();

    await page.goto('/settings/connections');
    await expect(page.getByText('未接入', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: '飞书连接' }).click();
    await page.getByLabel('飞书用户或应用标识').fill('E2E Feishu');
    await page.getByLabel('飞书授权码').fill('recorded-feishu-uat');
    await page
      .getByRole('switch', { name: '使用已发布飞书工具请求能力' })
      .click();
    await page.getByRole('button', { name: '创建连接' }).click();
    await page.getByRole('button', { name: '验证飞书连接' }).click();

    const readTool = page.getByRole('region', {
      name: '飞书工具 feishu.doc.read',
    });
    await expect(readTool).toBeVisible({ timeout: 20_000 });
    await readTool.getByRole('button', { name: '加入快捷' }).click();
    await expect(
      readTool.getByRole('button', { name: '移出快捷' })
    ).toBeVisible();
    await readTool
      .getByLabel('工具参数（JSON）')
      .fill('{"documentId":"doc-e2e"}');
    await readTool.getByRole('button', { name: '执行明确意图' }).click();
    await expect(readTool.getByText('本次结果：已完成')).toBeVisible();

    await page.reload();
    const recoveredTool = page.getByRole('region', {
      name: '飞书工具 feishu.doc.read',
    });
    await expect(
      recoveredTool.getByRole('button', { name: '移出快捷' })
    ).toBeVisible();
    await expect(
      page.getByText('feishu.doc.read', { exact: true }).last()
    ).toBeVisible();
  });
});
