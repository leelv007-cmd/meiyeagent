import { expect, test } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { seedConfirmedStore } from '../fixtures/product';
import {
  adoptResult,
  assertJourneyRestored,
  downloadFullPackage,
  JOURNEY_CONTRACTS,
  openDeliveryPanel,
  submitComposerJourney,
  waitForResultJourney,
} from '../fixtures/ui-journey';

const copyContract = JOURNEY_CONTRACTS.find(
  ({ modality }) => modality === 'copy'
);

if (!copyContract) throw new Error('Copy Composer journey contract is required');

test.afterEach(async ({ request }) => {
  await cleanupE2EUsers(request);
});

test('Composer delivery opens a ContentPackage that can be adopted, delivered, and restored', async ({
  page,
  request,
}) => {
  test.setTimeout(420_000);
  const user = await registerE2EUser(request);
  await loginByForm(page, user);
  await seedConfirmedStore(page);
  await page.goto('/dashboard');

  const workId = await submitComposerJourney(
    page,
    copyContract,
    `为朋友圈准备可交付内容包 ${crypto.randomUUID()}`
  );
  await waitForResultJourney(page, copyContract, workId);
  await adoptResult(page, copyContract);
  await openDeliveryPanel(page, copyContract.modality);
  await downloadFullPackage(page, copyContract);
  await assertJourneyRestored(page, copyContract, workId);
});
