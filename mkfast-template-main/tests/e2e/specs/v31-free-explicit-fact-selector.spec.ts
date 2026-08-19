/**
 * FREE explicit fact selector cataloged journey.
 *
 * The full-stack run proves that a merchant-visible checked fact becomes the
 * public requestedFactRefs field and is accepted by Core's current-head,
 * same-workspace authorization. A forged or stale ref would return 4xx before
 * the Composer claim.
 */

import { expect, test } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { seedConfirmedStore } from '../fixtures/product';
import { selectComposerLens } from '../fixtures/ui-journey';

test.afterEach(async ({ request }) => {
  await cleanupE2EUsers(request);
});

test('FREE explicit selector submits one server-authorized fact ref', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const user = await registerE2EUser(request);
  await loginByForm(page, user);
  await seedConfirmedStore(page);
  await page.goto('/dashboard');

  await page.getByTestId('composer-creation-mode-free').click();
  const selector = page.getByTestId('free-fact-selector');
  await expect(selector).toBeVisible();
  await expect(
    selector.getByText('来自你已确认的门店资料，仅勾选项会用于这次自由创作。')
  ).toBeVisible();

  const selectedRow = selector.locator('[data-fact-ref]').first();
  const selectedRef = await selectedRow.getAttribute('data-fact-ref');
  expect(selectedRef).toMatch(/^store_fact:.+:\d+$/u);
  await selectedRow.getByRole('checkbox').check();

  await selectComposerLens(page, 'copy');
  await page
    .getByTestId('composer-intent-input')
    .fill('用我刚勾选的门店资料写一条护理科普');
  await expect(page.getByTestId('composer-quote-line')).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId('composer-submit')).toBeEnabled();

  const submissionRequest = page.waitForRequest(
    (candidate) =>
      candidate.method() === 'POST' &&
      /\/api\/core\/p1\/composer\/submissions(?:\?|$)/u.test(candidate.url())
  );
  const submissionResponse = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === 'POST' &&
      /\/api\/core\/p1\/composer\/submissions(?:\?|$)/u.test(candidate.url())
  );
  await page.getByTestId('composer-submit').click();

  const sent = await submissionRequest;
  expect(sent.postDataJSON()).toEqual(
    expect.objectContaining({ requestedFactRefs: [selectedRef] })
  );
  const accepted = await submissionResponse;
  expect(accepted.status()).toBeLessThan(400);
});
