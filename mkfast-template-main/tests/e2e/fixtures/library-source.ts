import { readFile } from 'node:fs/promises';

import { expect, type Page } from '@playwright/test';

import { productState } from './product';
import { closeComposerCapsule, openComposerCapsule } from './ui-journey';

const PNG_FIXTURES = await Promise.all(
  [
    '../../../public/model-previews/image-beauty-preview.png',
    '../../../public/model-previews/copy-planning-preview.png',
  ].map((path) => readFile(new URL(path, import.meta.url)))
);

/**
 * The library upload input ships from the server disabled — `product.state` is
 * only there after hydration — and `setInputFiles` does not wait for enabled.
 * Waiting on `toBeAttached` therefore drops the bytes onto a disabled input
 * whose React `onChange` never runs: no request, no asset, no error anywhere.
 * Enabled is the hydration gate, so wait for that instead.
 */
export async function uploadLibraryAsset(
  page: Page,
  file: { buffer: Buffer; mimeType?: string; name: string }
) {
  const input = page.locator('#canonical-asset-upload');
  await expect(input).toBeEnabled({ timeout: 60_000 });
  await input.setInputFiles({
    buffer: file.buffer,
    mimeType: file.mimeType ?? 'image/png',
    name: file.name,
  });
}

export async function authorizeLatestLibraryAssetAsCustomerCase(page: Page) {
  await expect(
    page.getByRole('link', { name: '确认这张素材能否用于宣传' })
  ).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: '确认这张素材能否用于宣传' }).click();
  await expect(page).toHaveURL(/\/dashboard\/assets\/asset-/u, {
    timeout: 30_000,
  });
  const category = page.locator('select[id$="-category"]');
  // Asset detail can still show "正在读取素材" after the URL lands.
  await expect(category).toBeVisible({ timeout: 60_000 });
  await category.selectOption('customer_case');
  // Restricted customer_case rights are platform-scoped. A 抖音 deliverable
  // with only 小红书 selected lands unauthorizedAssetIds and freezes 开始制作.
  for (const name of [/小红书|Xiaohongshu/u, /抖音|Douyin/u] as const) {
    const platform = page.getByRole('button', { name });
    if ((await platform.getAttribute('aria-pressed')) !== 'true') {
      await platform.click();
    }
  }
  const noExpiry = page.getByRole('button', { name: /无固定期限|No fixed/u });
  if ((await noExpiry.getAttribute('aria-pressed')) !== 'true') {
    await noExpiry.click();
  }
  // Withdrawn rows omit this button (`authorization.action === 'none'`).
  // Fail here instead of hanging the 600s journey timeout.
  const confirm = page.getByRole('button', { name: /确认公开营销授权/u });
  await expect(
    confirm,
    'library authorize confirm must exist; a withdrawn reuse has no confirm'
  ).toBeVisible({ timeout: 15_000 });
  await expect(confirm).toBeEnabled({ timeout: 15_000 });
  await confirm.click();
  await expect(page.getByText(/公开营销可用|Authorized/u)).toBeVisible({
    timeout: 30_000,
  });
  const authorized = (await productState(page)).assets.find(
    (asset) =>
      asset.authorizationStatus === 'authorized' &&
      asset.category === 'customer_case'
  );
  if (!authorized) {
    throw new Error('Library authorize did not produce a customer_case asset');
  }
  return authorized;
}

/**
 * D7=A replacement for seedComposerInlineAuthorize: merchant-visible
 * assets page upload + authorize + composer library pick.
 */
export async function attachComposerSourceViaLibrary(
  page: Page,
  file: {
    buffer?: Buffer;
    mimeType?: string;
    name?: string;
    fileName?: string;
    fixtureIndex?: 0 | 1;
    expectedAssetId?: string;
  } = {}
) {
  if (file.expectedAssetId) {
    // A remount drops the merchant's lens/recipe. Re-pick in place when the
    // composer is already up (video reload + recipe, then same-asset attach).
    const onComposer =
      /\/dashboard\/?(\?|$)/u.test(new URL(page.url()).pathname) &&
      (await page
        .getByTestId('composer-home')
        .isVisible()
        .catch(() => false));
    if (!onComposer) {
      await page.goto('/dashboard');
      await expect(page.getByTestId('composer-home')).toBeVisible({
        timeout: 60_000,
      });
    }
    await pickComposerLibraryAsset(page, file.expectedAssetId);
    const existing = (await productState(page)).assets.find(
      (asset) => asset.id === file.expectedAssetId
    );
    if (!existing) {
      throw new Error(
        `Library pick did not find expected asset ${file.expectedAssetId}`
      );
    }
    return existing;
  }
  await page.goto('/dashboard/assets');
  await uploadLibraryAsset(page, {
    buffer: file.buffer ?? PNG_FIXTURES[file.fixtureIndex ?? 0]!,
    mimeType: file.mimeType,
    name: file.name ?? file.fileName ?? `e2e-library-${crypto.randomUUID()}.png`,
  });
  const authorized = await authorizeLatestLibraryAssetAsCustomerCase(page);
  await page.goto('/dashboard');
  await expect(page.getByTestId('composer-home')).toBeVisible({
    timeout: 60_000,
  });
  await pickComposerLibraryAsset(page, authorized.id);
  return authorized;
}

export async function pickComposerLibraryAsset(page: Page, assetId: string) {
  const panel = await openComposerCapsule(page, 'attach');
  const pick = page.getByTestId(`composer-library-source-${assetId}`);
  await expect(pick).toBeVisible({ timeout: 30_000 });
  await pick.click();
  await expect(pick)
    .toBeHidden({ timeout: 10_000 })
    .catch(async () => {
      await closeComposerCapsule(page, panel);
    });
}
