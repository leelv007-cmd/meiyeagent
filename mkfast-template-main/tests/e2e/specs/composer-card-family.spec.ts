import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

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
 * This file covers what the card family itself promises:
 *  - one creation journey shows 进度宣告卡 → 意图确认卡 → 成品交付卡, in that order;
 *  - answering the question resumes the run *for real* — the proof is that the
 *    run reaches a delivered revision, which a workflow suspended on
 *    pending-structured-decision cannot do;
 *  - leaving it alone releases it on the D-116 countdown (默认值路径), again
 *    proven by the run finishing rather than by the card disappearing;
 *  - the 「采用」 entry is bound to the revision the backend actually delivered;
 *  - every sentence on all three cards is merchant language (D-116);
 *  - quota is passive on the main path — no pre-run 额度确认 (D-043).
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

const CONFIRMATION_CARD_TIMEOUT_CONFIG_KEY =
  'harness.confirmation_card.timeout_seconds';

/**
 * Keep answer journeys outside the core timeout race through the same governed
 * CAS + audit path an operator uses. Core owns the durable timeout; the browser
 * only displays the same projected value.
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
  const reason = `T45 e2e ${journey} ${Date.now()}: set confirmation timeout to ${seconds}s`;
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
        'idempotency-key': `t45-e2e-${journey}-${crypto.randomUUID()}`,
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    expectedRevision = (expectedRevision ?? 0) + 1;
  };

  // Config application is intentionally idempotent for an unchanged value.
  // Move through a valid neighbouring value so a repeated local run still
  // records this journey's own governed audit entry.
  if (current?.storedValue === seconds) {
    await apply(
      seconds === 3_600 ? seconds - 1 : seconds + 1,
      `${reason} (repeat-run bridge)`
    );
  }
  await apply(seconds, reason);

  const revision = expectedRevision;
  await expect
    .poll(async () => latestRevision(await queryHistory()), {
      timeout: 30_000,
    })
    .toMatchObject({
      reason,
      revision,
      storedValue: seconds,
    });

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

/**
 * `intent` decides whether D-111 asks. An intent naming a beauty category is
 * routed straight through; one that names none makes the harness ask
 * `…:s1:industry_category`, which is how this file gets a real question card
 * instead of a stubbed one.
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
    await applyConfirmationCardTimeout(page, request, 600, 'three-cards');
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    // A promotion word without a price, so D-111 asks 「方便补充这次活动的
    // 项目和价格档吗？」 — which is how one journey gets all three cards
    // instead of two. (Since T44, a cold tenant's *industry* gap no longer
    // asks — Day-0 delivers first on the policy route — so the ask journey
    // must ride a non-industry gap.)
    const run = await startRun(page, '写一条周末到店的团购活动文案');

    // ① 进度宣告卡 — one card carrying the 白话进度 announcements, in order.
    const progressCard = page.getByTestId('composer-progress-card');
    await expect(progressCard).toBeVisible({ timeout: 180_000 });
    const stageLines = progressCard.getByTestId('composer-stage-line');
    expect(await stageLines.count()).toBeGreaterThan(0);
    assertMerchantLanguage(await progressCard.innerText(), [
      run.taskId,
      run.workId,
    ]);

    // ② 意图确认卡.
    const questionCard = page.getByTestId('ask-merchant-group-card');
    await expect(questionCard).toBeVisible({ timeout: 240_000 });
    assertMerchantLanguage(await questionCard.innerText(), [
      run.taskId,
      run.workId,
    ]);
    // Order: 进度 above 问题, both above the eventual delivery card.
    const questionOrder = await page.evaluate(() => {
      const progress = document.querySelector(
        '[data-testid="composer-progress-card"]'
      );
      const question = document.querySelector(
        '[data-testid="ask-merchant-group-card"]'
      );
      if (!progress || !question) return null;
      return progress.compareDocumentPosition(question) &
        Node.DOCUMENT_POSITION_FOLLOWING
        ? 'progress-then-question'
        : 'question-then-progress';
    });
    expect(questionOrder).toBe('progress-then-question');
    // The harness raises this gap with free text and no options, so the answer
    // path is the text box — see fixtureStructuredOutput / fallbackGuidanceGap.
    await questionCard.getByRole('textbox').fill('皮肤管理套餐 88 元');
    await questionCard.getByRole('button', { name: '提交回答' }).click();

    // ③ 成品交付卡 — the run finishes inside the conversation.
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
    await applyConfirmationCardTimeout(page, request, 599, 'answer-question');
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    // A promotion word without a price — D-111 asks 「方便补充这次活动的项目
    // 和价格档吗？」. (Cold-tenant industry gaps stopped asking with T44's
    // Day-0 deliver-first branch, so the ask journey rides a promotion gap.)
    const run = await startRun(page, '写一条周末到店的团购活动文案');

    const questionCard = page.getByTestId('ask-merchant-group-card');
    await expect(questionCard).toBeVisible({ timeout: 240_000 });
    // 建议补充 + 默认值 + 倒计时, all stated before anything is asked of them.
    await expect(page.getByTestId('ask-merchant-default')).toContainText(
      '暂未确定'
    );
    await expect(page.getByTestId('ask-merchant-countdown')).toBeVisible();
    assertMerchantLanguage(await questionCard.innerText(), [
      run.taskId,
      run.workId,
    ]);

    // `continue` is a Core-owned deadline. Typing remains available and a late
    // answer can derive a successor; the browser never claims it paused Core.
    await questionCard.getByRole('textbox').fill('皮肤管理');
    await expect(questionCard).toHaveAttribute('data-auto-continue', 'true');
    await expect(page.getByTestId('ask-merchant-countdown')).toBeVisible();

    const decisionPost = page.waitForRequest(
      (request) =>
        request.method() === 'POST' && request.url().endsWith('/interaction'),
      { timeout: 60_000 }
    );
    await questionCard.getByRole('button', { name: '提交回答' }).click();

    // The merchant's answer goes in as an accepted decision, carrying what they
    // actually chose — not as the default.
    const posted = (await decisionPost).postDataJSON() as {
      response?: {
        kind?: string;
        items?: Array<{ result?: { kind?: string; value?: string } }>;
      };
    };
    expect(posted.response?.kind).toBe('answer');
    expect(posted.response?.items?.[0]?.result?.kind).toBe('answer');
    expect(posted.response?.items?.[0]?.result?.value).toBe('皮肤管理');

    // The proof that DBOS left PENDING is that the run *delivered*: a workflow
    // suspended on pending-structured-decision produces no revision at all.
    await expect(page.getByTestId('composer-delivery-turn')).toBeVisible({
      timeout: 300_000,
    });
    await expect(page.getByTestId('composer-delivery-turn')).toHaveAttribute(
      'data-package-id',
      /.+/u
    );
    // And nothing is left pending on the decision seam.
    const pending = await page.evaluate(async (taskId: string) => {
      const response = await fetch(
        `/api/core/p1/harness/tasks/${encodeURIComponent(taskId)}/decision`,
        { credentials: 'same-origin' }
      );
      if (response.status === 404) return null;
      const body = (await response.json()) as { data?: { question?: unknown } };
      return body.data?.question ?? null;
    }, run.taskId);
    expect(
      pending,
      'no question may remain pending after the answer'
    ).toBeNull();
  });

  test('leaving the question alone releases it on the countdown (默认值路径)', async ({
    page,
    request,
  }) => {
    test.setTimeout(600_000);
    await applyConfirmationCardTimeout(page, request, 60, 'timeout-question');
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    await startRun(page, '写一条本周到店的优惠活动文案');

    const questionCard = page.getByTestId('ask-merchant-group-card');
    await expect(questionCard).toBeVisible({ timeout: 240_000 });
    await expect(questionCard).toHaveAttribute('data-auto-continue', 'true');

    // Nobody touches it. Core's durable recv expires and persists the ignored
    // decision; the browser must not post a competing timeout truth.
    let browserDecisionPosts = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/decision')) {
        browserDecisionPosts += 1;
      }
    });
    const openedAt = Date.now();
    await expect(page.getByTestId('composer-delivery-turn')).toBeVisible({
      timeout: 300_000,
    });
    const waited = (Date.now() - openedAt) / 1_000;
    expect(waited, `released after ${waited}s`).toBeGreaterThan(15);
    expect(waited, `released after ${waited}s`).toBeLessThan(120);
    expect(browserDecisionPosts).toBe(0);
    await expect(page.getByTestId('composer-delivery-turn')).toHaveAttribute(
      'data-package-id',
      /.+/u
    );
    await expect(page.getByTestId('composer-question-settled')).toContainText(
      '系统已按通用模式继续，你仍可回答并生成精修版本。'
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
          envelope.data?.question &&
          typeof envelope.data.question === 'object'
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
      '额度已经放回'
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

  test('quota is passive on the main path — no pre-run 额度确认', async ({
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
    // line (`composer-quota-passive`). The server quote line is the passive
    // exposure on the main path — statement only, no pre-run 额度确认 gate.
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
        throw new Error(envelope.error?.message ?? 'entitlements projection failed');
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
