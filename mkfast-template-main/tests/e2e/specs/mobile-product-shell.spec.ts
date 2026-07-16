import { expect, test } from '@playwright/test';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

test('keeps the four merchant destinations and camera authorization reachable on mobile', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const user = await registerE2EUser(request);
  try {
    await loginByForm(page, user);
    const mobileNav = page.getByRole('navigation', { name: '移动端导航' });
    await expect(mobileNav).toBeVisible();
    for (const label of ['创作', '内容', '新建', '素材', '门店']) {
      await expect(mobileNav.getByText(label, { exact: true })).toBeVisible();
    }

    await mobileNav.getByText('新建', { exact: true }).click();
    await expect(page.getByRole('tab', { name: '行动' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(page.getByText('拍摄素材', { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(390);
    await page.screenshot({
      path: 'test-results/evidence/p0-mobile-workbench.png',
      fullPage: true,
    });

    await page.goto('/dashboard/assets');
    const cameraInput = page.locator('input[type="file"]').first();
    await expect(cameraInput).toHaveAttribute('capture', 'environment');
    await expect(cameraInput).toHaveAttribute('accept', /image/);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(390);

    await page.goto('/dashboard/store');
    const leadLedgerLink = page.getByRole('link', { name: '线索台账' });
    await expect(leadLedgerLink).toBeVisible();
    await leadLedgerLink.click();
    await expect(page).toHaveURL(/\/dashboard\/leads$/);
  } finally {
    await cleanupE2EUsers(request);
  }
});
