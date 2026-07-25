import { expect, test } from '@playwright/test';

import { cleanupE2EUsers } from '../fixtures/auth';
import { createE2EUser } from '../fixtures/test-data';

test.describe('M-01 signed platform contract', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('maps one destination choice through preview, body, and admission', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const user = createE2EUser();
    await page.goto('/auth/register');
    await page.waitForLoadState('networkidle');
    await page.locator('input[name="name"]').fill(user.name);
    await page.locator('input[name="email"]').fill(user.email);
    await page.locator('input[name="password"]').fill(user.password);
    const registrationResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/auth/sign-up/email'),
      { timeout: 30_000 }
    );
    await page.getByRole('button', { name: /^sign up$|^注册$/iu }).click();
    const registrationResponse = await registrationResponsePromise;
    expect(
      registrationResponse.ok(),
      await registrationResponse.text()
    ).toBeTruthy();
    await page.goto('/dashboard');

    const billingActions: string[] = [];
    page.on('request', (request) => {
      if (
        request.method() !== 'POST' ||
        !request.url().includes('/api/core/p1/commands')
      ) {
        return;
      }
      try {
        const body = request.postDataJSON() as {
          action?: string;
          module?: string;
        };
        if (body.module === 'product-billing' && body.action) {
          billingActions.push(body.action);
        }
      } catch {
        // Ignore unrelated non-JSON requests.
      }
    });

    await page.getByTestId('composer-lens-option-copy').click();
    const quoteLine = page.getByTestId('composer-quote-line');
    await expect(quoteLine).toBeVisible({ timeout: 30_000 });
    const initialHash = await quoteLine.getAttribute(
      'data-submission-contract-hash'
    );
    expect(initialHash).toMatch(/^[a-f0-9]{64}$/u);

    const platform = page.locator('#composer-setting-input-platform');
    await platform.selectOption('xiaohongshu');
    await expect(
      page.getByTestId('composer-destination-capability')
    ).toHaveText('生成后导出');
    await expect
      .poll(() => quoteLine.getAttribute('data-submission-contract-hash'))
      .not.toBe(initialHash);
    const xhsHash = await quoteLine.getAttribute(
      'data-submission-contract-hash'
    );

    await platform.selectOption('wechat_moments');
    await expect(
      page.getByTestId('composer-destination-capability')
    ).toHaveText('生成后协办交接');
    await expect
      .poll(() => quoteLine.getAttribute('data-submission-contract-hash'))
      .not.toBe(xhsHash);

    await platform.selectOption('xiaohongshu');
    await expect
      .poll(() => quoteLine.getAttribute('data-submission-contract-hash'))
      .toBe(xhsHash);
    await page
      .getByTestId('composer-intent-input')
      .fill('写一条夏日护理预约文案');

    const submissionRequestPromise = page.waitForRequest(
      (request) =>
        request.method() === 'POST' &&
        request.url().includes('/api/core/p1/composer/submissions'),
      { timeout: 120_000 }
    );
    const submissionResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/core/p1/composer/submissions'),
      { timeout: 120_000 }
    );
    const submit = page.getByTestId('composer-submit');
    await expect(submit).toBeEnabled({ timeout: 30_000 });
    await submit.click();
    const briefSurface = page.getByTestId('composer-brief-surface');
    const nextStep = await Promise.race([
      briefSurface
        .waitFor({ state: 'visible', timeout: 60_000 })
        .then(() => 'brief' as const),
      submissionRequestPromise.then(() => 'submission' as const),
    ]);
    if (nextStep === 'brief') {
      const confirm = briefSurface.getByTestId('composer-brief-confirm');
      await expect(confirm).toBeEnabled();
      await confirm.click();
    }
    const submissionRequest = await submissionRequestPromise;
    const submissionBody = submissionRequest.postDataJSON() as {
      contentPackagePlatform?: string;
      distributionTarget?: string;
      deliverable?: { kind?: string; quantity?: number };
      catalogModel?: unknown;
      recipe?: unknown;
    };
    expect(submissionBody).toMatchObject({
      contentPackagePlatform: 'xiaohongshu',
      distributionTarget: 'export',
      deliverable: { kind: 'copy_document', quantity: 1 },
    });
    expect(submissionBody.catalogModel).toBeTruthy();
    expect(submissionBody.recipe).toBeTruthy();

    const submissionResponse = await submissionResponsePromise;
    expect(
      submissionResponse.ok(),
      await submissionResponse.text()
    ).toBeTruthy();
    expect(billingActions).toContain('quote');
    expect(billingActions).not.toContain('confirm');
  });
});
