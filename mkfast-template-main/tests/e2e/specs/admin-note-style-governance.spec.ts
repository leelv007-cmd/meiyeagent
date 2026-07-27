/**
 * U05 硬门（D-107）：运营改「图文笔记风格集合」的全程，一次 JSON 手改都不能有。
 *
 * 这条路以前根本不存在——`harness.note.styles` 只在契约里，后台没有任何入口，
 * 想换风格得改代码或直接刷库。现在它和别的受控配置走同一条路：
 * 结构化表单改值 → 影响面确认 → 写入原因 → CAS 版本推进 → 审计留痕。
 *
 * 门的判据有两条，缺一不可：
 *   1. 编辑区里没有让人自己拼结构的 JSON 输入框（`textarea.font-mono` 计数为 0）；
 *   2. 全程只用带标签的表单控件改值，保存后新值确实落到了受控配置上。
 */
import { expect, test, type Page } from '@playwright/test';

import { DEFAULT_NOTE_STYLES } from '@meiye/contracts';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

const NOTE_STYLE_FORM = '[data-testid="admin-config-form-harness.note.styles"]';
const FIRST_STYLE_NAME =
  '[data-testid="admin-config-harness-note-styles-styles-0-name"]';
const FIRST_STYLE_GUIDE =
  '[data-testid="admin-config-harness-note-styles-styles-0-writingGuide"]';
const DOUYIN_TOGGLE =
  '[data-testid="admin-config-harness-note-styles-styles-0-platforms-douyin"]';

async function openNoteStyleEditor(page: Page) {
  await page.goto('/admin/templates');
  const section = page.getByTestId('admin-note-styles');
  await expect(section).toBeVisible({ timeout: 30_000 });
  const form = page.locator(NOTE_STYLE_FORM);
  await expect(form).toBeVisible({ timeout: 30_000 });
  return { form, section };
}

/** 表单改完后走一次受控写入，返回写入前的版本号文本。 */
async function recordThroughGovernedReview(page: Page, reason: string) {
  const save = page.getByRole('button', { name: '审阅并记录' });
  await expect(save).toBeEnabled({ timeout: 30_000 });
  await save.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await page.locator('#impact-review-reason').fill(reason);
  const confirm = dialog.getByRole('button', { name: '确认记录配置' });
  await expect(confirm).toBeVisible({ timeout: 15_000 });
  await confirm.click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
}

test('an operator reshapes the note style set without ever touching JSON', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const admin = await registerE2EUser(request, { role: 'admin' });
  const marker = `门店场景版-${Date.now()}`;
  const originalName = DEFAULT_NOTE_STYLES.styles[0].name;

  try {
    await loginByForm(page, admin);
    const { form, section } = await openNoteStyleEditor(page);

    // ① 编辑区里没有要人自己拼结构的输入框。表格里的等宽只读单元格不算编辑器，
    //    所以只盯编辑区 `#admin-runtime-config-value` 这一块。
    const editor = page.locator('#admin-runtime-config-value');
    await expect(editor.locator('textarea.font-mono')).toHaveCount(0);
    await expect(editor.locator('[contenteditable="true"]')).toHaveCount(0);
    await expect(form).toBeVisible();

    // 打开时看到的就是此刻真正在用的那份，不是一张空表。
    const nameField = page.locator(FIRST_STYLE_NAME);
    await expect(nameField).toHaveValue(originalName, { timeout: 30_000 });

    // ② 全程只动表单控件：改名字、改写作要点、关掉一个平台。
    await nameField.fill(marker);
    await page.locator(FIRST_STYLE_GUIDE).fill('先说清楚门店当下能接的项目。');
    const douyin = page.locator(DOUYIN_TOGGLE);
    await expect(douyin).toBeVisible();
    await douyin.click();

    await recordThroughGovernedReview(
      page,
      `U05 硬门：改图文笔记风格集合 ${marker}`
    );

    // 新值确实落到了受控配置上：概览表读得到，重新进页面也还在。
    await expect(section.getByText(marker).first()).toBeVisible({
      timeout: 30_000,
    });
    await page.reload();
    await expect(page.locator(FIRST_STYLE_NAME)).toHaveValue(marker, {
      timeout: 30_000,
    });
  } finally {
    // 这是一条全局受控配置，跑完按原样改回去——同样走表单，不走后门。
    try {
      await openNoteStyleEditor(page);
      await page.locator(FIRST_STYLE_NAME).fill(originalName);
      await page
        .locator(FIRST_STYLE_GUIDE)
        .fill(DEFAULT_NOTE_STYLES.styles[0].writingGuide);
      const douyin = page.locator(DOUYIN_TOGGLE);
      if (await douyin.isVisible()) {
        const pressed = await douyin.getAttribute('data-selected');
        if (pressed !== 'true') await douyin.click();
      }
      await recordThroughGovernedReview(page, 'U05 硬门：跑完恢复原风格集合');
    } catch {
      // 恢复失败不该把主断言的结论盖掉；失败本身会在下一次跑的第一条断言上暴露。
    }
    await cleanupE2EUsers(request);
  }
});
