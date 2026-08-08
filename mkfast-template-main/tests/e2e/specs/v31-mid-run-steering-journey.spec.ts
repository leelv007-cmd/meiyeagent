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
import {
  chooseImageTextDirection,
  selectComposerLens,
} from '../fixtures/ui-journey';

/**
 * V31-16 / V31-27 / V3.1 §37.4-G — Mid-run Steering.
 *
 * Journey under test:
 *   mid-run 「封面不要写最后两个名额，第二页少点字」
 *   → only cover + page 2 change; other pages keep
 *   → no fee change → apply without replan
 *   → 「再增加两页」→ replan + requote confirm
 *
 * The steering surface is `steering-composer-*` in
 * src/product/composer/steering-composer-panel.tsx; classification, impact
 * sentence and the requote decision all come from Core
 * (`agent-session.steering_submit`, V31-16).
 */

async function openCustomizedCreate(page: Page) {
  await page.goto('/dashboard');
  // image_text submissions fail closed (400 INVALID_STATE) without a
  // case_image workspace source — seed one first, as the merchant would
  // (same contract v31-living-plan-journey and the three-modal journey use).
  await seedComposerInlineAuthorize(page, {
    fileName: `v31-journey-${crypto.randomUUID()}.png`,
  });
  await selectComposerLens(page, 'image_text');
  await expect(page.getByTestId('composer-home')).toBeVisible();
}

/**
 * D-043 progressive fact confirm: intents naming missing/conflicting key facts
 * suspend on a Core-rendered 「确认本次创作」 gate before the run continues.
 * Anchor on the accessible name — the card has no static testid in web src.
 */
async function confirmCreationGateIfPresent(page: Page) {
  const confirm = page.getByRole('button', { name: '确认并开始' });
  try {
    await confirm.waitFor({ state: 'visible', timeout: 45_000 });
  } catch {
    return; // No gate for this intent — the run continues directly.
  }
  await confirm.click();
}

/**
 * The mid-run entry mounts on a bound, steerable run. Waiting for the note
 * outline first is what makes 「封面」/「第二页」 resolvable units rather than an
 * instruction Core has to refuse for want of a target: `notePlanPreview` is
 * emitted with the `style_selected` frame, right after the 图文方向 answer.
 */
async function openSteeringComposer(page: Page) {
  await expect(page.getByTestId('note-plan-timeline-frame')).toBeVisible({
    timeout: 120_000,
  });
  const steeringInput = page.getByTestId('steering-composer-input');
  await expect(steeringInput).toBeVisible({ timeout: 120_000 });
  return steeringInput;
}

test.describe('V31-16 Mid-run Steering journey (§37.4-G)', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('修改封面与第二页 → 其他页保持 → 无费用变化直接应用', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    await openCustomizedCreate(page);

    const intent = page.getByTestId('composer-intent-input');
    await intent.fill('帮我做一组含配图的小红书笔记，奶油风美甲，大概 4 页。');
    // Submit must bind the server quote before it can create anything; a click
    // on the disabled send control is swallowed and produces no run at all.
    await expect(page.getByTestId('composer-quote-line')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId('composer-submit')).toBeEnabled({
      timeout: 60_000,
    });
    await page.getByTestId('composer-submit').click();

    // Wait for plan confirm or in-flight generation surface.
    const progressHost = page
      .getByTestId('plan-commit-strip')
      .or(page.getByTestId('artifact-panel'))
      .or(page.getByTestId('agent-activity-line'))
      .or(page.getByTestId('composer-question-turn'));

    await expect(progressHost.first()).toBeVisible({ timeout: 120_000 });

    // Confirm plan when present so Make can start (mid-run surface). The real
    // image_text run holds twice before generation: the D-043 fact gate, then
    // the one 图文方向 question.
    await confirmCreationGateIfPresent(page);
    await chooseImageTextDirection(page);

    // Steering composer (interrupt-after-unit) mid-run.
    const steeringInput = await openSteeringComposer(page);
    await steeringInput.fill('封面不要写最后两个名额，第二页少点字');

    await page.getByTestId('steering-submit').click();

    // Impact feedback: cover + page 2; other pages unchanged; no replan.
    const impact = page.getByTestId('steering-impact');
    await expect(impact).toBeVisible({ timeout: 60_000 });
    await expect(impact.getByTestId('steering-impact-affected')).toContainText(
      '封面'
    );
    await expect(impact.getByTestId('steering-impact-affected')).toContainText(
      '第2页'
    );
    await expect(impact.getByTestId('steering-impact-preserved')).toBeVisible();

    // Billing (§5.6): the pages are still pending at the execution_confirm hold
    // — no upstream call has gone out — so this is the one branch that costs
    // nothing extra. Nothing was sent, so there is no settled charge to report.
    const fee = impact.getByTestId('steering-impact-fee');
    await expect(fee).toHaveAttribute('data-rebilled', 'false');
    await expect(fee).toContainText('不额外算积分');
    await expect(impact.getByTestId('steering-impact-settled')).toHaveCount(0);

    // Must not force a full replan/requote for pure future_step / derived patch.
    const replanCard = page.getByTestId('plan-requote-card');
    await expect(replanCard).toHaveCount(0);
  });

  test('增加页数进入 replan + requote 确认', async ({ page, request }) => {
    test.setTimeout(300_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    await openCustomizedCreate(page);

    const intent = page.getByTestId('composer-intent-input');
    await intent.fill('帮我做一组含配图的小红书笔记，先做 4 页。');
    await expect(page.getByTestId('composer-quote-line')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId('composer-submit')).toBeEnabled({
      timeout: 60_000,
    });
    await page.getByTestId('composer-submit').click();

    const progressHost = page
      .getByTestId('plan-commit-strip')
      .or(page.getByTestId('artifact-panel'))
      .or(page.getByTestId('agent-activity-line'))
      .or(page.getByTestId('composer-question-turn'));
    await expect(progressHost.first()).toBeVisible({ timeout: 120_000 });

    await confirmCreationGateIfPresent(page);
    await chooseImageTextDirection(page);

    const steeringInput = await openSteeringComposer(page);
    await steeringInput.fill('再增加两页，做成 6 页');

    await page.getByTestId('steering-submit').click();

    // plan_change → replan + requote confirmation object (V31-11).
    const replan = page.getByTestId('plan-requote-card');
    await expect(replan).toBeVisible({ timeout: 60_000 });
    const impact = page.getByTestId('steering-impact');
    await expect(impact).toHaveAttribute('data-kind', 'plan_change');
    // A scope change reopens the credit question at the plan layer rather than
    // charging anything here — and never names an upstream price (D-061).
    const fee = impact.getByTestId('steering-impact-fee');
    await expect(fee).toContainText('积分要重新算一次');
    await expect(fee).not.toContainText('成本');
  });
});
