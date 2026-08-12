/**
 * V31-73 — zero-source first visit on the default 图文 recipe.
 *
 * Do NOT call `seedComposerInlineAuthorize`. That helper is the V31-54
 * fixture that hid this dead end: a new merchant has no case image, send
 * must enter guidance, and must never reach 「确认并开始」→ 400.
 */
import { expect, test } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { selectComposerLens } from '../fixtures/ui-journey';

const ZERO_SOURCE_INTENT = '帮我写一条美甲新客团购的种草笔记';

test.describe('V31-73 零素材图文首访', () => {
  test.afterEach(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('零素材选图文发送进入引导，走不到确认并开始 400', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });

    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await page.goto('/dashboard');

    const submissionStatuses: number[] = [];
    page.on('response', (response) => {
      if (
        response.request().method() === 'POST' &&
        response.url().includes('/api/core/p1/composer/submissions')
      ) {
        submissionStatuses.push(response.status());
      }
    });

    await expect(page.getByTestId('composer-intent-input')).toBeVisible({
      timeout: 30_000,
    });
    await selectComposerLens(page, 'image_text');
    await page.getByTestId('composer-intent-input').fill(ZERO_SOURCE_INTENT);

    const submit = page.getByTestId('composer-submit');
    await expect(submit).toBeEnabled({ timeout: 60_000 });
    await expect(page.getByText('本次用量已确认')).toHaveCount(0);

    await submit.click();

    const guidance = page.getByTestId('composer-recipe-slot-guidance');
    await expect(guidance).toBeVisible({ timeout: 15_000 });
    await expect(guidance).toHaveAttribute('data-slot', 'case_image');
    await expect(page.getByTestId('composer-recipe-slot-upload')).toBeVisible();
    await expect(page.getByTestId('composer-recipe-slot-switch')).toBeVisible();
    await expect(page.getByText('可以直接再发一次')).toHaveCount(0);
    await expect(page.getByTestId('composer-run-create-failed')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '确认并开始' })).toHaveCount(
      0
    );
    expect(submissionStatuses, 'must not POST composer submissions').toEqual(
      []
    );
  });
});
