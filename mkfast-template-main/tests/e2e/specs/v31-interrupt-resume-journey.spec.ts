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

/**
 * V31-14 / V3.1 §37.4-H — Interrupt resume + pending interrupt reconnect (spec only).
 *
 * Journey under test:
 *   paid Make suspends on typed interrupt → refresh/reconnect → pending interrupt
 *   still visible → resume by interruptId+revision → run continues
 *
 * Real browser run is owned by the merge controller. This file is the Playwright
 * seam contract. Do not run full e2e in agent lanes.
 *
 * Related: §37.4-F material rights revoke, §37.4-E plan stale (other specs).
 */

async function openCustomizedCreate(page: Page) {
  await page.goto('/dashboard');
  // image_text submissions fail closed (400 INVALID_STATE) without a
  // case_image workspace source — seed one first, as the merchant would.
  await seedComposerInlineAuthorize(page, {
    fileName: `v31-journey-${crypto.randomUUID()}.png`,
  });
  await selectComposerLens(page, 'image_text');
  await expect(page.getByTestId('composer-home')).toBeVisible();
}

async function reachExecutionConfirmation(page: Page, intent: string) {
  await page.getByTestId('composer-intent-input').fill(intent);
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
  const submissionResponse = await submission;
  const submissionEnvelope = (await submissionResponse.json()) as {
    data?: { task?: { id?: string } };
    error?: { message?: string };
  };
  expect(
    submissionResponse.ok(),
    submissionEnvelope.error?.message
  ).toBeTruthy();
  expect(submissionEnvelope.data?.task?.id).toBeTruthy();

  const start = page.getByTestId('agent-commit-strip-start');
  await expect(start).toBeEnabled({ timeout: 120_000 });
  const startResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/core\/p1\/composer\/tasks\/[^/]+\/start$/u.test(
        new URL(response.url()).pathname
      ),
    { timeout: 120_000 }
  );
  await start.click();
  expect((await startResponse).ok()).toBeTruthy();

  await expect(
    page.getByTestId('execution-confirmation-interaction-card')
  ).toBeVisible({ timeout: 120_000 });

  return { taskId: submissionEnvelope.data!.task!.id! };
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

async function queryCreditRefunds(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/core/p1/query', {
      body: JSON.stringify({
        action: 'credit_detail',
        module: 'entitlements',
        payload: {},
      }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const envelope = (await response.json()) as {
      data?: {
        transactions?: Array<{
          creditedAmount?: number;
          credits?: number;
          operation?: string;
          refundDisposition?: string;
          status?: string;
          type?: string;
        }>;
      };
      error?: { message?: string };
    };
    if (!response.ok || !envelope.data?.transactions) {
      throw new Error(envelope.error?.message ?? 'Credit detail read failed');
    }
    return envelope.data.transactions.filter(
      (transaction) =>
        transaction.operation === 'creation' && transaction.type === 'refund'
    );
  });
}

test.describe('V31-14 Interrupt resume journey (§37.4-H)', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('pending interrupt 刷新/重连不丢 → resume by interruptId', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    await openCustomizedCreate(page);

    await reachExecutionConfirmation(
      page,
      '帮我做三页含配图的小红书笔记，奶油风美甲。'
    );
    const interruptHost = page.getByTestId('agent-pending-interrupt');
    await expect(interruptHost).toBeVisible({ timeout: 120_000 });
    const interruptId = await interruptHost.getAttribute('data-interrupt-id');
    const revision = await interruptHost.getAttribute(
      'data-interrupt-revision'
    );
    expect(interruptId).toBeTruthy();
    expect(revision).toMatch(/^\d+$/u);
    const beforeText = (await interruptHost.innerText()).trim();
    expect(beforeText.length).toBeGreaterThan(0);

    const invalidSchema = await page.request.post(
      '/api/core/p1/interrupts/resume',
      {
        data: {
          schemaVersion: 'interrupt-payload/v999',
          interruptId,
          revision: Number(revision),
          type: 'accept',
          idempotencyKey: `invalid-schema:${interruptId}`,
        },
      }
    );
    expect(invalidSchema.status()).toBe(400);
    const staleRevision = await page.request.post(
      '/api/core/p1/interrupts/resume',
      {
        data: {
          schemaVersion: 'interrupt-payload/v1',
          interruptId,
          revision: Number(revision) + 1,
          type: 'accept',
          idempotencyKey: `stale-revision:${interruptId}`,
        },
      }
    );
    expect(staleRevision.status()).toBe(409);

    // §37.4-H: refresh / reconnect must not drop pending interrupt.
    await page.reload();
    await expect(interruptHost).toHaveAttribute(
      'data-interrupt-id',
      interruptId!
    );
    await expect(interruptHost).toHaveAttribute(
      'data-interrupt-revision',
      revision!
    );
    await page.getByTestId('agent-interrupt-accept').click();
    await expect(
      page.locator(
        `[data-testid="agent-pending-interrupt"][data-interrupt-id="${interruptId}"]`
      )
    ).toHaveCount(0, { timeout: 60_000 });
    const duplicate = await page.request.post(
      '/api/core/p1/interrupts/resume',
      {
        data: {
          schemaVersion: 'interrupt-payload/v1',
          interruptId,
          revision: Number(revision),
          type: 'accept',
          idempotencyKey: `interrupt-resume:${interruptId}:r${revision}:accept`,
        },
      }
    );
    expect(duplicate.ok(), await duplicate.text()).toBeTruthy();
    expect(await duplicate.json()).toMatchObject({
      data: { outcome: 'replayed' },
    });
  });

  test('homepage pending interrupts list is workspace-scoped', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    await openCustomizedCreate(page);
    await reachExecutionConfirmation(page, '按已确认的门店资料做三页图文。');
    const pending = page.getByTestId('agent-pending-interrupt');
    await expect(pending).toBeVisible({ timeout: 120_000 });
    const interruptId = await pending.getAttribute('data-interrupt-id');

    await page.goto('/dashboard');
    await expect(page.getByTestId('agent-pending-interrupt')).toHaveAttribute(
      'data-interrupt-id',
      interruptId!,
      { timeout: 60_000 }
    );
  });

  test('expired hold refunds and closes the dispatched waiting run without continuing', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);
    await openCustomizedCreate(page);
    const { taskId } = await reachExecutionConfirmation(
      page,
      '按已确认资料做三页图文。'
    );

    const pending = page.getByTestId('agent-pending-interrupt');
    await expect(pending).toBeVisible({ timeout: 120_000 });
    const interruptId = await pending.getAttribute('data-interrupt-id');
    const revision = await pending.getAttribute('data-interrupt-revision');
    expect(interruptId).toBeTruthy();
    expect(revision).toMatch(/^\d+$/u);

    const expiry = await page.request.post(
      '/api/e2e/interrupt-expiry-fixture',
      {
        data: { interruptId },
        headers: { 'x-e2e-secret': 'mkfast-e2e-secret' },
      }
    );
    expect(expiry.ok(), await expiry.text()).toBeTruthy();
    await expect
      .poll(
        async () => {
          const decision = await page.request.get(
            `/api/core/p1/harness/tasks/${encodeURIComponent(taskId)}/decision`
          );
          return (await decision.json()) as unknown;
        },
        { timeout: 60_000 }
      )
      .toMatchObject({
        data: {
          resolutionSource: 'core_hold_expired',
          status: 'resolved',
        },
      });
    await expect
      .poll(() => queryProductUsage(page, taskId), { timeout: 60_000 })
      .toMatchObject({ status: 'refunded' });
    const refundedUsage = await queryProductUsage(page, taskId);
    expect(refundedUsage.reservedCredits).toBeGreaterThan(0);
    expect(refundedUsage.refundedCredits).toBe(refundedUsage.reservedCredits);
    expect(refundedUsage.settledCredits ?? 0).toBe(0);
    await expect
      .poll(() => queryCreditRefunds(page), { timeout: 60_000 })
      .toContainEqual(
        expect.objectContaining({
          creditedAmount: refundedUsage.reservedCredits,
          credits: refundedUsage.reservedCredits,
          refundDisposition: 'credited',
          status: 'refunded',
        })
      );
    await page.reload();
    await expect(
      page.locator(
        `[data-testid="agent-pending-interrupt"][data-interrupt-id="${interruptId}"]`
      )
    ).toHaveCount(0);
    await expect(page.getByTestId('composer-terminal-outcome')).toContainText(
      /已取消.*积分已退回/u,
      { timeout: 60_000 }
    );

    const resume = await page.request.post('/api/core/p1/interrupts/resume', {
      data: {
        schemaVersion: 'interrupt-payload/v1',
        interruptId,
        revision: Number(revision),
        type: 'accept',
        idempotencyKey: `expired:${interruptId}`,
      },
    });
    expect(resume.status()).toBe(409);
    expect(await resume.json()).toMatchObject({
      error: { code: 'IDEMPOTENCY_CONFLICT' },
    });
  });
});
