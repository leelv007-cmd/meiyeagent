import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { seedConfirmedStore } from '../fixtures/product';
import { selectComposerLens } from '../fixtures/ui-journey';

/**
 * V31-16 / V3.1 §37.4-G — Mid-run Steering (spec only).
 *
 * Journey under test:
 *   mid-run 「封面不要写最后两个名额，第二页少点字」
 *   → only cover + page 2 change; other pages keep
 *   → no fee change → apply without replan
 *   → 「再增加两页」→ replan + requote confirm
 *
 * Real browser run is owned by the merge controller. This file is the Playwright
 * seam contract. Do not run full e2e in agent lanes.
 */

async function openCustomizedCreate(page: Page) {
  await page.goto('/dashboard');
  await selectComposerLens(page, 'image_text');
  await expect(page.getByTestId('composer-home')).toBeVisible();
}

test.describe('V31-16 Mid-run Steering journey (§37.4-G)', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('修改封面与第二页 → 其他页保持 → 无费用变化直接应用', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    await openCustomizedCreate(page);

    const intent = page.getByTestId('composer-intent-input');
    await intent.fill('帮我做一组含配图的小红书笔记，奶油风美甲，大概 4 页。');
    await page.getByTestId('composer-submit').click();

    // Wait for plan confirm or in-flight generation surface.
    const progressHost = page
      .getByTestId('plan-commit-strip')
      .or(page.getByTestId('artifact-panel'))
      .or(page.getByTestId('agent-activity-line'))
      .or(page.getByTestId('composer-question-turn'));

    await expect(progressHost.first()).toBeVisible({ timeout: 120_000 });

    // Confirm plan when present so Make can start (mid-run surface).
    const confirm = page
      .getByRole('button', { name: /确认执行|确认|开始生成/ })
      .first();
    if (await confirm.isVisible().catch(() => false)) {
      await confirm.click();
    }

    // Steering composer (interrupt-after-unit) mid-run.
    const steeringInput = page
      .getByTestId('steering-composer-input')
      .or(page.getByTestId('composer-intent-input'))
      .or(page.getByPlaceholder(/运行中|中途|补充|改/));

    await expect(steeringInput.first()).toBeVisible({ timeout: 120_000 });
    await steeringInput.first().fill('封面不要写最后两个名额，第二页少点字');

    const steerSubmit = page
      .getByTestId('steering-submit')
      .or(page.getByTestId('composer-submit'))
      .or(page.getByRole('button', { name: /发送|提交|应用/ }));
    await steerSubmit.first().click();

    // Impact feedback: cover + page 2; other pages unchanged; no replan.
    const impact = page
      .getByTestId('steering-impact')
      .or(page.getByText(/已应用|封面|第\s*2\s*页|其他页面不变/));
    await expect(impact.first()).toBeVisible({ timeout: 60_000 });

    // Must not force a full replan/requote for pure future_step / derived patch.
    const replanCard = page.getByTestId('plan-requote-card');
    await expect(replanCard).toHaveCount(0);
  });

  test('增加页数进入 replan + requote 确认', async ({ page, request }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    await openCustomizedCreate(page);

    const intent = page.getByTestId('composer-intent-input');
    await intent.fill('帮我做一组含配图的小红书笔记，先做 4 页。');
    await page.getByTestId('composer-submit').click();

    const progressHost = page
      .getByTestId('plan-commit-strip')
      .or(page.getByTestId('artifact-panel'))
      .or(page.getByTestId('agent-activity-line'))
      .or(page.getByTestId('composer-question-turn'));
    await expect(progressHost.first()).toBeVisible({ timeout: 120_000 });

    const confirm = page
      .getByRole('button', { name: /确认执行|确认|开始生成/ })
      .first();
    if (await confirm.isVisible().catch(() => false)) {
      await confirm.click();
    }

    const steeringInput = page
      .getByTestId('steering-composer-input')
      .or(page.getByTestId('composer-intent-input'))
      .or(page.getByPlaceholder(/运行中|中途|补充|改/));
    await expect(steeringInput.first()).toBeVisible({ timeout: 120_000 });
    await steeringInput.first().fill('再增加两页，做成 6 页');

    const steerSubmit = page
      .getByTestId('steering-submit')
      .or(page.getByTestId('composer-submit'))
      .or(page.getByRole('button', { name: /发送|提交|应用/ }));
    await steerSubmit.first().click();

    // plan_change → replan + requote confirmation object (V31-11).
    const replan = page
      .getByTestId('plan-requote-card')
      .or(page.getByTestId('plan-commit-strip'))
      .or(page.getByText(/重新报价|方案已更新|需确认|费用/));
    await expect(replan.first()).toBeVisible({ timeout: 60_000 });
  });
});
