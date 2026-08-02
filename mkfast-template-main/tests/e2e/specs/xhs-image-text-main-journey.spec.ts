/**
 * Journey-gate XHS image-text main chain (L4 / #313–#328 surface).
 *
 * Lean path for the ordinary production-main-journey job:
 *   register → seed store → submit 小红书图文 (fixture)
 *   → direction + execution confirm → delivered
 *   → Result Center object workspace with note document
 *
 * Prefer shared ui-journey helpers over the full T20 compiler suite so the
 * gate stays near a three-minute budget while still covering the note carrier.
 */

import { expect, test } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { seedComposerInlineAuthorize, seedConfirmedStore } from '../fixtures/product';
import {
  JOURNEY_CONTRACTS,
  submitComposerJourney,
  waitForResultJourney,
} from '../fixtures/ui-journey';

const imageTextContract = JOURNEY_CONTRACTS.find(
  ({ modality }) => modality === 'image_text'
)!;

test.describe('XHS image-text main journey (production gate)', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(120_000);
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    test.setTimeout(120_000);
    await cleanupE2EUsers(request);
  });

  test('fixture 小红书图文 reaches delivered note object workspace', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });

    const merchant = await registerE2EUser(request);
    await loginByForm(page, merchant);
    await seedConfirmedStore(page);
    await page.goto('/dashboard');
    await seedComposerInlineAuthorize(page, {
      fileName: 'xhs-main-journey-source.png',
    });

    const workId = await submitComposerJourney(
      page,
      imageTextContract,
      '把本店皮肤护理案例做成小红书图文笔记'
    );
    await waitForResultJourney(page, imageTextContract, workId);

    const workspace = page.getByTestId('result-image-text-workspace');
    await expect(workspace.getByTestId('image-worksurface')).toBeVisible();
    await expect(workspace.getByTestId('object-workspace-shell')).toHaveAttribute(
      'data-carrier',
      'note'
    );
    await expect(workspace.getByTestId('note-object-workspace')).toBeVisible();
    await expect(workspace.getByTestId('copy-field-body')).toContainText(/\S/u);
  });
});
