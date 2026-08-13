import { expect, type Page } from '@playwright/test';

import { productState } from './product';
import { closeComposerCapsule, openComposerCapsule } from './ui-journey';

export async function authorizeLatestLibraryAssetAsCustomerCase(page: Page) {
  await expect(
    page.getByRole('link', { name: '确认这张素材能否用于宣传' })
  ).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: '确认这张素材能否用于宣传' }).click();
  await expect(page).toHaveURL(/\/dashboard\/assets\/asset-/u, {
    timeout: 30_000,
  });
  const category = page.locator('select[id$="-category"]');
  await expect(category).toBeVisible();
  await category.selectOption('customer_case');
  const xhs = page.getByRole('button', { name: /小红书|Xiaohongshu/u });
  if ((await xhs.getAttribute('aria-pressed')) !== 'true') {
    await xhs.click();
  }
  const noExpiry = page.getByRole('button', { name: /无固定期限|No fixed/u });
  if ((await noExpiry.getAttribute('aria-pressed')) !== 'true') {
    await noExpiry.click();
  }
  await page.getByRole('button', { name: /确认公开营销授权/u }).click();
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

export async function pickComposerLibraryAsset(page: Page, assetId: string) {
  const panel = await openComposerCapsule(page, 'attach');
  const pick = page.getByTestId(`composer-library-source-${assetId}`);
  await expect(pick).toBeVisible({ timeout: 15_000 });
  await pick.click();
  await expect(pick)
    .toBeHidden({ timeout: 10_000 })
    .catch(async () => {
      await closeComposerCapsule(page, panel);
    });
}
