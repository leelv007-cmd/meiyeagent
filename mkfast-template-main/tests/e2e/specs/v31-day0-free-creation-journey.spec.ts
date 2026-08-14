/**
 * V31-07 Day-0 自由创作 journey (§37.4-A, write-only; master runs with lane
 * ports).
 *
 * Ticket promise: Day-0 零门店商家可达安全通用结果 (Playwright §37.4-A).
 * D-175: free creation must not be blocked by missing confirmed_store /
 * project facts — the fixture proves the honest bound both ways:
 * - a zero-store merchant switches the Composer to 自由创作 entry
 * - submits a free creation and receives a usable generic result
 * - the result contains no fabricated store facts (the seed store was never
 *   confirmed; its name/project/address must not appear anywhere)
 *
 * Sequence under test (the real one, verified in Core):
 * `POST /p1/composer/submissions` runs the Agent Session Intent turn before the
 * PlanCompiler, and pure copy is the **only** approval exemption
 * (`approvalBasisForSubmission` → `policy_exempt_copy`,
 * `apps/core/src/p1/agent-session/composer-plan-session.ts`). So this journey —
 * and only this journey — may answer `makeReady: true` and start Make without
 * any merchant decision: no execution-confirmation card, and no explicit
 * `tasks/:taskId/start` command. Both of those absences are asserted, because
 * "copy is exempt" is a claim about what does NOT happen.
 *
 * Real Core session end to end (Web → Core → Harness; only the model boundary
 * is fixture mode). No mocks on the critical chain, no conditional assertions,
 * no test.skip/fixme.
 */
import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { productState } from '../fixtures/product';
import {
  closeComposerCapsule,
  openComposerCapsule,
  selectComposerLens,
} from '../fixtures/ui-journey';

const NEVER_SEEDED_STORE_FACTS = ['E2E 美业门店', '透亮猫眼', '湖墅南路'];

const FREE_INTENT =
  '帮我的美容工作室写一条克制的开业文案，先不写具体项目和价格';

/**
 * Free/copy submit may open the Brief surface first when high-risk wording
 * (e.g. 「价格」) is in the intent. Confirm is not execution confirmation and
 * not an explicit start — it is the progressive fact/brief seal that then
 * POSTs `/composer/submissions`. Same settle pattern as Level-1.
 */
async function settleFreeSubmission(
  page: Page,
  responsePromise: ReturnType<Page['waitForResponse']>
) {
  await expect(page.getByRole('button', { name: '确认并开始' })).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: '确认本次创作' })
  ).toHaveCount(0);
  return responsePromise;
}

async function operationsQuery<T>(
  page: Page,
  action: string,
  payload: Record<string, unknown> = {}
) {
  return page.evaluate(
    async ({ queryAction, queryPayload }) => {
      const response = await fetch('/api/core/p1/query', {
        body: JSON.stringify({
          action: queryAction,
          module: 'operations',
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
          envelope.error?.message ?? `operations.${queryAction} query failed`
        );
      }
      return envelope.data as T;
    },
    { queryAction: action, queryPayload: payload }
  );
}

test.describe('V31-07 Day-0 自由创作 (§37.4-A)', () => {
  test.afterEach(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('零门店商家 free 模式提交自由创作，得到不带虚构门店事实的通用结果', async ({
    page,
    request,
  }) => {
    test.setTimeout(360_000);
    await page.setViewportSize({ width: 1440, height: 900 });

    // Zero-store merchant: intentionally NO seedConfirmedStore.
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await page.goto('/dashboard');

    // Copy is exempt from the merchant decision, which is a statement about
    // requests that never happen — so record them from the first navigation on.
    const explicitStartRequests: string[] = [];
    page.on('request', (candidate) => {
      if (
        candidate.method() === 'POST' &&
        /\/api\/core\/p1\/composer\/tasks\/[^/]+\/start$/u.test(candidate.url())
      ) {
        explicitStartRequests.push(candidate.url());
      }
    });

    // Honest precondition: the merchant really has no store (V31-51:
    // projection must encode absence as explicit null, not omit the key).
    const initial = await productState(page);
    expect(initial.workspaceId, 'projection must have run').toBeTruthy();
    expect(Object.hasOwn(initial, 'store')).toBe(true);
    expect(initial.store).toBeNull();

    // D-111 双入口 → 自由创作 (free mode; the server decides the route).
    const modeHost = page.getByTestId('composer-creation-mode-host');
    await expect(modeHost).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('composer-creation-mode-free').click();
    await expect(page.getByTestId('creation-mode-surface')).toHaveAttribute(
      'data-creation-mode',
      'free'
    );
    await expect(
      page.getByTestId('composer-free-creation-panel')
    ).toBeVisible();

    // 输出类型 stays in the bottom capsule in both modes (spec 2.4).
    await selectComposerLens(page, 'copy');

    // Free mode pins the generation model explicitly. The select leads with a
    // 「选择模型」 placeholder whose value is empty, so picking the first option
    // by label pins nothing at all — the pinned model is the first option that
    // carries a real catalog id, and the select must end up holding it.
    const modelSelect = page.getByTestId('composer-free-model-select');
    await expect(modelSelect).toBeEnabled({ timeout: 30_000 });
    await modelSelect.click();
    const firstRealModel = page.getByRole('option').first();
    await expect(
      firstRealModel,
      'free mode must offer at least one selectable model'
    ).toBeVisible();
    const pinnedModelId =
      (await firstRealModel.getAttribute('data-model-id')) ?? '';
    expect(pinnedModelId.length).toBeGreaterThan(0);
    await firstRealModel.click();
    await expect(
      modelSelect,
      'the pinned model must survive the selection'
    ).toHaveAttribute('data-selected-model', pinnedModelId);

    // 提交自由创作 — a generic intent that claims no store facts.
    const intentInput = page.getByTestId('composer-intent-input');
    await intentInput.fill(FREE_INTENT);
    await expect(intentInput).toHaveValue(FREE_INTENT);

    // 目的地明确为小红书(避免 destination 澄清打断自由创作路径)。文案 lens pins
    // 朋友圈 as its default, so 小红书 starts unpressed and this really is one
    // merchant choice — these chips toggle, so the state is asserted on both
    // sides of the click instead of guarded by a conditional.
    const destinationPanel = await openComposerCapsule(page, 'destination');
    const destination = page.getByTestId(
      'composer-destination-option-xiaohongshu'
    );
    await expect(destination).toHaveAttribute('aria-pressed', 'false');
    await destination.click();
    await expect(destination).toHaveAttribute('aria-pressed', 'true');
    await closeComposerCapsule(page, destinationPanel);

    await expect(page.getByTestId('composer-quote-line')).toBeVisible({
      timeout: 60_000,
    });
    // D-175: no store/project grounding blocker on the free path.
    await expect(page.getByTestId('composer-grounding-blocker')).toHaveCount(0);

    const submit = page.getByTestId('composer-submit');
    await expect(
      submit,
      'the free composer must be ready to submit before the journey clicks send'
    ).toBeEnabled({ timeout: 60_000 });
    const submissionResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/core/p1/composer/submissions'),
      { timeout: 180_000 }
    );
    await submit.click();
    // Intent mentions 「价格」→ Brief high-risk fact gate may open first.
    // Merchant confirms on 「确认并开始」, which then POSTs submissions.
    const submissionResponse = await settleFreeSubmission(
      page,
      submissionResponsePromise
    );
    const submissionText = await submissionResponse.text();
    const submissionBody = JSON.parse(submissionText) as {
      data?: {
        contentPackage?: { id?: string };
        makeReady?: boolean;
        runId?: string;
        task?: { id?: string };
        threadId?: string;
        work?: { id?: string };
      };
      error?: { message?: string };
    };
    expect(submissionResponse.status(), submissionBody.error?.message).toBe(
      202
    );
    const packageId = submissionBody.data?.contentPackage?.id ?? '';
    const workId = submissionBody.data?.work?.id ?? '';
    expect(packageId.length, `body=${submissionText}`).toBeGreaterThan(0);
    expect(workId.length, `body=${submissionText}`).toBeGreaterThan(0);
    expect(
      (submissionBody.data?.task?.id ?? '').length,
      `body=${submissionText}`
    ).toBeGreaterThan(0);
    expect(
      (submissionBody.data?.threadId ?? '').length,
      'the Intent turn must bind a durable Agent Thread'
    ).toBeGreaterThan(0);
    expect(
      (submissionBody.data?.runId ?? '').length,
      'the Intent turn must bind a durable Agent Run'
    ).toBeGreaterThan(0);
    // Pure copy is the only policy exemption: the Session still ran and
    // returned durable handles, while Make was admitted inside this one request
    // instead of waiting for an explicit start.
    expect(
      submissionBody.data?.makeReady,
      'policy_exempt_copy must admit Make on submit'
    ).toBe(true);

    // ADR-0014: stays in the conversation; first usable token streams. The
    // token lives on the candidate stream itself, so the element is named
    // rather than matched by the attribute under assertion.
    await expect(page).not.toHaveURL(/\/dashboard\/results\//u);
    const candidateStream = page.getByTestId('composer-candidate-stream');
    await expect(candidateStream).toHaveAttribute('data-has-token', 'true', {
      timeout: 90_000,
    });
    await expect(page.getByTestId('composer-candidate-primary')).toBeVisible();

    // 交付卡到达 → 安全通用结果存在。
    const deliveryCard = page.locator(
      `[data-testid="composer-delivery-card"][data-work-id="${workId}"]`
    );
    await expect(deliveryCard).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('agent-workstream')).toHaveAttribute(
      'data-delivered',
      'true',
      { timeout: 60_000 }
    );

    // The exemption, stated as the two things that must never have happened:
    // no execution-confirmation decision was asked for, and no explicit start
    // command was issued — yet the run delivered.
    await expect(
      page.getByTestId('execution-confirmation-interaction-card'),
      'pure copy must reach delivery without a merchant execution decision'
    ).toHaveCount(0);
    expect(
      explicitStartRequests,
      'policy_exempt_copy must not need the explicit plan start command'
    ).toEqual([]);

    // 通用结果内容 = 非空、且不含任何虚构门店事实(从未种过门店)。
    const packages = await operationsQuery<
      Array<{
        id: string;
        versions?: Array<{
          body?: string;
          title?: string;
          topics?: string[];
        }>;
      }>
    >(page, 'content_packages', {});
    expect(
      packages.map((entry) => entry.id),
      'the free-creation ContentPackage must be listed'
    ).toContain(packageId);
    const matched = packages.find((entry) => entry.id === packageId)!;
    const versionText = [
      matched.versions?.[0]?.title ?? '',
      matched.versions?.[0]?.body ?? '',
      ...(matched.versions?.[0]?.topics ?? []),
    ]
      .join('\n')
      .trim();
    expect(versionText.length).toBeGreaterThan(0);
    for (const fabricated of NEVER_SEEDED_STORE_FACTS) {
      expect(
        versionText,
        `must not fabricate store fact ${fabricated}`
      ).not.toContain(fabricated);
    }

    // 商家眼前的过程与候选同样不得虚构门店事实。The whole conversation is the
    // subject: the candidate card collapses into a summary capsule once the
    // delivery turn lands (`candidateShouldCollapse`), so asserting on the
    // conversation covers the streamed copy, the collapsed capsule and the
    // delivery statement rather than whichever one happens to be mounted.
    const conversation = page.getByTestId('composer-conversation');
    await expect(conversation).toBeVisible();
    for (const fabricated of NEVER_SEEDED_STORE_FACTS) {
      await expect(
        conversation,
        `the conversation must not fabricate store fact ${fabricated}`
      ).not.toContainText(fabricated);
    }
  });
});
