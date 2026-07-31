import { expect, test } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { productState, seedConfirmedStore } from '../fixtures/product';
import { assertThreeModalDiscovery } from '../fixtures/ui-journey';

test.afterEach(async ({ request }) => {
  await cleanupE2EUsers(request);
});

test('cold Composer exposes the required lenses without a merchant submission', async ({
  page,
  request,
}) => {
  const user = await registerE2EUser(request);
  await loginByForm(page, user);

  await assertThreeModalDiscovery(page);
  await expect(page.getByTestId('composer-intent-input')).toBeVisible();
  await expect(page.getByTestId('composer-submit')).toHaveAccessibleName(
    '先补门店信息'
  );
  await expect(page.getByTestId('composer-submit')).toBeEnabled();
  await expect(page.getByTestId('composer-conversation')).toBeVisible();
  await expect(page.getByTestId('composer-turn-merchant')).toHaveCount(0);
});

test('lens and intent bind a quote without writing a product record', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const user = await registerE2EUser(request);
  await loginByForm(page, user);
  await seedConfirmedStore(page);
  await page.goto('/dashboard');

  const before = await productState(page);
  const lens = page.getByTestId('composer-lens-option-copy');
  await lens.click();
  await expect(lens).toBeChecked();
  await page
    .getByTestId('composer-intent-input')
    .fill('为到店护理写一条朋友圈项目介绍');
  await expect(page.getByTestId('composer-quote-line')).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId('composer-submit')).toBeEnabled();

  const after = await productState(page);
  expect(after.assets).toEqual(before.assets);
  expect(after.contents).toEqual(before.contents);
});
