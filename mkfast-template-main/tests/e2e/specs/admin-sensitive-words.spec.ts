import { expect, test } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

test.describe('sensitive words operations (#320)', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('an admin creates, edits, disables, and deletes one sensitive word', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const browserErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    const admin = await registerE2EUser(request, { role: 'admin' });
    await loginByForm(page, admin);
    await page.goto('/admin/templates');

    const panel = page.getByTestId('admin-sensitive-words');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    const marker = Date.now();
    const createdWord = `特效祛斑王-${marker}`;
    const updatedWord = `祛斑特效王-${marker}`;

    await panel.getByLabel('词条').fill(createdWord);
    await panel.getByLabel('分类').selectOption('medical');
    await panel
      .getByLabel('替换建议（逗号分隔）')
      .fill('专业色斑护理，效果因人而异');
    await panel.getByRole('button', { name: '新增', exact: true }).click();

    const createdRow = panel.getByRole('row').filter({ hasText: createdWord });
    await expect(createdRow).toHaveCount(1);
    await expect(createdRow).toContainText('医疗用语');
    await expect(createdRow).toContainText('专业色斑护理，效果因人而异');

    await createdRow.getByRole('button', { name: '编辑' }).click();
    await expect(panel.getByText('编辑词条', { exact: true })).toBeVisible();
    await panel.getByLabel('词条').fill(updatedWord);
    await panel
      .getByLabel('替换建议（逗号分隔）')
      .fill('专业肤色护理，因人而异');
    await panel.getByRole('button', { name: '保存修改' }).click();

    const updatedRow = panel.getByRole('row').filter({ hasText: updatedWord });
    await expect(updatedRow).toHaveCount(1);
    await expect(updatedRow).toContainText('专业肤色护理，因人而异');
    await updatedRow.getByRole('button', { name: '停用' }).click();
    await expect(
      updatedRow.getByRole('button', { name: '启用' })
    ).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    await updatedRow.getByRole('button', { name: '删除' }).click();
    await expect(updatedRow).toHaveCount(0);
    expect(browserErrors).toEqual([]);
  });
});
