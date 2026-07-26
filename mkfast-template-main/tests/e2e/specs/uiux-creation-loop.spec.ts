import { expect, test, type Locator, type Page } from '@playwright/test';
import type {
  ApiEnvelope,
  ContentPackage,
  ProductState,
  TodayRecommendationState,
} from '@meiye/contracts';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { seedAuthorizedGrounding } from '../fixtures/product';
import { evidencePath } from '../fixtures/evidence';

interface CreativeProjection {
  assets: Array<{
    candidateIndex?: number;
    id: string;
    jobId: string;
    kind: 'text' | 'image' | 'video';
  }>;
  contents: Array<{
    assetIds: string[];
    id: string;
    jobId: string;
    status: 'accepted';
  }>;
  events: Array<{ type: string }>;
  jobs: Array<{
    contract: {
      aigcLabelEnabled: boolean;
      catalogModelId: string;
      catalogRevision: string;
      currency: string;
      estimatedAmount: number;
      operation: string;
      outputCount: number;
      quoteRevision: string;
      watermarkEnabled: boolean;
    };
    failureCode?: string;
    id: string;
    outputAssetIds: string[];
    outputContentIds: string[];
    recoveredAt?: string;
    status: string;
  }>;
  works: Array<{
    derivedFrom?: string;
    id: string;
    sessionId: string;
    sourceReferences: Array<{ id: string; kind: string }>;
    status: string;
  }>;
}

const PNG_FIXTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

function imageFixture(marker: string) {
  return Buffer.concat([PNG_FIXTURE, Buffer.from(marker)]);
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

async function contentPackages(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/core/p1/query', {
      body: JSON.stringify({
        action: 'content_packages',
        module: 'operations',
        payload: {},
      }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const envelope = (await response.json()) as {
      data?: ContentPackage[];
      error?: { message: string };
    };
    if (!response.ok || !envelope.data) {
      throw new Error(envelope.error?.message ?? 'ContentPackage query failed');
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

async function imageDataTransfer(page: Page, name: string, marker: string) {
  const base64 = imageFixture(marker).toString('base64');
  return page.evaluateHandle(
    ({ encoded, fileName }) => {
      const binary = atob(encoded);
      const bytes = Uint8Array.from(binary, (character) =>
        character.charCodeAt(0)
      );
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([bytes], fileName, {
          type: 'image/png',
        })
      );
      return transfer;
    },
    { encoded: base64, fileName: name }
  );
}

async function pasteImage(dropZone: Locator, name: string, marker: string) {
  const base64 = imageFixture(marker).toString('base64');
  await dropZone.evaluate(
    (element, { encoded, fileName }) => {
      const binary = atob(encoded);
      const bytes = Uint8Array.from(binary, (character) =>
        character.charCodeAt(0)
      );
      const clipboardData = new DataTransfer();
      clipboardData.items.add(
        new File([bytes], fileName, {
          type: 'image/png',
        })
      );
      element.dispatchEvent(
        new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData,
        })
      );
    },
    { encoded: base64, fileName: name }
  );
}

async function confirmComposerImageFacts(
  item: Locator,
  options: { restricted?: boolean } = {}
) {
  if (options.restricted) {
    await item
      .getByRole('combobox', { name: '这是什么素材？' })
      .selectOption('before_after');
  }
  for (const [label, answer] of [
    ['画面里有人吗？', options.restricted ? '是' : '否'],
    ['有手机号、聊天截图等隐私吗？', '否'],
    ['有未成年人吗？', '否'],
  ] as const) {
    await item
      .getByRole('group', { name: label })
      .getByRole('button', { name: answer })
      .click();
  }
  await item.getByRole('button', { name: '可用于公开营销' }).click();
  await item
    .getByLabel('授权凭证编号或存档位置')
    .fill('e2e-consent/archive-2026-0718');
  if (options.restricted) {
    await item.getByRole('button', { name: '小红书' }).click();
    await item.getByRole('button', { name: '无固定期限' }).click();
  }
  await item.getByRole('button', { name: '确认并上传' }).click();
}

async function createWork(page: Page, intent: string) {
  await page.getByLabel('描述这次想创作的内容').fill(intent);
  await page.getByRole('button', { name: '建立创作记录' }).click();
  const record = page.getByLabel('创作助理整理的记录');
  await expect(record).toBeVisible();
  await expect(record.getByText(intent, { exact: true }).first()).toBeVisible();
}

async function submitImageAndSaveAsset(page: Page) {
  const record = page.getByLabel('创作助理整理的记录');
  // T1: Brief auto-confirms on work load (0-click). Keep optional manual recovery.
  const confirmBrief = record.getByRole('button', {
    name: '采用并确认 Brief',
  });
  if (await confirmBrief.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await confirmBrief.click();
  }
  await expect(
    record
      .getByText('Brief 已确认', { exact: true })
      .or(record.getByTestId('creative-brief-chips'))
  ).toBeVisible({ timeout: 30_000 });
  await record.getByRole('button', { name: /^图片生成/ }).click();
  await record.getByRole('button', { name: /^调整专业参数/ }).click();
  const checkedModel = record
    .getByRole('radiogroup', { name: '执行模型' })
    .getByRole('radio', { checked: true });
  if ((await checkedModel.count()) === 0) {
    await record
      .getByRole('radiogroup', { name: '执行模型' })
      .locator('[role="radio"]:not([disabled])')
      .first()
      .click();
  }
  await expect(checkedModel).toHaveCount(1);
  await record
    .getByRole('checkbox', {
      name: /我已确认模型、规格、费用和发布标识/,
    })
    .check();
  const submit = page.getByRole('button', { name: '提交生成任务' });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect
    .poll(
      async () => {
        const job = (await creativeProjection(page)).jobs.find(
          (candidate) => candidate.contract.operation === 'image.generate'
        );
        if (job?.status === 'failed') {
          throw new Error(`Image job failed: ${job.failureCode ?? 'unknown'}`);
        }
        return job?.status;
      },
      { timeout: 60_000 }
    )
    .toBe('completed');
  await expect(page.getByText('已保存到素材', { exact: true })).toBeVisible({
    timeout: 60_000,
  });
}

test.describe('S2 cold start and unified creation loop', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('adding a source derives a new current Work and replaces the workId URL', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await createWork(page, '验证带来源后导航到新创作');

    const before = await creativeProjection(page);
    const sourceWork = before.works[0];
    expect(sourceWork).toBeTruthy();
    await expect(page).toHaveURL(
      new RegExp(`workId=${encodeURIComponent(sourceWork!.id)}`)
    );

    const record = page.getByLabel('创作助理整理的记录');
    await record.getByRole('button', { name: '带入当前创作' }).first().click();
    const inheritance = page.getByRole('dialog', {
      name: '确认从来源继承什么',
    });
    await inheritance.getByRole('button', { name: '确认带入 4 项' }).click();

    await expect
      .poll(async () => (await creativeProjection(page)).works.length)
      .toBe(2);
    const after = await creativeProjection(page);
    const derivedWork = after.works.find(
      (work) => work.derivedFrom === sourceWork!.id
    );
    expect(derivedWork).toBeTruthy();
    await expect(page).toHaveURL(
      new RegExp(`workId=${encodeURIComponent(derivedWork!.id)}`)
    );
    await expect(record.getByText('基于上一版调整')).toBeVisible();
    await expect(
      record.getByRole('link', { name: '打开作品详情' })
    ).toHaveAttribute('href', `/dashboard/works/${derivedWork!.id}`);
  });

  test('E0 example is opt-in and can be remixed without creating business objects', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    await expect(
      page.getByRole('heading', { name: '今天值得发什么' })
    ).toBeVisible();
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
    await expect(showcase).toBeVisible();

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
      example.getByText('只读 · 浏览不消耗额度', { exact: true })
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
    // Remixing only fills the draft — submission stays the merchant's own click.
    // Enabled, not merely present: a submit button that mounts but cannot be
    // clicked would make reuse a dead end, which is the OI-15 shape.
    await expect(page.getByTestId('composer-submit')).toBeEnabled();
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
    await expect(
      page.getByRole('heading', { level: 3, name: '本周猫眼项目推荐' })
    ).toBeVisible();
    await expect(page.getByText('换季期的咨询量正在上升')).toBeVisible();
    // D-116: the merchant sees how many confirmed facts were used, never their ids.
    await expect(page.getByText('本店 1 条已确认事实')).toBeVisible();
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

  test('E1 reuses the existing Task without copying it', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    const taskId = await page.evaluate(async () => {
      const response = await fetch('/api/core/p1/commands', {
        body: JSON.stringify({
          action: 'create_task',
          module: 'operations',
          payload: {
            dedupeKey: 'e2e-s2-existing-task',
            dueAt: new Date(Date.now() + 3_600_000).toISOString(),
            executable: true,
            risk: 'normal',
            source: 'manual',
            title: 'E2E 已有来源任务',
          },
        }),
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'e2e-s2-existing-task',
        },
        method: 'POST',
      });
      const envelope = (await response.json()) as {
        data?: { id: string };
        error?: { message: string };
      };
      if (!response.ok || !envelope.data) {
        throw new Error(envelope.error?.message ?? 'Task creation failed');
      }
      return envelope.data.id;
    });

    await page.reload();
    await expect(
      page.getByRole('button', { name: '任务 · E2E 已有来源任务' })
    ).toBeVisible();
    await page.getByRole('button', { exact: true, name: '更多' }).click();
    await page.getByRole('button', { name: /^前后对比/ }).click();
    await page.getByRole('button', { name: '建立创作记录' }).click();
    await expect(page.getByLabel('创作助理整理的记录')).toBeVisible();

    const projection = await creativeProjection(page);
    expect(projection.works).toHaveLength(1);
    const workId = projection.works[0]?.id;
    expect(workId).toBeTruthy();
    await expect(page).toHaveURL(
      new RegExp(`[?&]workId=${encodeURIComponent(workId ?? '')}(?:&|$)`)
    );
    expect(projection.works[0]?.sourceReferences).toEqual(
      expect.arrayContaining([
        { id: taskId, kind: 'task' },
        expect.objectContaining({
          id: 'official-before_after',
          kind: 'template',
        }),
      ])
    );
    await page.setViewportSize({ height: 844, width: 390 });
    const mobileWorkContext = page.getByTestId('mobile-work-context');
    await expect(mobileWorkContext).toHaveAttribute(
      'data-work-id',
      workId ?? ''
    );
    await expect(
      mobileWorkContext.locator(`[data-source-reference="task:${taskId}"]`)
    ).toContainText('E2E 已有来源任务');
    await expect(
      mobileWorkContext.locator(
        '[data-source-reference="template:official-before_after"]'
      )
    ).toContainText('前后对比');
    await page.reload();
    await expect(page.getByTestId('mobile-work-context')).toHaveAttribute(
      'data-work-id',
      workId ?? ''
    );
    const taskCount = await page.evaluate(async () => {
      const response = await fetch('/api/core/p1/query', {
        body: JSON.stringify({
          action: 'inbox',
          module: 'operations',
          payload: {},
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      const envelope = (await response.json()) as {
        data: { tasks: unknown[] };
      };
      return envelope.data.tasks.length;
    });
    expect(taskCount).toBe(1);
  });

  test('composer uploads, drops, pastes, and removes real image references', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await page.route('**/api/core/p1/harness/recommendation', (route) =>
      route.fulfill({
        json: {
          error: {
            code: 'HARNESS_UNAVAILABLE',
            message: 'Harness is unavailable in this isolated rights test.',
          },
        },
        status: 503,
      })
    );

    const cameraInput = page.getByLabel('拍照上传图片');
    const galleryInput = page.getByLabel('选择要上传的图片');
    await expect(cameraInput).toHaveAttribute('accept', 'image/*');
    await expect(cameraInput).toHaveAttribute('capture', 'environment');
    await expect(galleryInput).toHaveAttribute('accept', 'image/*');
    await expect(galleryInput).toHaveAttribute('multiple', '');
    await expect(page.getByRole('button', { name: '选择图片' })).toBeEnabled();

    const dropZone = page
      .locator('#composer-gallery-input')
      .locator('xpath=../..');
    const plainPaste = await dropZone.evaluate((element) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', 'https://example.test/not-an-image');
      const event = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(plainPaste).toBe(false);
    expect((await productState(page)).assets).toEqual([]);
    await seedAuthorizedGrounding(page);

    await page.screenshot({
      fullPage: true,
      path: evidencePath(
        'uiux-upgrade-b/screenshots/22a-composer-drop-ready-desktop.png'
      ),
    });
    await galleryInput.setInputFiles({
      buffer: imageFixture('gallery'),
      mimeType: 'image/png',
      name: 'gallery-input.png',
    });

    const uploadList = page.getByRole('list', { name: '本次创作的图片' });
    const galleryItem = uploadList
      .getByRole('listitem')
      .filter({ hasText: 'gallery-input.png' });
    await confirmComposerImageFacts(galleryItem, { restricted: true });
    await expect(
      galleryItem.getByText('已保存到素材库', { exact: true })
    ).toBeVisible({ timeout: 30_000 });
    await galleryItem
      .getByRole('button', {
        name: '从本次创作中移除 gallery-input.png',
      })
      .click();
    await expect(galleryItem).toBeHidden();

    await galleryInput.setInputFiles({
      buffer: imageFixture('internal'),
      mimeType: 'image/png',
      name: 'internal-only.png',
    });
    const internalItem = uploadList
      .getByRole('listitem')
      .filter({ hasText: 'internal-only.png' });
    for (const label of [
      '画面里有人吗？',
      '有手机号、聊天截图等隐私吗？',
      '有未成年人吗？',
    ]) {
      await internalItem
        .getByRole('group', { name: label })
        .getByRole('button', { name: '否' })
        .click();
    }
    await internalItem.getByRole('button', { name: '仅内部草稿' }).click();
    await internalItem.getByRole('button', { name: '确认并上传' }).click();
    await expect(
      internalItem.getByText('仅内部可用，待补全公开营销授权', {
        exact: true,
      })
    ).toBeVisible({ timeout: 30_000 });

    const dropTransfer = await imageDataTransfer(
      page,
      'dropped-input.png',
      'drop'
    );
    await dropZone.dispatchEvent('dragenter', { dataTransfer: dropTransfer });
    await expect(dropZone).toHaveClass(/border-primary/);
    await page.screenshot({
      fullPage: true,
      path: evidencePath(
        'uiux-upgrade-b/screenshots/22b-composer-drop-highlight-desktop.png'
      ),
    });
    await dropZone.dispatchEvent('drop', { dataTransfer: dropTransfer });
    await dropTransfer.dispose();

    const droppedItem = uploadList
      .getByRole('listitem')
      .filter({ hasText: 'dropped-input.png' });
    await confirmComposerImageFacts(droppedItem);
    await expect(
      droppedItem.getByText('已保存到素材库', { exact: true })
    ).toBeVisible({ timeout: 30_000 });

    await pasteImage(dropZone, 'pasted-input.png', 'paste');
    const pastedItem = uploadList
      .getByRole('listitem')
      .filter({ hasText: 'pasted-input.png' });
    await confirmComposerImageFacts(pastedItem);
    await expect(
      pastedItem.getByText('已保存到素材库', { exact: true })
    ).toBeVisible({ timeout: 30_000 });
    await page.screenshot({
      fullPage: true,
      path: evidencePath(
        'uiux-upgrade-b/screenshots/22c-composer-images-added-desktop.png'
      ),
    });

    const assets = (await productState(page)).assets;
    const removedAsset = assets.find((asset) =>
      asset.tags.includes('gallery-input.png')
    );
    const droppedAsset = assets.find((asset) =>
      asset.tags.includes('dropped-input.png')
    );
    const pastedAsset = assets.find((asset) =>
      asset.tags.includes('pasted-input.png')
    );
    const internalAsset = assets.find((asset) =>
      asset.tags.includes('internal-only.png')
    );
    expect(removedAsset).toBeTruthy();
    expect(removedAsset).toMatchObject({
      authorizationStatus: 'authorized',
      category: 'before_after',
      consentScope: 'public_marketing',
      containsPerson: true,
      rightsEvidence: 'e2e-consent/archive-2026-0718',
      rightsNoFixedExpiry: true,
      rightsPlatforms: ['xiaohongshu'],
    });
    expect(droppedAsset).toBeTruthy();
    expect(pastedAsset).toBeTruthy();
    expect(internalAsset).toMatchObject({
      authorizationStatus: 'pending',
      consentScope: 'internal_only',
    });

    await createWork(page, '用两张本店实拍写一条到店内容');
    const projection = await creativeProjection(page);
    const assetReferences = projection.works[0]?.sourceReferences.filter(
      ({ kind }) => kind === 'asset'
    );
    expect(assetReferences).toEqual(
      expect.arrayContaining([
        { id: droppedAsset?.id, kind: 'asset' },
        { id: pastedAsset?.id, kind: 'asset' },
      ])
    );
    expect(assetReferences).not.toContainEqual({
      id: removedAsset?.id,
      kind: 'asset',
    });
    expect(assetReferences).not.toContainEqual({
      id: internalAsset?.id,
      kind: 'asset',
    });
    await page.screenshot({
      fullPage: true,
      path: evidencePath(
        'uiux-upgrade-b/screenshots/22d-work-image-references-desktop.png'
      ),
    });

    const confirmBrief = page.getByRole('button', { name: '采用并确认 Brief' });
    if (await confirmBrief.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await confirmBrief.click();
    }
    await page.getByRole('button', { name: /^调整专业参数/ }).click();
    const selectedModel = page
      .getByRole('radiogroup', { name: '执行模型' })
      .getByRole('radio', { checked: true });
    if ((await selectedModel.count()) === 0) {
      await page
        .getByRole('radiogroup', { name: '执行模型' })
        .locator('[role="radio"]:not([disabled])')
        .first()
        .click();
    }
    await page
      .getByRole('checkbox', {
        name: /我已确认模型、规格、费用和发布标识/,
      })
      .check();
    await page.getByRole('button', { name: '提交生成任务' }).click();
    const candidates = page.getByRole('radiogroup', {
      name: '三条文案候选',
    });
    await expect(candidates.getByRole('radio')).toHaveCount(3, {
      timeout: 60_000,
    });
    await candidates.getByRole('radio').first().click();
    await page.getByRole('button', { name: '采用所选文案' }).click();
    await expect(
      page.getByText('本批已采用 1 条文案', { exact: true })
    ).toBeVisible({ timeout: 60_000 });
    const [deliveredPackage] = await contentPackages(page);
    expect(deliveredPackage).toMatchObject({
      source: {
        assetIds: expect.arrayContaining([droppedAsset?.id, pastedAsset?.id]),
      },
      status: 'accepted',
    });
    expect(deliveredPackage?.versions).not.toHaveLength(0);
  });

  test('explicit contract adopts copy, attaches generated media, and preserves one ContentPackage', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    const sourceAssetId = await seedAuthorizedGrounding(page);
    await createWork(page, '为新做的透亮猫眼写一条克制的到店内容');
    const confirmBrief = page.getByRole('button', { name: '采用并确认 Brief' });
    if (await confirmBrief.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await confirmBrief.click();
    }
    await expect(
      page
        .getByText('Brief 已确认', { exact: true })
        .or(page.getByTestId('creative-brief-chips'))
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /^调整专业参数/ }).click();

    const selectedModel = page
      .getByRole('radiogroup', { name: '执行模型' })
      .getByRole('radio', { checked: true });
    if ((await selectedModel.count()) === 0) {
      await page
        .getByRole('radiogroup', { name: '执行模型' })
        .locator('[role="radio"]:not([disabled])')
        .first()
        .click();
    }
    await expect(selectedModel).toHaveCount(1);

    const watermark = page.getByRole('switch', { name: '品牌水印' });
    const aigcLabel = page.getByRole('switch', { name: 'AIGC 标识' });
    if (!(await watermark.isChecked())) await watermark.click();
    if (!(await aigcLabel.isChecked())) await aigcLabel.click();
    await expect(watermark).toBeChecked();
    await expect(aigcLabel).toBeChecked();
    await page
      .getByRole('checkbox', {
        name: /我已确认模型、规格、费用和发布标识/,
      })
      .check();
    await expect(
      page.getByRole('button', { name: '提交生成任务' })
    ).toBeEnabled();
    await page.getByRole('button', { name: '提交生成任务' }).click();
    const candidates = page.getByRole('radiogroup', {
      name: '三条文案候选',
    });
    await expect(candidates.getByRole('radio')).toHaveCount(3);
    const acceptSelected = page.getByRole('button', {
      name: '采用所选文案',
    });
    await expect(acceptSelected).toBeDisabled();
    const candidateB = candidates.getByRole('radio', {
      name: /^候选 B：/,
    });
    await candidateB.click();
    await expect(candidateB).toBeChecked();
    await expect(candidates.getByRole('radio', { checked: true })).toHaveCount(
      1
    );
    await expect(acceptSelected).toBeEnabled();

    const generated = await creativeProjection(page);
    expect(generated.works).toHaveLength(1);
    expect(generated.jobs).toHaveLength(1);
    expect(generated.assets).toHaveLength(3);
    expect(generated.contents).toEqual([]);
    expect(generated.jobs[0]).toMatchObject({
      contract: {
        aigcLabelEnabled: true,
        currency: 'USD',
        estimatedAmount: 0.06,
        operation: 'copy.generate',
        outputCount: 3,
        watermarkEnabled: true,
      },
      outputContentIds: [],
      status: 'completed',
    });
    expect([...generated.jobs[0]!.outputAssetIds].sort()).toEqual(
      generated.assets.map(({ id }) => id).sort()
    );
    const selectedAsset = generated.assets.find(
      ({ candidateIndex }) => candidateIndex === 1
    );
    expect(selectedAsset).toBeTruthy();

    await acceptSelected.click();
    await expect(
      page.getByText('本批已采用 1 条文案', { exact: true })
    ).toBeVisible();
    const accepted = await creativeProjection(page);
    expect(accepted.contents).toEqual([]);
    expect(accepted.jobs[0]?.outputContentIds).toEqual([]);
    const acceptedPackages = await contentPackages(page);
    expect(acceptedPackages).toHaveLength(1);
    expect(acceptedPackages[0]).toMatchObject({
      kind: 'image_text',
      source: {
        assetIds: expect.arrayContaining([selectedAsset?.id, sourceAssetId]),
      },
      status: 'accepted',
      versions: [
        expect.objectContaining({
          orderedAssetIds: [sourceAssetId],
        }),
      ],
    });
    expect(accepted.events.map(({ type }) => type)).toEqual([
      'first_work_created',
      'first_job_submitted',
      'first_assets_visible',
      'first_content_accepted',
    ]);

    await page.reload();
    const restoredSelector = page.getByRole('region', {
      name: '文案候选择优',
    });
    await expect(
      restoredSelector.getByText('本批已采用 1 条文案', { exact: true })
    ).toBeVisible();
    const restoredCandidates = restoredSelector.getByRole('radiogroup', {
      name: '三条文案候选',
    });
    await expect(restoredCandidates.getByRole('radio')).toHaveCount(3);
    await expect(
      restoredCandidates.getByRole('radio', { name: /^候选 B：/ })
    ).toBeChecked();
    await expect(
      restoredCandidates.getByRole('radio', { checked: true })
    ).toHaveCount(1);
    await expect(
      restoredSelector.getByRole('button', { name: '采用所选文案' })
    ).toBeDisabled();

    const restored = await creativeProjection(page);
    expect(restored.contents).toEqual([]);
    expect(restored.jobs[0]?.outputContentIds).toEqual([]);
    const restoredPackages = await contentPackages(page);
    expect(restoredPackages).toHaveLength(1);
    expect(restoredPackages[0]?.id).toBe(acceptedPackages[0]?.id);

    const packageId = restoredPackages[0]!.id;
    await page.getByRole('button', { name: '新建创作' }).click();
    await createWork(page, '基于同一门店实拍生成一张猫眼项目视觉图');
    await submitImageAndSaveAsset(page);
    const mediaProjection = await creativeProjection(page);
    const imageJob = mediaProjection.jobs.find(
      (job) => job.contract.operation === 'image.generate'
    );
    expect(imageJob).toBeTruthy();
    const generatedImage = mediaProjection.assets.find(
      (asset) => asset.jobId === imageJob?.id && asset.kind === 'image'
    );
    expect(generatedImage).toBeTruthy();

    const attachToContent = page.getByRole('button', {
      name: '加入当前成品',
    });
    await expect(attachToContent).toBeVisible();
    await attachToContent.click();
    await expect(
      page
        .getByTestId('content-package-generation-attachment')
        .getByText('已加入当前成品', { exact: true })
    ).toBeVisible();
    await expect
      .poll(async () => {
        const attachedPackage = (await contentPackages(page)).find(
          (item) => item.id === packageId
        );
        const currentVersion = attachedPackage?.versions.find(
          (version) => version.id === attachedPackage.currentVersionId
        );
        return {
          childRunIds:
            attachedPackage?.generated.childRuns.map((run) => run.runId) ?? [],
          generatedAssetIds: attachedPackage?.generated.assetIds ?? [],
          orderedAssetIds: currentVersion?.orderedAssetIds ?? [],
          ownedAssetIds:
            attachedPackage?.generated.ownedAssets?.map((asset) => asset.id) ??
            [],
        };
      })
      .toEqual({
        childRunIds: expect.arrayContaining([imageJob!.id]),
        generatedAssetIds: [generatedImage!.id],
        orderedAssetIds: [sourceAssetId, generatedImage!.id],
        ownedAssetIds: [generatedImage!.id],
      });

    await page.getByRole('link', { name: '查看当前成品' }).click();
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/works/${encodeURIComponent(packageId)}(?:\\?|$)`)
    );
    await expect(
      page.getByText('视觉顺序：2 张', { exact: true }).first()
    ).toBeVisible();
    await expect(
      page.getByRole('img', { name: '第 2 张' }).first()
    ).toBeVisible();
    const libraryCard = page.locator(
      `[data-content-package-id="${packageId}"]`
    );
    await expect(libraryCard).toBeVisible();
    await expect(libraryCard.locator('img').first()).toBeVisible();
    await expect(libraryCard.locator('img').first()).toHaveAttribute(
      'src',
      /\/api\/core\/p1\/assets\?objectKey=/
    );

    // M-04 DEMOTED (T37 / #231) — 三平台版本 leg of the retired
    // ContentPackageDetail. T34 replaced that page with the works face and this
    // control moved with it; relanding the journey is T38's call. The contract
    // is not uncovered meanwhile: `assembly-gate-required-journey.spec.ts`
    // asserts the three platform variants on the delivered ContentPackage.
    const generateVariants = page.getByRole('button', {
      name: /^生成三平台版本/,
    });
    await expect(generateVariants).toBeEnabled({ timeout: 30_000 });
    await generateVariants.click();
    await expect
      .poll(
        async () =>
          (await contentPackages(page)).find((item) => item.id === packageId)
            ?.variants.length,
        { timeout: 60_000 }
      )
      .toBe(3);
    const withVariants = (await contentPackages(page)).find(
      (item) => item.id === packageId
    );
    for (const variant of withVariants?.variants ?? []) {
      expect(
        variant.versions.find(
          (version) => version.id === variant.currentVersionId
        )?.orderedAssetIds
      ).toEqual([sourceAssetId, generatedImage!.id]);
    }

    await page.reload();
    const reloadedPackage = (await contentPackages(page)).find(
      (item) => item.id === packageId
    );
    expect(
      reloadedPackage?.versions.find(
        (version) => version.id === reloadedPackage.currentVersionId
      )?.orderedAssetIds
    ).toEqual([sourceAssetId, generatedImage!.id]);
    await expect(
      page.locator(`[data-content-package-id="${packageId}"]`)
    ).toBeVisible();
    await expect(
      page
        .locator(`[data-content-package-id="${packageId}"]`)
        .locator('img')
        .first()
    ).toBeVisible();
    await page.getByRole('button', { name: '小红书', exact: true }).click();
    await expect(page.getByText('辅助完成', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '导出小红书' }).click();
    const download = page.getByRole('link', { name: '下载导出文件' });
    await expect(download).toBeVisible({ timeout: 30_000 });
    const archive = await download.evaluate(async (link) => {
      const response = await fetch((link as HTMLAnchorElement).href, {
        credentials: 'same-origin',
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        contentType: response.headers.get('content-type'),
        magic: Array.from(bytes.slice(0, 4)),
        size: bytes.byteLength,
        status: response.status,
      };
    });
    expect(archive).toMatchObject({
      contentType: 'application/zip',
      magic: [0x50, 0x4b, 0x03, 0x04],
      status: 200,
    });
    expect(archive.size).toBeGreaterThan(100);
    const exported = (await contentPackages(page)).find(
      (item) => item.id === packageId
    );
    expect(exported?.exportReceipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: 'xiaohongshu',
          status: 'succeeded',
        }),
      ])
    );
    await page
      .getByLabel('发布地址（可选）')
      .fill('https://www.xiaohongshu.com/explore/e2e-published');
    await page.getByRole('button', { name: '记录已发布' }).click();
    await expect(
      page.locator('[data-delivery-event="manual_publish_result"]')
    ).toContainText('已发布');
    const storeVisit = page.getByRole('button', {
      exact: true,
      name: '到店',
    });
    await expect(storeVisit).toBeEnabled();
    await storeVisit.click();
    await expect(page.locator('[data-signal-source="merchant"]')).toContainText(
      '到店'
    );
    for (const step of [
      'published',
      'attention',
      'consultation',
      'appointment_or_purchase',
      'redeemed_or_visited',
    ]) {
      await expect(
        page.locator(`[data-ladder-step="${step}"]`)
      ).toHaveAttribute('data-reached', 'true');
    }
    expect(JSON.stringify(exported)).not.toContain('providerCost');
    const beforeCtaChange = (await contentPackages(page)).find(
      (item) => item.id === packageId
    )!;
    await page.getByRole('button', { name: '换 CTA' }).click();
    await expect
      .poll(async () => {
        const changed = (await contentPackages(page)).find(
          (item) => item.id === packageId
        );
        return {
          action: changed?.resultReviewActions?.at(-1)?.action,
          currentVersionId: changed?.currentVersionId,
          versionCount: changed?.versions.length,
        };
      })
      .toEqual({
        action: 'change_cta',
        currentVersionId: expect.any(String),
        versionCount: beforeCtaChange.versions.length + 1,
      });
    const afterCtaChange = (await contentPackages(page)).find(
      (item) => item.id === packageId
    )!;
    const changedCtaVersion = afterCtaChange.versions.find(
      (version) => version.id === afterCtaChange.currentVersionId
    );
    expect(changedCtaVersion).toMatchObject({
      derivedFromVersionId: beforeCtaChange.currentVersionId,
    });
    const packageCountBeforeContinue = (await contentPackages(page)).length;
    await page.getByRole('button', { name: '续做这一系列' }).click();
    await expect(page).toHaveURL(/\/dashboard\?taskId=/u);
    expect(await contentPackages(page)).toHaveLength(
      packageCountBeforeContinue
    );
    const continuationTask = await page.evaluate(async (expectedPackageId) => {
      const response = await fetch('/api/core/p1/query', {
        body: JSON.stringify({
          action: 'inbox',
          module: 'operations',
          payload: {},
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      const envelope = (await response.json()) as {
        data: {
          tasks: Array<{
            id: string;
            relatedObject?: { id: string; kind: string };
            source: string;
          }>;
        };
      };
      return envelope.data.tasks.find(
        (task) => task.relatedObject?.id === expectedPackageId
      );
    }, packageId);
    expect(continuationTask).toMatchObject({
      relatedObject: { id: packageId, kind: 'content' },
      source: 'weekly_review',
    });

    // M-04 DEMOTED (T37 / #231) — 海报 leg of the retired ContentPackageDetail,
    // same disposition as the 三平台版本 block above: T34 replaced the page,
    // T38 owns relanding the journey. Core-level equivalents stay in
    // `image-intent-service-journeys.spec.ts` and `image-text-note-compiler.spec.ts`.
    await page.goto(`/dashboard/works/${encodeURIComponent(packageId)}`);
    await page.getByRole('button', { exact: true, name: '海报' }).click();
    const openPoster = page.getByRole('button', { name: '去做宣传海报' });
    await expect(openPoster).toBeVisible();
    const posterPackage = (await contentPackages(page)).find(
      (item) => item.id === packageId
    )!;
    const posterVersion = posterPackage.versions.find(
      (version) => version.id === posterPackage.currentVersionId
    )!;
    await openPoster.click();
    await expect(page).toHaveURL(/\/dashboard\/works\//u);
    const seededWork = await page.evaluate(async () => {
      const workId = decodeURIComponent(location.pathname.split('/').at(-1)!);
      const response = await fetch('/api/core/p1/query', {
        body: JSON.stringify({
          action: 'work',
          module: 'operations',
          payload: { workId },
        }),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      const envelope = (await response.json()) as {
        data?: {
          sourceContentPackageId?: string;
          sourceContentPackageVersionId?: string;
          revisions: Array<{
            document: {
              height: number;
              pages: Array<{
                elements: Array<{ kind: string; text?: string }>;
              }>;
              width: number;
            };
          }>;
        };
        error?: { message: string };
      };
      if (!response.ok || !envelope.data) {
        throw new Error(envelope.error?.message ?? 'Seeded work query failed');
      }
      return envelope.data;
    });
    const document = seededWork.revisions[0]!.document;
    expect(seededWork).toMatchObject({
      sourceContentPackageId: packageId,
      sourceContentPackageVersionId: posterVersion.id,
    });
    expect({ height: document.height, width: document.width }).toEqual({
      height: 1080,
      width: 1080,
    });
    expect(
      document.pages[0]!.elements.filter(
        (element) => element.kind === 'text'
      ).map((element) => element.text)
    ).toEqual(
      expect.arrayContaining([
        posterVersion.title,
        posterVersion.body,
        posterVersion.conversionHook,
      ])
    );
  });

  test('reload and derivation preserve the object graph', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedAuthorizedGrounding(page);
    await createWork(page, '生成一条可恢复且可另存条件的内容');
    await submitImageAndSaveAsset(page);
    const before = await creativeProjection(page);
    expect(before.jobs[0]).toMatchObject({
      contract: { operation: 'image.generate' },
      status: 'completed',
    });
    expect(before.jobs[0]?.recoveredAt).toBeTruthy();
    expect(before.assets).toHaveLength(1);
    expect(before.assets[0]?.kind).toBe('image');
    expect(before.contents).toEqual([]);

    const canonicalObjects = [
      {
        heading: '创作记录',
        linkName: '打开 Session',
        path: `/dashboard/sessions/${before.works[0]!.sessionId}`,
      },
      {
        heading: '作品详情',
        linkName: '打开 Work',
        path: `/dashboard/works/${before.works[0]!.id}`,
      },
      {
        heading: '执行详情',
        linkName: '打开 Job',
        path: `/dashboard/jobs/${before.jobs[0]!.id}`,
      },
    ];
    for (const object of canonicalObjects) {
      await page.goto(object.path);
      await expect(
        page.getByRole('heading', { level: 1, name: object.heading })
      ).toBeVisible();
      await expect(
        page.getByRole('link', { name: object.linkName })
      ).toHaveAttribute('href', object.path);
      await page.reload();
      await expect(
        page.getByRole('link', { name: object.linkName })
      ).toHaveAttribute('href', object.path);
    }

    const parentWorkId = before.works[0]!.id;
    await page.goto(`/dashboard/results/${encodeURIComponent(parentWorkId)}`);
    await expect(page).toHaveURL(
      new RegExp(
        `/dashboard/results/${encodeURIComponent(parentWorkId)}(?:\\?|$)`
      )
    );
    const recovered = await creativeProjection(page);
    expect(recovered.works.map(({ id }) => id)).toEqual(
      before.works.map(({ id }) => id)
    );
    expect(recovered.jobs.map(({ id }) => id)).toEqual(
      before.jobs.map(({ id }) => id)
    );
    expect(recovered.assets.map(({ id }) => id)).toEqual(
      before.assets.map(({ id }) => id)
    );
    expect(recovered.contents.map(({ id }) => id)).toEqual(
      before.contents.map(({ id }) => id)
    );

    await page.getByRole('button', { name: '调整条件并另存为新创作' }).click();
    await expect(page.getByText('基于上一版调整')).toBeVisible();
    const derived = await creativeProjection(page);
    expect(derived.works).toHaveLength(2);
    const derivedWork = derived.works.find(
      (work) => work.derivedFrom === parentWorkId
    );
    expect(derivedWork).toBeTruthy();
    await expect(page).toHaveURL(
      new RegExp(
        `/dashboard/results/${encodeURIComponent(derivedWork!.id)}(?:\\?|$)`
      )
    );
    expect(derived.jobs.map(({ id }) => id)).toEqual(
      before.jobs.map(({ id }) => id)
    );
    expect(derived.assets.map(({ id }) => id)).toEqual(
      before.assets.map(({ id }) => id)
    );
    expect(derived.contents.map(({ id }) => id)).toEqual(
      before.contents.map(({ id }) => id)
    );
  });

  test('recorded-only model stays unavailable and cannot submit', async ({
    page,
    request,
  }) => {
    await page.route('**/api/core/p1/query', async (route) => {
      const body = route.request().postDataJSON() as {
        action?: string;
        module?: string;
      };
      if (body.module !== 'model-supply' || body.action !== 'catalog') {
        await route.continue();
        return;
      }
      await route.fulfill({
        body: JSON.stringify({
          data: {
            models: [
              {
                activationEvidence: { status: 'recorded' },
                availability: 'recorded',
                displayName: 'Recorded LLM',
                id: 'llm-recorded-only',
                modality: 'llm',
                operations: ['copy.generate'],
                qualityRank: 1,
              },
            ],
            revisionId: 'recorded-only-r1',
          },
        }),
        contentType: 'application/json',
        status: 200,
      });
    });
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await createWork(page, '不可用模型仍允许保存真实草稿');

    await expect(page.getByText('未选择模型', { exact: true })).toBeVisible();
    await expect(page.getByText(/尚未完成可用性验证/)).toBeVisible();
    await page
      .getByRole('checkbox', {
        name: /我已确认模型、规格、费用和发布标识/,
      })
      .check();
    await expect(
      page.getByRole('button', { name: '提交生成任务' })
    ).toBeDisabled();
    await page.screenshot({
      fullPage: true,
      path: evidencePath(
        'uiux-upgrade-b/screenshots/00b-recorded-gate-desktop.png'
      ),
    });
    const projection = await creativeProjection(page);
    expect(projection.works).toHaveLength(1);
    expect(projection.jobs).toEqual([]);
  });
});
