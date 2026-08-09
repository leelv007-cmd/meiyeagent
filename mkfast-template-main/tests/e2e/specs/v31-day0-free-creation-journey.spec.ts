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
import { firstTokenLocator } from '../fixtures/user-activation';

const NEVER_SEEDED_STORE_FACTS = ['E2E 美业门店', '透亮猫眼', '湖墅南路'];

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

    // Honest precondition: the merchant really has no store.
    const initial = await productState(page);
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

    // Free mode pins the generation model explicitly.
    const modelSelect = page.getByTestId('composer-free-model-select');
    await expect(modelSelect).toBeEnabled({ timeout: 30_000 });
    const modelOptions = await modelSelect.locator('option').allTextContents();
    const firstModel = modelOptions.find((label) => label.trim().length > 0);
    expect(firstModel, 'free mode must offer at least one model').toBeTruthy();
    await modelSelect.selectOption({ label: firstModel });

    // 提交自由创作 — a generic intent that claims no store facts.
    const intentInput = page.getByTestId('composer-intent-input');
    await intentInput.fill(
      '帮我的美容工作室写一条克制的开业文案，先不写具体项目和价格'
    );
    await expect(intentInput).toHaveValue(
      '帮我的美容工作室写一条克制的开业文案，先不写具体项目和价格'
    );

    // 目的地明确为小红书(避免 destination 澄清打断自由创作路径)。
    const destinationPanel = await openComposerCapsule(page, 'destination');
    const destination = page.getByTestId(
      'composer-destination-option-xiaohongshu'
    );
    if ((await destination.getAttribute('aria-pressed')) !== 'true') {
      await destination.click();
    }
    await closeComposerCapsule(page, destinationPanel);

    await expect(page.getByTestId('composer-quote-line')).toBeVisible({
      timeout: 60_000,
    });
    // D-175: no store/project grounding blocker on the free path.
    await expect(page.getByTestId('composer-grounding-blocker')).toHaveCount(0);

    const submissionResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/core/p1/composer/submissions'),
      { timeout: 120_000 }
    );
    await page.getByTestId('composer-submit').click();
    const submissionResponse = await submissionResponsePromise;
    const submissionBody = JSON.parse(await submissionResponse.text()) as {
      data?: {
        contentPackage?: { id?: string };
        makeReady?: boolean;
        runId?: string;
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
    expect(packageId).toBeTruthy();
    expect(workId).toBeTruthy();
    expect(submissionBody.data?.threadId).toBeTruthy();
    expect(submissionBody.data?.runId).toBeTruthy();
    expect(submissionBody.data?.makeReady).toBe(true);

    // Pure copy is the only policy exemption: Session still ran and returned
    // durable handles, while Make was admitted without an extra start request.

    // ADR-0014: stays in the conversation; first usable token streams.
    await expect(page).not.toHaveURL(/\/dashboard\/results\//u);
    await expect(firstTokenLocator(page)).toHaveAttribute(
      'data-has-token',
      'true',
      { timeout: 90_000 }
    );
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
    const matched = packages.find((entry) => entry.id === packageId);
    expect(
      matched,
      'the free-creation ContentPackage must be listed'
    ).toBeTruthy();
    const versionText = [
      matched!.versions?.[0]?.title ?? '',
      matched!.versions?.[0]?.body ?? '',
      ...(matched!.versions?.[0]?.topics ?? []),
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

    // 候选正文同样不得虚构门店事实。
    const candidateText = await page
      .getByTestId('composer-candidate-primary')
      .innerText();
    for (const fabricated of NEVER_SEEDED_STORE_FACTS) {
      expect(candidateText).not.toContain(fabricated);
    }
  });
});
