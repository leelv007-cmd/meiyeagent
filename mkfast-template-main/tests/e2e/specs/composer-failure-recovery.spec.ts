import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

import type { MerchantCreditDetail } from '@meiye/contracts';

import { composerSessionStorageKey } from '@/product/composer/composer-session';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { productState, seedConfirmedStore } from '../fixtures/product';
import { selectComposerLens } from '../fixtures/ui-journey';

/**
 * S2 失败与恢复 — the two journeys W03 and W10 exist to make true.
 *
 * ① 失败申报: a run that cannot be delivered says so *in the conversation*, in
 *    merchant language, with a next step and the 积分 outcome. Before this the
 *    transcript simply stopped and a generic toast was the whole story
 *    (差距报告 P0-2).
 * ② 时间桥: closing the tab is not a way to lose a run. The server holds the
 *    only truth, so reopening rebuilds the conversation from the event replay
 *    (D-145; audit-chat「前台把钥匙丢了」).
 *
 * Both drive the real Web → Core → Harness/DBOS chain. The only deterministic
 * boundary is the model provider, exactly as in every other fixture journey:
 * ①'s failure is produced by the *real* canonical `critical_fact_source` gate
 * blocking a candidate whose price claim has no traceable source, and the
 * refund, the audit fact and the terminal frame are all the production path.
 */

/** 失败档 — the fixture drill word (apps/core/src/p1/model-supply/ai-sdk-runner.ts). */
const FAILURE_DRILL_INTENT = '写一条皮肤护理到店体验文案（失败档）';

/** Mirrors src/product/composer/card-language.ts — 走查断言清单. */
const FORBIDDEN_LANGUAGE =
  /workspace\s+id|task\s+id|work\s+id|\bprovider\b|\bdeepseek\b|\bhttp\s*[1-5]\d{2}\b|\bworkflow\b|\brevision\b|\bcandidate\b|\bschema\b|\bdbos\b|\bllm\b|成本价|毛利/iu;
const FORBIDDEN_IDENTIFIERS =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-|\b[\w-]+:s\d+:[\w-]+|\b(?:store_fact|content_package|task):/u;

function assertMerchantLanguage(text: string, internalIds: string[]) {
  expect(text, `engineering language on a merchant card: ${text}`).not.toMatch(
    FORBIDDEN_LANGUAGE
  );
  expect(text, `internal identifier on a merchant card: ${text}`).not.toMatch(
    FORBIDDEN_IDENTIFIERS
  );
  for (const id of internalIds) {
    if (id) expect(text).not.toContain(id);
  }
}

const CONFIRMATION_CARD_TIMEOUT_CONFIG_KEY =
  'harness.confirmation_card.timeout_seconds';

/**
 * Keep the held-question journey outside Core's own release deadline, through
 * the same governed CAS + audit path an operator uses. Core owns the durable
 * timeout; the browser only displays the projected value.
 */
async function applyConfirmationCardTimeout(
  page: Page,
  request: APIRequestContext,
  seconds: number,
  journey: string
) {
  const admin = await registerE2EUser(request, { role: 'admin' });
  await loginByForm(page, admin);

  const queryHistory = async () => {
    const response = await page.request.post('/api/core/p1/query', {
      data: {
        action: 'config_history',
        module: 'admin-config',
        payload: { key: CONFIRMATION_CARD_TIMEOUT_CONFIG_KEY },
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return (
      (
        (await response.json()) as {
          data?: Array<{
            reason?: string;
            revision?: number;
            storedValue?: unknown;
          }>;
        }
      ).data ?? []
    );
  };
  const latestRevision = (history: Awaited<ReturnType<typeof queryHistory>>) =>
    history.reduce<(typeof history)[number] | undefined>(
      (latest, candidate) =>
        (candidate.revision ?? 0) > (latest?.revision ?? 0)
          ? candidate
          : latest,
      undefined
    );

  const before = await queryHistory();
  const current = latestRevision(before);
  let expectedRevision = current?.revision ?? null;
  const reason = `S2 e2e ${journey} ${Date.now()}: set confirmation timeout to ${seconds}s`;
  const apply = async (value: number, applyReason: string) => {
    const response = await page.request.post('/api/core/p1/commands', {
      data: {
        action: 'config_apply',
        module: 'admin-config',
        payload: {
          expectedRevision,
          key: CONFIRMATION_CARD_TIMEOUT_CONFIG_KEY,
          reason: applyReason,
          value,
        },
      },
      headers: {
        'idempotency-key': `s2-e2e-${journey}-${crypto.randomUUID()}`,
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    expectedRevision = (expectedRevision ?? 0) + 1;
  };

  if (current?.storedValue === seconds) {
    await apply(
      seconds === 3_600 ? seconds - 1 : seconds + 1,
      `${reason} (repeat-run bridge)`
    );
  }
  await apply(seconds, reason);

  const revision = expectedRevision;
  await expect
    .poll(async () => latestRevision(await queryHistory()), { timeout: 30_000 })
    .toMatchObject({ reason, revision, storedValue: seconds });

  const signedOut = await page.evaluate(async () => {
    const response = await fetch('/api/auth/sign-out', {
      body: '{}',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    return { body: await response.text(), ok: response.ok };
  });
  expect(signedOut.ok, signedOut.body).toBeTruthy();
}

function submissionResponse(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/core/p1/composer/submissions'),
    { timeout: 120_000 }
  );
}

/**
 * A submission may pause on the Brief surface before it reaches Core. Both
 * shapes end at the same POST, which is the only thing that proves a submit
 * actually happened rather than a button merely being clickable.
 */
async function settleSubmission(
  page: Page,
  responsePromise: ReturnType<typeof submissionResponse>
) {
  const briefSurface = page.getByTestId('composer-brief-surface');
  const next = await Promise.race([
    briefSurface
      .waitFor({ state: 'visible', timeout: 60_000 })
      .then(() => 'brief' as const)
      .catch(() => 'submission' as const),
    responsePromise.then(() => 'submission' as const),
  ]);
  if (next === 'brief')
    await page.getByTestId('composer-brief-confirm').click();

  const response = await responsePromise;
  const envelope = (await response.json()) as {
    data?: { work?: { id?: string }; task?: { id?: string } };
    error?: { message?: string };
  };
  expect(response.ok(), envelope.error?.message).toBeTruthy();
  return {
    taskId: envelope.data?.task?.id ?? '',
    workId: envelope.data?.work?.id ?? '',
  };
}

async function startRun(page: Page, intent: string) {
  await page.goto('/dashboard');
  await selectComposerLens(page, 'copy');
  await page.getByTestId('composer-intent-input').fill(intent);
  await expect(page.getByTestId('composer-quote-line')).toBeVisible({
    timeout: 30_000,
  });

  const responsePromise = submissionResponse(page);
  await page.getByTestId('composer-submit').click();
  return settleSubmission(page, responsePromise);
}

/** 可用 N 分 — the credit balance the refund has to move back. */
function availableCreditsFromBalanceLine(text: string) {
  // 「可用 1300 分」 — the credit balance (D-172). This used to read 「还剩 N 条」
  // off `composer-quota-passive`, the bucket line that the retired three-bucket
  // projection fed (#336).
  const match = /可用\s*(\d+)\s*分/u.exec(text);
  return match ? Number(match[1]) : null;
}

/**
 * The topbar balance, not the one in the credit capsule: since the capsule bar
 * (`d27a43cc`) `workbench-credit-balance` only mounts while that popover is
 * open, so reading it would make the refund assertion depend on a panel being
 * held open across the whole run. Both render `workbench_credit_balance` off
 * the same `availableCredits`, and this one is always on screen.
 */
function creditBalanceLine(page: Page) {
  return page.getByTestId('workbench-credit-topbar-balance');
}

/**
 * 商家积分明细 — the same `entitlements/credit_detail` projection the account
 * page renders (`use-merchant-credit-detail.ts`), so this reads what the
 * merchant can look up rather than an internal table.
 *
 * The balance line alone cannot tell 「扣了又退」 from 「从未扣过」: both end at
 * the number they started from. The ledger can, because a reservation leaves a
 * row behind whether or not it is later credited back.
 */
async function creditTransactions(page: Page, operation: string) {
  const detail = await page.evaluate(async () => {
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
      data?: MerchantCreditDetail;
      error?: { message?: string };
    };
    if (!response.ok || !envelope.data) {
      throw new Error(envelope.error?.message ?? 'credit_detail failed');
    }
    return envelope.data;
  });
  return detail.transactions.filter(
    (transaction) => transaction.operation === operation
  );
}

test.describe('S2 失败与恢复', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('W03: a failed run declares itself in the conversation and the quota comes back', async ({
    page,
    request,
  }) => {
    test.setTimeout(420_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    await page.goto('/dashboard');
    await selectComposerLens(page, 'copy');
    await page.getByTestId('composer-intent-input').fill(FAILURE_DRILL_INTENT);
    await expect(page.getByTestId('composer-quote-line')).toBeVisible({
      timeout: 30_000,
    });
    // Read the balance before the run so the refund is an observed change
    // rather than a sentence the card asserts about itself.
    const creditsBefore = availableCreditsFromBalanceLine(
      await creditBalanceLine(page).innerText()
    );

    const run = await startRun(page, FAILURE_DRILL_INTENT);

    // ① 对话流出现中文申报卡.
    const card = page.getByTestId('composer-report-card');
    await expect(card).toBeVisible({ timeout: 300_000 });
    await expect(card).toHaveAttribute('data-report-kind', 'failure');
    const reason = await page.getByTestId('composer-report-reason').innerText();
    const nextStep = await page
      .getByTestId('composer-report-next-step')
      .innerText();
    // 白话原因 + 下一步动作, both in Chinese, neither an error code.
    expect(reason).toMatch(/[一-龥]/u);
    expect(nextStep).toMatch(/[一-龥]/u);
    assertMerchantLanguage(await card.innerText(), [run.taskId, run.workId]);

    // 可恢复入口 — a failure that offers nothing is a dead end (D-116), and an
    // entry that renders but cannot act is the same dead end with a button on
    // it. So each one is clicked and its effect asserted, never counted.
    const actions = page.getByTestId('composer-report-actions');
    expect(await actions.locator('button').count()).toBeGreaterThan(0);

    // ② 积分退还可见: stated on the card *and* visible on the balance line.
    await expect(page.getByTestId('composer-report-quota')).toContainText(
      '退回'
    );
    if (creditsBefore !== null) {
      await expect
        .poll(
          async () =>
            availableCreditsFromBalanceLine(
              await creditBalanceLine(page).innerText()
            ),
          { timeout: 60_000 }
        )
        .toBe(creditsBefore);
    }

    // 退回 ≠ 从未扣过. Ending on the number it started from is also what never
    // charging would look like, so the balance alone cannot tell a refund from
    // a run that was waved through — nor can it catch a charge that is never
    // credited back, once the balance has settled. The ledger keeps both facts:
    // a reservation leaves its row whatever happens next, and the credit back
    // is a second row that names the amount it returned.
    //
    // Read off the ledger rather than by watching the balance dip mid-run: the
    // reservation and its refund are 408ms apart (#356 archaeology), and the
    // balance line lags them — it was still reading the pre-run number while
    // the reservation was already on the ledger, and only showed the dip after
    // the refund had landed. Sampling that window would be asserting on a stale
    // read, not on the charge.
    await expect
      .poll(async () => await creditTransactions(page, 'creation'), {
        timeout: 60_000,
      })
      .toHaveLength(2);
    const creation = await creditTransactions(page, 'creation');
    const reserved = creation.filter((entry) => entry.type === 'reserve');
    const refunded = creation.filter((entry) => entry.type === 'refund');
    expect(reserved, '本次运行必须真的预扣过一次').toHaveLength(1);
    expect(reserved[0]!.credits).toBeGreaterThan(0);
    expect(reserved[0]!.status).toBe('refunded');
    expect(refunded, '预扣必须被退回').toHaveLength(1);
    expect(refunded[0]!.refundDisposition).toBe('credited');
    expect(refunded[0]!.creditedAmount).toBe(reserved[0]!.credits);

    // A blocked draft must not be left on screen as if it were usable.
    await expect(page.getByTestId('composer-delivery-turn')).toHaveCount(0);

    // 再生成一次, straight from the failure. A failed run leaves the lens frozen,
    // so this is the assertion that separates a working entry from a button
    // that renders: the click has to reach Core with a run of its own.
    await expect(page.getByTestId('composer-intent-input')).toBeDisabled();
    const retried = submissionResponse(page);
    await page.getByTestId('composer-report-action-retry').click();
    const second = await settleSubmission(page, retried);
    expect(second.taskId).not.toBe(run.taskId);
    // `.last()`: 再生成一次 carries the conversation forward rather than wiping
    // it, so asking again reads as a second ask — the merchant said the same
    // sentence twice and the transcript says so.
    await expect(
      page.getByTestId('composer-turn-merchant').last()
    ).toContainText(FAILURE_DRILL_INTENT, { timeout: 60_000 });
  });

  /**
   * The other entry, on its own path. 再生成一次 rebuilds the session from
   * scratch, which would hide everything 改一下要求 leaves standing: the same
   * conversation carries on with a second run in it, so the quote key, the
   * progress cursor and the previous 申报 all have to be scoped to the attempt
   * rather than to the tab.
   */
  test('W03: 改一下要求 hands the composer back and the next submit is the merchant own', async ({
    page,
    request,
  }) => {
    test.setTimeout(420_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    const run = await startRun(page, FAILURE_DRILL_INTENT);
    await expect(page.getByTestId('composer-report-card')).toBeVisible({
      timeout: 300_000,
    });

    const intentInput = page.getByTestId('composer-intent-input');
    await expect(intentInput).toBeDisabled();
    await page.getByTestId('composer-report-action-adjust_intent').click();
    await expect(intentInput).toBeEnabled();
    // Taking the conversation over ends the tab's claim on the failed run. If
    // the handle stayed in sessionStorage, the next reload would restore that
    // run — its stream, its poll and its 申报 — on top of the sentence the
    // merchant is in the middle of rewriting (轮 5 P1-①).
    const { workspaceId } = await productState(page);
    await expect
      .poll(async () =>
        page.evaluate(
          (key) => window.sessionStorage.getItem(key),
          composerSessionStorageKey(workspaceId)
        )
      )
      .toBeNull();
    // Rewritten to drop the claim that was refused — the point of 改一下要求.
    // Typed rather than filled: each keystroke moves the billable payload, so
    // the quote is provably held while this runs and the state below is not a
    // race the machine happened to win.
    const rewritten = '写一条皮肤护理到店体验文案，只讲服务流程和预约方式';
    const quoteStatus = page.getByTestId('composer-quote-status');
    // 改一下要求 hands their own sentence back, so the rewrite starts by clearing
    // what the failed run was asked for.
    await intentInput.fill('');
    const typing = intentInput.pressSequentially(rewritten, { delay: 40 });
    await expect(quoteStatus).toHaveAttribute('data-quote-state', 'settling');
    await typing;
    await expect(intentInput).toHaveValue(rewritten);

    // The press has to land *inside* the window or this leg proves nothing
    // about it, so the state is read once more with no retry: held, with no
    // price on screen, at the moment the merchant presses.
    expect(await quoteStatus.getAttribute('data-quote-state')).toBe('settling');
    await expect(page.getByTestId('composer-quote-line')).toHaveCount(0);

    // The ordinary send button, not the card: this is the merchant continuing
    // by hand. It re-quotes under the rewritten sentence, which is where a
    // quote id that ignored the intent used to strand them on a 409.
    const resubmitted = submissionResponse(page);
    // Exactly one press, and no second one anywhere below: a press inside the
    // window has to carry all the way to Core on its own. If it only flushed
    // the window the merchant would have to press again, which is the dead
    // press this leg exists to catch.
    await page.getByTestId('composer-submit').click();
    const second = await settleSubmission(page, resubmitted);
    expect(second.taskId).not.toBe(run.taskId);

    // 新进度帧可见 — the second workflow numbers its frames from zero, so a
    // cursor left at the first run's high-water mark would drop all of them and
    // the run would stream into nothing.
    await expect(page.getByTestId('composer-progress-card')).toBeVisible({
      timeout: 240_000,
    });
    await expect
      .poll(async () => page.getByTestId('composer-stage-line').count(), {
        timeout: 120_000,
      })
      .toBeGreaterThan(0);

    // 无陈旧报告 — and the run that now succeeds ends on a deliverable.
    await expect(page.getByTestId('composer-report-card')).toHaveCount(0);
    await expect(page.getByTestId('composer-delivery-turn')).toBeVisible({
      timeout: 300_000,
    });
    await expect(page.getByTestId('composer-report-card')).toHaveCount(0);
  });

  test('W10: closing the tab no longer loses the run — the server brings it back', async ({
    context,
    page,
    request,
  }) => {
    test.setTimeout(900_000);
    // Long enough that the run is still held when the tab closes, short enough
    // that the timeout genuinely fires while the merchant is away — a hold that
    // never expires would let a 「超时终态」 assertion pass without any timeout
    // having happened. The deadline stays Core's, set through admin config.
    const holdSeconds = 120;
    await applyConfirmationCardTimeout(
      page,
      request,
      holdSeconds,
      'time-bridge'
    );
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    // A promotion word with no price makes D-111 ask, which is what keeps the
    // run suspended rather than delivering before the tab can close.
    const intent = '写一条周末到店的团购活动文案';
    const run = await startRun(page, intent);

    await expect(page.getByTestId('composer-progress-card')).toBeVisible({
      timeout: 240_000,
    });
    await expect(page.getByTestId('ask-merchant-group-card')).toBeVisible({
      timeout: 240_000,
    });
    const stagesBefore = await page
      .getByTestId('composer-progress-card')
      .getByTestId('composer-stage-line')
      .count();
    expect(stagesBefore).toBeGreaterThan(0);

    // 关标签页. A new page in the same context keeps the login and drops the
    // per-tab sessionStorage — which is exactly the handle that used to be the
    // only way back to a running conversation.
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto('/dashboard');
    expect(
      await reopened.evaluate(() => window.sessionStorage.length),
      'the browser handle must not be what restores the run'
    ).toBe(0);

    // 对话流恢复精确状态含进度.
    await expect(reopened.getByTestId('composer-turn-merchant')).toContainText(
      intent,
      { timeout: 120_000 }
    );
    const progress = reopened.getByTestId('composer-progress-card');
    await expect(progress).toBeVisible({ timeout: 180_000 });
    await expect
      .poll(async () => progress.getByTestId('composer-stage-line').count(), {
        timeout: 120_000,
      })
      .toBeGreaterThanOrEqual(stagesBefore);
    // 未决问题回到原位 — the question the run is held on is still there after
    // leaving, because Core kept it.
    await expect(reopened.getByTestId('ask-merchant-group-card')).toBeVisible({
      timeout: 120_000,
    });

    // 任务中心接入 harness 任务 + 深链回活对话. The tab holds this run's handle in
    // sessionStorage; planting a different one first is what makes the deep
    // link's precedence observable rather than assumed — otherwise both paths
    // would open the same conversation and the click would prove nothing.
    // By the contract that opens the panel rather than by label: the trigger
    // renames itself with whatever is pending (「1 项」/「N 个进行中」/「任务」).
    const asyncTaskTrigger = reopened.locator(
      'button[aria-controls="async-task-center-panel"]'
    );
    await expect(asyncTaskTrigger).toBeVisible({ timeout: 60_000 });
    await asyncTaskTrigger.click();
    const panel = reopened.locator('#async-task-center-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(intent);
    const deepLink = panel.locator(
      `a[href*="taskId=${encodeURIComponent(run.taskId)}"]`
    );
    await expect(deepLink).toHaveCount(1);

    await deepLink.click();
    await expect(reopened).toHaveURL(
      new RegExp(`taskId=${encodeURIComponent(run.taskId)}`)
    );
    await expect(reopened.getByTestId('composer-turn-merchant')).toContainText(
      intent,
      { timeout: 120_000 }
    );

    // 深链优先于本地把手. A tab that already holds some other conversation must
    // still open the run the link names — the tab's handle is only what it saw
    // last, and the server is the truth. Planted before the page's own scripts
    // run, so the stale session is genuinely there when the composer mounts.
    const stale = '上一条已经不在进行中的旧对话';
    const { workspaceId: reopenWorkspaceId } = await productState(reopened);
    const deepLinkPage = await context.newPage();
    await deepLinkPage.addInitScript(
      ([key, owner, text]) => {
        window.sessionStorage.setItem(
          key,
          JSON.stringify({
            schema: 'composer-session/v1',
            sessionId: 'stale-session',
            workspaceId: owner,
            updatedAt: new Date().toISOString(),
            merchantText: text,
            task: {
              taskId: 'stale-task',
              workId: 'stale-work',
              packageId: 'stale-package',
            },
          })
        );
      },
      [
        composerSessionStorageKey(reopenWorkspaceId),
        reopenWorkspaceId,
        stale,
      ] as const
    );
    await deepLinkPage.goto(
      `/dashboard?taskId=${encodeURIComponent(run.taskId)}`
    );
    await expect(
      deepLinkPage.getByTestId('composer-turn-merchant')
    ).toContainText(intent, { timeout: 120_000 });
    await expect(
      deepLinkPage.getByTestId('composer-turn-merchant')
    ).not.toContainText(stale);
    await deepLinkPage.close();

    // 超时终态持久化. The hold is Core's, and it expires while the merchant is
    // away: the card settles to 「系统已按通用模式继续」 and that terminal line
    // has to survive a reopen, because it comes back from the event replay
    // rather than from anything this browser remembered.
    const settled = reopened.getByTestId('composer-question-settled');
    await expect(settled).toContainText('已按通用模式继续', {
      timeout: holdSeconds * 1_000 + 180_000,
    });
    // …and it is Core's fact, not this tab's memory. After leaving and coming
    // back the typed interaction snapshot still reports the durable semantic
    // default; the retired structured-decision seam does not own this request.
    await reopened.reload();
    const resolution = await reopened.request.get(
      `/api/core/p1/harness/tasks/${encodeURIComponent(run.taskId)}/interaction?view=snapshot`
    );
    expect(resolution.ok(), await resolution.text()).toBeTruthy();
    expect(await resolution.json()).toMatchObject({
      data: {
        request: { kind: 'ask_merchant' },
        resolutionSource: 'system_default',
        status: 'resolved',
      },
    });

    await reopened.close();
  });
});
