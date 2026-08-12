import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { seedConfirmedStore } from '../fixtures/product';
import { setTheme } from '../fixtures/page-health';
import { selectComposerLens } from '../fixtures/ui-journey';

/**
 * T31 / #225 — 卡片族与确认卡, the presentation layer of the three outbound
 * seam messages.
 *
 * The container journey (不跳转 / 刷新恢复 / 签名提交体) is composer-reshell.spec.ts.
 * Since V31-14/25 a frozen-snapshot Make never re-opens guidance gaps, so the
 * free-copy question lives in the *plan phase* (V31-28, 2026-08-12
 * adjudication): trigger authority is split by prompt shape — a promotion /
 * missing-price intent rides the Brief high-risk informed-consent gate and
 * delivers first (uiux-day0-contract owns that journey), while a *vague*
 * guidance intent (nothing names the industry) raises the plan-phase
 * clarification this file rides. This file covers what the card family
 * promises on that journey:
 *  - one creation journey shows 方案期问题卡 → 进度宣告卡 → 成品交付卡, in that
 *    order — the question comes before any Make progress exists;
 *  - answering the question resumes the run *for real* — the answer turn
 *    compiles the plan and auto-starts the exempt copy Make (D-043), proven by
 *    a delivered revision no waiting plan-run could produce on its own;
 *  - leaving it alone parks the run durably — the question survives a reload
 *    and a late answer is still a live exit (方案期无倒计时默认值; the old
 *    D-116 countdown semantics belong to execution-phase cards only);
 *  - the 「采用」 entry is bound to the revision the backend actually delivered;
 *  - every sentence on all three faces is merchant language (D-116);
 *  - credits are passive on the main path — no pre-run 积分确认 (D-043).
 */

/** Mirrors src/product/composer/card-language.ts — the走查断言清单. */
const FORBIDDEN_LANGUAGE =
  /workspace\s+id|task\s+id|work\s+id|\bprovider\b|\bdeepseek\b|\bhttp\s*[1-5]\d{2}\b|\bworkflow\b|\brevision\b|\bcandidate\b|\bschema\b|\bdbos\b|\bllm\b|成本价|毛利/iu;
const FORBIDDEN_IDENTIFIERS =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-|\b[\w-]+:s\d+:[\w-]+|\b(?:store_fact|content_package|task):|[¥$]\s*\d|\d+(?:\.\d+)?\s*元/u;

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

type SubmissionResult = { taskId: string; workId: string };

/**
 * `intent` decides what asks. An intent naming a beauty category is routed
 * straight through (deliver-first); a *vague* one (no industry, no promotion
 * word) raises the plan-phase clarification `industry_category` — a real
 * question, not a stubbed one. Promotion-worded intents trigger the Brief
 * high-risk consent surface instead, which the race below confirms.
 */
async function startRun(page: Page, intent: string): Promise<SubmissionResult> {
  await page.goto('/dashboard');
  await selectComposerLens(page, 'copy');
  await page.getByTestId('composer-intent-input').fill(intent);
  await expect(page.getByTestId('composer-quote-line')).toBeVisible({
    timeout: 30_000,
  });

  const requestPromise = page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      request.url().includes('/api/core/p1/composer/submissions'),
    { timeout: 120_000 }
  );
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/core/p1/composer/submissions'),
    { timeout: 120_000 }
  );
  await page.getByTestId('composer-submit').click();

  const briefSurface = page.getByTestId('composer-brief-surface');
  const next = await Promise.race([
    briefSurface
      .waitFor({ state: 'visible', timeout: 60_000 })
      .then(() => 'brief' as const)
      .catch(() => 'submission' as const),
    requestPromise.then(() => 'submission' as const),
  ]);
  if (next === 'brief')
    await page.getByTestId('composer-brief-confirm').click();

  await requestPromise;
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

/**
 * The delivered revision, straight from the seam the card does *not* use — the
 * card reads the terminal SSE snapshot, this reads the HTTP projection. Two
 * independent reads agreeing is what makes 「与后端一致」 an assertion rather
 * than a tautology.
 */
async function readDeliveredRevision(page: Page, workId: string) {
  const projection = await page.evaluate(async (id: string) => {
    const response = await fetch('/api/core/p1/query', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        module: 'operations',
        action: 'content_packages',
        payload: {},
      }),
    });
    return {
      ok: response.ok,
      status: response.status,
      body: (await response.json()) as unknown,
      workId: id,
    };
  }, workId);
  return projection;
}

test.describe('T31 三类卡与确认卡', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('the three cards appear in order and every sentence is merchant language', async ({
    page,
    request,
  }) => {
    test.setTimeout(420_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    // A vague intent names no industry, so the plan phase asks 「这次内容主要
    // 属于哪一类美业服务？」 — which is how one journey gets all three faces
    // instead of two. (Promotion / missing-price intents ride the Brief
    // high-risk consent gate instead and never reach this question —
    // 2026-08-12 adjudication, see uiux-day0-contract.)
    const run = await startRun(page, '随便帮我写点这周能发的内容');

    // ① 方案期问题卡 — the clarification face, before any Make progress
    // exists: the run is parked on the merchant's answer, so a progress card
    // here would mean the Make started without the plan.
    const questionFace = page.getByTestId('composer-plan-clarification');
    await expect(questionFace).toBeVisible({ timeout: 120_000 });
    await expect(questionFace).toContainText(
      '这次内容主要属于哪一类美业服务？'
    );
    assertMerchantLanguage(await questionFace.innerText(), [
      run.taskId,
      run.workId,
    ]);
    await expect(page.getByTestId('composer-progress-card')).toHaveCount(0);

    // ② The answer goes through the same input the question points at
    // (「请在下方输入框补充信息后发送」), and the exempt copy Make auto-starts
    // on the answer (D-043 — no 积分确认, no explicit start).
    const answerPost = page.waitForRequest(
      (req) =>
        req.method() === 'POST' &&
        /\/composer\/tasks\/[^/]+\/answer$/u.test(req.url()),
      { timeout: 60_000 }
    );
    await page.getByTestId('composer-intent-input').fill('皮肤管理');
    await page.getByTestId('composer-submit').click();
    await answerPost;

    // ③ 进度宣告卡 — the 白话进度 announcements begin only now.
    const progressCard = page.getByTestId('composer-progress-card');
    await expect(progressCard).toBeVisible({ timeout: 180_000 });
    const stageLines = progressCard.getByTestId('composer-stage-line');
    expect(await stageLines.count()).toBeGreaterThan(0);
    assertMerchantLanguage(await progressCard.innerText(), [
      run.taskId,
      run.workId,
    ]);

    // ④ 成品交付卡 — the run finishes inside the conversation.
    const deliveryTurn = page.getByTestId('composer-delivery-turn');
    await expect(deliveryTurn).toBeVisible({ timeout: 300_000 });
    // Order: the progress card is above the delivery card in the transcript.
    const order = await page.evaluate(() => {
      const progress = document.querySelector(
        '[data-testid="composer-progress-card"]'
      );
      const delivery = document.querySelector(
        '[data-testid="composer-delivery-turn"]'
      );
      if (!progress || !delivery) return null;
      return progress.compareDocumentPosition(delivery) &
        Node.DOCUMENT_POSITION_FOLLOWING
        ? 'progress-then-delivery'
        : 'delivery-then-progress';
    });
    expect(order).toBe('progress-then-delivery');

    // 任务总结 is stated on the deliverable it describes (D-116).
    const statement = page.getByTestId('composer-delivery-statement');
    await expect(statement).toBeVisible();
    const statementText = await statement.innerText();
    expect(statementText).toContain('策略依据');
    assertMerchantLanguage(await deliveryTurn.innerText(), [
      run.taskId,
      run.workId,
    ]);

    // The answered question is settled — no clarification face may linger
    // under the delivered result.
    await expect(page.getByTestId('composer-plan-clarification')).toHaveCount(
      0
    );
  });

  test('「采用」 is bound to the revision the backend delivered', async ({
    page,
    request,
  }) => {
    test.setTimeout(420_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    const run = await startRun(page, '写一条新客皮肤护理到店体验文案');

    const deliveryTurn = page.getByTestId('composer-delivery-turn');
    await expect(deliveryTurn).toBeVisible({ timeout: 240_000 });

    // What the card bound itself to (read off the terminal SSE snapshot).
    const packageId = await deliveryTurn.getAttribute('data-package-id');
    const versionId = await deliveryTurn.getAttribute('data-version-id');
    const revision = await deliveryTurn.getAttribute('data-revision');
    expect(packageId, 'the delivery card must bind a package').toBeTruthy();
    expect(versionId, 'the delivery card must bind a version').toBeTruthy();
    expect(Number(revision)).toBeGreaterThanOrEqual(0);

    // What the backend says, read through the independent HTTP projection.
    const projection = await readDeliveredRevision(page, run.workId);
    expect(projection.ok, JSON.stringify(projection.body)).toBeTruthy();
    const serialized = JSON.stringify(projection.body);
    expect(
      serialized,
      'the revision the card bound must be the one the backend holds'
    ).toContain(packageId!);
    expect(serialized).toContain(versionId!);

    // Clicking 采用 opens the Result Center bound to that same revision.
    await page.getByTestId('composer-delivery-action-adopt').click();
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/results/${encodeURIComponent(run.workId)}`, 'u'),
      { timeout: 60_000 }
    );
    const url = new URL(page.url());
    expect(url.searchParams.get('contentId')).toBe(packageId);
    expect(url.searchParams.get('versionId')).toBe(versionId);
    expect(url.searchParams.get('panel')).toBe('result');
    await expect(page.getByTestId('result-center-shell')).toBeVisible();
  });

  test('answering the question card resumes the run for real', async ({
    page,
    request,
  }) => {
    test.setTimeout(600_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    // A vague intent names no industry — the plan phase asks 「这次内容主要属
    // 于哪一类美业服务？」 and parks the run on the answer. (Promotion gaps
    // ride the Brief consent gate, not this question — 2026-08-12 adjudication.)
    const run = await startRun(page, '随便帮我写点这周能发的内容');

    const questionFace = page.getByTestId('composer-plan-clarification');
    await expect(questionFace).toBeVisible({ timeout: 120_000 });
    await expect(questionFace).toContainText(
      '这次内容主要属于哪一类美业服务？'
    );
    assertMerchantLanguage(await questionFace.innerText(), [
      run.taskId,
      run.workId,
    ]);
    // The parked run produced nothing yet — this is what the answer resumes.
    await expect(page.getByTestId('composer-progress-card')).toHaveCount(0);
    await expect(page.getByTestId('composer-delivery-turn')).toHaveCount(0);

    const answerPost = page.waitForRequest(
      (req) =>
        req.method() === 'POST' &&
        /\/composer\/tasks\/[^/]+\/answer$/u.test(req.url()),
      { timeout: 60_000 }
    );
    await page.getByTestId('composer-intent-input').fill('皮肤管理');
    await page.getByTestId('composer-submit').click();

    // The merchant's answer goes in as their own words — not as a default.
    const posted = await answerPost;
    expect(
      (posted.postDataJSON() as { merchantAnswer?: string }).merchantAnswer
    ).toBe('皮肤管理');

    // The proof the answer resumed the run for real is that it *delivered*: a
    // plan-run parked on its clarification has no timeout path and produces
    // no revision at all without the answer — and no explicit /start is ever
    // POSTed in this test.
    await expect(page.getByTestId('composer-delivery-turn')).toBeVisible({
      timeout: 300_000,
    });
    await expect(page.getByTestId('composer-delivery-turn')).toHaveAttribute(
      'data-package-id',
      /.+/u
    );
    // And nothing is left pending on the clarification seam.
    await expect(page.getByTestId('composer-plan-clarification')).toHaveCount(
      0
    );

    // The answer envelope is the auto-start contract (D-043): makeReady rides
    // the answer itself. Asserted on the idempotent replay (the crash-recovery
    // seam: same envelope, Make started exactly once — the first answer's own
    // envelope is pinned by apps/core composer-plan-session/composer-http
    // contract tests) because awaiting the first answer's response object here
    // trips an intermittent dev-transport stall unrelated to the contract —
    // see the V31-28 ticket's follow-ups.
    const replay = await page.evaluate(async (id: string) => {
      const response = await fetch(
        `/api/core/p1/composer/tasks/${encodeURIComponent(id)}/answer`,
        {
          body: JSON.stringify({ merchantAnswer: '皮肤管理' }),
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          method: 'POST',
          signal: AbortSignal.timeout(20_000),
        }
      );
      return {
        body: (await response.json()) as { data?: { makeReady?: boolean } },
        status: response.status,
      };
    }, run.taskId);
    expect(replay.status).toBe(200);
    expect(
      replay.body.data?.makeReady,
      'the answered exempt copy plan must be make-ready off the answer itself'
    ).toBe(true);
    // Replay did not re-run anything: the delivery card is still the one
    // delivery, and no second progress run appeared.
    await expect(page.getByTestId('composer-delivery-turn')).toHaveCount(1);
  });

  test('leaving the question alone parks the run durably — the question survives a reload and a late answer still delivers', async ({
    page,
    request,
  }) => {
    // 2026-08-12 改约 (V31-28): the plan-phase clarification has no countdown
    // and no default-value release — that D-116 machinery belongs to
    // execution-phase cards. The plan-phase contract is durable patience:
    // nobody answers ⇒ the run does not advance by itself; the question is a
    // durable interrupt that survives a reload; a late answer is still a live
    // exit. (方案期 unattended 默认值机制 = follow-up ticket, not this one.)
    test.setTimeout(600_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    await startRun(page, '随便帮我写点这周能发的内容');

    const questionFace = page.getByTestId('composer-plan-clarification');
    await expect(questionFace).toBeVisible({ timeout: 120_000 });

    // Nobody touches it. The browser must not answer on the merchant's
    // behalf, and the run must not advance on its own.
    let browserAnswerPosts = 0;
    page.on('request', (req) => {
      if (
        req.method() === 'POST' &&
        (/\/composer\/tasks\/[^/]+\/answer$/u.test(req.url()) ||
          req.url().endsWith('/decision') ||
          req.url().endsWith('/interaction'))
      ) {
        browserAnswerPosts += 1;
      }
    });
    // A fixture Make delivers within seconds of starting, so 20s of silence
    // is proof the run is parked, not merely slow.
    await page.waitForTimeout(20_000);
    expect(browserAnswerPosts).toBe(0);
    await expect(page.getByTestId('composer-progress-card')).toHaveCount(0);
    await expect(page.getByTestId('composer-delivery-turn')).toHaveCount(0);
    await expect(questionFace).toBeVisible();

    // The question is a durable interrupt — a reload rebuilds it from the
    // server, not from tab state.
    await page.reload();
    await expect(page.getByTestId('composer-plan-clarification')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId('composer-progress-card')).toHaveCount(0);
    await expect(page.getByTestId('composer-delivery-turn')).toHaveCount(0);

    // A late answer is still a live exit — typed straight into the reloaded
    // tab: the pending clarification keeps the send button pressable without
    // re-choosing a lens (V31-28 send-gate contract).
    const answerPost = page.waitForRequest(
      (req) =>
        req.method() === 'POST' &&
        /\/composer\/tasks\/[^/]+\/answer$/u.test(req.url()),
      { timeout: 60_000 }
    );
    await page.getByTestId('composer-intent-input').fill('美甲');
    await page.getByTestId('composer-submit').click();
    await answerPost;
    await expect(page.getByTestId('composer-delivery-turn')).toBeVisible({
      timeout: 300_000,
    });
    await expect(page.getByTestId('composer-delivery-turn')).toHaveAttribute(
      'data-package-id',
      /.+/u
    );
  });

  test('a released hold changes the quota promise before the merchant answers', async ({
    page,
    request,
  }) => {
    test.setTimeout(420_000);
    // Promotion gaps now prefer the interaction channel (ask-merchant). This
    // case asserts the decision-card hold promise (reservationReleased), so
    // keep interaction absent and inject a hold question on the decision seam.
    // AskMerchantInteractionSlot also polls `?view=snapshot`; that URL must be
    // stubbed too or the real system_default resolution steals the fallback
    // slot and composer-question-card never mounts.
    await page.route(
      /\/api\/core\/p1\/harness\/tasks\/[^/]+\/interaction(?:\?.*)?$/u,
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue();
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          json: {
            data: {
              request: null,
              resolutionSource: null,
              status: 'absent',
            },
            meta: { correlationId: 'e2e-harness-interaction-absent' },
          },
        });
      }
    );
    await page.route(
      /\/api\/core\/p1\/harness\/tasks\/[^/]+\/decision$/u,
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue();
          return;
        }
        const response = await route.fetch();
        const envelope = (await response.json()) as {
          data?: {
            question?: Record<string, unknown> | null;
            reservationReleased?: boolean;
            timeoutSeconds?: number | null;
            status?: string;
          };
        };
        const baseQuestion =
          envelope.data?.question && typeof envelope.data.question === 'object'
            ? envelope.data.question
            : {
                freeText: { enabled: true, placeholder: '也可以直接告诉我' },
                options: [],
                question: '方便补充这次活动的项目和价格档吗？',
                questionId: 'e2e-released-hold-question',
                response: {
                  field: 'offer_price',
                  reason: '让这次活动内容更贴合你的实际情况',
                },
                scope: 'current_task',
                workflowId: 'e2e-released-hold-workflow',
                workflowRevision: 1,
              };
        await route.fulfill({
          response,
          json: {
            data: {
              question: {
                ...baseQuestion,
                unattended: 'hold',
              },
              reservationReleased: true,
              resolutionSource: null,
              status: 'pending',
              timeoutSeconds: null,
            },
            meta: { correlationId: 'e2e-harness-decision-released-hold' },
          },
        });
      }
    );
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    // seedConfirmedStore finalizes store facts through the public intake
    // command — progressive-fact-card is for incomplete stores only and must
    // not be expected after this helper (credit-era / intake-finalized path).
    await seedConfirmedStore(page);

    const run = await startRun(page, '写一条周末到店的团购活动文案');
    const questionCard = page.getByTestId('composer-question-card');
    await expect(questionCard).toBeVisible({ timeout: 240_000 });
    await expect(page.getByTestId('composer-question-hold')).toContainText(
      '积分已经放回'
    );
    await expect(page.getByTestId('composer-question-hold')).toContainText(
      '重新排队占用'
    );
    await expect(page.getByTestId('composer-question-answer')).toBeEnabled();
    await expect(page.getByTestId('composer-question-countdown')).toHaveCount(
      0
    );
    assertMerchantLanguage(await questionCard.innerText(), [
      run.taskId,
      run.workId,
    ]);
  });

  test('credits are passive on the main path — no pre-run 积分确认', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    await page.goto('/dashboard');
    await selectComposerLens(page, 'copy');
    await page
      .getByTestId('composer-intent-input')
      .fill('写一条周末皮肤护理到店预约文案');
    await expect(page.getByTestId('composer-quote-line')).toBeVisible({
      timeout: 30_000,
    });

    // Credit-era (D-172 / #298): when `projection.credits` is present,
    // `composerQuotaAvailability` intentionally silences the bucket passive
    // line, which #336 retired with the three-bucket projection that fed it.
    // The server quote line is the passive exposure on the main path — a
    // statement only, with no pre-run 积分确认 gate.
    await expect(page.getByTestId('composer-quota-passive')).toHaveCount(0);
    const entitlement = await page.evaluate(async () => {
      const response = await fetch('/api/core/p1/query', {
        body: JSON.stringify({
          action: 'projection',
          module: 'entitlements',
          payload: {},
        }),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      const envelope = (await response.json()) as {
        data?: {
          credits?: { availableCredits?: number };
        };
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          envelope.error?.message ?? 'entitlements projection failed'
        );
      }
      return envelope.data;
    });
    expect(
      entitlement?.credits,
      'credit-era entitlements must project a credits balance'
    ).toBeTruthy();
    expect(
      Number(entitlement?.credits?.availableCredits)
    ).toBeGreaterThanOrEqual(0);
    const quoteLine = page.getByTestId('composer-quote-line');
    await expect(quoteLine).toBeVisible();
    expect(await quoteLine.locator('button, input, a').count()).toBe(0);
    assertMerchantLanguage(await quoteLine.innerText(), []);

    // 无冲突路径 0 张阻塞卡 (D-043 决定①) — nothing gates the run.
    await expect(page.getByTestId('composer-quota-blocking-card')).toHaveCount(
      0
    );
    await expect(page.getByTestId('composer-submit')).toBeEnabled();
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`the card family renders on mobile in the ${theme} theme`, async ({
      page,
      request,
    }) => {
      test.setTimeout(420_000);
      const user = await registerE2EUser(request);
      await loginByForm(page, user);
      await seedConfirmedStore(page);
      await setTheme(page, theme);
      await page.setViewportSize({ width: 390, height: 844 });

      await startRun(page, '写一条周末皮肤护理到店预约文案');
      await expect(page.locator('html')).toHaveClass(
        new RegExp(`\\b${theme}\\b`, 'u')
      );
      await expect(page.getByTestId('composer-progress-card')).toBeVisible({
        timeout: 180_000,
      });
      await expect(page.getByTestId('composer-delivery-turn')).toBeVisible({
        timeout: 240_000,
      });
      await expect(
        page.getByTestId('composer-delivery-action-adopt')
      ).toBeVisible();

      // Nothing may scroll the page sideways on a phone.
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(1);

      await page.screenshot({
        fullPage: true,
        path: `../.scratch/t31-card-family-2026-07-26/cards-mobile-${theme}.png`,
      });
    });

    test(`the card family renders on desktop in the ${theme} theme`, async ({
      page,
      request,
    }) => {
      test.setTimeout(420_000);
      const user = await registerE2EUser(request);
      await loginByForm(page, user);
      await seedConfirmedStore(page);
      await setTheme(page, theme);
      await page.setViewportSize({ width: 1440, height: 900 });

      await startRun(page, '写一条周末皮肤护理到店预约文案');
      await expect(page.locator('html')).toHaveClass(
        new RegExp(`\\b${theme}\\b`, 'u')
      );
      await expect(page.getByTestId('composer-progress-card')).toBeVisible({
        timeout: 180_000,
      });
      await expect(page.getByTestId('composer-delivery-turn')).toBeVisible({
        timeout: 240_000,
      });

      await page.screenshot({
        fullPage: true,
        path: `../.scratch/t31-card-family-2026-07-26/cards-desktop-${theme}.png`,
      });
    });
  }
});
