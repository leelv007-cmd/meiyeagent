import { expect, test, type Page } from '@playwright/test';
import type { ProductState } from '@meiye/contracts';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { setTheme, type ThemeMode } from '../fixtures/page-health';
import { seedConfirmedStore } from '../fixtures/product';
import {
  adoptResult,
  downloadFullPackage,
  JOURNEY_CONTRACTS,
  openDeliveryPanel,
  waitForResultJourney,
} from '../fixtures/ui-journey';

/**
 * D-126 Dashboard home mount (issue #223).
 *
 * Cold: three platform-maintained sample stores; clicking a sample task runs
 * the real chain, spends the real trial allowance and produces an exportable
 * artifact (D-128 — no demo-only path). Hot: one recommendation a day whose
 * CTA prefills the Composer draft.
 */

const COPY_CONTRACT = JOURNEY_CONTRACTS[0]!;

type UsageBucket = { allowance: number; remaining: number };
type EntitlementProjection = {
  plan?: { tier?: string };
  usage: Record<string, UsageBucket | undefined>;
};

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

async function productState(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/core/product/state', {
      credentials: 'same-origin',
    });
    const envelope = (await response.json()) as {
      data?: ProductState;
      error?: { message: string };
    };
    if (!response.ok || !envelope.data) {
      throw new Error(envelope.error?.message ?? 'Product state failed');
    }
    return envelope.data;
  });
}

async function creativeWorkbench(page: Page) {
  return p1Query<{
    assets: Array<{ id: string }>;
    contents: Array<{ id: string }>;
    jobs: Array<{ id: string }>;
    works: Array<{ id: string }>;
  }>(page, 'operations', 'creative_workbench');
}

async function operationsCommand<T>(
  page: Page,
  action: string,
  payload: Record<string, unknown>
) {
  return page.evaluate(
    async ({ commandAction, commandPayload }) => {
      const response = await fetch('/api/core/p1/commands', {
        body: JSON.stringify({
          action: commandAction,
          module: 'operations',
          payload: commandPayload,
        }),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `t29-${commandAction}-${crypto.randomUUID()}`,
        },
        method: 'POST',
      });
      const envelope = (await response.json()) as {
        data?: unknown;
        error?: { message?: string };
      };
      if (!response.ok || envelope.data === undefined) {
        throw new Error(envelope.error?.message ?? `${commandAction} failed`);
      }
      return envelope.data;
    },
    { commandAction: action, commandPayload: payload }
  ) as Promise<T>;
}

/** Drives the real five-stage harness — no route stubbing anywhere. */
async function submitHarnessTask(
  page: Page,
  input: { packageId: string; taskId: string }
) {
  await page.evaluate(async ({ packageId, taskId }) => {
    const rawInput = '把本周护理项目做成一条可以发的小红书文案';
    const response = await fetch('/api/core/p1/harness/tasks', {
      body: JSON.stringify({
        taskId,
        packageId,
        expectedRevision: 0,
        workflowRevision: 1,
        rawInput,
        intent: {
          context: {
            workId: `work-${taskId}`,
            intent: rawInput,
            sourceSummaries: [],
          },
          assetReferences: [],
        },
      }),
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': taskId,
      },
      method: 'POST',
    });
    if (!response.ok) {
      const envelope = (await response.json()) as {
        error?: { message: string };
      };
      throw new Error(envelope.error?.message ?? 'Harness submission failed');
    }
  }, input);
}

type HarnessQuestion = {
  questionId: string;
  workflowRevision: number;
  response: { field: string; reason: string };
};

async function pendingQuestion(page: Page, taskId: string) {
  return page.evaluate(async (currentTaskId) => {
    const response = await fetch(
      `/api/core/p1/harness/tasks/${encodeURIComponent(currentTaskId)}/decision`,
      { credentials: 'same-origin' }
    );
    const envelope = (await response.json()) as {
      data?: { question: HarnessQuestion | null };
    };
    return response.ok ? (envelope.data?.question ?? null) : null;
  }, taskId) as Promise<HarnessQuestion | null>;
}

/** Answers every server-owned question until the task stops asking. */
async function answerHarnessQuestions(page: Page, taskId: string) {
  for (let round = 0; round < 6; round += 1) {
    let question: HarnessQuestion | null = null;
    await expect
      .poll(
        async () => {
          question = await pendingQuestion(page, taskId);
          return question !== null || round > 0;
        },
        { timeout: 90_000 }
      )
      .toBe(true);
    if (!question) return;
    await page.evaluate(
      async ({ currentQuestion, currentTaskId }) => {
        const value = '299 元';
        const key = `t29-recommendation:${currentQuestion.questionId}`;
        const response = await fetch(
          `/api/core/p1/harness/tasks/${encodeURIComponent(currentTaskId)}/decision`,
          {
            body: JSON.stringify({
              idempotencyKey: key,
              questionId: currentQuestion.questionId,
              workflowRevision: currentQuestion.workflowRevision,
              patch: {
                field: currentQuestion.response.field,
                value,
                reason: currentQuestion.response.reason,
              },
              decision: { state: 'accepted', value },
            }),
            credentials: 'same-origin',
            headers: {
              'content-type': 'application/json',
              'idempotency-key': key,
            },
            method: 'POST',
          }
        );
        if (!response.ok) {
          const envelope = (await response.json()) as {
            error?: { message: string };
          };
          throw new Error(envelope.error?.message ?? 'Harness answer failed');
        }
      },
      { currentQuestion: question, currentTaskId: taskId }
    );
  }
}

async function readTodayRecommendation(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/core/p1/harness/recommendation', {
      credentials: 'same-origin',
    });
    const envelope = (await response.json()) as {
      data?: { recommendation: Record<string, unknown> | null };
    };
    return response.ok ? (envelope.data?.recommendation ?? null) : null;
  });
}

async function revealExampleStores(page: Page) {
  await page.getByRole('button', { name: '查看示例' }).click();
  const showcase = page.getByTestId('example-store-showcase');
  await expect(showcase).toBeVisible();
  return showcase;
}

async function submitPrefilledCopy(page: Page) {
  const lens = page.getByTestId('composer-lens-option-copy');
  await lens.click();
  await expect(lens).toBeChecked();
  await expect(page.getByTestId('composer-quote-line')).toBeVisible({
    timeout: 30_000,
  });
  const submissionResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/core/p1/composer/submissions'),
    { timeout: 120_000 }
  );
  await page.getByTestId('composer-submit').click();
  const response = await submissionResponse;
  const body = (await response.json()) as {
    data?: { work?: { id?: string } };
    error?: { message?: string };
  };
  expect(
    response.ok(),
    body.error?.message ?? 'Sample task submission failed'
  ).toBeTruthy();
  const workId = body.data?.work?.id;
  expect(workId, 'sample task must create a real work').toBeTruthy();
  return workId!;
}

test.describe('D-126 dashboard home mount', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    test.setTimeout(180_000);
    await cleanupE2EUsers(request);
  });

  test('cold tenant sees three sample stores and runs a sample task on the real chain', async ({
    page,
    request,
  }) => {
    test.setTimeout(360_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    // --- Cold home ------------------------------------------------------
    await expect(page.getByTestId('dashboard-home-surface')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: '今天值得发什么' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {
        level: 3,
        name: '还没有基于本店事实的推荐',
      })
    ).toBeVisible();

    const showcase = await revealExampleStores(page);
    const stores = (await productState(page)).exampleStores;
    expect(stores.map((store) => store.industry)).toEqual([
      'hair_care',
      'skin_management',
      'hair_growth',
    ]);
    for (const label of ['护发', '皮肤管理', '生发']) {
      await expect(
        showcase.getByRole('radio', { name: label })
      ).toBeVisible();
    }
    const sampleStore = stores[0]!;
    const sampleRegion = page.getByRole('region', { name: sampleStore.name });
    await expect(sampleRegion).toBeVisible();
    // 商家点开示例作品即理解产品产出：档案、事实、素材、作品都在场。
    await expect(
      sampleRegion.getByText(sampleStore.profile.project)
    ).toBeVisible();
    for (const fact of sampleStore.facts) {
      await expect(sampleRegion.getByText(fact.value)).toBeVisible();
    }
    for (const content of sampleStore.contentPreviews) {
      await expect(sampleRegion.getByText(content.title)).toBeVisible();
    }

    // --- Trial allowance before the sample task -------------------------
    const before = await p1Query<EntitlementProjection>(
      page,
      'entitlements',
      'projection'
    );
    expect(before.plan?.tier).toBe('trial');
    expect({
      copy: before.usage.copy?.allowance,
      image: before.usage.image?.allowance,
      video: before.usage.video?.allowance,
    }).toEqual({ copy: 5, image: 5, video: 1 });
    const copyRemainingBefore = before.usage.copy!.remaining;

    // --- Sample task prefills the Composer, then runs for real ----------
    await sampleRegion.getByRole('button', { name: '复用这条结构' }).click();
    const intentInput = page.getByTestId('composer-intent-input');
    await expect(intentInput).toBeFocused();
    const prefilled = await intentInput.inputValue();
    expect(prefilled.length).toBeGreaterThan(10);

    const workId = await submitPrefilledCopy(page);
    await waitForResultJourney(page, COPY_CONTRACT, workId);

    // 试用额度余量减少 —— the sample task spends the real trial allowance.
    await expect
      .poll(
        async () => {
          const after = await p1Query<EntitlementProjection>(
            page,
            'entitlements',
            'projection'
          );
          return after.usage.copy?.remaining ?? copyRemainingBefore;
        },
        { timeout: 60_000 }
      )
      .toBeLessThan(copyRemainingBefore);

    // 产物可导出 —— identical to a paying merchant's export path.
    await adoptResult(page, COPY_CONTRACT);
    await openDeliveryPanel(page, COPY_CONTRACT.modality);
    await downloadFullPackage(page, COPY_CONTRACT);
  });

  test('platform_sample material never reaches the merchant workspace', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await revealExampleStores(page);

    const stores = (await productState(page)).exampleStores;
    const sampleIds = new Set(
      stores.flatMap((store) => [
        store.id,
        ...store.facts.map((fact) => fact.id),
        ...store.assetPreviews.map((asset) => asset.id),
        ...store.contentPreviews.map((content) => content.id),
        store.handoffPreview.id,
      ])
    );
    expect(sampleIds.size).toBeGreaterThan(0);
    expect(
      [...sampleIds].every((id) => id.startsWith('platform-sample:'))
    ).toBe(true);

    // Positive control: give the merchant real assets of their own.
    await seedConfirmedStore(page);
    await page.reload();
    const state = await productState(page);
    const ownProjectNames = (state.store?.projects ?? []).map(
      (project) => project.name
    );
    expect(
      ownProjectNames.length,
      'positive control needs the merchant own facts present'
    ).toBeGreaterThan(0);

    // Absence: no sample id shows up in any merchant-facing projection.
    const workspaceIds = [
      ...state.assets.map((asset) => asset.id),
      ...state.contents.map((content) => content.id),
      ...state.handoffPackages.map((handoff) => handoff.id),
    ];
    const workbench = await creativeWorkbench(page);
    const projectionIds = [
      ...workspaceIds,
      ...workbench.assets.map((asset) => asset.id),
      ...workbench.contents.map((content) => content.id),
      ...workbench.works.map((work) => work.id),
      ...workbench.jobs.map((job) => job.id),
    ];
    for (const id of projectionIds) {
      expect(sampleIds.has(id), `${id} leaked into the merchant workspace`).toBe(
        false
      );
      expect(id.startsWith('platform-sample:')).toBe(false);
    }

    // A workspace with real facts stops offering the samples altogether.
    await expect(page.getByTestId('example-store-showcase')).toBeHidden();
  });

  test('hot tenant gets one recommendation whose CTA prefills the Composer', async ({
    page,
    request,
  }) => {
    test.setTimeout(420_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    // Confirmed facts first: the recommendation is only "grounded" when the
    // delivered task's context trace matches the current fact revision.
    await seedConfirmedStore(page);
    await page.goto('/dashboard');

    // Drive the real five-stage harness to a delivered package.
    const taskId = `t29-recommendation-${crypto.randomUUID()}`;
    const contentPackage = await operationsCommand<{ id: string }>(
      page,
      'create_content_package',
      { kind: 'image_text', source: { assetIds: [] } }
    );
    await submitHarnessTask(page, { packageId: contentPackage.id, taskId });
    await answerHarnessQuestions(page, taskId);
    await expect
      .poll(() => readTodayRecommendation(page), { timeout: 180_000 })
      .not.toBeNull();

    await page.goto('/dashboard');
    const card = page.getByTestId('today-recommendation');
    await expect(card).toBeVisible();

    // 三要素齐全：为什么今天适合发 / 用了本店什么 / 希望顾客做什么。
    await expect(card.getByText('为什么适合现在')).toBeVisible();
    await expect(card.getByText('用了本店什么')).toBeVisible();
    await expect(card.getByText('希望顾客做什么')).toBeVisible();
    // D-116: the merchant reads a count, never a store_fact: id.
    await expect(card.getByText(/本店 \d+ 条已确认事实/u)).toBeVisible();
    await expect(card.getByText(/store_fact:/u)).toHaveCount(0);
    // Hot workspace: the cold sample showcase is gone for good.
    await expect(page.getByTestId('example-store-showcase')).toBeHidden();
    await expect(page.getByRole('button', { name: '查看示例' })).toHaveCount(0);

    await card.getByTestId('today-recommendation-use').click();
    const intentInput = page.getByTestId('composer-intent-input');
    await expect(intentInput).toBeFocused();
    await expect(intentInput).toHaveValue(/按今天的主推荐写一条内容/u);
    // CTA→prefill：留在首页，不跳设置页，也不自动提交。
    await expect(page).toHaveURL(/\/dashboard(?:\?|$)/u);
    await expect(page.getByTestId('composer-submit')).toBeEnabled();
  });

  for (const theme of ['light', 'dark'] as const satisfies readonly ThemeMode[]) {
    test(`cold home renders on mobile in the ${theme} theme`, async ({
      page,
      request,
    }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: 375, height: 812 });
      await setTheme(page, theme);
      const user = await registerE2EUser(request);
      await loginByForm(page, user);
      await expect(page.locator('html')).toHaveClass(
        new RegExp(`\\b${theme}\\b`)
      );

      const showcase = await revealExampleStores(page);
      await expect(showcase.getByRole('radio')).toHaveCount(3);
      await expect(page.getByTestId('today-recommendation')).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth
      );
      expect(overflow, 'cold home must not scroll horizontally').toBeLessThanOrEqual(1);

      await page.screenshot({
        fullPage: true,
        path: `test-results/dashboard-home-cold-mobile-${theme}.png`,
      });
    });
  }
});
