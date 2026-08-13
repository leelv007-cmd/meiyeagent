/**
 * V31-85 — zero-source video must not offer a fake fallback exit.
 *
 * Video launch recipes all require a source slot. The guidance card may only
 * keep 「去传素材」. Full-stack run belongs to the master; this file must --list.
 */
import { expect, test } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { selectComposerLens } from '../fixtures/ui-journey';

const ZERO_SOURCE_VIDEO_INTENT = '帮我拍一条美甲新客到店的15秒短视频';

test.describe('V31-85 零素材视频 fallback', () => {
  test.afterEach(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('零素材选视频进入诚实引导，没有假出口也不提交', async ({
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
    await selectComposerLens(page, 'video');
    await page
      .getByTestId('composer-intent-input')
      .fill(ZERO_SOURCE_VIDEO_INTENT);

    const submit = page.getByTestId('composer-submit');
    await expect(submit).toBeEnabled({ timeout: 60_000 });
    await submit.click();

    const guidance = page.getByTestId('composer-recipe-slot-guidance');
    await expect(guidance).toBeVisible({ timeout: 15_000 });
    await expect(guidance).toHaveAttribute('data-can-switch', 'false');
    await expect(page.getByTestId('composer-recipe-slot-upload')).toBeVisible();
    await expect(page.getByTestId('composer-recipe-slot-switch')).toHaveCount(
      0
    );
    await expect(page.getByText('换不需要案例图的写法')).toHaveCount(0);
    await expect(page.getByText('改一改再发就好')).toHaveCount(0);
    await expect(page.getByTestId('composer-run-create-failed')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '确认并开始' })).toHaveCount(
      0
    );
    expect(submissionStatuses, 'must not POST composer submissions').toEqual(
      []
    );
  });
});
