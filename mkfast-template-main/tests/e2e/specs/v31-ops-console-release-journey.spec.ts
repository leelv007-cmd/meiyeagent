import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { productState } from '../fixtures/product';
import { selectComposerLens } from '../fixtures/ui-journey';

async function openConsole(page: Page) {
  await page.goto('/admin/ops-console');
  await expect(page.getByTestId('admin-ops-console')).toBeVisible();
}

async function publish(
  page: Page,
  releaseId: string,
  version: number,
  toolPolicy: string
) {
  await page.getByTestId('admin-ops-console-publish-release').fill(releaseId);
  await page
    .getByTestId('admin-ops-console-publish-version')
    .fill(String(version));
  await page
    .getByTestId('admin-ops-console-publish-tool-policy')
    .fill(toolPolicy);
  await page
    .getByTestId('admin-ops-console-publish-reason')
    .fill(`publish ${releaseId}`);
  await page.getByTestId('admin-ops-console-publish-submit').click();
  await expect(
    page.getByTestId(`admin-ops-console-release-${releaseId}`)
  ).toBeVisible();
}

async function transition(
  page: Page,
  releaseId: string,
  status: 'evaluating' | 'canary'
) {
  await page.getByTestId('admin-ops-console-advance-release').fill(releaseId);
  await page
    .getByTestId('admin-ops-console-advance-status')
    .selectOption(status);
  await page
    .getByTestId('admin-ops-console-advance-reason')
    .fill(`advance ${status}`);
  await page.getByTestId('admin-ops-console-advance-submit').click();
  await expect(
    page.getByTestId(`admin-ops-console-release-${releaseId}`)
  ).toHaveAttribute('data-status', status);
}

async function evaluateRelease(page: Page, releaseId: string) {
  await page.getByTestId('admin-ops-console-eval-release').fill(releaseId);
  await page
    .getByTestId('admin-ops-console-eval-reason')
    .fill(`fixture eval ${releaseId}`);
  await page.getByTestId('admin-ops-console-eval-submit').click();
  await expect(
    page.getByTestId('admin-ops-console-eval-observation')
  ).toContainText(`${releaseId}: passed`);
}

async function promote(page: Page, releaseId: string) {
  await page.getByTestId('admin-ops-console-promote-release').fill(releaseId);
  await page
    .getByTestId('admin-ops-console-promote-reason')
    .fill(`promote ${releaseId}`);
  await page.getByTestId('admin-ops-console-promote-submit').click();
  await expect(
    page.getByTestId(`admin-ops-console-release-${releaseId}`)
  ).toHaveAttribute('data-status', 'production');
}

async function submitCopyRun(page: Page, intent: string) {
  await page.goto('/dashboard');
  await selectComposerLens(page, 'copy');
  await page.getByTestId('composer-intent-input').fill(intent);
  await expect(page.getByTestId('composer-submit')).toBeEnabled({
    timeout: 30_000,
  });
  const response = page.waitForResponse(
    (item) =>
      item.request().method() === 'POST' &&
      item.url().includes('/api/core/p1/composer/submissions'),
    { timeout: 120_000 }
  );
  await page.getByTestId('composer-submit').click();
  const brief = page.getByTestId('composer-brief-surface');
  if (await brief.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await page.getByTestId('composer-brief-confirm').click();
  }
  expect((await response).ok()).toBeTruthy();
}

test.describe('V31 Ops Console real release journey', () => {
  test.afterEach(async ({ request }) => cleanupE2EUsers(request));

  test('UI publish → canary → trial run → promote → rollback → new task pin', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const admin = await registerE2EUser(request, { role: 'admin' });
    await loginByForm(page, admin);
    await page.goto('/dashboard');
    const workspaceId = (await productState(page)).workspaceId;
    const suffix = Date.now();
    const releaseA = `release-ui-a-${suffix}`;
    const releaseB = `release-ui-b-${suffix}`;

    await openConsole(page);
    await publish(page, releaseA, 101, 'tool/ui-a');
    await transition(page, releaseA, 'evaluating');
    await transition(page, releaseA, 'canary');
    await page
      .getByTestId('admin-ops-console-allowlist-release')
      .fill(releaseA);
    await page
      .getByTestId('admin-ops-console-allowlist-workspaces')
      .fill(workspaceId);
    await page
      .getByTestId('admin-ops-console-allowlist-reason')
      .fill('UI canary allowlist');
    await page.getByTestId('admin-ops-console-allowlist-submit').click();
    await evaluateRelease(page, releaseA);
    await promote(page, releaseA);

    await publish(page, releaseB, 102, 'tool/ui-b');
    await page
      .getByTestId('admin-ops-console-trial-workspace')
      .fill(workspaceId);
    await page.getByTestId('admin-ops-console-trial-release').fill(releaseB);
    await page
      .getByTestId('admin-ops-console-trial-reason')
      .fill('one run UI trial');
    await page.getByTestId('admin-ops-console-trial-submit').click();

    await submitCopyRun(page, `candidate B ${suffix}`);
    await openConsole(page);
    await page.getByTestId('admin-ops-console-refresh').click();
    await expect(
      page.getByTestId(`admin-ops-console-trial-observation-${releaseB}`)
    ).toContainText(releaseB);
    await expect(
      page.getByTestId(`admin-ops-console-trial-observation-${releaseB}`)
    ).not.toContainText('pending');
    await expect(
      page
        .getByTestId('admin-ops-console-run-pin')
        .filter({ hasText: releaseB })
        .first()
    ).toBeVisible();

    await submitCopyRun(page, `production A ${suffix}`);
    await openConsole(page);
    await page.getByTestId('admin-ops-console-refresh').click();
    await expect(
      page
        .getByTestId('admin-ops-console-run-pin')
        .filter({ hasText: releaseA })
        .first()
    ).toBeVisible();

    await transition(page, releaseB, 'evaluating');
    await transition(page, releaseB, 'canary');
    await evaluateRelease(page, releaseB);
    await promote(page, releaseB);

    await page.getByTestId('admin-ops-console-rollback-target').fill(releaseA);
    await page
      .getByTestId('admin-ops-console-rollback-reason')
      .fill('UI rollback incident');
    await page
      .getByTestId('admin-ops-console-rollback-evidence')
      .fill('incident://ui-e2e');
    await page.getByTestId('admin-ops-console-rollback-submit').click();
    await expect(
      page.getByTestId(`admin-ops-console-release-${releaseA}`)
    ).toHaveAttribute('data-status', 'production');
    await expect(
      page
        .getByTestId('admin-ops-console-run-pin')
        .filter({ hasText: releaseB })
        .first()
    ).toBeVisible();

    await submitCopyRun(page, `post rollback A ${suffix}`);
    await openConsole(page);
    await page.getByTestId('admin-ops-console-refresh').click();
    await expect(
      page
        .getByTestId('admin-ops-console-run-pin')
        .filter({ hasText: releaseA })
        .first()
    ).toBeVisible();
  });
});
