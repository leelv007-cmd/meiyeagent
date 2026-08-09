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
 * V31-10 / V3.1 §37.4-C first half — Living Plan journey (spec only).
 *
 * Journey under test (Level 2 定制图文):
 *   检索 → 一问 → Living Plan → 自然语言调整
 *
 * Real browser run is owned by the merge controller. This file is the
 * Playwright seam contract: selectors + ordering of merchant-visible steps.
 * Do not run in agent lanes (`pnpm e2e` is forbidden for execution agents).
 *
 * Confirm / Make / note page regen / publish handoff are out of scope here
 * (V31-11+ / §37.4-C second half).
 */

async function openCustomizedCreate(page: Page) {
  await page.goto('/dashboard');
  // image_text submissions fail closed (400 INVALID_STATE) without a
  // case_image workspace source — seed one first, as the merchant would
  // attach a case photo (same contract the three-modal journey exercises).
  await seedComposerInlineAuthorize(page, {
    fileName: `v31-journey-${crypto.randomUUID()}.png`,
  });
  // Customized image-text path (Level 2 Living Plan), not pure-copy Level 1.
  await selectComposerLens(page, 'image_text');
  await expect(page.getByTestId('composer-home')).toBeVisible();
}

test.describe('V31-10 Living Plan journey (§37.4-C first half)', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('检索 → 一问 → Living Plan → 调整（前半段）', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    await openCustomizedCreate(page);

    // Merchant states a fuzzy business goal (not a filled form).
    const intent = page.getByTestId('composer-intent-input');
    await intent.fill(
      '明天下午还有两个空档，帮我发点奶油风美甲，不要太像广告。'
    );
    await page.getByTestId('composer-submit').click();

    // 1) Retrieval/progress is visible as narrative or stage lines (not a
    // form). On the Composer conversation surface these render through the
    // progress card (composer-stage-line); the agent- lines cover the
    // Workbench pane when it hosts the run.
    const retrievalSignal = page
      .getByTestId('agent-activity-line')
      .or(page.getByTestId('agent-narrative-line'))
      .or(page.getByTestId('composer-stage-line'))
      .or(page.getByTestId('composer-progress-card'));
    await expect(retrievalSignal.first()).toBeVisible({ timeout: 60_000 });

    // 2) Session question budget is structural: zero or one visible question,
    // never a second card. Known platform/lens/rights/quote fields are server-
    // owned and therefore must not be re-asked.
    const visibleQuestions = page
      .getByTestId('ask-merchant-group-card')
      .or(page.getByTestId('composer-question-card'));
    await expect(visibleQuestions).toHaveCount(0);

    // 3) Living Plan grows in the same Workstream (five-section document).
    await expect(page.getByTestId('agent-living-plan')).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByTestId('agent-plan-section-goal')).toBeVisible();
    await expect(
      page.getByTestId('agent-plan-section-deliverables')
    ).toBeVisible();
    await expect(
      page.getByTestId('agent-plan-section-expression')
    ).toBeVisible();
    await expect(
      page.getByTestId('agent-plan-section-facts_assets')
    ).toBeVisible();
    await expect(
      page.getByTestId('agent-plan-section-cost_duration')
    ).toBeVisible();

    // Compact Plan / commit strip unifies Brief/quote/confirm presentation.
    await expect(page.getByTestId('agent-commit-strip')).toBeVisible();
    await expect(page.getByTestId('agent-commit-strip-start')).toBeEnabled();

    // 4) Natural-language adjust → new revision + readable diff; prior revision browsable.
    await page.getByTestId('agent-commit-strip-revise').click();
    await page
      .getByTestId('composer-intent-input')
      .fill('只做小红书，减到 4 页');
    await page.getByTestId('composer-submit').click();

    await expect(page.getByTestId('agent-living-plan')).toHaveAttribute(
      'data-revision',
      /[2-9]|\d{2,}/,
      { timeout: 90_000 }
    );
    await expect(page.getByTestId('agent-plan-diff')).toBeVisible({
      timeout: 60_000,
    });
    // Old version remains reachable (revision chips when history length > 1).
    const rev1 = page.getByTestId('agent-living-plan-revision-1');
    await expect(rev1).toBeVisible();
    await rev1.click();
    await expect(page.getByTestId('agent-living-plan')).toHaveAttribute(
      'data-revision',
      '1'
    );
  });
});
