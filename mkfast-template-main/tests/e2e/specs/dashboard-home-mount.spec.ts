import { expect, test, type Page } from '@playwright/test';
import type { ProductState } from '@meiye/contracts';
import { readFile } from 'node:fs/promises';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { setTheme, type ThemeMode } from '../fixtures/page-health';
import { seedConfirmedStore } from '../fixtures/product';
import {
  JOURNEY_CONTRACTS,
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

type UsageBucket = { allowance: number; available: number };
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

/**
 * 可发布 是一件已完成的成品，不是候选列表——商户一次「采用」都还没点，
 * 标题/正文/转化语就已经齐全。这条是 OI-15 的防线：成品的存在不许被
 * 任何前置动作扣为人质。
 *
 * T42 之前「采用此版本」是条死路（挂得出来、点不动），当时这里断言它缺席；
 * T42 把它修成真正可用的动作，所以断言反过来钉「可用」——退回死路要红。
 * 「交付是否必须先采用」是产品口径问题（见 result-shell-model.ts 的 ready
 * 分支：交付确实排在 hasAdoptedCandidate 之后），本 helper 不替它表态。
 */
async function assertFinishedPieceBeforeAdopt(page: Page) {
  await expect(page.getByTestId('result-merchant-status')).toContainText(
    /可发布|已发布就绪/u,
    { timeout: 180_000 }
  );

  // T42 的修复本身：采用是一个能用的动作，不是 OI-15 那条挂着点不动的死路。
  await expect(
    page
      .getByTestId('result-shell-actions')
      .getByRole('button', { name: '采用此版本', exact: true })
  ).toBeEnabled();

  // 成品是真写出来的，且是在任何一次采用点击之前：标题、正文、转化语三样都非空。
  const worksurface = page.getByTestId(COPY_CONTRACT.resultSurfaceTestId);
  await expect(worksurface.getByTestId('copy-field-title')).toHaveValue(/\S/u);
  await expect(worksurface.getByTestId('copy-field-body')).toHaveValue(/\S/u);
  await expect(worksurface.getByTestId('copy-field-hook')).toHaveValue(/\S/u);

  // 单主候选是既定口径，不是 T18 的临时行为：D-113「④段默认交付 1 个主候选，
  // 『择』仅限用户品味选择与质量门有界重试」，D-118 分型为「copy/image/video
  // 默认 1 主候选」，D-126 又写明「1 候选执行确认由 D-113 收编」。T18 的输出
  // 编译器把它落成 candidateStrategy: 'single_primary'。
  // 所以「备选（N）」入口是有意缺席，不是漏了——这里把缺席本身钉成契约：
  // 谁把候选墙加回来，这三条就得红一条。文本那条是兜底，防止换个 testid 重新长出来。
  await expect(worksurface.getByTestId('copy-alternatives-panel')).toHaveCount(
    0
  );
  await expect(worksurface.getByTestId('copy-alternatives-toggle')).toHaveCount(
    0
  );
  await expect(worksurface.getByText(/备选（\d+）/u)).toHaveCount(0);
}

async function revealExampleStores(page: Page) {
  await page.getByRole('button', { name: '查看示例' }).click();
  const showcase = page.getByTestId('example-store-showcase');
  await expect(showcase).toBeVisible();
  return showcase;
}

async function submitPrefilledCopy(page: Page, prefilled = false) {
  const lens = page.getByTestId('composer-lens-option-copy');
  if (prefilled) {
    // The prefill already picked the copy lens — re-picking it is a click the
    // merchant never has to make (D-043).
    await expect(lens).toBeChecked();
  } else {
    await lens.click();
    await expect(lens).toBeChecked();
  }
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
  // A workspace with open Brief questions gets the Brief card first, and
  // confirming it is the merchant's own click — never an auto-submit. The card
  // only appears after the Brief projection round-trip, and a workspace with
  // nothing left to ask runs straight through, so wait for whichever lands.
  const briefConfirm = page.getByTestId('composer-brief-confirm');
  await Promise.race([
    briefConfirm
      .waitFor({ state: 'visible', timeout: 60_000 })
      .then(() => briefConfirm.click()),
    submissionResponse,
  ]).catch(() => undefined);
  const response = await submissionResponse;
  const body = (await response.json()) as {
    data?: { task?: { id?: string }; work?: { id?: string } };
    error?: { message?: string };
  };
  expect(
    response.ok(),
    body.error?.message ?? 'Sample task submission failed'
  ).toBeTruthy();
  const workId = body.data?.work?.id;
  const taskId = body.data?.task?.id;
  expect(workId, 'sample task must create a real work').toBeTruthy();
  expect(taskId, 'sample task must create a real billable task').toBeTruthy();
  // ADR-0014 keeps the merchant in the conversation after submission. The
  // delivered card is the single navigation into Result Center, so this helper
  // must exercise that real click instead of assuming the retired redirect.
  const deliveryCard = page.getByTestId('composer-delivery-card');
  await expect(deliveryCard).toBeVisible({ timeout: 180_000 });
  await deliveryCard.click();
  await expect(page).toHaveURL(
    new RegExp(`/dashboard/results/${encodeURIComponent(workId!)}`, 'u'),
    { timeout: 60_000 }
  );
  return { taskId: taskId!, workId: workId! };
}

/**
 * D-164①: the dashboard's own three sections, in DOM order.
 *
 * Reads the dedicated section testids rather than counting landmarks — the
 * page's shell already renders regions of its own, so a role count would pass
 * or fail for reasons that have nothing to do with this ticket.
 */
async function dashboardSectionOrder(page: Page) {
  return await page
    .locator('[data-testid^="dashboard-section-"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-testid'))
    );
}

test.describe('D-126 dashboard home mount', () => {
  test.describe.configure({ mode: 'default' });

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    test.setTimeout(180_000);
    await cleanupE2EUsers(request);
  });

  test('cold tenant sees three sample stores and a sample task prefills the Composer', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    // --- Cold home ------------------------------------------------------
    await expect(page.getByTestId('dashboard-home-surface')).toBeVisible();
    await expect(page.getByTestId('dashboard-greeting')).toBeVisible();
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
      await expect(showcase.getByRole('radio', { name: label })).toBeVisible();
    }
    const sampleStore = stores[0]!;
    const sampleRegion = page.getByRole('region', { name: sampleStore.name });
    await expect(sampleRegion).toBeVisible();
    // 商家点开示例作品即理解产品产出：档案、事实、素材、作品都在场。
    await expect(
      sampleRegion.getByText(sampleStore.profile.project).first()
    ).toBeVisible();
    for (const fact of sampleStore.facts) {
      await expect(sampleRegion.getByText(fact.value).first()).toBeVisible();
    }
    for (const content of sampleStore.contentPreviews) {
      await expect(sampleRegion.getByText(content.title).first()).toBeVisible();
    }

    // --- C-3 trial allowance is already provisioned for the cold tenant --
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

    // --- Sample task prefills the Composer, then runs for real ----------
    await sampleRegion.getByRole('button', { name: '复用这条结构' }).click();
    const intentInput = page.getByTestId('composer-intent-input');
    await expect(intentInput).toBeFocused();
    const prefilled = await intentInput.inputValue();
    expect(prefilled.length).toBeGreaterThan(10);

    // Browsing and remixing a sample creates no business object of its own.
    const workbench = await creativeWorkbench(page);
    expect(workbench.works).toEqual([]);
    expect(workbench.jobs).toEqual([]);

    // D-164①: 段③ is absent here and only here. An empty workspace has nothing
    // to continue, and a second empty panel under the sample stores would say
    // nothing 段① has not already said.
    expect(await dashboardSectionOrder(page)).toEqual([
      'dashboard-section-proposal',
      'dashboard-section-create',
    ]);
  });

  test('sample task runs on the real chain, spends trial allowance and exports', async ({
    page,
    request,
  }) => {
    test.setTimeout(360_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    const showcase = await revealExampleStores(page);
    const sampleStore = (await productState(page)).exampleStores[0]!;
    await expect(showcase).toBeVisible();

    const before = await p1Query<EntitlementProjection>(
      page,
      'entitlements',
      'projection'
    );
    expect(before.plan?.tier, 'the sample runs on the real trial plan').toBe(
      'trial'
    );

    await page
      .getByRole('region', { name: sampleStore.name })
      .getByRole('button', { name: '复用这条结构' })
      .click();
    await expect(page.getByTestId('composer-intent-input')).toBeFocused();

    // D-128: the sample runs the same chain a paying merchant runs, and it runs
    // straight through — the draft already says which service it is about.
    const { taskId, workId } = await submitPrefilledCopy(page, true);
    await expect(
      page.getByRole('button', { exact: true, name: '1 项' }),
      'a sample task must not stop to ask what the merchant just picked'
    ).toBeHidden();
    await waitForResultJourney(page, COPY_CONTRACT, workId);

    // 试用额度被真实占用 —— the sample holds usage on the same ProductUsage
    // ledger a paying merchant is charged on, bound to this very task.
    const usage = await p1Query<{
      reservedQuantity: number;
      resource?: string;
      status: string;
    }>(page, 'product-billing', 'get_usage', { taskId });
    expect(usage.resource).toBe('copy');
    expect(usage.reservedQuantity).toBeGreaterThan(0);
    expect(['reserved', 'committed']).toContain(usage.status);

    // 成品真的写出来了，而且采用不是必经动作。导出止步于此：这条 Day-0 脊柱
    // 产生 canonical ContentPackage 后，作品页能从当前 revision 下载文字文件。
    await assertFinishedPieceBeforeAdopt(page);
    await page.goto(`/dashboard/works/${encodeURIComponent(workId)}`);
    await expect(page.getByTestId('works-detail-revision')).toBeVisible({
      timeout: 60_000,
    });
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('works-action-download-text').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/-r\d+\.txt$/u);
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    expect(
      (await readFile(downloadPath!, 'utf8')).trim().length
    ).toBeGreaterThan(20);
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
      expect(
        sampleIds.has(id),
        `${id} leaked into the merchant workspace`
      ).toBe(false);
      expect(id.startsWith('platform-sample:')).toBe(false);
    }

    // A workspace with real facts stops offering the samples altogether.
    await expect(page.getByTestId('example-store-showcase')).toBeHidden();
  });

  test('a workspace with real work is never told it produced nothing', async ({
    page,
    request,
  }) => {
    test.setTimeout(420_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);
    await page.goto('/dashboard');

    // Real history through the Composer execution spine — direct Harness task
    // admission is retired, and no route is stubbed while that history is
    // produced (the degraded-projection tail below stubs the recommendation
    // read only, after the real work already exists).
    await page
      .getByTestId('composer-intent-input')
      .fill('把本周护理项目做成一条可以发的小红书文案');
    const { workId } = await submitPrefilledCopy(page);
    await waitForResultJourney(page, COPY_CONTRACT, workId);
    await assertFinishedPieceBeforeAdopt(page);

    // Harness recommendation is preferred; when an older real delivery lacks
    // that audit shape, the latest canonical ContentPackage is the stable
    // fallback. Real history must not remain in the cold state forever.
    // W04 旅程硬门：这个账号已经真的产出过东西，首页就不许再说「还没生成过」。
    // 若两条来源都排不出主推荐，诚实的说法是「今天这条没排出来」——降级态不许
    // 伪装成冷启动，且无论哪种态，下一步入口都必须留在卡里。
    await page.goto('/dashboard');
    const card = page.getByTestId('today-recommendation');
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute(
      'data-recommendation-state',
      /^(?:pending|current)$/u
    );
    await expect(
      card.getByRole('heading', { level: 3, name: /\S/u })
    ).toBeVisible();
    await expect(
      card.getByRole('heading', {
        level: 3,
        name: '还没有基于本店事实的推荐',
      })
    ).toHaveCount(0);
    const recommendationState = await card.getAttribute(
      'data-recommendation-state'
    );
    if (recommendationState === 'current') {
      await expect(card.getByText('为什么适合现在')).toBeVisible();
      await expect(card.getByText('用了本店什么')).toBeVisible();
      await expect(card.getByText('希望顾客做什么')).toBeVisible();
      await expect(card.getByTestId('today-recommendation-use')).toBeVisible();
    } else {
      await expect(
        card.getByRole('heading', {
          level: 3,
          name: '今天的主推荐还没排出来',
        })
      ).toBeVisible();
    }
    // 不是空壳：无论哪种态，下一步入口都在卡里。
    await expect(
      card.getByRole('button', {
        name: /开始下一次任务|用这条推荐开始创作/u,
      })
    ).toHaveCount(1);
    expect((await card.innerText()).trim().length).toBeGreaterThan(0);
    await expect(
      card.getByText(/store_fact:|platform-sample|null|undefined/u)
    ).toHaveCount(0);

    // D-164①: 提议 → 创作 → 继续, all three on the one dashboard route and in
    // that order. The order is the claim: what to do next comes before the
    // place to do it, and unfinished work comes last so it nudges without
    // displacing the entry the merchant came here for.
    await expect(page.getByTestId('dashboard-section-continue')).toBeVisible();
    expect(await dashboardSectionOrder(page)).toEqual([
      'dashboard-section-proposal',
      'dashboard-section-create',
      'dashboard-section-continue',
    ]);
    await expect(page.getByTestId('continue-item').first()).toBeVisible();

    await card
      .getByRole('button', {
        name: /开始下一次任务|用这条推荐开始创作/u,
      })
      .click();
    const intentInput = page.getByTestId('composer-intent-input');
    await expect(intentInput).toBeFocused();
    if (recommendationState === 'current') {
      await expect(intentInput).not.toHaveValue('');
    }

    // 降级投影腿：真实成品原封不动留在工作台，只把推荐这一路的两个来源
    // （Harness 投影 + ContentPackage 兜底）排空。此时唯一诚实的说法是
    // 「今天的主推荐还没排出来」——不许退回冷启动，也不许是空壳。
    await page.route('**/api/core/p1/harness/recommendation', async (route) => {
      await route.fulfill({
        json: {
          data: {
            workspaceId: 'workspace-e2e',
            currentFactsRevision: 1,
            recommendation: null,
            stale: false,
          },
        },
        status: 200,
      });
    });
    await page.route('**/api/core/p1/query', async (route) => {
      const body = route.request().postDataJSON() as { action?: string };
      if (body?.action !== 'content_packages') {
        await route.fallback();
        return;
      }
      await route.fulfill({ json: { data: [] }, status: 200 });
    });
    await page.goto('/dashboard');
    const degraded = page.getByTestId('today-recommendation');
    await expect(degraded).toHaveAttribute(
      'data-recommendation-state',
      'pending'
    );
    await expect(
      degraded.getByRole('heading', {
        level: 3,
        name: '今天的主推荐还没排出来',
      })
    ).toBeVisible();
    await expect(
      degraded.getByRole('heading', {
        level: 3,
        name: '还没有基于本店事实的推荐',
      })
    ).toHaveCount(0);
    await expect(
      degraded.getByRole('button', { name: '开始下一次任务' })
    ).toBeVisible();
    await expect(
      degraded.getByText(/store_fact:|platform-sample|null|undefined/u)
    ).toHaveCount(0);
  });

  for (const theme of [
    'light',
    'dark',
  ] as const satisfies readonly ThemeMode[]) {
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
      await expect(
        showcase
          .getByRole('radiogroup', { name: '选择示例门店行业' })
          .getByRole('radio')
      ).toHaveCount(3);
      await expect(page.getByTestId('today-recommendation')).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth
      );
      expect(
        overflow,
        'cold home must not scroll horizontally'
      ).toBeLessThanOrEqual(1);

      // Durable walkthrough evidence — Playwright wipes test-results/ per run.
      // Kept out of the tracked tree (OI-26): a spec that rewrites committed
      // files turns every run into a dirty worktree for whoever shares it.
      await page.screenshot({
        fullPage: true,
        path: `../.scratch/t29-dashboard-home-2026-07-25/shots/cold-home-mobile-${theme}.png`,
      });
    });
  }
});
