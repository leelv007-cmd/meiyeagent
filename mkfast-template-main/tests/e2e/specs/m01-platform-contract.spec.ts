import { expect, test } from '@playwright/test';

import { cleanupE2EUsers } from '../fixtures/auth';
import { seedConfirmedStore } from '../fixtures/product';
import { createE2EUser } from '../fixtures/test-data';
import {
  closeComposerCapsule,
  openComposerCapsule,
  selectComposerLens,
} from '../fixtures/ui-journey';

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
    await seedConfirmedStore(page);
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

    await selectComposerLens(page, 'copy');
    await page
      .getByTestId('composer-intent-input')
      .fill('写一条夏日护理预约文案');
    const quoteLine = page.getByTestId('composer-quote-line');
    await expect(quoteLine).toBeVisible({ timeout: 30_000 });
    const initialHash = await quoteLine.getAttribute(
      'data-submission-contract-hash'
    );
    expect(initialHash).toMatch(/^[a-f0-9]{64}$/u);

    // T30 / #224: 「发到哪」is one chip question in the conversation, not a
    // settings-grid select — the destination is a signed field the server
    // freezes, so it is asked once and never rendered as an editable form row.
    // Destination options + capability now live in the capsule popover.
    const destination = (platform: string) =>
      page.getByTestId(`composer-destination-option-${platform}`);
    await expect(
      page.locator('#composer-setting-input-platform'),
      'the retired platform select must not come back (D-031)'
    ).toHaveCount(0);

    // Capture inside the poll. While the quote refetches, the attribute is
    // briefly absent, and `null` trivially satisfies `.not.toBe(previous)` —
    // so a poll that only checks difference can pass mid-refetch and the read
    // that follows grabs the gap instead of the new hash.
    const contractHashOtherThan = async (previous: string | null) => {
      let captured: string | null = null;
      await expect
        .poll(async () => {
          const value = await quoteLine.getAttribute(
            'data-submission-contract-hash'
          );
          if (!value || !/^[a-f0-9]{64}$/u.test(value) || value === previous) {
            return false;
          }
          captured = value;
          return true;
        })
        .toBe(true);
      return captured as unknown as string;
    };

    // Capability line is inside the destination popover — assert while open,
    // then close so quote-hash polling (outside) is not blocked by the panel.
    const xhsPanel = await openComposerCapsule(page, 'destination');
    await destination('xiaohongshu').click();
    await expect(destination('xiaohongshu')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(
      page.getByTestId('composer-destination-capability')
    ).toHaveText('生成后导出');
    await closeComposerCapsule(page, xhsPanel);
    const xhsHash = await contractHashOtherThan(initialHash);

    const wechatPanel = await openComposerCapsule(page, 'destination');
    await destination('wechat_moments').click();
    await expect(
      page.getByTestId('composer-destination-capability')
    ).toHaveText('生成后协办交接');
    await closeComposerCapsule(page, wechatPanel);
    await contractHashOtherThan(xhsHash);

    const xhsAgainPanel = await openComposerCapsule(page, 'destination');
    await destination('xiaohongshu').click();
    await closeComposerCapsule(page, xhsAgainPanel);
    await expect
      .poll(() => quoteLine.getAttribute('data-submission-contract-hash'))
      .toBe(xhsHash);
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
