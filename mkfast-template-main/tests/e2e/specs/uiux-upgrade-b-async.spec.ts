import { expect, test } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { seedConfirmedStore } from '../fixtures/product';
import {
  JOURNEY_CONTRACTS,
  submitComposerJourney,
  waitForResultJourney,
} from '../fixtures/ui-journey';

const copyContract = JOURNEY_CONTRACTS.find(
  ({ modality }) => modality === 'copy'
);

if (!copyContract)
  throw new Error('Copy Composer journey contract is required');

test.afterEach(async ({ request }) => {
  await cleanupE2EUsers(request);
});

test('a running Composer task restores after refresh without a second submission', async ({
  page,
  request,
}) => {
  test.setTimeout(360_000);
  const user = await registerE2EUser(request);
  await loginByForm(page, user);
  await seedConfirmedStore(page);
  await page.goto('/dashboard');

  let submissions = 0;
  page.on('request', (outgoing) => {
    if (
      outgoing.method() === 'POST' &&
      outgoing.url().includes('/api/core/p1/composer/submissions')
    ) {
      submissions += 1;
    }
  });

  const intent = `恢复中的文案任务 ${crypto.randomUUID()}`;
  const workId = await submitComposerJourney(page, copyContract, intent, {
    async onRunStreaming() {
      await expect(page.getByTestId('composer-conversation')).toBeVisible();
      await expect(page.getByTestId('composer-stage-line').first()).toBeVisible(
        {
          timeout: 120_000,
        }
      );
      await page.reload();
      await expect(page.getByTestId('composer-turn-merchant')).toContainText(
        intent,
        { timeout: 60_000 }
      );
      await expect(
        page
          .getByTestId('composer-stage-line')
          .or(page.getByTestId('composer-delivery-card'))
          .first()
      ).toBeVisible({ timeout: 120_000 });
    },
  });

  expect(submissions).toBe(1);
  await waitForResultJourney(page, copyContract, workId);
});
