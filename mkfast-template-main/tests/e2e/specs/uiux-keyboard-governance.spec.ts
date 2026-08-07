import { expect, test } from '@playwright/test';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { seedConfirmedStore } from '../fixtures/product';
import { ensureComposerSecondaryCapsules } from '../fixtures/ui-journey';

test.afterEach(async ({ request }) => {
  await cleanupE2EUsers(request);
});

test('keyboard submits the Composer and announces the streamed candidate', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const user = await registerE2EUser(request);
  await loginByForm(page, user);
  await seedConfirmedStore(page);
  await page.goto('/dashboard');

  // Keyboard governance — do NOT swap in selectComposerLens (mouse clicks).
  // CapsuleTrigger is a native <button type="button"> receiving Base UI
  // PopoverTrigger props (composer-conversation.tsx CapsuleTrigger /
  // PopoverTrigger). Native button activation (Space/Enter) fires the click
  // that opens the popover; the radiogroup stays unmounted until then.
  await ensureComposerSecondaryCapsules(page);
  const lensTrigger = page.getByTestId('composer-capsule-lens');
  const lensPanel = page.getByTestId('composer-capsule-lens-panel');
  const lens = page.getByTestId('composer-lens-option-copy');
  await lensTrigger.focus();
  await page.keyboard.press('Space');
  await expect(lensPanel).toBeVisible();
  // Same focus()+Space idiom the pre-capsule test used on the radio itself.
  // FloatingFocusManager may already land on the first radio; re-focus is a
  // no-op then and keeps the journey on keyboard activation, not pointer.
  await lens.focus();
  await page.keyboard.press('Space');
  await expect(lens).toBeChecked();

  const intent = page.getByTestId('composer-intent-input');
  await intent.focus();
  await page.keyboard.insertText('键盘完成的真实到店内容');
  await expect(page.getByTestId('composer-quote-line')).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId('composer-submit')).toBeEnabled();
  await intent.press(
    process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter'
  );

  await expect(page.getByTestId('composer-conversation')).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId('composer-stage-line').first()).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByTestId('composer-candidate-primary')).toBeVisible({
    timeout: 120_000,
  });
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
