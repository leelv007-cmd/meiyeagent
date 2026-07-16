import { expect, test } from '@playwright/test';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

test.afterEach(async ({ request }) => {
  await cleanupE2EUsers(request);
});

test('keyboard completes the core creation journey and announces Job status', async ({
  page,
  request,
}) => {
  const user = await registerE2EUser(request);
  await loginByForm(page, user);

  const intent = page.getByLabel('描述这次想创作的内容');
  await intent.focus();
  await page.keyboard.insertText('键盘完成的真实到店内容');
  const create = page.getByRole('button', { name: '建立创作记录' });
  await create.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Agent 创作记录')).toBeVisible();

  const quote = page.getByRole('checkbox', {
    name: /接受本次执行合同/,
  });
  await quote.focus();
  await page.keyboard.press('Space');
  await expect(quote).toBeChecked();
  const submit = page.getByRole('button', { name: '提交生成任务' });
  await expect(submit).toBeEnabled();
  await submit.focus();
  await page.keyboard.press('Enter');

  const announcedStatus = page
    .locator('[aria-live="polite"]')
    .filter({ hasText: /进行中|结果待核验|已完成/ })
    .last();
  await expect(announcedStatus).toBeVisible({ timeout: 60_000 });
  const candidate = page.getByRole('radio', { name: /^候选 A：/ });
  await expect(candidate).toBeVisible({ timeout: 60_000 });
  await candidate.focus();
  await page.keyboard.press('Space');
  await expect(candidate).toBeChecked();
  const accept = page.getByRole('button', { name: '采用所选文案' });
  await expect(accept).toBeEnabled();
  await accept.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByText('本批已采用 1 条文案', { exact: true })
  ).toBeVisible();
});

test('Impact Dialog traps focus and returns it to the keyboard trigger', async ({
  page,
  request,
}) => {
  const user = await registerE2EUser(request, { role: 'admin' });
  await loginByForm(page, user);
  await page.goto('/admin/templates');

  await page.getByLabel('模板 ID').fill('keyboard-template');
  await page.getByLabel('版本 ID').fill('keyboard-version');
  const trigger = page.getByRole('button', { name: '发布版本' });
  await trigger.focus();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: '全量发布官方模板版本' });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('执行原因（写入审计）')).toBeFocused();
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Tab');
    await expect
      .poll(() =>
        dialog.evaluate((element) => element.contains(document.activeElement))
      )
      .toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
