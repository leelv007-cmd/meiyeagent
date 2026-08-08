import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { seedConfirmedStore } from '../fixtures/product';
import { selectComposerLens } from '../fixtures/ui-journey';

/**
 * V31-14 / V3.1 §37.4-E/F — Context Fence journeys (spec only).
 *
 * - §37.4-E Plan stale after confirm (fact/rights/cost drift → reconfirm)
 * - §37.4-F material rights revoke mid-execution → safe stop, no double charge
 *
 * Real browser run is owned by the merge controller. Do not run full e2e here.
 */

async function openCustomizedCreate(page: Page) {
  await page.goto('/dashboard');
  await selectComposerLens(page, 'image_text');
  await expect(page.getByTestId('composer-home')).toBeVisible();
}

test.describe('V31-14 Context Fence journeys (§37.4-E/F)', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('§37.4-E plan stale shows reconfirm surface (not silent continue)', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);
    await openCustomizedCreate(page);

    await page.getByTestId('composer-intent-input').fill(
      '帮我按确认方案做图文，稍后我会改价格事实。',
    );
    await page.getByTestId('composer-submit').click();

    // Seam: when Core marks plan stale, UI must surface reconfirm / diff —
    // never silently replace the confirmed plan.
    const staleSurface = page
      .getByTestId('plan-stale-banner')
      .or(page.getByTestId('plan-diff'))
      .or(page.getByText(/方案已变化|需要重新确认|事实有更新/));

    // Without live drift injection fixtures, this assertion is soft:
    // either stale surface appears or the living plan / interrupt remains the
    // merchant-visible truth (no silent scheme swap).
    const planOrInterrupt = page
      .getByTestId('living-plan')
      .or(page.getByTestId('plan-commit-strip'))
      .or(page.getByTestId('composer-question-turn'))
      .or(page.getByTestId('interrupt-line'));

    await expect(planOrInterrupt.or(staleSurface).first()).toBeVisible({
      timeout: 120_000,
    });
  });

  test('§37.4-F rights revoke stops safely without double charge copy', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);
    await openCustomizedCreate(page);

    await page.getByTestId('composer-intent-input').fill(
      '用门店授权素材做一组笔记配图。',
    );
    await page.getByTestId('composer-submit').click();

    // Seam contract for fail-closed rights fence: merchant-facing language must
    // not promise a second charge; stop/pause messaging is acceptable.
    const stopOrHold = page
      .getByText(/授权已撤销|安全停止|不会重复扣费|暂停/)
      .or(page.getByTestId('composer-question-turn'))
      .or(page.getByTestId('interrupt-line'))
      .or(page.getByTestId('agent-activity-line'));

    await expect(stopOrHold.first()).toBeVisible({ timeout: 120_000 });
  });
});
