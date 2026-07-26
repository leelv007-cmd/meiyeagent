import { expect, test, type Page, type Request } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import {
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
  video: '皮肤护理 抖音项目成片',
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
 * Day-0「首 token」on the new seam.
 *
 * copy and image_text both stream from the first usable token
 * (`src/product/results/result-token-stream.ts`), so the gate demands a real
 * partial while the run is still going — one final flash fails it. Video is an
 * ADR-0010 long task with no token stream, so its first observable signal is
 * the 白话进度 announcement; demanding a token there would be demanding
 * something the product never emits.
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

  if (contract.modality === 'video') return;

  await expect(
    page.getByTestId('composer-candidate-stream'),
    'copy / image_text must show a real first token before the run finishes'
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
  await expect(
    page.getByTestId('composer-stage-line').first(),
    'the replayed event log must bring back progress the browser never stored'
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
});
