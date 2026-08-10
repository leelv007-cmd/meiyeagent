import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import {
  productCommand,
  seedComposerInlineAuthorize,
  seedConfirmedStore,
} from '../fixtures/product';
import { selectComposerLens } from '../fixtures/ui-journey';

/**
 * V31-14 / V3.1 §37.4-F — 素材撤权 journey.
 *
 * §37.4-F original text: Plan 形成后撤权、Make admission fail closed、可换素材、
 * 不重复扣费. All four legs are asserted here, and the last one is asserted on
 * the ledger, never on page copy: `merchantCreditTransactionOperationSchema`
 * (`packages/contracts/src/merchant-credit-detail.ts:47-51`) is deliberately a
 * merchant-safe category rather than an internal operation id, so the exact
 * per-operation identity comes from the taskId-scoped ProductUsage receipt and
 * the workspace credit projection deltas around it.
 *
 * Real browser run is owned by the merge controller. Do not run full e2e here.
 */

type CreditBalance = {
  availableCredits: number;
  expiredCredits: number;
  grantedCredits: number;
  refundedCredits: number;
  usedCredits: number;
};

type EntitlementProjection = { credits: CreditBalance };

type ProductUsageReceipt = {
  refundedCredits?: number;
  reservedCredits?: number;
  settledCredits?: number;
  status?: string;
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

/** Submits one paid image_text Work and returns its server-owned taskId. */
async function submitPaidNote(page: Page, intent: string) {
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
  const response = await submission;
  const envelope = (await response.json()) as {
    data?: { task?: { id?: string } };
    error?: { message?: string };
  };
  expect(response.ok(), envelope.error?.message).toBeTruthy();
  expect(envelope.data?.task?.id).toBeTruthy();

  // Plan 形成: merchant sees compiled deliverables. Fixture plans usually say
  // 「3 页」; recovery after rebind may render the note deliverable without the
  // page-count chip — both prove a plan revision landed.
  await expect(
    page.getByTestId('agent-plan-section-deliverables')
  ).toContainText(/3\s*页|图文笔记/u, { timeout: 120_000 });

  return envelope.data!.task!.id!;
}

async function startPreparedPlan(page: Page) {
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
  return startResponse;
}

/** Answers the typed interrupt whose card text matches `hasText`. */
async function acceptInterrupt(page: Page, hasText: RegExp) {
  const interrupt = page
    .getByTestId('agent-pending-interrupt')
    .filter({ hasText });
  await expect(interrupt).toBeVisible({ timeout: 120_000 });
  await expect(interrupt).toHaveAttribute(
    'data-interrupt-schema-version',
    'interrupt-payload/v1'
  );
  await interrupt.getByTestId('agent-interrupt-accept').click();
  await expect(interrupt).toHaveCount(0, { timeout: 120_000 });
}

test.describe('V31-14 rights revocation journey (§37.4-F)', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('revoking a source after the Plan fails Make closed, a material swap recovers, and only one debit lands', async ({
    page,
    request,
  }) => {
    test.setTimeout(600_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    await page.goto('/dashboard');
    const revoked = await seedComposerInlineAuthorize(page, {
      fileName: `v31-rights-revoke-${crypto.randomUUID()}.png`,
    });
    await selectComposerLens(page, 'image_text');
    await expect(page.getByTestId('composer-home')).toBeVisible();

    const blockedTaskId = await submitPaidNote(
      page,
      '用这张门店案例图做三页笔记配图。'
    );
    const before = await creditProjection(page);
    const reserved = await productUsage(page, blockedTaskId);
    expect(
      reserved.reservedCredits ?? 0,
      'a paid Work must hold a server-owned reservation before Make'
    ).toBeGreaterThan(0);

    // §37.4-F leg 1: 撤权 happens after the Plan exists, before Make starts.
    await productCommand(page, {
      assetId: revoked.id,
      type: 'withdraw_asset',
    });

    // §37.4-F leg 2: Make admission fails closed — no deliverable is produced.
    await startPreparedPlan(page);
    const failureReport = page.getByTestId('composer-report-card');
    await expect(failureReport).toHaveAttribute('data-report-kind', 'failure', {
      timeout: 180_000,
    });
    await expect(
      failureReport.getByTestId('composer-report-reason')
    ).toContainText(/授权已撤销/u);
    await expect(page.getByTestId('composer-delivery-card')).toHaveCount(0);

    // The reservation must come back; a fail-closed stop never settles.
    await expect
      .poll(async () => (await productUsage(page, blockedTaskId)).status, {
        timeout: 120_000,
      })
      .toBe('refunded');
    const blockedUsage = await productUsage(page, blockedTaskId);
    const blockedReserved = blockedUsage.reservedCredits ?? 0;
    expect(blockedUsage.settledCredits ?? 0).toBe(0);
    expect(blockedUsage.refundedCredits).toBe(blockedReserved);
    expect(blockedReserved, 'refund path must name a positive hold').toBeGreaterThan(
      0
    );

    const afterStop = await creditProjection(page);
    expect(
      afterStop.credits.usedCredits,
      'a fail-closed stop must not spend anything'
    ).toBe(before.credits.usedCredits);
    // `before` is captured after submit while the reservation is held, so
    // available is already reduced. Safe-stop refund returns the hold — available
    // must rise by reservedCredits, not stay flat at the held baseline.
    expect(
      afterStop.credits.availableCredits,
      'the held credits must be available again after the safe stop'
    ).toBe(before.credits.availableCredits + blockedReserved);
    expect(
      afterStop.credits.refundedCredits - before.credits.refundedCredits
    ).toBe(blockedReserved);

    // §37.4-F leg 3: 可换素材 — rebind session, authorize a replacement, submit.
    // After fail-closed the Composer is still bound to the failed session id
    // (quote idempotency) and the draft still pins the withdrawn asset. Product
    // recovery (改一下要求) mints a new sessionId and drops ineligible sources;
    // the replacement must be authorized *after* that rebind so it attaches to
    // the thawed draft, not the frozen one that gets discarded.
    const adjust = page.getByTestId('composer-report-action-adjust_intent');
    await expect(
      adjust,
      'failure report must offer 改一下要求 so recovery rebinds the session'
    ).toBeVisible({ timeout: 30_000 });
    await adjust.click();
    await expect(page.getByTestId('composer-intent-input')).toBeEditable({
      timeout: 30_000,
    });
    // Recovery refresh+strip is async; wait until withdrawn source no longer
    // permanently blocks, then attach a replacement into the thawed draft.
    await expect
      .poll(
        async () =>
          (await page.getByTestId('composer-grounding-blocker').count()) === 0,
        {
          message:
            'recovery must drop the withdrawn asset so grounding can clear',
          timeout: 30_000,
        }
      )
      .toBe(true);
    await seedComposerInlineAuthorize(page, {
      fileName: `v31-rights-swap-${crypto.randomUUID()}.png`,
      fixtureIndex: 1,
    });
    await expect(page.getByTestId('composer-grounding-blocker')).toHaveCount(0, {
      timeout: 30_000,
    });
    await selectComposerLens(page, 'image_text');
    const recoveredTaskId = await submitPaidNote(
      page,
      '换成新授权的门店案例图，同样做三页笔记配图。'
    );
    expect(recoveredTaskId).not.toBe(blockedTaskId);
    const recoveredStart = await startPreparedPlan(page);
    expect((await recoveredStart).ok()).toBeTruthy();
    // decide→start already confirmed paid execution; only note_style remains
    // (same contract as living-plan / artifact growth after V31-56 delivery fix).
    await acceptInterrupt(page, /两种图文方向/u);
    await expect(page.getByTestId('composer-delivery-card')).toBeVisible({
      timeout: 420_000,
    });

    // §37.4-F leg 4: 不重复扣费 — the whole journey debits exactly one Work.
    await expect
      .poll(async () => (await productUsage(page, recoveredTaskId)).status, {
        timeout: 180_000,
      })
      .toBe('committed');
    const recoveredUsage = await productUsage(page, recoveredTaskId);
    const recoveredSettled = recoveredUsage.settledCredits ?? 0;
    expect(recoveredSettled).toBe(recoveredUsage.reservedCredits ?? 0);
    expect(recoveredUsage.refundedCredits ?? 0).toBe(0);
    // Blocked task must stay refunded — a late settle on it would double-debit.
    const blockedFinal = await productUsage(page, blockedTaskId);
    expect(blockedFinal.status).toBe('refunded');
    expect(blockedFinal.settledCredits ?? 0).toBe(0);

    // Baseline is post-refund afterStop (not post-reserve `before`): holds are
    // not yet usedCredits, and available has already returned the hold.
    // Primary meter is availableCredits (merchant balance). usedCredits can
    // include historical settles that refunds do not roll back on some paths;
    // pin both, but require available to match the single delivered Work.
    const after = await creditProjection(page);
    expect(
      afterStop.credits.availableCredits - after.credits.availableCredits,
      `balance must fall by the delivered Work only (afterStop.available=${afterStop.credits.availableCredits} after.available=${after.credits.availableCredits} recoveredSettled=${recoveredSettled} usedDelta=${after.credits.usedCredits - afterStop.credits.usedCredits})`
    ).toBe(recoveredSettled);
    expect(
      after.credits.usedCredits - afterStop.credits.usedCredits,
      `usedCredits must not exceed the delivered Work (afterStop.used=${afterStop.credits.usedCredits} after.used=${after.credits.usedCredits} recoveredSettled=${recoveredSettled})`
    ).toBe(recoveredSettled);
    expect(
      after.credits.grantedCredits,
      'a safe stop must never re-grant credits'
    ).toBe(afterStop.credits.grantedCredits);
  });
});
