import { expect, test, type Page } from '@playwright/test';
import type {
  ApiEnvelope,
  ProductCommand,
  ProductState,
} from '@meiye/contracts';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import {
  productState,
  seedComposerInlineAuthorize,
  seedConfirmedStore,
} from '../fixtures/product';
import {
  closeComposerCapsule,
  openComposerCapsule,
  openComposerRecipeCard,
  selectComposerLens,
} from '../fixtures/ui-journey';
import {
  blockingQuestionLocator,
  briefConfirmButton,
  composerSubmitButton,
  firstTokenLocator,
  installUserActivationCounter,
  skipOnboardingButton,
  type UserActivationCounter,
} from '../fixtures/user-activation';

/**
 * V1 Day-0 experience contract hard gate — D-098 C6 rebaseline (#85 / #60).
 *
 * M-04 DEMOTED (T39 / #233). These strict Day-0 assertions were never on a
 * required job, and 4 of this file's 7 cases were already red on the fixture
 * 模型档 before any reshell touched them
 * (`docs/evidence/e2e-baseline-2026-07-25.md`: template path `:210`, pure text
 * path `:266` on a legacy projection the new seam does not feed, video path
 * `:332` whose `composer-delivery-card` never arrives inside its own 180s
 * budget, T5 inline authorize `:539`). The assertions worth keeping —
 * isTrusted 点击预算 / 零前置表单 / 首 token — were copied onto the shipped seam
 * in `specs/m04-browser-hard-gate.spec.ts`, which the ordinary PR gate runs.
 *
 * The file is kept rather than deleted (no approved disposition batch covers
 * it) and must not re-enter the required set; `src/lib/e2e-hard-gate-contract`
 * holds the register that enforces both halves of that statement.
 *
 * Click budget (isTrusted real-count via installUserActivationCounter). D-173
 * raised the Day-0 budget from 2 to 3 because the capsule Composer (L3-2) moved
 * the lens radiogroup and the Recipe cards into popovers, so reaching either now
 * costs an extra open-capsule activation:
 *   1. Template / scenario card path: open recipe capsule(1) +
 *      card(2, dual-purpose lens+apply) + start(3) = 3
 *   2. Pure free-text path: open lens capsule(1) + select lens(2) + start(3) = 3
 *   3. Video path: open lens capsule(1) + select lens(2) + start(3) +
 *      Brief confirm(4) + D-164③ 确认执行(5) = 3 base + 2 extra
 *      (D-094 / D-043 decision ③ Brief confirm is EXTRA and not cancelled by C6;
 *      D-164③ / P1-05 adds the paid-media execution confirm, and the shipped
 *      journey contract already prices video at 5)
 *
 * Required lens/mode selector = mode selector, NOT a forbidden pre-form (D-081).
 * Old free-text "≤2 without mode select" semantics are retired — they conflict
 * with D-081 forced lens selection. The capsule open is likewise not optional:
 * D-173 keeps the selection mandatory and pays for the popover, it does not
 * reopen the "keyboard alone / no mode select" shortcut.
 *
 * Assertions target the shipped Composer lens radiogroup + Recipe cards.
 * Do not weaken isTrusted counters or soft-pass missing steps.
 */

const PNG_FIXTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

async function day0SeedPrep(
  page: Page,
  request: Parameters<typeof registerE2EUser>[0]
) {
  const user = await registerE2EUser(request);
  await loginByForm(page, user);
  await seedConfirmedStore(page);
  await page.goto('/dashboard');
  return user;
}

/**
 * ADR-0014「提交后不跳转」— the D-043 stop condition is the first token the
 * merchant can actually see, and it now streams inside the conversation. This
 * is a stronger endpoint than the old one: the merchant reaches a usable draft
 * without any navigation at all.
 */
async function assertResultFirstToken(
  page: Page,
  _workspace: 'copy' | 'image'
) {
  await expect(
    page,
    'submitting must not navigate away from the Composer conversation'
  ).not.toHaveURL(/\/dashboard\/results\//u);
  await expect(page.getByTestId('composer-conversation')).toBeVisible({
    timeout: 60_000,
  });
  await expect(firstTokenLocator(page)).toHaveAttribute(
    'data-has-token',
    'true',
    { timeout: 90_000 }
  );
  await expect(page.getByTestId('composer-candidate-primary')).toBeVisible();
}

/**
 * The Result Center is still the 交付结果面 — it is now reached by clicking the
 * 成品预览卡, and the work it opens must be the one this run produced.
 */
async function assertDeliveryCardOpensResultCenter(page: Page) {
  const deliveryCard = page.getByTestId('composer-delivery-card');
  await expect(deliveryCard).toBeVisible({ timeout: 180_000 });
  await expect(page).not.toHaveURL(/\/dashboard\/results\//u);

  await deliveryCard.click();
  await expect(page).toHaveURL(/\/dashboard\/results\/[^/?#]+/u, {
    timeout: 60_000,
  });
  await expect(page.getByTestId('result-center-shell')).toBeVisible();
  await expect(page.getByTestId('result-merchant-status')).toContainText(
    /生成中|可发布/u
  );
}

/**
 * Video has no token stream (ADR-0010 long-task path), so its first usable
 * result is the 成片 itself. The run announces itself in the conversation, and
 * the 成品预览卡 is what opens the video worksurface — clicking it is a
 * navigation, not an activation, so the click budget is unaffected.
 */
async function assertVideoFirstUsableResult(
  page: Page,
  onDeliveryCardVisible: () => void
) {
  await expect(
    page,
    'submitting must not navigate away from the Composer conversation'
  ).not.toHaveURL(/\/dashboard\/results\//u);
  await expect(page.getByTestId('composer-conversation')).toBeVisible({
    timeout: 60_000,
  });

  const deliveryCard = page.getByTestId('composer-delivery-card');
  await expect(deliveryCard).toBeVisible({ timeout: 180_000 });
  onDeliveryCardVisible();
  await deliveryCard.click();

  await expect(page).toHaveURL(/\/dashboard\/results\/[^/?#]+/u, {
    timeout: 60_000,
  });
  await expect(page.getByTestId('result-center-shell')).toBeVisible();
  await expect(page.getByTestId('video-result-status')).toContainText(
    /成片生成中|成片待确认/u
  );
  await expect(page.getByTestId('video-worksurface')).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.getByTestId('video-player')).toBeVisible();
}

async function assertNoSkipUsed(page: Page, counter: UserActivationCounter) {
  // The retired onboarding bypass is absent from the canonical Composer.
  await expect(skipOnboardingButton(page)).toHaveCount(0);
  expect(counter.count()).toBe(0);
}

async function assertZeroBlockingBeforeSubmit(page: Page) {
  await expect(blockingQuestionLocator(page)).toHaveCount(0);
  await expect(briefConfirmButton(page)).toHaveCount(0);
  await expect(page.getByText('尚未完成可用性验证')).toHaveCount(0);
  await expect(page.getByText('保留原模型，但暂不可提交')).toHaveCount(0);
}

async function assertComposerQuoteReady(page: Page) {
  await expect(
    page.getByTestId('composer-quote-line'),
    'the live ProductQuote must be bound before submit'
  ).toBeVisible({ timeout: 30_000 });
}

function assertActivationBudget(
  activationCount: number,
  expected: number,
  counter: UserActivationCounter,
  label: string
) {
  expect(
    activationCount,
    `${label}: D-098 C6 as superseded by D-173 expects exactly ${expected} isTrusted user activations to first token; got ${activationCount}: ${JSON.stringify(counter.events())}`
  ).toBe(expected);
  expect(counter.events().every((event) => event.kind === 'click')).toBe(true);
  expect(
    counter.events().some((event) => event.targetLabel?.includes('暂时跳过'))
  ).toBe(false);
}

test.describe('V1 Day-0 experience contract hard gate (D-098 C6)', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    test.setTimeout(180_000);
    await cleanupE2EUsers(request);
  });

  test.describe('template path (C6 dual-purpose card)', () => {
    test('open recipe capsule (1) + scene/template card (2, lens+apply) + start (3) = 3 activations to first token', async ({
      page,
      request,
    }) => {
      test.setTimeout(180_000);
      const counter = await installUserActivationCounter(page);
      await day0SeedPrep(page, request);

      // Measurement after seed prep only — never count prep activations.
      counter.beginMeasurement();
      await assertNoSkipUsed(page, counter);
      await assertZeroBlockingBeforeSubmit(page);

      // C6: a Recipe card click is still dual-purpose (select lens + apply
      // patch) and still occupies the lens-selection budget slot. Since L3-2
      // the cards live inside the recipe capsule, so reaching them costs the
      // extra open-capsule activation D-173 budgets for.
      const recipePanel = await openComposerRecipeCard(
        page,
        'composer-recipe-card-recipe.project_intro'
      );
      expect(
        counter.count(),
        `opening the recipe capsule and clicking the template card must count as exactly 2 isTrusted activations (open + C6 dual-purpose card); events=${JSON.stringify(counter.events())}`
      ).toBe(2);

      // The apply tip renders inside the recipe popover — assert it while the
      // panel is open, then close before touching the surface behind it.
      await expect(
        page.getByTestId('composer-recipe-apply-undo')
      ).toBeVisible();
      await closeComposerCapsule(page, recipePanel);
      const intentInput = page.getByLabel('描述这次想创作的内容');
      await intentInput.fill('介绍本店透亮猫眼项目');
      await expect(intentInput).toHaveValue('介绍本店透亮猫眼项目');
      await assertComposerQuoteReady(page);
      await expect(composerSubmitButton(page)).toBeEnabled();
      await assertZeroBlockingBeforeSubmit(page);

      await composerSubmitButton(page).click();

      await assertResultFirstToken(page, 'copy');
      const activationCount = await counter.waitForFirstTokenAndStop({
        timeout: 90_000,
      });

      assertActivationBudget(
        activationCount,
        3,
        counter,
        'template path (C6 + D-173)'
      );

      await expect(blockingQuestionLocator(page)).toHaveCount(0);
      await expect(firstTokenLocator(page)).toHaveAttribute(
        'data-has-token',
        'true'
      );

      // The other half of the replaced navigation assertion: the Result Center
      // is still reachable, by clicking the 成品预览卡. Measurement has already
      // stopped, so this click is outside the budget.
      await assertDeliveryCardOpensResultCenter(page);
    });
  });

  test.describe('pure text path (C6 forced lens select)', () => {
    test('open lens capsule (1) + select lens (2) + start creation (3) = 3 activations to first token', async ({
      page,
      request,
    }) => {
      test.setTimeout(180_000);
      const counter = await installUserActivationCounter(page);
      await day0SeedPrep(page, request);

      counter.beginMeasurement();
      await assertNoSkipUsed(page, counter);
      await assertZeroBlockingBeforeSubmit(page);

      // D-081 / C6: pure free-text MUST pay for an explicit lens/mode select.
      // The Composer starts cold; selecting the explicit copy radio never
      // relies on an inferred default. Since L3-2 the radio lives in the lens
      // capsule, so the select costs two trusted activations (open + pick) —
      // the capsule face and the checked radio are both asserted by the fixture.
      await expect(
        page.getByTestId('composer-capsule-lens'),
        'pure text path requires a visible lens/mode capsule (输出类型); red until C/D Composer enforces D-081 if absent'
      ).toBeVisible();
      await selectComposerLens(page, 'copy');
      expect(
        counter.count(),
        `lens select must count as exactly 2 isTrusted activations (open capsule + pick lens); events=${JSON.stringify(counter.events())}`
      ).toBe(2);

      // Typing is NOT a user-activation (counter only records trusted clicks /
      // Cmd+Enter), and neither is the Escape that closes the capsule. The
      // free-text path budget is exactly 3 clicks.
      const intent = page.getByLabel('描述这次想创作的内容');
      await intent.fill('为透亮猫眼写一条克制的到店种草');
      await assertComposerQuoteReady(page);
      await expect(composerSubmitButton(page)).toBeEnabled();
      await expect(blockingQuestionLocator(page)).toHaveCount(0);
      expect(counter.count()).toBe(2);

      await composerSubmitButton(page).click();

      await assertResultFirstToken(page, 'copy');
      const activationCount = await counter.waitForFirstTokenAndStop({
        timeout: 90_000,
      });

      // Exact 3 — not ≤3. A path that skips lens select and only clicks start
      // (old free-text semantics) would report 1 and must fail this gate, and a
      // surface that silently preselected a lens would report 2.
      assertActivationBudget(
        activationCount,
        3,
        counter,
        'pure text path (C6 + D-173)'
      );

      await expect(blockingQuestionLocator(page)).toHaveCount(0);
      await expect(firstTokenLocator(page)).toHaveAttribute(
        'data-has-token',
        'true'
      );

      // The other half of the replaced navigation assertion.
      await assertDeliveryCardOpensResultCenter(page);
    });
  });

  test.describe('video path (C6 base 3 under D-173 + D-094 Brief + D-164③ confirm)', () => {
    test('open lens capsule (1) + select video lens (2) + start (3) + Brief confirm (4) + 确认执行 (5) to first token', async ({
      page,
      request,
    }) => {
      test.setTimeout(180_000);
      const counter = await installUserActivationCounter(page);
      await day0SeedPrep(page, request);
      await seedComposerInlineAuthorize(page, {
        fileName: `day0-video-${crypto.randomUUID()}.png`,
      });

      counter.beginMeasurement();
      await assertNoSkipUsed(page, counter);
      await assertZeroBlockingBeforeSubmit(page);

      // Base C6 budget under D-173: open lens capsule + lens select + start = 3.
      await expect(
        page.getByTestId('composer-capsule-lens'),
        'video path requires a visible 输出类型 capsule holding the 做视频 radio'
      ).toBeVisible();
      await selectComposerLens(page, 'video');
      expect(counter.count()).toBe(2);

      const intent = page.getByLabel('描述这次想创作的内容');
      await intent.fill('为夏季美甲写一条15秒到店种草短视频');
      await assertComposerQuoteReady(page);
      await expect(composerSubmitButton(page)).toBeEnabled();
      expect(counter.count()).toBe(2);

      await composerSubmitButton(page).click();
      expect(counter.count()).toBe(3);

      // D-094 / D-043 decision ③: any video generation requires conditional
      // Brief confirm. This EXTRA click is NOT cancelled by C6 — expected
      // total is 4 (3 base under D-173 + 1 Brief), not 3.
      // Prefer hard fail over soft-pass when Brief UI is not on the current
      // shipped surface (awaiting C4 Brief UI / #98).
      const briefConfirm = briefConfirmButton(page);
      await expect(
        briefConfirm,
        'D-098 C6 + D-094 video path requires Brief confirm after start (awaiting C4 Brief UI / #98 if missing on current surface)'
      ).toBeVisible({ timeout: 30_000 });
      await briefConfirm.click();
      expect(
        counter.count(),
        `after Brief confirm expected 4 isTrusted activations (3 base + Brief); events=${JSON.stringify(counter.events())}`
      ).toBe(4);

      // D-164③ / P1-05: paid media then holds on the in-stream execution_confirm
      // interrupt (frozen params + credit preview) before execution_selection
      // runs. Without 确认执行 the run stays suspended and the 成品预览卡 never
      // arrives — which is what made this case look like an unmeetable video
      // budget in docs/evidence/e2e-baseline-2026-07-25.md §3 (that note predates
      // D-164③). The shipped journey contract already prices video at 5
      // (ui-journey.ts JOURNEY_CONTRACTS), and this is the fifth activation.
      const executionConfirm = page.getByTestId(
        'execution-confirmation-interaction-card'
      );
      await expect(executionConfirm).toBeVisible({ timeout: 60_000 });
      await expect(
        page.getByTestId('composer-execution-confirm-turn')
      ).toHaveAttribute('data-agent-frame', 'decision');
      await executionConfirm.getByRole('button', { name: '确认执行' }).click();
      await expect(executionConfirm).toBeHidden({ timeout: 60_000 });
      expect(
        counter.count(),
        `after 确认执行 expected 5 isTrusted activations (3 base + Brief + D-164③); events=${JSON.stringify(counter.events())}`
      ).toBe(5);

      // First-token endpoint is the Day-0 stop condition for all three paths.
      // Video has no token stream, so the 成片 itself is the endpoint — keep the
      // hard wait (no fake-green).
      await assertVideoFirstUsableResult(page, () => counter.stop());
      const activationCount = counter.count();
      expect(
        activationCount,
        `video path (C6+D-094 under D-173): expected exactly 5 isTrusted activations (open lens capsule + lens + start + Brief confirm + D-164③ 确认执行) to first token; got ${activationCount}: ${JSON.stringify(counter.events())}`
      ).toBe(5);
      expect(counter.events().every((event) => event.kind === 'click')).toBe(
        true
      );
      expect(
        counter
          .events()
          .some((event) => event.targetLabel?.includes('暂时跳过'))
      ).toBe(false);
    });
  });

  test('keyboard submit path: lens select (2 clicks) + Cmd/Ctrl+Enter (1) = 3 activations', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const counter = await installUserActivationCounter(page);
    await day0SeedPrep(page, request);

    counter.beginMeasurement();

    // C6: keyboard equivalence covers the submit activation only. Pure free-text
    // still owes an explicit lens select under D-081 — do NOT reintroduce the
    // old "keyboard alone ≤2 / =1 without mode select" free-text semantics.
    // D-173 only re-prices that select: since L3-2 it is open capsule + pick
    // option, so the keyboard path is 2 clicks + 1 keyboard_submit.
    await expect(page.getByTestId('composer-capsule-lens')).toBeVisible();
    await selectComposerLens(page, 'copy');
    expect(counter.count()).toBe(2);

    const intent = page.getByLabel('描述这次想创作的内容');
    await intent.fill('快捷键提交也应直达首 token');
    await assertComposerQuoteReady(page);
    await intent.press(
      process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter'
    );

    await assertResultFirstToken(page, 'copy');
    const activationCount = await counter.waitForFirstTokenAndStop({
      timeout: 90_000,
    });

    // 2 clicks (open lens capsule, pick lens) + 1 keyboard_submit. Cmd/Ctrl+Enter
    // does not produce a click, and the Escape that closes the capsule is not an
    // activation, so the keyboard equivalence still buys exactly the submit step.
    expect(
      activationCount,
      `keyboard path under C6 as superseded by D-173 expects open capsule + lens click + keyboard_submit = 3; got ${activationCount}: ${JSON.stringify(counter.events())}`
    ).toBe(3);
    expect(counter.events()).toEqual([
      expect.objectContaining({ kind: 'click' }),
      expect.objectContaining({ kind: 'click' }),
      expect.objectContaining({ kind: 'keyboard_submit' }),
    ]);
    await expect(page.locator('[data-has-token="true"]').first()).toBeVisible();
  });

  test('trusted top-level activation counter persists across full navigations and ignores frames', async ({
    page,
    request,
  }) => {
    const counter = await installUserActivationCounter(page);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await page.goto('/dashboard');
    counter.beginMeasurement();

    await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<iframe srcdoc="&lt;button id=&quot;frame-action&quot;&gt;frame action&lt;/button&gt;"></iframe>'
      );
    });
    await page.frameLocator('iframe').locator('#frame-action').click();
    expect(counter.count()).toBe(0);

    await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<a data-activation-navigation="assets" href="/dashboard/assets">activation navigation assets</a>'
      );
    });
    await page.locator('[data-activation-navigation="assets"]').click();
    await expect(page).toHaveURL(/\/dashboard\/assets$/);

    await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<a data-activation-navigation="content" href="/dashboard/works">activation navigation content</a>'
      );
    });
    await page.locator('[data-activation-navigation="content"]').click();
    await expect(page).toHaveURL(/\/dashboard\/works$/);
    counter.stop();

    expect(counter.count()).toBe(2);
    expect(counter.events()).toEqual([
      expect.objectContaining({
        kind: 'click',
        targetLabel: 'activation navigation assets',
      }),
      expect.objectContaining({
        kind: 'click',
        targetLabel: 'activation navigation content',
      }),
    ]);
  });

  test('high-risk conflict path: exactly one Brief confirmation then continue (exempt from C6 base budget)', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    // Conflict path is exempt from the C6 base click budget because the
    // conditional Brief confirmation is mandatory. The new Composer must not
    // resurrect the retired Harness question form.
    await installUserActivationCounter(page);
    await day0SeedPrep(page, request);

    // Conflict fixture path: free-text that triggers the offer-price question.
    // D-081 still requires an explicit lens. This path is exempt only from
    // the base click budget because the conflict confirmation is mandatory.
    await selectComposerLens(page, 'copy');
    const intent = page.getByLabel('描述这次想创作的内容');
    await intent.fill('把新团购做一套能发的');
    await assertComposerQuoteReady(page);
    await composerSubmitButton(page).click();

    const brief = page.getByTestId('composer-brief-surface');
    await expect(brief).toBeVisible({ timeout: 60_000 });
    await expect(
      brief.getByTestId(
        'composer-brief-trigger-high_risk_fact_missing_or_conflict'
      )
    ).toHaveCount(1);
    await expect(page.getByText('只需确认一件事')).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: '这次团购价按哪个金额写？' })
    ).toHaveCount(0);

    await briefConfirmButton(page).click();
    // Z1 retired composer-question-card. The only remaining merchant question
    // renderer is AskMerchantInteractionSlot; this fixture may continue from
    // its semantic default, so the durable contract is that the retired card
    // never blocks the post-Brief run.
    await expect(page.getByTestId('composer-question-card')).toHaveCount(0);
    await assertResultFirstToken(page, 'copy');
  });
});

test.describe('V1 T5 independent inline one-click authorize', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    test.setTimeout(180_000);
    await cleanupE2EUsers(request);
  });

  test('upload → inline one-question → evidence → continue without leaving dashboard', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);
    await page.goto('/dashboard');
    const dashboardUrl = page.url();
    const observedCommands: ProductCommand[] = [];
    page.on('request', (request) => {
      if (
        request.method() !== 'POST' ||
        !request.url().includes('/api/core/product/commands')
      ) {
        return;
      }
      const command = request.postDataJSON() as ProductCommand;
      observedCommands.push(command);
    });

    // L3-2: inline source intake moved into the attach capsule popover, so the
    // whole one-question journey below runs while that panel is open. The
    // contract is unchanged — intake is still inline on the Composer surface,
    // it is no longer permanently unfolded.
    const attachPanel = await openComposerCapsule(page, 'attach');
    const sourcePicker = page.getByTestId('composer-source-picker');
    await expect(
      sourcePicker,
      'the canonical Composer must provide inline source intake'
    ).toBeVisible();
    const galleryInput = sourcePicker.locator('#composer-gallery-input');
    await expect(galleryInput).toBeAttached();
    await galleryInput.setInputFiles({
      buffer: PNG_FIXTURE,
      mimeType: 'image/png',
      name: `t5-inline-${crypto.randomUUID()}.png`,
    });

    // Exactly one inline question — not the multi-field library form.
    await expect(
      page.getByText(/这是你店里的真实素材吗|Is this a real store material/)
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole('button', {
        name: /确认：允许公开宣传|Confirm public use|是，可用于公开宣传/,
      })
    ).toHaveCount(1);
    const uploadList = page.getByRole('list', {
      name: /本次创作的图片|Images in this creation/,
    });
    await expect(uploadList.getByRole('listitem')).toHaveCount(1);
    expect(
      await uploadList.evaluate(
        (element) =>
          getComputedStyle(element)
            .gridTemplateColumns.split(' ')
            .filter(Boolean).length
      )
    ).toBe(1);
    const publicUseButton = page.getByRole('button', {
      name: /确认：允许公开宣传|Confirm public use|是，可用于公开宣传/,
    });
    expect(
      await publicUseButton.evaluate((element) => ({
        clientWidth: element.clientWidth,
        height: element.getBoundingClientRect().height,
        scrollWidth: element.scrollWidth,
        whiteSpace: getComputedStyle(element).whiteSpace,
      }))
    ).toMatchObject({
      height: expect.any(Number),
      whiteSpace: 'normal',
    });
    expect(
      await publicUseButton.evaluate(
        (element) => element.getBoundingClientRect().height
      )
    ).toBeGreaterThanOrEqual(44);
    expect(
      await publicUseButton.evaluate(
        (element) => element.scrollWidth <= element.clientWidth
      )
    ).toBe(true);
    // Details form collapsed by default (no forced evidence field).
    await expect(page.getByLabel('授权凭证编号或存档位置')).toHaveCount(0);

    await page
      .getByRole('button', {
        name: /确认：允许公开宣传|Confirm public use|是，可用于公开宣传/,
      })
      .click();

    await expect(
      page.getByText(/已保存到素材库|素材信息已确认/).first()
    ).toBeVisible({ timeout: 60_000 });

    // URL unchanged — no hop to /dashboard/assets/:id.
    expect(new URL(page.url()).pathname).toBe(new URL(dashboardUrl).pathname);
    await expect(page).not.toHaveURL(/\/dashboard\/assets\//);

    // Leave the attach portal closed: an open capsule panel intercepts pointer
    // events over the rest of the Composer (same reason as 310c71e6).
    await closeComposerCapsule(page, attachPanel);

    const state = await productState(page);
    const authorized = state.assets.find(
      (asset) => asset.consentScope === 'public_marketing'
    );
    expect(authorized).toBeTruthy();
    // System evidence pointer (same authorize_asset field as library path).
    expect(authorized?.rightsEvidence).toMatch(/^system:inline-auth:/);
    expect(authorized?.containsPerson).toBe(false);
    expect(authorized?.minorStatus).toBe('none');

    const intakeCommand = observedCommands.find(
      (command) =>
        command.type === 'add_asset' && command.asset.id === authorized?.id
    );
    // Initial composer intake carries the same metadata fields that the
    // library path writes with update_asset_metadata before authorize_asset.
    expect(intakeCommand).toMatchObject({
      asset: {
        category: 'store',
        consentScope: 'internal_only',
        containsPerson: false,
        containsSensitiveData: false,
        id: authorized?.id,
        mediaType: 'image',
        minorStatus: 'none',
        rightsOwner: 'E2E 美业门店',
        sourceType: 'real',
        tags: [expect.stringMatching(/^t5-inline-/)],
      },
      type: 'add_asset',
    });
    const authorizationCommand = observedCommands.find(
      (command) =>
        command.type === 'authorize_asset' && command.assetId === authorized?.id
    );
    expect(authorizationCommand).toEqual({
      assetId: authorized?.id,
      consentScope: 'public_marketing',
      rightsEvidence: authorized?.rightsEvidence,
      type: 'authorize_asset',
    });

    // Continue: intent + submit still on the same surface.
    await selectComposerLens(page, 'copy');
    await page.getByLabel('描述这次想创作的内容').fill('内联授权后继续创作');
    await assertComposerQuoteReady(page);
    await expect(composerSubmitButton(page)).toBeEnabled();
    // Prove the authorized asset is in product state (composer source-ready).
    const reread = (await page.evaluate(async () => {
      const response = await fetch('/api/core/product/state', {
        credentials: 'same-origin',
      });
      const envelope = (await response.json()) as ApiEnvelope<ProductState>;
      if (!response.ok || 'error' in envelope) {
        throw new Error('Product state failed after T5 authorize');
      }
      return envelope.data;
    })) as ProductState;
    expect(
      reread.assets.some(
        (asset) =>
          asset.consentScope === 'public_marketing' &&
          /^system:inline-auth:/.test(asset.rightsEvidence ?? '')
      )
    ).toBe(true);

    await composerSubmitButton(page).click();
    await expect(page.locator('[data-has-token="true"]').first()).toBeVisible({
      timeout: 90_000,
    });
    await expect(page).not.toHaveURL(/\/dashboard\/results\//u);
    await expect(page.getByTestId('composer-conversation')).toBeVisible();
    await expect(page.getByTestId('composer-delivery-card')).toBeVisible({
      timeout: 180_000,
    });

    void user;
  });
});
