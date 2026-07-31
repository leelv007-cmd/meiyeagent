import { expect, test, type Page, type Request } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import {
  productState,
  seedComposerInlineAuthorize,
  seedConfirmedStore,
} from '../fixtures/product';
import {
  blockingQuestionLocator,
  briefConfirmButton,
  installUserActivationCounter,
  skipOnboardingButton,
  type UserActivationCounter,
} from '../fixtures/user-activation';
import {
  adoptResult,
  assertJourneyRestored,
  assertThreeModalDiscovery,
  downloadFullPackage,
  JOURNEY_CONTRACTS,
  openDeliveryPanel,
  submitComposerJourney,
  waitForResultJourney,
  type JourneyContract,
} from '../fixtures/ui-journey';

/**
 * M-04 / T37 (#231) — the required browser hard gate.
 *
 * 「严格测试文件存在」is not「当前 required hard gate 成立」. This file is the
 * browser journey the ordinary PR gate runs
 * (`scripts/ci/run-pr-production-journey.sh`), and it walks the whole mainline
 * on the shipped seam:
 *
 *   Composer 提交 (`/api/core/p1/composer/submissions`, T08 双字段合同)
 *     → 流式候选 (白话进度 + token 帧)
 *     → 刷新恢复 ①  (中断后回到会话，进度不丢，且不产生第二次提交)
 *     → 采用
 *     → 交付 (Result Center，按 distributionTarget 出完整发布包)
 *     → 刷新恢复 ②  (回到结果，采用态不丢)
 *
 * Three modalities are locked: copy / image_text / video. Video is not
 * substitutable — a gate that greens while 视频 is uncovered is the exact
 * failure M-04 names — so the contract lookup below throws rather than skips.
 *
 * The Day-0 strict assertions moved here from `uiux-day0-contract.spec.ts`
 * (isTrusted 点击计数 / 零前置表单 / 首 token). They existed without running on
 * any required job; here they run against the new seam on every pull request.
 *
 * Identity stays neutral (D-111 / M-03): the tenant registers no marketing
 * identity, and the journey must not invent one for it. Nothing here needs a
 * credential — the harness runs the fixture 模型档
 * (`MODEL_EXECUTION_MODE=fixture`, injected by the CI script and by
 * `playwright.config.ts`), so a missing provider key cannot redden this gate.
 */

const REQUIRED_MODALITIES = ['copy', 'image_text', 'video'] as const;

const HARD_GATE_CONTRACTS: readonly JourneyContract[] = REQUIRED_MODALITIES.map(
  (modality) => {
    const contract = JOURNEY_CONTRACTS.find(
      (candidate) => candidate.modality === modality
    );
    if (!contract) {
      // Loud on purpose: dropping a modality from the shared contract table
      // must break the gate, never silently shrink it.
      throw new Error(
        `M-04 hard gate requires a ${modality} journey contract; JOURNEY_CONTRACTS carries ${JOURNEY_CONTRACTS.map(
          (candidate) => candidate.modality
        ).join('/')}`
      );
    }
    return contract;
  }
);

/** Neutral, category-naming intents — no identity entity, no borrowed brand. */
const INTENT_SEED: Record<JourneyContract['modality'], string> = {
  copy: '皮肤护理 朋友圈项目介绍',
  image_text: '皮肤护理 小红书套图',
  video: '为门店已确认的透亮猫眼项目制作抖音成片',
};

type SubmissionBody = {
  contentPackagePlatform?: string;
  distributionTarget?: string;
  deliverable?: { kind?: string; quantity?: number };
  catalogModel?: { id?: string; revision?: string };
  recipe?: { id?: string; revision?: string };
  creationMode?: string;
  intent?: string;
};

async function installLineageObservation(page: Page) {
  await page.evaluate(() => {
    const seen = new Set<string>();
    Object.defineProperty(window, '__m04LineageSeen', {
      configurable: true,
      value: seen,
    });
    const record = () => {
      for (const marker of document.body?.innerText.matchAll(
        /\bM04LINEAGE_[AB]_[A-Za-z0-9-]+\b/gu
      ) ?? []) {
        seen.add(marker[0]);
      }
    };
    new MutationObserver(record).observe(document, {
      characterData: true,
      childList: true,
      subtree: true,
    });
    window.addEventListener('DOMContentLoaded', record);
  });
}

async function markDocumentIdentity(page: Page) {
  return page.evaluate(() => {
    const identity = crypto.randomUUID();
    Object.defineProperty(window, '__m04DocumentIdentity', {
      configurable: true,
      value: identity,
    });
    return identity;
  });
}

async function navigateInCurrentDocument(
  page: Page,
  href: string,
  expectedDocumentIdentity: string
) {
  const expectedUrl = new URL(href, page.url()).href;
  await page.evaluate((nextHref) => {
    window.history.pushState({}, '', nextHref);
    window.dispatchEvent(
      new PopStateEvent('popstate', { state: window.history.state })
    );
  }, href);
  await expect(page).toHaveURL(expectedUrl, { timeout: 60_000 });
  await expect(page.getByTestId('result-center-shell')).toBeVisible({
    timeout: 120_000,
  });
  expect(
    await page.evaluate(
      () =>
        (
          window as Window & {
            __m04DocumentIdentity?: string;
          }
        ).__m04DocumentIdentity
    )
  ).toBe(expectedDocumentIdentity);
}

async function observedLineageMarkers(page: Page) {
  return page.evaluate(() =>
    Array.from(
      (
        window as Window & {
          __m04LineageSeen?: Set<string>;
        }
      ).__m04LineageSeen ?? []
    )
  );
}

async function assertRunningLineageToken(page: Page, marker: string) {
  const primary = page.locator(
    '[data-testid="copy-stream-slot"][data-role="primary"][data-has-token="true"]',
    { hasText: marker }
  );
  const runningStream = page.locator(
    '[data-testid="result-token-stream"][data-streaming="true"][data-has-first-token="true"]',
    { has: primary }
  );
  await expect(runningStream).toBeVisible({ timeout: 120_000 });
}

/**
 * Collect every body posted to the new seam. The count matters as much as the
 * content: refresh-restore re-subscribes, so a second POST would mean the
 * browser had grown a second submission truth (ADR-0014 红线).
 */
function captureSubmissions(page: Page) {
  const bodies: SubmissionBody[] = [];
  const listener = (request: Request) => {
    if (request.method() !== 'POST') return;
    if (!request.url().includes('/api/core/p1/composer/submissions')) return;
    try {
      bodies.push(request.postDataJSON() as SubmissionBody);
    } catch {
      bodies.push({});
    }
  };
  page.on('request', listener);
  return {
    only() {
      page.off('request', listener);
      expect(
        bodies.length,
        'the mainline posts exactly one submission per run — a refresh must re-subscribe, never resubmit'
      ).toBe(1);
      return bodies[0]!;
    },
  };
}

async function p1Query<T>(
  page: Page,
  module: string,
  action: string,
  payload: Record<string, unknown> = {}
) {
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

/**
 * Day-0「零前置表单」. Nothing may stand between a cold Composer and the submit
 * button: no onboarding bypass, no question wall, and no Brief confirmation
 * before the merchant has asked for anything.
 */
async function assertZeroBlockingBeforeSubmit(page: Page) {
  await expect(skipOnboardingButton(page)).toHaveCount(0);
  await expect(blockingQuestionLocator(page)).toHaveCount(0);
  await expect(briefConfirmButton(page)).toHaveCount(0);
  await expect(page.getByText('尚未完成可用性验证')).toHaveCount(0);
  await expect(page.getByText('保留原模型，但暂不可提交')).toHaveCount(0);
}

/**
 * Day-0「首 token」on the new seam — each modality held to the first substance
 * it actually produces, never to one borrowed from another.
 *
 * copy streams from the first usable token
 * (`src/product/results/result-token-stream.ts`), so the gate demands a real
 * partial while the run is still going — one final flash fails it.
 *
 * 图文 and 视频 do not emit `workflow.token` frames under the fixture 模型档
 * this gate runs. 视频 is an ADR-0010 long task; 图文 suspends on its direction
 * question and then delivers its pages as one 成品 card (measured: the run
 * reaches 成品已就绪 with `data-has-token` still `false`). Demanding a token
 * from either would be demanding something the product never emits, so their
 * first substance is asserted where it exists: 白话进度 below for both, and for
 * 图文 the two compiled directions plus the resumption its choice causes, in
 * `chooseImageTextDirection` — which the shared fixture runs before this hook.
 */
async function assertStreamingCandidate(page: Page, contract: JourneyContract) {
  const stageLines = page.getByTestId('composer-stage-line');
  await expect(
    stageLines.first(),
    '白话进度 must announce the run inside the conversation'
  ).toBeVisible({ timeout: 180_000 });
  expect(
    (await stageLines.allInnerTexts()).join('\n'),
    'stage announcements are merchant language, never engineering vocabulary'
  ).not.toMatch(/workflow|revision|schema|provider|store_fact:|catalogModel/iu);

  if (contract.modality !== 'copy') return;

  await expect(
    page.getByTestId('composer-candidate-stream'),
    'copy must show a real first token before the run finishes'
  ).toHaveAttribute('data-has-token', 'true', { timeout: 180_000 });
  await expect(page.getByTestId('composer-candidate-primary')).toHaveCount(1);
  expect(
    (await page.getByTestId('composer-candidate-primary').innerText()).trim()
      .length,
    'the streamed candidate must carry real text'
  ).toBeGreaterThan(0);
}

function assertActivationBudget(
  counter: UserActivationCounter,
  contract: JourneyContract
) {
  expect(
    counter.count(),
    `${contract.modality}: D-098 C6 expects exactly ${contract.expectedActivations} isTrusted activations to the first usable result; got ${counter.count()}: ${JSON.stringify(counter.events())}`
  ).toBe(contract.expectedActivations);
  expect(counter.events().every((event) => event.kind === 'click')).toBe(true);
  expect(
    counter.events().some((event) => event.targetLabel?.includes('暂时跳过'))
  ).toBe(false);
}

/**
 * 刷新恢复 ① — the interruption lands while the merchant is still in the
 * conversation. Restore is a re-subscribe on the same route: not a navigation,
 * and not a replay of a locally stored transcript.
 */
async function assertConversationRestored(page: Page, intent: string) {
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/u);
  await expect(page.getByTestId('composer-conversation')).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId('composer-turn-merchant')).toContainText(
    intent
  );
  // Whichever side of the run the interruption lands on, the replayed event log
  // must bring it back: its 白话进度 while it is still going, its 成品 once it
  // has finished. Demanding only the progress lines makes this a race — a 文案
  // run in the fixture 模型档 can deliver before the reload completes, and a
  // restored conversation replays a finished run as its result, not as a
  // transcript of announcements it has already left behind (OI-76).
  await expect(
    // `.first()` last, not on the left arm: a restored run that carries both a
    // progress line and its 成品 card — the ordinary case — resolves to two
    // elements otherwise, and strict mode rejects the whole locator.
    page
      .getByTestId('composer-stage-line')
      .or(page.getByTestId('composer-delivery-card'))
      .first(),
    'the replayed event log must bring back the run the browser never stored'
  ).toBeVisible({ timeout: 120_000 });
}

test.describe('M-04 required browser hard gate', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    test.setTimeout(180_000);
    await cleanupE2EUsers(request);
  });

  for (const contract of HARD_GATE_CONTRACTS) {
    test(`${contract.modality} → ${contract.deliveryTarget}: submit → stream → restore → adopt → deliver → restore`, async ({
      page,
      request,
    }) => {
      test.setTimeout(contract.modality === 'video' ? 600_000 : 420_000);

      const counter = await installUserActivationCounter(page);
      const user = await registerE2EUser(request);
      await loginByForm(page, user);
      await seedConfirmedStore(page);
      await page.goto('/dashboard');

      // 图文 and 视频 lead with recipes that require a real source — 小红书笔记
      // asks for a 案例图 (`case_image`), 抖音成片 for `case_media` — and the
      // submission gate refuses without one, which is the product being honest
      // rather than a test problem. Seed it through the Composer's own inline
      // authorization (the Day-0 composer path, never the library form), before
      // measurement begins so none of its clicks reach the budget.
      if (contract.modality !== 'copy') {
        await seedComposerInlineAuthorize(page);
      }

      // All three modalities discoverable on a cold Composer, none preselected.
      await assertThreeModalDiscovery(page);

      // Measurement starts after seed prep — prep activations are never counted.
      counter.beginMeasurement();
      await assertZeroBlockingBeforeSubmit(page);

      const intent = `M-04 ${INTENT_SEED[contract.modality]} ${crypto.randomUUID()}`;
      const submissions = captureSubmissions(page);

      const workId = await submitComposerJourney(page, contract, intent, {
        async onRunStreaming() {
          // Freeze first: after this point no click — including the recovery
          // reload's — can be laundered into the Day-0 budget.
          counter.stop();
          await assertStreamingCandidate(page, contract);
          assertActivationBudget(counter, contract);
          await assertConversationRestored(page, intent);
        },
      });

      // T08 双字段合同: one merchant answer, two server-side fields, and the
      // package that lands is the platform the body asked for.
      const body = submissions.only();
      expect(body.contentPackagePlatform).toBe(contract.deliveryTarget);
      expect(body.distributionTarget).toBeTruthy();
      expect(body.deliverable?.kind).toBeTruthy();
      expect(body.catalogModel?.id).toBeTruthy();
      expect(body.catalogModel?.revision).toBeTruthy();
      expect(body.recipe?.revision).toBeTruthy();
      expect(body.intent).toContain(INTENT_SEED[contract.modality]);

      await waitForResultJourney(page, contract, workId);

      // D-111 / M-03 中性口吻: this tenant never registered an identity, so the
      // journey must have delivered without borrowing one.
      expect(
        await p1Query<unknown[]>(
          page,
          'marketing-identity',
          'marketing_identities',
          { includeInactive: true }
        )
      ).toEqual([]);

      await adoptResult(page, contract);
      await openDeliveryPanel(page, contract.modality);
      await downloadFullPackage(page, contract);

      await assertJourneyRestored(page, contract, workId);
    });
  }

  test('English stale Brief explains the invalidated decision and blocks confirmation', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);
    await page.goto('/en/dashboard');

    const state = await productState(page);
    const activeFacts = await p1Query<Array<{ kind?: string }>>(
      page,
      'context',
      'store_facts_active',
      {
        at: new Date().toISOString(),
        scope: { storeId: state.workspaceId },
      }
    );
    expect(
      new Set(activeFacts.map((fact) => fact.kind)),
      'the journey may proceed only after the service and price facts are active'
    ).toEqual(new Set(['service', 'price']));

    const copyCatalog = await p1Query<{
      models: Array<{ available?: boolean; id?: string; unitPrice?: unknown }>;
    }>(page, 'model-supply', 'catalog', { operation: 'copy.generate' });
    expect(
      copyCatalog.models.find((model) => model.id === 'deepseek-v4-pro'),
      'the credential-free fixture catalog must produce the copy model this browser journey quotes'
    ).toMatchObject({
      available: true,
      unitPrice: expect.anything(),
    });

    const copyLens = page.getByTestId('composer-lens-option-copy');
    await copyLens.click();
    await expect(copyLens).toBeChecked();
    const intent = page.getByTestId('composer-intent-input');
    await intent.fill(`皮肤护理 朋友圈团购项目介绍 ${crypto.randomUUID()}`);
    await expect(page.getByTestId('composer-quote-line')).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId('composer-submit').click();

    const brief = page.getByTestId('composer-brief-surface');
    await expect(brief).toBeVisible({ timeout: 60_000 });
    await intent.fill('把新团购改成只发朋友圈的短文案');

    const notice = brief.getByTestId('composer-brief-stale');
    await expect(notice).toHaveText(
      'Your brief no longer matches what you just changed. Go back, then submit it again.'
    );
    await expect(notice).not.toContainText(/[\u3400-\u9fff]/u);
    await expect(brief.getByTestId('composer-brief-confirm')).toBeDisabled();
  });

  test('workId-only Result route reopens a running copy and reconnects its canonical workflow', async ({
    page,
    request,
  }) => {
    test.setTimeout(420_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);
    await page.goto('/dashboard');
    await assertThreeModalDiscovery(page);

    const marker = `M04LINEAGE_A_${crypto.randomUUID()}`;
    const resultPage = await page.context().newPage();
    await resultPage.goto('/dashboard');
    await submitComposerJourney(
      page,
      HARD_GATE_CONTRACTS.find(({ modality }) => modality === 'copy')!,
      `皮肤护理 朋友圈项目介绍 ${marker}`,
      {
        async onSubmissionAccepted({ workId }) {
          await resultPage.goto(`/dashboard/results/${workId}`);
        },
        async onRunStreaming() {
          await assertRunningLineageToken(resultPage, marker);
          await expect(resultPage).not.toHaveURL(/taskId=/u);
          await resultPage.close();
        },
      }
    );
  });

  test('a stale URL taskId never projects another workflow token into the authoritative Work Result', async ({
    page,
    request,
  }) => {
    test.setTimeout(600_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);
    await page.goto('/dashboard');
    await assertThreeModalDiscovery(page);
    const copyContract = HARD_GATE_CONTRACTS.find(
      ({ modality }) => modality === 'copy'
    )!;

    const wrongMarker = `M04LINEAGE_B_${crypto.randomUUID()}`;
    let wrong: { taskId: string; workId: string } | undefined;
    await submitComposerJourney(
      page,
      copyContract,
      `皮肤护理 朋友圈错误来源 ${wrongMarker}`,
      {
        onSubmissionAccepted(submission) {
          wrong = submission;
        },
      }
    );
    expect(wrong).toBeTruthy();

    const resultPage = await page.context().newPage();
    await resultPage.goto('/dashboard/works');
    await expect(resultPage.getByTestId('works-list')).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      resultPage.getByText(wrongMarker, { exact: false }).first()
    ).toBeVisible({ timeout: 60_000 });
    const documentIdentity = await markDocumentIdentity(resultPage);

    const composerPage = await page.context().newPage();
    await composerPage.goto('/dashboard');
    await assertThreeModalDiscovery(composerPage);
    const authoritativeMarker = `M04LINEAGE_A_${crypto.randomUUID()}`;
    await expect(
      resultPage.getByText(authoritativeMarker, { exact: false })
    ).toHaveCount(0);
    const eventRequests: string[] = [];
    const captureEventRequest = (request: Request) => {
      if (request.url().includes('/events')) {
        eventRequests.push(request.url());
      }
    };
    resultPage.on('request', captureEventRequest);
    let authoritativeTaskId = '';
    await submitComposerJourney(
      composerPage,
      copyContract,
      `皮肤护理 朋友圈权威来源 ${authoritativeMarker}`,
      {
        async onSubmissionAccepted(authoritative) {
          authoritativeTaskId = authoritative.taskId;
          await navigateInCurrentDocument(
            resultPage,
            `/dashboard/results/${authoritative.workId}?taskId=${wrong!.taskId}`,
            documentIdentity
          );
          // Install after leaving the works list so residual LINEAGE_B text from
          // the prior wrong submission is not recorded as a stream leak.
          await installLineageObservation(resultPage);
        },
        async onRunStreaming() {
          await assertRunningLineageToken(resultPage, authoritativeMarker);
          resultPage.off('request', captureEventRequest);
          expect(
            eventRequests.some((url) =>
              url.includes(
                `/workflows/${encodeURIComponent(authoritativeTaskId)}/events`
              )
            )
          ).toBe(true);
          expect(
            eventRequests.some((url) =>
              url.includes(
                `/workflows/${encodeURIComponent(wrong!.taskId)}/events`
              )
            )
          ).toBe(false);
          expect(await observedLineageMarkers(resultPage)).not.toContain(
            wrongMarker
          );
          await expect(
            resultPage.getByText(wrongMarker, { exact: false })
          ).toHaveCount(0);
          await resultPage.close();
        },
      }
    );
    await composerPage.close();
  });
});
