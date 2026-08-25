/**
 * V31-108 — prepare terminal rejection: failed inspector + 改一下要求,
 * never 超时.
 *
 * Sequence under test (full-stack run is owned by the merge controller):
 *   confirm paid image recipe → persist a work handle → inject the e2e-only
 *   prepare-terminal-rejection fixture (real recoverPendingStarts + helper) →
 *   reload the tab → 申报卡 + 改一下要求, merchant copy 没能开始 / 积分已经退回.
 *
 * Do not run the full browser stack from a lane worktree.
 */
import { expect, test } from '@playwright/test';

import { prepareRejectedMerchantMessage } from '../../../../apps/core/src/p1/execution-spine/stalled-work-sweeper';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import {
  seedComposerInlineAuthorize,
  seedConfirmedStore,
} from '../fixtures/product';
import {
  chooseImageTextDirection,
  selectComposerLens,
  settleComposerSubmission,
} from '../fixtures/ui-journey';

const INTENT = '做一组美甲项目套图，适合发小红书。';
/** Must stay the fixture reason in e2e-prepare-terminal-rejection-fixture.ts. */
const MERCHANT_MESSAGE = prepareRejectedMerchantMessage(
  '这次的创作方案无法按当前要求开始'
);

test.describe('V31-108 prepare 终态拒绝失败卡', () => {
  test.afterEach(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('prepare 被拒后重开标签页看到失败卡和改一下要求，不得出现超时', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });

    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await page.goto('/dashboard');
    await seedConfirmedStore(page);
    await seedComposerInlineAuthorize(page, {
      fileName: `v31-108-${crypto.randomUUID()}.png`,
    });
    await selectComposerLens(page, 'image_text');

    await page.getByTestId('composer-intent-input').fill(INTENT);
    const submit = page.getByTestId('composer-submit');
    await expect(submit).toBeEnabled({ timeout: 60_000 });
    const submission = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/core/p1/composer/submissions'),
      { timeout: 120_000 }
    );
    await submit.click();
    const response = await settleComposerSubmission(page, submission);
    const submissionText = await response.text();
    expect(response.ok(), submissionText).toBeTruthy();
    const body = JSON.parse(submissionText) as {
      data?: { task?: { id?: string }; work?: { id?: string } };
    };
    const taskId = body.data?.task?.id ?? '';
    const workId = body.data?.work?.id ?? '';
    expect(workId.length, '202 must bind a work handle').toBeGreaterThan(0);

    const strip = page.getByTestId('agent-commit-strip');
    await expect(strip).toBeVisible({ timeout: 120_000 });
    await expect(strip).toHaveAttribute('data-start-disabled', 'false');
    const start = page.getByTestId('agent-commit-strip-start');
    await expect(start).toBeEnabled();
    const startResponse = page.waitForResponse(
      (candidate) =>
        candidate.request().method() === 'POST' &&
        candidate
          .url()
          .includes(
            `/api/core/p1/composer/tasks/${encodeURIComponent(taskId)}/start`
          ),
      { timeout: 120_000 }
    );
    await start.click();
    expect((await startResponse).ok()).toBeTruthy();
    await chooseImageTextDirection(page);

    const rejection = await page.request.post(
      '/api/e2e/prepare-terminal-rejection-fixture',
      {
        data: {
          workId,
          ...(taskId ? { taskId } : {}),
        },
        headers: { 'x-e2e-secret': 'mkfast-e2e-secret' },
      }
    );
    expect(rejection.ok(), await rejection.text()).toBeTruthy();

    const report = page.getByTestId('composer-report-card');
    await expect(report).toBeVisible({ timeout: 60_000 });
    await expect(report).toContainText(MERCHANT_MESSAGE);
    await expect(report).not.toContainText(/超时/u);

    await page.reload();
    await expect(report).toBeVisible({ timeout: 60_000 });
    await expect(report).toContainText(MERCHANT_MESSAGE);
    await expect(report).toContainText(/没能开始/u);
    await expect(report).toContainText(/积分已经退回/u);
    await expect(report).not.toContainText(/超时/u);
    await expect(
      page.getByTestId('composer-report-action-adjust_intent')
    ).toHaveText('改一下要求');
    await expect(
      page.getByTestId('composer-report-action-adjust_intent')
    ).toBeVisible();

    const inspector = page.getByTestId('workbench-inspector-failed');
    if ((await inspector.count()) > 0) {
      await expect(inspector).not.toContainText(/超时/u);
    }
  });
});
