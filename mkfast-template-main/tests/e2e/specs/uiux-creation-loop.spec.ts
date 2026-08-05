import { expect, test, type Page } from '@playwright/test';
import type {
  ApiEnvelope,
  ProductState,
  TodayRecommendationState,
} from '@meiye/contracts';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

interface CreativeProjection {
  assets: unknown[];
  contents: unknown[];
  jobs: unknown[];
  works: unknown[];
}

async function creativeProjection(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/core/p1/query', {
      body: JSON.stringify({
        action: 'creative_workbench',
        module: 'operations',
        payload: {},
      }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const envelope = (await response.json()) as {
      data?: CreativeProjection;
      error?: { message: string };
    };
    if (!response.ok || !envelope.data) {
      throw new Error(envelope.error?.message ?? 'Creative projection failed');
    }
    return envelope.data;
  });
}

async function productState(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/core/product/state', {
      credentials: 'same-origin',
    });
    const envelope = (await response.json()) as ApiEnvelope<ProductState>;
    if (!response.ok || 'error' in envelope) {
      throw new Error(
        'error' in envelope ? envelope.error.message : 'Product state failed'
      );
    }
    return envelope.data;
  });
}

async function activeStoreFacts(page: Page, storeId: string) {
  return page.evaluate(async (currentStoreId) => {
    const response = await fetch('/api/core/p1/query', {
      body: JSON.stringify({
        action: 'store_facts_active',
        module: 'context',
        payload: {
          scope: { storeId: currentStoreId },
          at: new Date().toISOString(),
        },
      }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const envelope = (await response.json()) as {
      data?: unknown[];
      error?: { message: string };
    };
    if (!response.ok || !envelope.data) {
      throw new Error(envelope.error?.message ?? 'Store fact query failed');
    }
    return envelope.data;
  }, storeId);
}

/**
 * Day-0 recommendation and example-store contract.
 *
 * Six cases tied to the retired unified creation workbench and
 * ContentPackageDetail were removed in #242. Their shipped-seam replacements
 * are recorded in TEST-CATALOG.md; do not restore the retired locators here.
 */
test.describe('Day-0 recommendation and example store', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('E0 example is opt-in and can be remixed without creating business objects', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    // D2 light capsules: cold chip + honest empty panel (h3 + start).
    await expect(page.getByTestId('today-recommendation')).toHaveAttribute(
      'data-suggestion-capsules',
      'true'
    );
    await expect(page.getByTestId('suggestion-chip-today')).toBeVisible();
    await expect(
      page.getByRole('heading', {
        level: 3,
        name: '还没有基于本店事实的推荐',
      })
    ).toBeVisible();

    const emptyProjection = await creativeProjection(page);
    expect(emptyProjection).toMatchObject({
      assets: [],
      contents: [],
      jobs: [],
      works: [],
    });
    const showcase = page.getByTestId('example-store-showcase');
    await expect(showcase).toBeHidden();
    await page.getByRole('button', { name: '查看示例' }).click();
    await expect(showcase).toBeVisible({ timeout: 60_000 });

    // D-126 / C-5: the cold home offers all three sample industries.
    const industries = showcase.getByRole('radiogroup', {
      name: '选择示例门店行业',
    });
    await expect(industries.getByRole('radio')).toHaveCount(3);
    for (const industry of ['护发', '皮肤管理', '生发']) {
      await expect(
        industries.getByRole('radio', { name: industry })
      ).toBeVisible();
    }

    const sampleStores = (await productState(page)).exampleStores;
    expect(sampleStores.map((store) => store.industry)).toEqual([
      'hair_care',
      'skin_management',
      'hair_growth',
    ]);
    expect(
      sampleStores.every((store) => store.provenance === 'platform_sample')
    ).toBe(true);

    const hairCare = sampleStores[0]!;
    const example = page.getByRole('region', { name: hairCare.name });
    await expect(example).toBeVisible();
    await expect(
      example.getByText('只读 · 浏览不消耗积分', { exact: true })
    ).toBeVisible();
    for (const asset of hairCare.assetPreviews) {
      await expect(example.getByText(asset.label).first()).toBeVisible();
    }
    for (const fact of hairCare.facts) {
      await expect(example.getByText(fact.value).first()).toBeVisible();
    }
    const exampleContents = example.getByRole('radiogroup', {
      name: '示例内容',
    });
    // Independent floor: deriving the count from the same seed the page reads
    // would make an empty contentPreviews array pass as toHaveCount(0), and
    // "the cold home actually offers example content" would stop being guarded.
    // Three per store is the platform sample seed convention.
    expect(hairCare.contentPreviews.length).toBeGreaterThanOrEqual(3);
    await expect(exampleContents.getByRole('radio')).toHaveCount(
      hairCare.contentPreviews.length
    );
    await example.getByRole('button', { name: '复用这条结构' }).click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          sessionStorage.getItem('meiye.creation-draft-intent.v1')
        )
      )
      .toMatch(/开场钩子/);
    await expect(page.getByLabel('描述这次想创作的内容')).toHaveValue(
      /开场钩子/
    );

    // Switching industry keeps the surface read-only and re-scopes the remix.
    await industries.getByRole('radio', { name: '生发' }).click();
    const hairGrowth = sampleStores[2]!;
    const growthExample = page.getByRole('region', { name: hairGrowth.name });
    await expect(growthExample).toBeVisible();
    const growthContent = hairGrowth.contentPreviews[1]!;
    await growthExample
      .getByRole('radiogroup', { name: '示例内容' })
      .getByRole('radio', { name: new RegExp(growthContent.title) })
      .click();
    await growthExample.getByRole('button', { name: '复用这条结构' }).click();

    const remixedIntent = page.getByLabel('描述这次想创作的内容');
    await expect(remixedIntent).toBeFocused();
    // The draft says which service it is about — the merchant just picked the
    // 生发 store, so the chain never has to stop and ask.
    await expect(remixedIntent).toHaveValue(
      `做一条抖音美业内容，主题是养发护理，内容角度围绕“${growthContent.title}”；用“开场钩子—项目体验—到店行动”结构，语气真实克制，所有门店与价格事实由我稍后补充。`
    );
    // Remixing only fills the draft. Platform samples remain read-only and
    // cannot satisfy the merchant's own StoreFact gate.
    const submit = page.getByTestId('composer-submit');
    await expect(submit).toBeEnabled();
    await expect(submit).toHaveAccessibleName('先补门店信息');
    await submit.click();
    await expect(page.getByTestId('progressive-fact-card')).toBeVisible();
    expect(await creativeProjection(page)).toMatchObject({
      assets: [],
      contents: [],
      jobs: [],
      works: [],
    });
    for (const store of sampleStores) {
      expect(await activeStoreFacts(page, store.id)).toEqual([]);
    }

    await growthExample.getByRole('button', { name: '隐藏示例' }).click();
    await expect(showcase).toBeHidden();
    expect(
      (await productState(page)).exampleStores.every((store) => store.hidden)
    ).toBe(true);
    await page.reload();
    await expect(page.getByTestId('example-store-showcase')).toBeHidden();
    await expect(page.getByRole('button', { name: '查看示例' })).toBeVisible();
    await expect(page.getByLabel('描述这次想创作的内容')).toBeVisible();
    expect(await creativeProjection(page)).toMatchObject({
      assets: [],
      contents: [],
      jobs: [],
      works: [],
    });
    for (const store of sampleStores) {
      expect(await activeStoreFacts(page, store.id)).toEqual([]);
    }
  });

  test('today recommendation follows the persisted fact revision state', async ({
    page,
    request,
  }) => {
    let state: TodayRecommendationState = {
      workspaceId: 'workspace-e2e',
      currentFactsRevision: 0,
      recommendation: null,
      stale: false,
    };
    await page.route('**/api/core/p1/harness/recommendation', async (route) => {
      await route.fulfill({ json: { data: state }, status: 200 });
    });
    // W04「用了本店什么」: the card names the facts out of the merchant's own
    // active ledger. Every other p1 query still goes to the real backend.
    await page.route('**/api/core/p1/query', async (route) => {
      const body = route.request().postDataJSON() as { action?: string };
      if (body?.action !== 'store_facts_active') {
        await route.fallback();
        return;
      }
      await route.fulfill({
        json: {
          data: [
            {
              factId: 'offer-price',
              workspaceId: 'workspace-e2e',
              kind: 'service',
              key: 'offer.name',
              value: { name: '猫眼加固' },
              scope: { storeId: 'workspace-e2e' },
              source: {
                kind: 'user_confirmation',
                referenceId: 'confirmation-e2e',
                capturedAt: '2026-07-18T08:00:00.000Z',
              },
              effectiveFrom: '2026-07-18T08:00:00.000Z',
              expiresAt: null,
              revision: 1,
              recordedAt: '2026-07-18T08:00:00.000Z',
              recordedBy: 'user-e2e',
            },
          ],
        },
        status: 200,
      });
    });

    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await expect(
      page.getByRole('heading', {
        level: 3,
        name: '还没有基于本店事实的推荐',
      })
    ).toBeVisible();

    state = {
      workspaceId: 'workspace-e2e',
      currentFactsRevision: 1,
      stale: false,
      recommendation: {
        workspaceId: 'workspace-e2e',
        taskId: 'task-e2e',
        factsRevision: 1,
        packageId: 'package-e2e',
        versionId: 'version-e2e',
        title: '本周猫眼项目推荐',
        body: '基于本店已确认的猫眼项目与价格生成。',
        whyNow: '换季期的咨询量正在上升',
        factReferences: ['store_fact:offer-price:1'],
        customerAction: '私信预约',
        sourceLabel: '把新团购做一套能发的',
        createdAt: '2026-07-18T08:00:00.000Z',
        opportunity: {
          opportunityId: 'opportunity-e2e',
          status: 'active',
          source: 'https://example.test/city-hair-color',
          sourceType: 'user_link',
          capturedAt: '2026-07-18T08:00:00.000Z',
          expiresAt: '2026-07-19T08:00:00.000Z',
          platforms: ['xiaohongshu'],
          region: '上海静安',
          targetAudience: '准备换夏季发色的同城顾客',
          matchedStoreReferences: ['store_fact:offer-price:1'],
          relevanceExplanation: '门店本周主推低损伤染发。',
          reusableMechanism: '借夏季显白发色问题给出本店原创建议。',
          expectedAction: '私信预约发质判断。',
          evergreenFallback: '转为常青发色选择指南。',
          protectedExpressionCopied: false,
        },
      },
    };
    await page.reload();
    // D2: current recommendation is a highlight chip; expand for three-element mini card.
    const todayChip = page.getByTestId('suggestion-chip-today');
    await expect(todayChip).toHaveAttribute('data-highlight', 'true');
    await expect(todayChip).toContainText(/今日建议|本周猫眼项目推荐/u);
    await expect(
      page.getByTestId('today-recommendation-mini-card')
    ).toHaveCount(0);
    await todayChip.click();
    await expect(
      page.getByTestId('today-recommendation-mini-card')
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 3, name: '本周猫眼项目推荐' })
    ).toBeVisible();
    await expect(page.getByText('换季期的咨询量正在上升')).toBeVisible();
    // D-116/W04: the merchant reads the fact by name — never its ledger id, and
    // no longer only its count.
    const usedFacts = page.getByTestId('today-recommendation-facts');
    await expect(usedFacts.getByText('服务项目·猫眼加固')).toBeVisible();
    await expect(usedFacts.getByText('本店 1 条已确认事实')).toBeVisible();
    await expect(page.getByText('store_fact:offer-price:1')).toBeHidden();
    await expect(page.getByText('私信预约', { exact: true })).toBeVisible();
    await expect(page.getByText('把新团购做一套能发的')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: '热点机会卡' })
    ).toBeVisible();
    await expect(page.getByText('门店本周主推低损伤染发。')).toBeVisible();
    await expect(page.getByText('私信预约发质判断。')).toBeVisible();
    // D-126: the CTA prefills the Composer draft in place — it does not navigate.
    await expect(page.getByRole('link', { name: '查看完整成品' })).toHaveCount(
      0
    );
    await page.getByTestId('today-recommendation-use').click();
    const prefilled = page.getByLabel('描述这次想创作的内容');
    await expect(prefilled).toBeFocused();
    await expect(prefilled).toHaveValue(
      '按今天的主推荐写一条内容：主题围绕“本周猫眼项目推荐”；今天适合发的理由是换季期的咨询量正在上升；希望顾客看完私信预约。'
    );
    await expect(page).toHaveURL(/\/dashboard(?:\?|$)/u);

    state = {
      workspaceId: 'workspace-e2e',
      currentFactsRevision: 2,
      recommendation: null,
      stale: true,
    };
    await page.reload();
    await expect(
      page.getByRole('heading', {
        level: 3,
        name: '正在等待新资料的推荐',
      })
    ).toBeVisible();
    await page.getByRole('button', { name: '开始下一次任务' }).click();
    await expect(page.getByLabel('描述这次想创作的内容')).toBeFocused();
    await expect(
      page.getByRole('heading', { level: 3, name: '本周猫眼项目推荐' })
    ).toBeHidden();
  });
});
