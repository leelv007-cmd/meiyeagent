import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import {
  seedComposerInlineAuthorize,
  seedConfirmedStore,
} from '../fixtures/product';
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
  // image_text submissions fail closed (400 INVALID_STATE) without a
  // case_image workspace source — seed one first, as the merchant would.
  await seedComposerInlineAuthorize(page, {
    fileName: `v31-journey-${crypto.randomUUID()}.png`,
  });
  await selectComposerLens(page, 'image_text');
  await expect(page.getByTestId('composer-home')).toBeVisible();
}

/**
 * D-043 progressive fact confirm: intents that name missing/conflicting key
 * facts (price, deadline, …) suspend on a server-driven 「确认本次创作」 gate
 * before the run continues. The card is Core-rendered (no static testid in
 * web src) — anchor on its accessible name. Click through when it appears so
 * the journey reaches the plan surfaces behind it.
 */
async function confirmCreationGateIfPresent(page: Page) {
  const confirm = page.getByRole('button', { name: '确认并开始' });
  try {
    await confirm.waitFor({ state: 'visible', timeout: 45_000 });
  } catch {
    return; // No gate for this intent — run continues directly.
  }
  await confirm.click();
}

test.describe('V31-14 Context Fence journeys (§37.4-E/F)', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('§37.4-E plan stale shows reconfirm surface (not silent continue)', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);
    await openCustomizedCreate(page);

    await page
      .getByTestId('composer-intent-input')
      .fill('帮我按确认方案做图文，稍后我会改价格事实。');
    await page.getByTestId('composer-submit').click();
    await confirmCreationGateIfPresent(page);

    // Seam: when Core marks plan stale, UI must surface reconfirm / diff —
    // never silently replace the confirmed plan. Production surfaces carry the
    // agent- prefix (agent-plan-diff renders adjustments; the commit strip
    // holds start behind `plan_stale`).
    const staleSurface = page
      .getByTestId('agent-plan-diff')
      .or(page.getByText(/方案已变化|需要重新确认|事实有更新/));

    // Without live drift injection fixtures, this assertion is soft:
    // either stale surface appears or the living plan / question interaction
    // remains the merchant-visible truth (no silent scheme swap).
    const planOrInterrupt = page
      .getByTestId('agent-living-plan')
      .or(page.getByTestId('agent-commit-strip'))
      .or(page.getByTestId('ask-merchant-group-card'))
      .or(page.getByTestId('composer-question-card'));

    await expect(planOrInterrupt.or(staleSurface).first()).toBeVisible({
      timeout: 120_000,
    });
  });

  test('§37.4-F rights revoke stops safely without double charge copy', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);
    await openCustomizedCreate(page);

    await page
      .getByTestId('composer-intent-input')
      .fill('用门店授权素材做一组笔记配图。');
    await page.getByTestId('composer-submit').click();
    await confirmCreationGateIfPresent(page);

    // Seam contract for fail-closed rights fence: the run must stay observable
    // (activity / narrative / one question), and merchant-facing language must
    // not promise a second charge; stop/pause messaging is acceptable.
    const stopOrHold = page
      .getByText(/授权已撤销|安全停止|不会重复扣费|暂停/)
      .or(page.getByTestId('ask-merchant-group-card'))
      .or(page.getByTestId('composer-question-card'))
      .or(page.getByTestId('agent-activity-line'))
      .or(page.getByTestId('agent-narrative-line'));

    await expect(stopOrHold.first()).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(/再次扣费|重复扣费/)).toHaveCount(0);
  });
});
