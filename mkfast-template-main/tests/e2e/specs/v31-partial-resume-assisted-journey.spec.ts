import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import {
  seedComposerInlineAuthorize,
  seedConfirmedStore,
} from '../fixtures/product';
import { selectComposerLens } from '../fixtures/ui-journey';

async function submitPersistentConflictNote(page: Page) {
  await page.goto('/dashboard');
  await seedComposerInlineAuthorize(page, {
    fileName: `v31-persistent-conflict-${crypto.randomUUID()}.png`,
  });
  await selectComposerLens(page, 'image_text');
  await page
    .getByTestId('composer-intent-input')
    .fill('把门店案例做成三页图文持续冲突样本，其他页正常交付。');

  const submission = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/core/p1/composer/submissions'),
    { timeout: 120_000 }
  );
  await page.getByTestId('composer-submit').click();

  const response = await submission;
  const envelope = (await response.json()) as {
    data?: { task?: { id?: string } };
    error?: { message?: string };
  };
  expect(response.ok(), envelope.error?.message).toBeTruthy();
  expect(envelope.data?.task?.id).toBeTruthy();

  const direction = page
    .getByTestId('ask-merchant-group-card')
    .filter({ hasText: /两种图文方向/u });
  await expect(direction).toBeVisible({ timeout: 120_000 });
  await direction.getByTestId('ask-merchant-option-card').first().click();

  const executionConfirmation = page.getByTestId(
    'execution-confirmation-interaction-card'
  );
  await expect(executionConfirmation).toBeVisible({ timeout: 120_000 });
  await expect(
    executionConfirmation.getByTestId('execution-confirmation-outline-row')
  ).toHaveCount(3);

  return { taskId: envelope.data!.task!.id! };
}

async function queryProductUsage(page: Page, taskId: string) {
  return page.evaluate(async (currentTaskId) => {
    const response = await fetch('/api/core/p1/query', {
      body: JSON.stringify({
        action: 'get_usage',
        module: 'product-billing',
        payload: { taskId: currentTaskId },
      }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const envelope = (await response.json()) as {
      data?: {
        refundedCredits?: number;
        reservedCredits?: number;
        settledCredits?: number;
        status?: string;
      };
      error?: { message?: string };
    };
    if (!response.ok || !envelope.data) {
      throw new Error(envelope.error?.message ?? 'Product usage read failed');
    }
    return envelope.data;
  }, taskId);
}

test.describe('V31-14 partial delivery resume journey', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('typed interrupt survives tab close, then page-2 failure delivers partial assisted output with settlement', async ({
    context,
    page,
    request,
  }) => {
    test.setTimeout(600_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    const { taskId } = await submitPersistentConflictNote(page);
    const pending = page.getByTestId('agent-pending-interrupt');
    await expect(pending).toBeVisible({ timeout: 120_000 });
    const interruptId = await pending.getAttribute('data-interrupt-id');
    const revision = await pending.getAttribute('data-interrupt-revision');
    expect(interruptId).toBeTruthy();
    expect(revision).toMatch(/^\d+$/u);

    await page.close();
    const restored = await context.newPage();
    await restored.goto('/dashboard');
    const restoredPending = restored.getByTestId('agent-pending-interrupt');
    await expect(restoredPending).toHaveAttribute(
      'data-interrupt-id',
      interruptId!,
      { timeout: 120_000 }
    );
    await expect(restoredPending).toHaveAttribute(
      'data-interrupt-revision',
      revision!
    );
    await restored.getByTestId('agent-interrupt-accept').click();
    await expect(restoredPending).toHaveCount(0, { timeout: 120_000 });

    const report = restored.getByTestId('composer-report-card');
    await expect(report).toBeVisible({ timeout: 420_000 });
    await expect(report).toHaveAttribute('data-report-kind', 'partial');
    await expect(report).toContainText(/1\s*页/u);
    await expect(
      restored.getByTestId('composer-report-action-review_partial')
    ).toBeVisible();
    await expect(restored.getByTestId('composer-delivery-card')).toBeVisible();

    const handoff = restored.getByTestId('publish-handoff-panel');
    await expect(handoff).toBeVisible({ timeout: 120_000 });
    await expect(handoff).toHaveAttribute('data-capability-mode', 'assisted');
    await expect(
      restored.getByTestId('publish-handoff-no-direct-publish')
    ).toBeVisible();
    await expect(
      restored.getByTestId('publish-handoff-direct-publish')
    ).toHaveCount(0);

    await expect
      .poll(async () => await queryProductUsage(restored, taskId), {
        timeout: 120_000,
      })
      .toMatchObject({ status: 'committed' });
    const usage = await queryProductUsage(restored, taskId);
    expect(usage.reservedCredits).toEqual(expect.any(Number));
    expect(usage.reservedCredits!).toBeGreaterThan(0);
    expect(usage.settledCredits).toBe(usage.reservedCredits);
    expect(usage.refundedCredits ?? 0).toBe(0);
  });
});
