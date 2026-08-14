import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { attachComposerSourceViaLibrary } from '../fixtures/library-source';
import { seedConfirmedStore } from '../fixtures/product';
import {
  chooseImageTextDirection,
  selectComposerLens,
  settleComposerSubmission,
} from '../fixtures/ui-journey';

async function submitPersistentConflictNote(page: Page) {
  await page.goto('/dashboard');
  await attachComposerSourceViaLibrary(page, {
    fileName: `v31-persistent-conflict-${crypto.randomUUID()}.png`,
  });
  await selectComposerLens(page, 'image_text');
  await page
    .getByTestId('composer-intent-input')
    .fill('把门店案例做成三页图文持续冲突样本，其他页正常交付。');

  await expect(page.getByTestId('composer-quote-line')).toBeVisible({
    timeout: 60_000,
  });
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
  const envelope = (await response.json()) as {
    data?: { task?: { id?: string } };
    error?: { message?: string };
  };
  expect(response.ok(), envelope.error?.message).toBeTruthy();
  expect(envelope.data?.task?.id).toBeTruthy();

  await expect(
    page.getByTestId('agent-plan-section-deliverables')
  ).toContainText(/3\s*页/u, { timeout: 120_000 });
  const start = page.getByTestId('agent-commit-strip-start');
  await expect(start).toBeEnabled({ timeout: 120_000 });
  const startResponse = page.waitForResponse(
    (current) =>
      current.request().method() === 'POST' &&
      /\/api\/core\/p1\/composer\/tasks\/[^/]+\/start$/u.test(
        new URL(current.url()).pathname
      ),
    { timeout: 120_000 }
  );
  await start.click();
  expect((await startResponse).ok()).toBeTruthy();

  const executionConfirmation = page.getByTestId(
    'execution-confirmation-interaction-card'
  );
  await expect(executionConfirmation).toBeVisible({ timeout: 120_000 });

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
    const beforeText = ((await pending.innerText()) ?? '').replace(
      /\s+/gu,
      ' '
    );
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
    await expect(
      restored.locator(
        `[data-testid="agent-pending-interrupt"][data-interrupt-id="${interruptId}"]`
      )
    ).toHaveCount(0, { timeout: 120_000 });
    await restored.reload();

    // V31-56: after explicit start the first typed interrupt is 图文方向.
    // Accepting it on restore continues Make. A second style card would mean
    // the resume did not land. A non-style first card still has to reach it,
    // on the production ask-merchant card — not another pending-interrupt row.
    if (!/两种图文方向/u.test(beforeText)) {
      await chooseImageTextDirection(restored);
    }
    // Mid-flight §23.4 pause is owned by v31-context-fence-journey (price
    // drift before confirm + reconfirm). This journey does not mutate facts
    // after admit, so generatePages continues into the fixture page-2 conflict
    // and partial assisted delivery without a second fence hold.

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

    // Partial delivery settles undelivered page units back (V31-16): status is
    // partially_refunded, not a full commit of the original three-page hold.
    await expect
      .poll(async () => await queryProductUsage(restored, taskId), {
        timeout: 120_000,
      })
      .toMatchObject({ status: 'partially_refunded' });
    const usage = await queryProductUsage(restored, taskId);
    expect(usage.reservedCredits).toEqual(expect.any(Number));
    expect(usage.reservedCredits!).toBeGreaterThan(0);
    expect(usage.settledCredits).toEqual(expect.any(Number));
    expect(usage.settledCredits!).toBeGreaterThan(0);
    expect(usage.settledCredits!).toBeLessThan(usage.reservedCredits!);
    expect(usage.refundedCredits ?? 0).toBe(
      usage.reservedCredits! - usage.settledCredits!
    );
  });
});
