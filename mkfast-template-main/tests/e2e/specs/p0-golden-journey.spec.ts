import { expect, test, type Page } from '@playwright/test';
import type { ContentPackage } from '@meiye/contracts';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { seedConfirmedStore } from '../fixtures/product';
import {
  closeComposerCapsule,
  openComposerCapsule,
  selectComposerLens,
} from '../fixtures/ui-journey';

type ComposerSubmission = {
  packageId: string;
  taskId: string;
  workId: string;
};

async function contentPackage(page: Page, packageId: string) {
  return page.evaluate(async (id) => {
    const response = await fetch('/api/core/p1/query', {
      body: JSON.stringify({
        action: 'content_packages',
        module: 'operations',
        payload: {},
      }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const envelope = (await response.json()) as {
      data?: ContentPackage[];
      error?: { message?: string };
    };
    if (!response.ok || !envelope.data) {
      throw new Error(
        envelope.error?.message ?? 'Content package query failed'
      );
    }
    return envelope.data.find((candidate) => candidate.id === id);
  }, packageId);
}

async function p1Command<T>(
  page: Page,
  module: 'operations' | 'result-delivery',
  action: string,
  payload: Record<string, unknown>
) {
  return page.evaluate(
    async ({ action: command, module: commandModule, payload: input }) => {
      const response = await fetch('/api/core/p1/commands', {
        body: JSON.stringify({
          action: command,
          module: commandModule,
          payload: input,
        }),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `p0-golden:${commandModule}:${command}:${crypto.randomUUID()}`,
        },
        method: 'POST',
      });
      const envelope = (await response.json()) as {
        data?: T;
        error?: { message: string };
      };
      if (!response.ok || !envelope.data) {
        throw new Error(envelope.error?.message ?? `${command} failed`);
      }
      return envelope.data;
    },
    { action, module, payload }
  );
}

async function approveExternalSend(page: Page, packageId: string) {
  const adopted = await contentPackage(page, packageId);
  const platform = adopted?.source.targetPlatform;
  if (!adopted || !platform) {
    throw new Error('Adopted package has no delivery platform');
  }
  await p1Command(page, 'result-delivery', 'result_export', {
    expectedRevision: adopted.revision,
    packageId,
    platform,
  });
  await expect
    .poll(
      async () =>
        (await contentPackage(page, packageId))?.approvalRequests?.find(
          (request) => request.status === 'pending'
        )?.id,
      { timeout: 60_000 }
    )
    .toBeTruthy();

  const current = await contentPackage(page, packageId);
  const approval = current?.approvalRequests?.find(
    (request) => request.status === 'pending'
  );
  if (!current || !approval) {
    throw new Error('External-send approval request was absent');
  }
  await p1Command(page, 'operations', 'approve_content_package_action', {
    accountId: 'e2e-xiaohongshu-account',
    actionKind: approval.actionKind,
    actionScheduledAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
    approvalKey: `p0-golden:${approval.id}`,
    cost: { amount: 0, currency: 'CNY' },
    expectedRevision: current.revision,
    packageId,
    platform: approval.platform,
    purpose: approval.purpose,
    requestId: approval.id,
    variantVersionId: approval.variantVersionId,
  });
}

async function submitComposerCopy(page: Page): Promise<ComposerSubmission> {
  await page.goto('/dashboard');
  await selectComposerLens(page, 'copy');
  await page
    .getByTestId('composer-intent-input')
    .fill('给透亮猫眼写一条周末预约文案');
  const destinationPanel = await openComposerCapsule(page, 'destination');
  const destination = page.getByTestId(
    'composer-destination-option-xiaohongshu'
  );
  await expect(destination).toBeVisible({ timeout: 30_000 });
  if ((await destination.getAttribute('aria-pressed')) !== 'true') {
    await destination.click();
  }
  await expect(destination).toHaveAttribute('aria-pressed', 'true');
  await closeComposerCapsule(page, destinationPanel);
  await expect(page.getByTestId('composer-quote-line')).toBeVisible({
    timeout: 60_000,
  });

  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/core/p1/composer/submissions'),
    { timeout: 120_000 }
  );
  await page.getByTestId('composer-submit').click();
  const brief = page.getByTestId('composer-brief-surface');
  const next = await Promise.race([
    responsePromise.then(() => 'submission' as const),
    brief
      .waitFor({ state: 'visible', timeout: 60_000 })
      .then(() => 'brief' as const),
  ]);
  if (next === 'brief') {
    await page.getByTestId('composer-brief-confirm').click();
  }

  const response = await responsePromise;
  const envelope = (await response.json()) as {
    data?: {
      contentPackage?: { id?: string };
      task?: { id?: string };
      work?: { id?: string };
    };
    error?: { message?: string };
  };
  expect(response.status(), envelope.error?.message).toBe(202);
  const submission = {
    packageId: envelope.data?.contentPackage?.id ?? '',
    taskId: envelope.data?.task?.id ?? '',
    workId: envelope.data?.work?.id ?? '',
  };
  expect(submission.packageId).toBeTruthy();
  expect(submission.taskId).toBeTruthy();
  expect(submission.workId).toBeTruthy();
  return submission;
}

test.describe('canonical product golden journey', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('hands off a Composer ContentPackage and records the canonical result', async ({
    context,
    page,
    request,
  }) => {
    test.setTimeout(360_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'canShare', {
        configurable: true,
        value: (payload: ShareData) => !payload.files?.length,
      });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (payload: ShareData) => {
          if (payload.url) {
            window.sessionStorage.setItem(
              'e2e-canonical-handoff-url',
              payload.url
            );
          }
        },
      });
    });

    await seedConfirmedStore(page);
    const submission = await submitComposerCopy(page);
    await expect
      .poll(
        async () => (await contentPackage(page, submission.packageId))?.status,
        { timeout: 120_000 }
      )
      .toBe('review_ready');

    await page.goto(
      `/dashboard/results/${encodeURIComponent(submission.workId)}`
    );
    const adopt = page.getByTestId('result-primary-action');
    await expect(adopt).toHaveText('采用此版本', { timeout: 60_000 });
    await adopt.click();
    await expect
      .poll(
        async () => (await contentPackage(page, submission.packageId))?.status,
        { timeout: 60_000 }
      )
      .toBe('accepted');
    await approveExternalSend(page, submission.packageId);

    await page.goto(
      `/dashboard/works/${encodeURIComponent(submission.packageId)}`
    );
    const handoffDoorway = page.getByTestId('works-action-handoff');
    await expect(
      handoffDoorway,
      'The canonical ContentPackage detail must offer the delivery doorway.'
    ).toBeVisible({ timeout: 60_000 });
    await expect(handoffDoorway).toHaveAttribute(
      'href',
      /\/dashboard\/results\/[^?#]+\?[^#]*panel=delivery/u
    );
    let releaseSensitiveWordsCheck!: () => void;
    const sensitiveWordsCheckRelease = new Promise<void>((resolve) => {
      releaseSensitiveWordsCheck = resolve;
    });
    let markSensitiveWordsCheckStarted!: () => void;
    const sensitiveWordsCheckStarted = new Promise<void>((resolve) => {
      markSensitiveWordsCheckStarted = resolve;
    });
    let checkedDeliveryText = '';
    await page.route('**/api/core/p1/query', async (route) => {
      const body = route.request().postDataJSON() as {
        action?: string;
        module?: string;
        payload?: { text?: string };
      };
      if (body.module === 'sensitive-words' && body.action === 'check_bar') {
        checkedDeliveryText = body.payload?.text ?? '';
        markSensitiveWordsCheckStarted();
        await sensitiveWordsCheckRelease;
      }
      await route.continue();
    });
    await handoffDoorway.click();
    await expect(page).toHaveURL(
      /\/dashboard\/results\/[^?#]+\?[^#]*panel=delivery/u
    );
    await expect(page.getByTestId('delivery-panel')).toBeVisible({
      timeout: 60_000,
    });
    const sensitiveWordsCheck = page.getByTestId(
      'delivery-sensitive-words-check'
    );
    await sensitiveWordsCheckStarted;
    await expect(sensitiveWordsCheck).toHaveAttribute(
      'data-status',
      'checking'
    );
    const deliveryActions = page.locator('[data-testid^="delivery-action-"]');
    await expect(deliveryActions.first()).toBeVisible();
    const deliveryActionCount = await deliveryActions.count();
    expect(deliveryActionCount).toBeGreaterThan(0);
    for (let index = 0; index < deliveryActionCount; index += 1) {
      await expect(deliveryActions.nth(index)).toBeDisabled();
    }
    releaseSensitiveWordsCheck();
    await expect(sensitiveWordsCheck).toHaveAttribute('data-status', 'clear', {
      timeout: 60_000,
    });
    await expect(sensitiveWordsCheck).toContainText('未检出违禁词');
    expect(checkedDeliveryText.trim()).not.toBe('');
    await page.unroute('**/api/core/p1/query');

    const assistedAction = page.getByTestId('delivery-action-assisted');
    await expect(assistedAction).toBeEnabled();
    await assistedAction.click();
    await expect(page.getByTestId('delivery-outcome-handed-over')).toBeVisible({
      timeout: 60_000,
    });
    await page.getByTestId('delivery-action-system_share').click();
    await expect(page.getByTestId('delivery-outcome-share-done')).toBeVisible();
    const canonicalHandoffUrl = await page.evaluate(() =>
      window.sessionStorage.getItem('e2e-canonical-handoff-url')
    );
    expect(canonicalHandoffUrl).toMatch(/\/dashboard\/handoff\/[^/?#]{16,}$/u);
    if (!canonicalHandoffUrl) {
      throw new Error('System share produced no canonical handoff URL');
    }
    await page.goto(canonicalHandoffUrl);
    await expect(
      page.getByRole('heading', { name: '小红书交接包' })
    ).toBeVisible({ timeout: 60_000 });
    for (const section of ['share', 'download', 'copy', 'report']) {
      await expect(
        page.getByTestId(`handoff-section-${section}`)
      ).toBeVisible();
    }
    await page
      .getByLabel('平台链接')
      .fill('https://example.test/posts/e2e-golden');
    await page.getByLabel('备注').fill('canonical Composer handoff e2e');
    await page.getByTestId('handoff-report-published').click();
    await expect(page.getByTestId('handoff-section-report')).toHaveAttribute(
      'data-published',
      'true'
    );
  });
});
