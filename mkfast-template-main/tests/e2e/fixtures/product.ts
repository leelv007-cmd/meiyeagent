import type {
  CommandResult,
  ProductCommand,
  ProductState,
} from '@meiye/contracts';
import { expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const PNG_FIXTURES = await Promise.all(
  [
    '../../../public/model-previews/image-beauty-preview.png',
    '../../../public/model-previews/copy-planning-preview.png',
  ].map((path) => readFile(new URL(path, import.meta.url)))
);

export async function productCommand(
  page: Page,
  command: ProductCommand,
  idempotencyKey = `e2e-product-${crypto.randomUUID()}`
) {
  return page.evaluate(
    async ({ command: input, idempotencyKey: key }) => {
      const response = await fetch('/api/core/product/commands', {
        body: JSON.stringify(input),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': key,
        },
        method: 'POST',
      });
      const envelope = (await response.json()) as {
        data?: CommandResult;
        error?: { message: string };
      };
      if (!response.ok || !envelope.data) {
        throw new Error(envelope.error?.message ?? 'Product command failed');
      }
      return envelope.data;
    },
    { command, idempotencyKey }
  );
}

export async function productState(page: Page) {
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

/** Confirmed store facts only — measurement prep for Day-0, no library path. */
export async function seedConfirmedStore(page: Page) {
  await productCommand(page, {
    type: 'confirm_store',
    store: {
      accounts: [],
      address: '湖墅南路 88 号',
      booking: '提前一天预约',
      brandVoice: '专业、克制、像熟客推荐',
      city: '杭州',
      district: '拱墅区',
      name: 'E2E 美业门店',
      prohibitions: ['不虚构价格'],
      projects: [
        {
          confirmed: true,
          durationMinutes: 90,
          id: 'project-grounded-creation',
          name: '透亮猫眼',
          price: 299,
        },
      ],
      regulated: false,
    },
  });
}

/**
 * Day-0 inline authorize seed via composer path (NOT library detail form).
 * Must complete before user-activation measurement begins.
 */
export async function seedComposerInlineAuthorize(
  page: Page,
  options: {
    expectedAssetId?: string;
    fileName?: string;
    fixtureIndex?: 0 | 1;
  } = {}
) {
  const fileName =
    options.fileName ?? `e2e-inline-auth-${crypto.randomUUID()}.png`;
  if (!page.url().includes('/dashboard')) {
    await page.goto('/dashboard');
  }
  const existingAssetIds = new Set(
    (await productState(page)).assets.map(({ id }) => id)
  );
  const galleryInput = page.locator('#composer-gallery-input');
  await expect(galleryInput).toBeAttached({ timeout: 30_000 });
  await galleryInput.setInputFiles({
    buffer: PNG_FIXTURES[options.fixtureIndex ?? 0]!,
    mimeType: 'image/png',
    name: fileName,
  });
  const oneClickYes = page.getByRole('button', {
    name: /确认：允许公开宣传|Confirm public use|是，可用于公开宣传/,
  });
  await expect(oneClickYes).toBeVisible({ timeout: 30_000 });
  await oneClickYes.click();
  await expect(
    page.getByText(/已保存到素材库|素材信息已确认|Saved to assets/).first()
  ).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(
      async () => {
        const state = await productState(page);
        return state.assets.some(
          (asset) =>
            (options.expectedAssetId
              ? asset.id === options.expectedAssetId
              : !existingAssetIds.has(asset.id)) &&
            asset.consentScope === 'public_marketing' &&
            Boolean(asset.rightsEvidence?.trim())
        );
      },
      { timeout: 60_000 }
    )
    .toBe(true);
  const authorized = (await productState(page)).assets.find(
    (asset) =>
      (options.expectedAssetId
        ? asset.id === options.expectedAssetId
        : !existingAssetIds.has(asset.id)) &&
      asset.consentScope === 'public_marketing' &&
      Boolean(asset.rightsEvidence?.trim())
  );
  if (!authorized)
    throw new Error('Composer inline authorize produced no asset');
  return authorized;
}

/**
 * Library-path authorized grounding (asset detail form).
 * MUST NOT be used as Day-0 inline proof — use seedComposerInlineAuthorize.
 */
export async function seedAuthorizedGrounding(
  page: Page,
  options: {
    fileExtension?: 'jpg' | 'png';
    mimeType?: 'image/jpeg' | 'image/png';
  } = {}
) {
  const fileExtension = options.fileExtension ?? 'png';
  const mimeType = options.mimeType ?? 'image/png';
  const assetLabel = `e2e-grounding-${crypto.randomUUID()}.${fileExtension}`;
  await productCommand(page, {
    type: 'confirm_store',
    store: {
      accounts: [],
      address: '湖墅南路 88 号',
      booking: '提前一天预约',
      brandVoice: '专业、克制、像熟客推荐',
      city: '杭州',
      district: '拱墅区',
      name: 'E2E 美业门店',
      prohibitions: ['不虚构价格'],
      projects: [
        {
          confirmed: true,
          durationMinutes: 90,
          id: 'project-grounded-creation',
          name: '透亮猫眼',
          price: 299,
        },
      ],
      regulated: false,
    },
  });

  const existingAssetIds = new Set(
    (await productState(page)).assets.map((asset) => asset.id)
  );
  await page.goto('/dashboard/assets');
  const uploadInput = page.locator('#canonical-asset-upload');
  await expect(uploadInput).toBeEnabled({ timeout: 30_000 });
  await uploadInput.setInputFiles({
    buffer: PNG_FIXTURES[0]!,
    mimeType,
    name: assetLabel,
  });
  let assetId: string | undefined;
  await expect
    .poll(
      async () => {
        assetId = (await productState(page)).assets.find(
          (asset) => !existingAssetIds.has(asset.id)
        )?.id;
        return assetId;
      },
      { timeout: 30_000 }
    )
    .toBeTruthy();
  if (!assetId) throw new Error('Uploaded Product asset has no detail URL');
  await page.goto(`/dashboard/assets/${assetId}`);
  await productCommand(page, {
    type: 'update_asset_metadata',
    assetId,
    category: 'other',
    containsPerson: false,
    containsSensitiveData: false,
    minorStatus: 'none',
    rightsOwner: 'E2E 美业门店',
    tags: [assetLabel],
  });
  await page.getByLabel('授权凭证编号或存档位置').fill('e2e-owner-confirmed');
  await page.getByRole('button', { name: /确认公开营销授权/ }).click();
  await page.getByText('公开营销可用', { exact: true }).first().waitFor();

  await page.goto('/dashboard');
  const moreSources = page.getByRole('button', {
    exact: true,
    name: '更多',
  });
  await moreSources.waitFor({ state: 'visible', timeout: 30_000 });
  if ((await moreSources.getAttribute('aria-expanded')) !== 'true') {
    await moreSources.click();
  }
  const sourceButton = page.getByRole('button', { name: assetLabel });
  await sourceButton.waitFor({ state: 'visible' });
  if ((await sourceButton.getAttribute('aria-pressed')) !== 'true') {
    await sourceButton.click();
  }
  return assetId;
}

export async function seedAcceptedProductContent(page: Page, prefix: string) {
  const projectId = `project-${prefix}`;
  const assetId = `asset-${prefix}`;
  const confirmed = await productCommand(page, {
    type: 'confirm_store',
    store: {
      name: 'E2E 美业门店',
      city: '杭州',
      district: '拱墅区',
      address: '湖墅南路 88 号',
      booking: '提前一天预约',
      brandVoice: '专业、克制、像熟客推荐',
      prohibitions: ['不承诺疗效', '不虚构价格'],
      accounts: [{ platform: 'xiaohongshu', nickname: 'E2E 美业门店小红书' }],
      projects: [
        {
          id: projectId,
          name: '透亮猫眼',
          price: 299,
          durationMinutes: 90,
          confirmed: true,
        },
      ],
      regulated: false,
    },
  });
  await productCommand(page, {
    type: 'add_asset',
    asset: {
      id: assetId,
      objectKey: `${confirmed.state.workspaceId}/assets/${assetId}.png`,
      mediaType: 'image',
      sourceType: 'real',
      tags: ['猫眼', '显白'],
      rightsOwner: 'E2E 美业门店',
      consentScope: 'internal_only',
      containsPerson: false,
      containsSensitiveData: false,
      minorStatus: 'none',
    },
  });
  await productCommand(page, {
    type: 'authorize_asset',
    assetId,
    consentScope: 'public_marketing',
    rightsEvidence: 'e2e-owner-confirmed',
  });
  const generated = await productCommand(page, {
    type: 'generate_copy',
    brief: {
      assetIds: [assetId],
      conversionGoal: '预约到店',
      hook: '阴天也透亮的猫眼',
      platform: 'xiaohongshu',
      projectId,
      scenario: '项目种草',
      tone: '口语、克制',
    },
  });
  const contentId = generated.output.candidateIds?.[0];
  if (!contentId) throw new Error('Product candidate was not generated');
  await productCommand(page, { type: 'select_content', contentId });
  return { assetId, contentId, projectId };
}
