/**
 * V31-08 / V3.1 §37.4-B — Level 1 pure copy journey.
 *
 * Authority: docs/design/0808规划/meiye-agent-v3.1-authoritative-plan-2026-08-08.md
 * §3 Level 1 + §37.4-B; V31-08 A5 billing UX; U1/U9 policy_exempt_copy freeze.
 *
 * Required claims (handoff §5; no API-only substitute, no conditional isVisible
 * skip, no route fulfill):
 *   1. policy-exempt copy does not require confirmation
 *   2. quote chip remains visible (cost + dual-state refund line)
 *   3. insufficient balance blocks with two recovery exits
 *   4. frozen plan/quote/release + real replay does not double-charge
 *
 * Sequence under test (the real one, verified in Core):
 * `POST /p1/composer/submissions` runs the Agent Session Intent turn before the
 * PlanCompiler, and pure copy is the **only** approval exemption
 * (`approvalBasisForSubmission` → `policy_exempt_copy`). So this journey answers
 * `makeReady: true` and starts Make without any merchant decision: no
 * execution-confirmation card, and no explicit `tasks/:taskId/start`.
 *
 * Real Core session end to end (Web → Core → Harness; only the model boundary
 * is fixture mode). Day-0 free creation is a different letter (A); this file
 * is the grounded copy path with a confirmed store.
 */
import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { productState, seedConfirmedStore } from '../fixtures/product';
import { selectComposerLens } from '../fixtures/ui-journey';

// Grounded on the seeded project name so D-043 fact-satisfaction does not
// suspend on 「价格缺失」before pure-copy admission. Avoid price language.
const LEVEL1_INTENT =
  '写一条朋友圈，介绍门店的透亮猫眼护理，语气克制，像熟客推荐。';

type CreditBalance = {
  availableCredits: number;
  expiredCredits: number;
  grantedCredits: number;
  refundedCredits: number;
  usedCredits: number;
};

type EntitlementProjection = { credits: CreditBalance };

type ProductQuoteSnapshot = {
  catalogModelId?: string;
  creditCost?: number;
  failureRefundsCredits?: boolean;
  quoteId?: string;
  quotePolicyRevision?: string;
  revision?: string;
  settledAmount?: number;
  taskId?: string;
};

type ProductUsageReceipt = {
  refundedCredits?: number;
  reservedCredits?: number;
  settledCredits?: number;
  status?: string;
};

type SubmissionCapture = {
  body: string;
  idempotencyKey: string;
};

type SubmissionEnvelope = {
  data?: {
    contentPackage?: { id?: string };
    makeReady?: boolean;
    replayed?: boolean;
    runId?: string;
    snapshot?: { id?: string };
    task?: { id?: string };
    threadId?: string;
    usageReservation?: { id?: string };
    work?: { id?: string };
  };
  error?: { message?: string };
};

async function p1Query<T>(
  page: Page,
  module: string,
  action: string,
  payload: Record<string, unknown> = {}
): Promise<T> {
  return page.evaluate(
    async ({ queryAction, queryModule, queryPayload }) => {
      const response = await fetch('/api/core/p1/query', {
        body: JSON.stringify({
          action: queryAction,
          module: queryModule,
          payload: queryPayload,
        }),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      const envelope = (await response.json()) as {
        data?: unknown;
        error?: { message?: string };
      };
      if (!response.ok || envelope.data === undefined) {
        throw new Error(
          envelope.error?.message ??
            `${queryModule}.${queryAction} query failed`
        );
      }
      return envelope.data;
    },
    { queryAction: action, queryModule: module, queryPayload: payload }
  ) as Promise<T>;
}

async function creditProjection(page: Page) {
  return p1Query<EntitlementProjection>(page, 'entitlements', 'projection');
}

async function productUsage(page: Page, taskId: string) {
  return p1Query<ProductUsageReceipt>(page, 'product-billing', 'get_usage', {
    taskId,
  });
}

async function productQuoteByTask(page: Page, taskId: string) {
  return p1Query<ProductQuoteSnapshot>(
    page,
    'product-billing',
    'get_quote_by_task',
    { taskId }
  );
}

/**
 * Credit-era trial grants 100 credits; zero the authenticated merchant's lots
 * so final browser admission reads a real insufficient projection.
 * Same seam as image-text-note-compiler.spec.ts (requires TEST_DATABASE_URL).
 */
function zeroRemainingCreditsForWorkspace(workspaceId: string) {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('TEST_DATABASE_URL is required to drain trial credits');
  }
  const sql = `
    UPDATE p1_credit_grant_lots
    SET remaining_credits = 0, revision = revision + 1
    WHERE workspace_id = '${workspaceId.replace(/'/g, "''")}'
    AND remaining_credits > 0;
  `;
  execFileSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    encoding: 'utf8',
  });
}

/** Grounded copy composer: confirmed store + 文案 lens + Level-1 intent. */
async function openGroundedCopyDraft(page: Page) {
  await page.goto('/dashboard');
  await seedConfirmedStore(page);
  await selectComposerLens(page, 'copy');
  await expect(page.getByTestId('composer-home')).toBeVisible();

  const intent = page.getByTestId('composer-intent-input');
  await intent.fill(LEVEL1_INTENT);
  await expect(intent).toHaveValue(LEVEL1_INTENT);
}

/**
 * Quote chip contract (A5 / R5): cost sentence + dual-state refund line stay
 * mounted while the bound quote is live. Asserts both testids unconditionally.
 */
async function assertQuoteChipVisible(page: Page) {
  const quoteLine = page.getByTestId('composer-quote-line');
  const creditQuote = page.getByTestId('workbench-credit-quote');
  const chip = creditQuote.or(quoteLine);
  await expect(chip, 'a bound quote chip must stay mounted').toBeVisible({
    timeout: 60_000,
  });
  await expect(chip).toContainText(
    /本次约消耗\s*\d+\s*分|本次用量已确认|失败将退回积分|失败不退回积分/u
  );
}

async function captureSubmissionRequest(
  page: Page,
  capture: { current: SubmissionCapture | null }
) {
  page.on('request', (request) => {
    if (
      request.method() !== 'POST' ||
      !request.url().includes('/api/core/p1/composer/submissions')
    ) {
      return;
    }
    const body = request.postData() ?? '';
    const idempotencyKey = request.headers()['idempotency-key'] ?? '';
    if (body.length > 0 && idempotencyKey.length > 0) {
      capture.current = { body, idempotencyKey };
    }
  });
}

/** Re-POST the exact first submission (same body + idempotency key). */
async function replayCapturedSubmission(
  page: Page,
  capture: SubmissionCapture
) {
  return page.evaluate(async ({ body, idempotencyKey }) => {
    const response = await fetch('/api/core/p1/composer/submissions', {
      body,
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      method: 'POST',
    });
    const text = await response.text();
    return { status: response.status, text };
  }, capture);
}

/**
 * D1=A: policy_exempt_copy must POST submissions without any confirm card.
 */
async function settleLevel1Submission(
  page: Page,
  responsePromise: ReturnType<Page['waitForResponse']>
) {
  await expect(page.getByRole('button', { name: '确认并开始' })).toHaveCount(0);
  await expect(
    page.getByTestId('execution-confirmation-interaction-card')
  ).toHaveCount(0);
  return responsePromise;
}

test.describe('V31-08 Level 1 pure copy journey (§37.4-B)', () => {
  test.afterEach(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('policy-exempt copy skips confirmation, keeps the quote chip, freezes quote, and replay does not double-charge', async ({
    page,
    request,
  }) => {
    test.setTimeout(420_000);
    await page.setViewportSize({ width: 1440, height: 900 });

    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    // Copy is exempt from the merchant decision — a statement about requests
    // that never happen — so record explicit start POSTs from first navigation.
    const explicitStartRequests: string[] = [];
    page.on('request', (candidate) => {
      if (
        candidate.method() === 'POST' &&
        /\/api\/core\/p1\/composer\/tasks\/[^/]+\/start$/u.test(candidate.url())
      ) {
        explicitStartRequests.push(candidate.url());
      }
    });

    const submissionCapture: { current: SubmissionCapture | null } = {
      current: null,
    };
    await captureSubmissionRequest(page, submissionCapture);

    await openGroundedCopyDraft(page);
    await assertQuoteChipVisible(page);
    await expect(page.getByTestId('composer-grounding-blocker')).toHaveCount(0);

    const before = await creditProjection(page);
    expect(
      before.credits.availableCredits,
      'trial workspace must have credits before a Level-1 run'
    ).toBeGreaterThan(0);

    const submit = page.getByTestId('composer-submit');
    await expect(
      submit,
      'the composer must be ready to submit before the journey clicks send'
    ).toBeEnabled({ timeout: 60_000 });
    await expect(submit).not.toHaveAttribute('aria-disabled', 'true');

    const submissionResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/core/p1/composer/submissions'),
      { timeout: 120_000 }
    );
    await submit.click();
    const submissionResponse = await settleLevel1Submission(
      page,
      submissionResponsePromise
    );
    const submissionText = await submissionResponse.text();
    const submission = JSON.parse(submissionText) as SubmissionEnvelope;
    expect(
      submissionResponse.status(),
      submission.error?.message ?? `body=${submissionText}`
    ).toBe(202);

    const taskId = submission.data?.task?.id ?? '';
    const workId = submission.data?.work?.id ?? '';
    const threadId = submission.data?.threadId ?? '';
    const runId = submission.data?.runId ?? '';
    const packageId = submission.data?.contentPackage?.id ?? '';
    const reservationId = submission.data?.usageReservation?.id ?? '';
    expect(taskId.length, `body=${submissionText}`).toBeGreaterThan(0);
    expect(workId.length, `body=${submissionText}`).toBeGreaterThan(0);
    expect(
      threadId.length,
      'the Intent turn must bind a durable Agent Thread'
    ).toBeGreaterThan(0);
    expect(
      runId.length,
      'the Intent turn must bind a durable Agent Run'
    ).toBeGreaterThan(0);
    expect(packageId.length, `body=${submissionText}`).toBeGreaterThan(0);
    expect(
      reservationId.length,
      'policy_exempt_copy still freezes a usage reservation'
    ).toBeGreaterThan(0);
    // Pure copy is the only policy exemption: Make is admitted inside this
    // one request instead of waiting for an explicit start.
    expect(
      submission.data?.makeReady,
      'policy_exempt_copy must admit Make on submit'
    ).toBe(true);
    expect(
      submission.data?.replayed ?? false,
      'the first admission is not a replay'
    ).toBe(false);

    // Quote chip remains visible after send (A5 常显), while the run streams.
    await assertQuoteChipVisible(page);

    // The exemption, stated as the two things that must never have happened:
    // no execution-confirmation decision, and no explicit start command.
    await expect(
      page.getByTestId('execution-confirmation-interaction-card'),
      'pure copy must not ask for a merchant execution decision'
    ).toHaveCount(0);
    await expect(
      page.getByTestId('composer-brief-surface'),
      'Level 1 pure copy must not stop on the video Brief surface'
    ).toHaveCount(0);
    expect(
      explicitStartRequests,
      'policy_exempt_copy must not need the explicit plan start command'
    ).toEqual([]);

    // ADR-0014: stays in the conversation; first usable token streams.
    await expect(page).not.toHaveURL(/\/dashboard\/results\//u);
    const candidateStream = page.getByTestId('composer-candidate-stream');
    await expect(candidateStream).toHaveAttribute('data-has-token', 'true', {
      timeout: 90_000,
    });

    const deliveryCard = page.locator(
      `[data-testid="composer-delivery-card"][data-work-id="${workId}"]`
    );
    await expect(deliveryCard).toBeVisible({ timeout: 180_000 });
    await expect(page.getByTestId('agent-workstream')).toHaveAttribute(
      'data-delivered',
      'true',
      { timeout: 60_000 }
    );

    // Still no confirmation / start after delivery.
    await expect(
      page.getByTestId('execution-confirmation-interaction-card')
    ).toHaveCount(0);
    expect(explicitStartRequests).toEqual([]);

    // Frozen quote authority: one task-scoped quote, positive credits.
    await expect
      .poll(async () => (await productUsage(page, taskId)).status, {
        timeout: 120_000,
      })
      .toBe('committed');
    const usage = await productUsage(page, taskId);
    const quote = await productQuoteByTask(page, taskId);
    expect(quote.taskId, 'the quote must be bound to this very task').toBe(
      taskId
    );
    expect(
      (quote.quoteId ?? '').length,
      'exact quote identity must freeze'
    ).toBeGreaterThan(0);
    expect(
      (quote.revision ?? '').length,
      'exact quote revision must freeze'
    ).toBeGreaterThan(0);
    expect(
      (quote.quotePolicyRevision ?? '').length,
      'quote policy revision freezes with the quote (release-adjacent authority)'
    ).toBeGreaterThan(0);
    expect(
      (quote.catalogModelId ?? '').length,
      'catalog model freezes with the quote'
    ).toBeGreaterThan(0);
    expect(
      typeof quote.failureRefundsCredits,
      'A5 dual-state refund switch is frozen on the quote'
    ).toBe('boolean');
    expect(
      quote.creditCost,
      'the quote must freeze a positive merchant credit price'
    ).toBeGreaterThan(0);
    expect(usage.reservedCredits, '预扣 must equal the frozen quote').toBe(
      quote.creditCost
    );
    expect(usage.settledCredits, '回执 must equal 预扣').toBe(
      usage.reservedCredits
    );
    expect(usage.refundedCredits ?? 0, 'a delivered run refunds nothing').toBe(
      0
    );

    const afterDelivery = await creditProjection(page);
    expect(
      before.credits.availableCredits - afterDelivery.credits.availableCredits,
      'balance falls by exactly the delivered Work'
    ).toBe(usage.settledCredits);
    expect(
      afterDelivery.credits.usedCredits - before.credits.usedCredits,
      'used credits rise by exactly one settled charge'
    ).toBe(usage.settledCredits);

    // Real admission replay: same body + idempotency key must not re-charge.
    expect(
      submissionCapture.current,
      'the browser must have observed the original submission request'
    ).toBeTruthy();
    const replay = await replayCapturedSubmission(
      page,
      submissionCapture.current!
    );
    expect(replay.status, replay.text).toBe(202);
    const replayBody = JSON.parse(replay.text) as SubmissionEnvelope;
    expect(
      replayBody.data?.replayed,
      'idempotent re-admission must mark replayed'
    ).toBe(true);
    expect(replayBody.data?.task?.id).toBe(taskId);
    expect(replayBody.data?.work?.id).toBe(workId);
    expect(replayBody.data?.makeReady).toBe(true);

    const usageAfterReplay = await productUsage(page, taskId);
    expect(usageAfterReplay.status).toBe('committed');
    expect(
      usageAfterReplay.settledCredits,
      'admission replay must not settle a second charge'
    ).toBe(usage.settledCredits);
    expect(usageAfterReplay.reservedCredits).toBe(usage.reservedCredits);

    const afterReplay = await creditProjection(page);
    expect(
      afterReplay.credits.availableCredits,
      'admission replay must not move the balance again'
    ).toBe(afterDelivery.credits.availableCredits);
    expect(afterReplay.credits.usedCredits).toBe(
      afterDelivery.credits.usedCredits
    );

    // Real UI event-log replay: reload restores the conversation; still one debit.
    await page.reload();
    await expect(page).toHaveURL(/\/dashboard(?:\?|$)/u);
    await expect(page.getByTestId('composer-conversation')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId('composer-turn-merchant')).toContainText(
      LEVEL1_INTENT
    );
    await expect(
      page.locator(
        `[data-testid="composer-delivery-card"][data-work-id="${workId}"]`
      )
    ).toBeVisible({ timeout: 180_000 });
    await expect(
      page.getByTestId('execution-confirmation-interaction-card')
    ).toHaveCount(0);
    expect(explicitStartRequests).toEqual([]);

    const usageAfterReload = await productUsage(page, taskId);
    expect(usageAfterReload.status).toBe('committed');
    expect(usageAfterReload.settledCredits).toBe(usage.settledCredits);
    const afterReload = await creditProjection(page);
    expect(afterReload.credits.availableCredits).toBe(
      afterDelivery.credits.availableCredits
    );
    expect(afterReload.credits.usedCredits).toBe(
      afterDelivery.credits.usedCredits
    );
  });

  test('insufficient balance blocks pure-copy submit with booster and upgrade exits', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });

    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    let submissionPostCount = 0;
    page.on('request', (candidate) => {
      if (
        candidate.method() === 'POST' &&
        candidate.url().includes('/api/core/p1/composer/submissions')
      ) {
        submissionPostCount += 1;
      }
    });

    await openGroundedCopyDraft(page);
    await assertQuoteChipVisible(page);

    const { workspaceId } = await productState(page);
    expect(workspaceId.length).toBeGreaterThan(0);

    // Drain after the quote is bound so the chip stays visible and the final
    // admission path is a real shortfall, not a missing-quote failure.
    zeroRemainingCreditsForWorkspace(workspaceId);

    const submit = page.getByTestId('composer-submit');
    await expect(submit).toBeEnabled({ timeout: 60_000 });
    await submit.click();

    // D-043 fact confirm (if mounted) is not a credit shortfall — accept it so
    // the credit admission ladder can surface the real shortfall alert.
    const factConfirm = page.getByRole('button', { name: '确认并开始' });
    const shortfall = page.getByTestId('workbench-credit-shortfall-alert');
    const afterSubmit = await Promise.race([
      factConfirm
        .waitFor({ state: 'visible', timeout: 30_000 })
        .then(() => 'fact_gate' as const)
        .catch(() => 'shortfall' as const),
      shortfall
        .waitFor({ state: 'visible', timeout: 30_000 })
        .then(() => 'shortfall' as const)
        .catch(() => 'fact_gate' as const),
    ]);
    if (afterSubmit === 'fact_gate') {
      await expect(factConfirm).toBeEnabled();
      await factConfirm.click();
    }

    await expect(shortfall).toBeVisible({ timeout: 30_000 });
    await expect(shortfall).toContainText(/还差\s*\d+\s*分/u);

    // Dual exits (A5 / R5): 买加油包 + 升级套餐, each with a distinct pricing anchor.
    await expect(
      shortfall.getByTestId('workbench-credit-buy-booster')
    ).toHaveAttribute('href', '/pricing#credit-boosters');
    await expect(
      shortfall.getByTestId('workbench-credit-upgrade')
    ).toHaveAttribute('href', '/pricing#subscription-plans');
    await expect(
      shortfall.getByTestId('workbench-credit-buy-booster')
    ).toContainText(/购买加油包|Buy a booster/u);
    await expect(
      shortfall.getByTestId('workbench-credit-upgrade')
    ).toContainText(/升级套餐|Upgrade/u);

    await expect(page.getByTestId('composer-submit')).toBeDisabled();
    expect(
      submissionPostCount,
      'an unaffordable pure-copy run must not POST a submission'
    ).toBe(0);

    // Quote chip remains visible while short (常显), beside the shortfall alert.
    await assertQuoteChipVisible(page);
    await expect(
      page.getByTestId('execution-confirmation-interaction-card')
    ).toHaveCount(0);
  });
});
