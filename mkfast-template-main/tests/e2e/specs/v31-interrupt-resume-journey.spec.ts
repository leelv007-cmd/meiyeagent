import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { attachComposerSourceViaLibrary } from '../fixtures/library-source';
import { seedConfirmedStore } from '../fixtures/product';
import {
  selectComposerLens,
  settleComposerSubmission,
} from '../fixtures/ui-journey';

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
  await attachComposerSourceViaLibrary(page, {
    fileName: `v31-journey-${crypto.randomUUID()}.png`,
  });
  await selectComposerLens(page, 'image_text');
  await expect(page.getByTestId('composer-home')).toBeVisible();
}

async function readActiveConfirmationRequestId(page: Page, taskId: string) {
  return page.evaluate(async (sessionTaskId) => {
    const response = await fetch('/api/core/p1/harness/tasks', {
      credentials: 'same-origin',
    });
    const envelope = (await response.json()) as {
      data?: {
        tasks?: Array<{
          executionConfirmationRequestId?: string;
          taskId?: string;
        }>;
      };
    };
    const prefix = `${sessionTaskId}:plan-r`;
    const matched = (envelope.data?.tasks ?? []).find(
      (task) =>
        task.taskId === sessionTaskId ||
        (typeof task.taskId === 'string' && task.taskId.startsWith(prefix))
    );
    return matched?.executionConfirmationRequestId ?? null;
  }, taskId);
}

async function submitPreparedLivingPlan(page: Page, intent: string) {
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
  const submissionResponse = await settleComposerSubmission(page, submission);
  const submissionEnvelope = (await submissionResponse.json()) as {
    data?: {
      executionConfirmationRequestId?: string;
      task?: { id?: string };
    };
    error?: { message?: string };
  };
  expect(
    submissionResponse.ok(),
    submissionEnvelope.error?.message
  ).toBeTruthy();
  const taskId = submissionEnvelope.data?.task?.id;
  expect(taskId).toBeTruthy();
  // SUBMIT-01A: 202 withholds the confirmation id until planning finishes.
  await expect
    .poll(() => readActiveConfirmationRequestId(page, taskId!), {
      timeout: 120_000,
    })
    .toBeTruthy();
  const executionConfirmationRequestId = await readActiveConfirmationRequestId(
    page,
    taskId!
  );
  expect(executionConfirmationRequestId).toBeTruthy();
  return {
    executionConfirmationRequestId: executionConfirmationRequestId!,
    taskId: taskId!,
  };
}

async function reachExecutionConfirmation(page: Page, intent: string) {
  const submitted = await submitPreparedLivingPlan(page, intent);

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

  // V31-56: the commit strip already recorded the paid confirmation
  // decision before /start. Core must not re-suspend on that same
  // execution_confirmation. The next typed interrupt (图文方向) is the
  // pending card §37.4-H reconnects.
  await expect(page.getByTestId('agent-pending-interrupt')).toBeVisible({
    timeout: 120_000,
  });

  return submitted;
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
        transaction.type === 'refund' ||
        (transaction.operation === 'creation' && transaction.type === 'refund')
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

    // §37.4-H: a pending interrupt blocks ordinary new input until answered.
    await expect(page.getByTestId('composer-submit')).toBeDisabled();
    await expect(page.getByTestId('composer-submit-intent')).toContainText(
      '请先处理上方待确认事项'
    );

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
      interruptId!,
      { timeout: 60_000 }
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
    // §37.4-H: resume must make the run continue, not merely retire the card.
    // V31-56: after explicit start the first typed interrupt *is* 图文方向.
    // Accepting it continues Make; a second style question would mean the
    // resume did not land. A non-style first card still has to reach 图文方向.
    if (/两种图文方向/u.test(beforeText)) {
      await expect(page.getByTestId('composer-delivery-card')).toBeVisible({
        timeout: 420_000,
      });
    } else {
      await expect(
        page
          .getByTestId('agent-pending-interrupt')
          .filter({ hasText: /两种图文方向/u })
      ).toBeVisible({ timeout: 180_000 });
    }
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

  test('the pending interrupt reaches the owner homepage and no other workspace', async ({
    browser,
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const owner = await registerE2EUser(request);
    await loginByForm(page, owner);
    await seedConfirmedStore(page);

    await openCustomizedCreate(page);
    await reachExecutionConfirmation(page, '按已确认的门店资料做三页图文。');
    const pending = page.getByTestId('agent-pending-interrupt');
    await expect(pending).toBeVisible({ timeout: 120_000 });
    const interruptId = await pending.getAttribute('data-interrupt-id');
    const revision = await pending.getAttribute('data-interrupt-revision');
    expect(interruptId).toBeTruthy();

    await page.goto('/dashboard');
    await expect(page.getByTestId('agent-pending-interrupt')).toHaveAttribute(
      'data-interrupt-id',
      interruptId!,
      { timeout: 60_000 }
    );

    // A second workspace must neither list nor resume the owner's interrupt.
    const outsiderContext = await browser.newContext();
    try {
      const outsider = await outsiderContext.newPage();
      const otherUser = await registerE2EUser(request);
      await loginByForm(outsider, otherUser);
      await outsider.goto('/dashboard');
      const outsiderList = await outsider.request.get(
        '/api/core/p1/pending-interrupts'
      );
      expect(outsiderList.ok(), await outsiderList.text()).toBeTruthy();
      const listed = (await outsiderList.json()) as {
        data?: { interrupts?: Array<{ interruptId?: string }> };
      };
      expect(
        (listed.data?.interrupts ?? []).map((item) => item.interruptId)
      ).not.toContain(interruptId);
      const stolenResume = await outsider.request.post(
        '/api/core/p1/interrupts/resume',
        {
          data: {
            idempotencyKey: `cross-workspace:${interruptId}`,
            interruptId,
            revision: Number(revision),
            schemaVersion: 'interrupt-payload/v1',
            type: 'accept',
          },
        }
      );
      expect(stolenResume.ok()).toBeFalsy();
    } finally {
      await outsiderContext.close();
    }

    // The owner's interrupt is untouched by the foreign attempt.
    await expect(page.getByTestId('agent-pending-interrupt')).toHaveAttribute(
      'data-interrupt-revision',
      revision!
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
    // V31-56: the billed hold is the confirmation reservation created at
    // submit. /start decides that hold; after start the only typed interrupt
    // is 图文方向, which is not a harness decision target.
    const { taskId, executionConfirmationRequestId } =
      await submitPreparedLivingPlan(page, '按已确认资料做三页图文。');
    await expect(page.getByTestId('agent-commit-strip-start')).toBeEnabled({
      timeout: 120_000,
    });

    const expiry = await page.request.post(
      '/api/e2e/interrupt-expiry-fixture',
      {
        data: { confirmationRequestId: executionConfirmationRequestId },
        headers: { 'x-e2e-secret': 'mkfast-e2e-secret' },
      }
    );
    expect(expiry.ok(), await expiry.text()).toBeTruthy();
    // Confirmation expire refunds the credit hold. Product usage stays
    // reserved until a usage-settlement path exists — that row is not the
    // hold authority.
    await expect
      .poll(
        async () => {
          const refunds = await queryCreditRefunds(page);
          return refunds.some(
            (row) =>
              row.refundDisposition === 'credited' &&
              (row.status === 'refunded' || row.type === 'refund') &&
              (row.creditedAmount ?? 0) > 0
          );
        },
        { timeout: 60_000 }
      )
      .toBe(true);

    await page.reload();
    // Confirmation expire is not a harness workflow cancel, so there is no
    // composer-terminal-outcome /已取消.*积分已退回/ turn before start.
    await expect(page.getByTestId('composer-home')).toBeVisible({
      timeout: 60_000,
    });

    const staleDecision = await page.request.post(
      `/api/core/p1/confirmation-requests/${encodeURIComponent(
        executionConfirmationRequestId
      )}/decide`,
      {
        data: {
          decision: 'confirmed',
          decisionId: `expired-confirm:${executionConfirmationRequestId}`,
        },
      }
    );
    expect(staleDecision.status(), await staleDecision.text()).toBe(409);

    const start = page.getByTestId('agent-commit-strip-start');
    if (await start.isEnabled()) {
      const revisionLabel =
        (await page
          .getByTestId('agent-living-plan-revision-single')
          .textContent()) ?? 'r1';
      const planRevision = Number(revisionLabel.replace(/^r/u, '')) || 1;
      const staleStart = await page.request.post(
        `/api/core/p1/composer/tasks/${encodeURIComponent(taskId)}/start`,
        { data: { planRevision } }
      );
      const startStatus = staleStart.status();
      const startBody = (await staleStart.json()) as {
        data?: {
          executionConfirmationRequestId?: string;
          makeReady?: boolean;
        };
      };
      // Expired hold cannot launch Make. /start 409 is the refuse; 202 is a
      // new withheld successor, not a paid run on this confirmationRequestId.
      if (startStatus === 202) {
        expect(startBody.data?.makeReady).not.toBe(true);
        expect(startBody.data?.executionConfirmationRequestId).not.toBe(
          executionConfirmationRequestId
        );
      } else {
        expect(startStatus, JSON.stringify(startBody)).toBe(409);
      }
    } else {
      await expect(start).toBeDisabled();
    }
  });
});
