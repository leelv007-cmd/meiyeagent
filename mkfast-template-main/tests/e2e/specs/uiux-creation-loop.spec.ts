import { expect, test, type Locator, type Page } from '@playwright/test';
import type {
  ApiEnvelope,
  ContentPackage,
  ProductState,
} from '@meiye/contracts';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { seedAuthorizedGrounding } from '../fixtures/product';

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

async function confirmComposerImageFacts(item: Locator) {
  for (const label of [
    '画面里有人吗？',
    '有手机号、聊天截图等隐私吗？',
    '有未成年人吗？',
  ]) {
    await item
      .getByRole('group', { name: label })
      .getByRole('button', { name: '否' })
      .click();
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
  const confirmBrief = record.getByRole('button', {
    name: '采用并确认 Brief',
  });
  if (await confirmBrief.isVisible()) {
    await confirmBrief.click();
  }
  await expect(record.getByText('Brief 已确认', { exact: true })).toBeVisible();
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
        const job = (await creativeProjection(page)).jobs[0];
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

    const emptyProjection = await creativeProjection(page);
    expect(emptyProjection).toMatchObject({
      assets: [],
      contents: [],
      jobs: [],
      works: [],
    });
    const example = page.getByRole('region', {
      name: '弥鹿美甲示例店',
    });
    await expect(example).toBeHidden();
    await page.getByRole('button', { name: '查看示例' }).click();
    await expect(example).toBeVisible();
    await expect(
      example.getByText('只读 · 浏览不消耗额度', { exact: true })
    ).toBeVisible();
    await expect(example.getByText('猫眼纹理特写')).toBeVisible();
    await expect(example.getByText('门店自然光环境')).toBeVisible();
    await expect(example.getByText('技师操作过程')).toBeVisible();
    await expect(example.getByText('完成效果实拍')).toBeVisible();
    const exampleContents = example.getByRole('radiogroup', {
      name: '示例内容',
    });
    await expect(exampleContents.getByRole('radio')).toHaveCount(3);
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
    await exampleContents
      .getByRole('radio', { name: /30 秒看懂猫眼光带/ })
      .click();
    await example.getByRole('button', { name: '复用这条结构' }).click();

    const remixedIntent = page.getByLabel('描述这次想创作的内容');
    await expect(remixedIntent).toBeFocused();
    await expect(remixedIntent).toHaveValue(
      '做一条抖音美业内容，内容角度围绕“30 秒看懂猫眼光带”；用“开场钩子—项目体验—到店行动”结构，语气真实克制，所有门店与价格事实由我稍后补充。'
    );
    await expect(
      page.getByRole('button', { name: '建立创作记录' })
    ).toBeEnabled();
    expect(await creativeProjection(page)).toMatchObject({
      assets: [],
      contents: [],
      jobs: [],
      works: [],
    });

    await example.getByRole('button', { name: '隐藏示例' }).click();
    await expect(example).toBeHidden();
    expect((await productState(page)).exampleStore.hidden).toBe(true);
    await page.reload();
    await expect(
      page.getByRole('region', { name: '弥鹿美甲示例店' })
    ).toBeHidden();
    await expect(page.getByRole('button', { name: '查看示例' })).toBeVisible();
    await expect(page.getByLabel('描述这次想创作的内容')).toBeVisible();
    expect(await creativeProjection(page)).toMatchObject({
      assets: [],
      contents: [],
      jobs: [],
      works: [],
    });
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
    test.setTimeout(90_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

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

    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/uiux-upgrade-b/screenshots/22a-composer-drop-ready-desktop.png',
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
    await confirmComposerImageFacts(galleryItem);
    await expect(
      galleryItem.getByText('已保存到素材库', { exact: true })
    ).toBeVisible({ timeout: 30_000 });
    await galleryItem
      .getByRole('button', {
        name: '从本次创作中移除 gallery-input.png',
      })
      .click();
    await expect(galleryItem).toBeHidden();

    const dropTransfer = await imageDataTransfer(
      page,
      'dropped-input.png',
      'drop'
    );
    await dropZone.dispatchEvent('dragenter', { dataTransfer: dropTransfer });
    await expect(dropZone).toHaveClass(/border-primary/);
    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/uiux-upgrade-b/screenshots/22b-composer-drop-highlight-desktop.png',
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
      path: '../docs/evidence/uiux-upgrade-b/screenshots/22c-composer-images-added-desktop.png',
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
    expect(removedAsset).toBeTruthy();
    expect(droppedAsset).toBeTruthy();
    expect(pastedAsset).toBeTruthy();

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
    const record = page.getByLabel('创作助理整理的记录');
    await expect(
      record.getByText('dropped-input.png', { exact: true }).first()
    ).toBeVisible();
    await expect(
      record.getByText('pasted-input.png', { exact: true }).first()
    ).toBeVisible();
    await expect(
      record.getByText('gallery-input.png', { exact: true })
    ).toBeHidden();
    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/uiux-upgrade-b/screenshots/22d-work-image-references-desktop.png',
    });
  });

  test('explicit contract adopts one copy and real photo into one ContentPackage', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    const sourceAssetId = await seedAuthorizedGrounding(page, {
      fileExtension: 'jpg',
      mimeType: 'image/jpeg',
    });
    await createWork(page, '为新做的透亮猫眼写一条克制的到店内容');
    await page.getByRole('button', { name: '采用并确认 Brief' }).click();
    await expect(page.getByText('Brief 已确认', { exact: true })).toBeVisible();
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

    await expect(
      page.getByRole('switch', { name: '品牌水印' })
    ).not.toBeChecked();
    await expect(page.getByRole('switch', { name: 'AIGC 标识' })).toBeChecked();
    await page.getByRole('switch', { name: '品牌水印' }).click();
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
    await page.goto(
      `/dashboard/content?packageId=${encodeURIComponent(packageId)}`
    );
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
    await page.getByRole('button', { name: '小红书', exact: true }).click();
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
    expect(JSON.stringify(exported)).not.toContain('providerCost');
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
    await page.goto(`/dashboard?workId=${encodeURIComponent(parentWorkId)}`);
    await expect(page).toHaveURL(
      new RegExp(`workId=${encodeURIComponent(parentWorkId)}`)
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
      new RegExp(`workId=${encodeURIComponent(derivedWork!.id)}`)
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
      path: '../docs/evidence/uiux-upgrade-b/screenshots/00b-recorded-gate-desktop.png',
    });
    const projection = await creativeProjection(page);
    expect(projection.works).toHaveLength(1);
    expect(projection.jobs).toEqual([]);
  });
});
