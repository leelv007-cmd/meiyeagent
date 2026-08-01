import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { seedConfirmedStore } from '../fixtures/product';
import {
  adoptResult,
  JOURNEY_CONTRACTS,
  openDeliveryPanel,
  submitComposerJourney,
  waitForResultJourney,
} from '../fixtures/ui-journey';

const copyContract = JOURNEY_CONTRACTS.find(
  ({ modality }) => modality === 'copy'
);

if (!copyContract)
  throw new Error('Copy Composer journey contract is required');

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test.afterEach(async ({ request }) => {
  await cleanupE2EUsers(request);
});

test('language switching preserves an authenticated route, query, and hash', async ({
  page,
  request,
}) => {
  const user = await registerE2EUser(request);
  await loginByForm(page, user);
  await page.goto('/dashboard/assets?from=uiux-277#gallery');

  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await page.getByRole('button', { name: '语言', exact: true }).click();
  await page.getByRole('menuitem', { name: /English$/u }).click();
  await expect(page).toHaveURL((url) => {
    return (
      url.pathname === '/en/dashboard/assets' &&
      url.searchParams.get('from') === 'uiux-277' &&
      url.hash === '#gallery'
    );
  });
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.reload();
  await expect(page).toHaveURL(
    /\/en\/dashboard\/assets\?from=uiux-277#gallery$/u
  );
  await page.getByRole('button', { name: /language/iu }).click();
  await page.getByRole('menuitem', { name: /中文$/u }).click();
  await expect(page).toHaveURL(/\/dashboard\/assets\?from=uiux-277#gallery$/u);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
});

test('reduced motion keeps the Composer conversation and ContentPackage delivery static', async ({
  page,
  request,
}) => {
  test.setTimeout(360_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const user = await registerE2EUser(request);
  await loginByForm(page, user);
  await seedConfirmedStore(page);
  await page.goto('/dashboard');

  const workId = await submitComposerJourney(
    page,
    copyContract,
    `减少动效内容包 ${crypto.randomUUID()}`,
    {
      async onRunStreaming() {
        await expect(page.getByTestId('composer-conversation')).toHaveAttribute(
          'data-motion',
          'off'
        );
      },
    }
  );
  await waitForResultJourney(page, copyContract, workId);
  await adoptResult(page, copyContract);
  await openDeliveryPanel(page, copyContract.modality);
  await expect(page.getByTestId('delivery-panel')).toHaveAttribute(
    'data-direct-publish-hidden',
    'true'
  );
});

for (const viewport of [
  { width: 379, height: 820 },
  { width: 390, height: 844 },
]) {
  test(`mobile ${viewport.width} keeps the five current product destinations usable in both locales`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize(viewport);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    const zhNav = page.getByRole('navigation', { name: '移动端导航' });
    await expect(zhNav).toBeVisible();
    for (const label of ['创作', '口吻与素材', '内容', '门店', '经验']) {
      await expect(zhNav.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByTestId('composer-home')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.goto('/en/dashboard');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    const enNav = page.getByRole('navigation', { name: 'Mobile navigation' });
    await expect(enNav).toBeVisible();
    for (const label of [
      'Create',
      'Voices & assets',
      'Content',
      'Store',
      'Memory',
    ]) {
      await expect(enNav.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByTestId('composer-home')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}
