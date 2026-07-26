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
import { productState, seedConfirmedStore } from '../fixtures/product';
import {
  blockingQuestionLocator,
  briefConfirmButton,
  composerLensOption,
  composerRecipeCard,
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
 * Click budget (isTrusted real-count via installUserActivationCounter):
 *   1. Template / scenario card path: card(1 dual-purpose lens+apply) + start(2) = 2
 *   2. Pure free-text path: select lens(1) + start(2) = 2
 *   3. Video path: select lens(1) + start(2) + Brief confirm(3) = 2 base + 1 extra
 *      (D-094 / D-043 decision ③ Brief confirm is EXTRA and not cancelled by C6)
 *
 * Required lens/mode selector = mode selector, NOT a forbidden pre-form (D-081).
 * Old free-text "≤2 without mode select" semantics are retired — they conflict
 * with D-081 forced lens selection.
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
async function assertVideoFirstUsableResult(page: Page) {
  await expect(
    page,
    'submitting must not navigate away from the Composer conversation'
  ).not.toHaveURL(/\/dashboard\/results\//u);
  await expect(page.getByTestId('composer-conversation')).toBeVisible({
    timeout: 60_000,
  });

  const deliveryCard = page.getByTestId('composer-delivery-card');
  await expect(deliveryCard).toBeVisible({ timeout: 180_000 });
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

async function creativeEventTypes(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/core/p1/query', {
      body: JSON.stringify({
        action: 'creative_workbench',
        module: 'operations',
        payload: {},
      }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const envelope = (await response.json()) as {
      data?: { events?: Array<{ type?: string }> };
      error?: { message?: string };
    };
    if (!response.ok || !envelope.data) {
      throw new Error(
        envelope.error?.message ?? 'Creative workbench query failed'
      );
    }
    return (envelope.data.events ?? []).flatMap((event) =>
      event.type ? [event.type] : []
    );
  });
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
    `${label}: D-098 C6 expects exactly ${expected} isTrusted user activations to first token; got ${activationCount}: ${JSON.stringify(counter.events())}`
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
    test('scene/template card (1, lens+apply) + start (2) = 2 activations to first token', async ({
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

      // C6: a Recipe card click is dual-purpose (select lens + apply patch).
      // That single activation occupies the lens-selection budget slot.
      const templateCard = composerRecipeCard(page);
      await expect(
        templateCard,
        'Day-0 template path needs a visible scene/template card on the entry surface'
      ).toBeVisible();
      await templateCard.click();
      expect(
        counter.count(),
        `template card must count as exactly 1 isTrusted activation (C6 dual-purpose); events=${JSON.stringify(counter.events())}`
      ).toBe(1);

      await assertComposerQuoteReady(page);
      await expect(composerSubmitButton(page)).toBeEnabled();
      await assertZeroBlockingBeforeSubmit(page);

      await composerSubmitButton(page).click();

      await assertResultFirstToken(page, 'copy');
      const activationCount = await counter.waitForFirstTokenAndStop({
        timeout: 90_000,
      });

      assertActivationBudget(activationCount, 2, counter, 'template path (C6)');

      await expect(blockingQuestionLocator(page)).toHaveCount(0);
      await expect(firstTokenLocator(page)).toHaveAttribute(
        'data-has-token',
        'true'
      );
      const events = await creativeEventTypes(page);
      expect(events).toContain('first_work_created');
      expect(events).not.toContain('cold_start_skipped');

      // The other half of the replaced navigation assertion: the Result Center
      // is still reachable, by clicking the 成品预览卡. Measurement has already
      // stopped, so this click is outside the budget.
      await assertDeliveryCardOpensResultCenter(page);
    });
  });

  test.describe('pure text path (C6 forced lens select)', () => {
    test('select lens (1) + start creation (2) = 2 activations to first token', async ({
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
      // The Composer starts cold; selecting the explicit copy radio is
      // one trusted activation and never relies on an inferred default.
      const lensChip = composerLensOption(page, 'copy');
      await expect(
        lensChip,
        'pure text path requires a visible lens/mode chip (做图文/做文案); red until C/D Composer enforces D-081 if absent'
      ).toBeVisible();
      await lensChip.click();
      expect(
        counter.count(),
        `lens select must count as exactly 1 isTrusted activation; events=${JSON.stringify(counter.events())}`
      ).toBe(1);

      // Typing is NOT a user-activation (counter only records trusted clicks /
      // Cmd+Enter). Free-text path budget is still exactly 2 clicks.
      const intent = page.getByLabel('描述这次想创作的内容');
      await intent.fill('为透亮猫眼写一条克制的到店种草');
      await assertComposerQuoteReady(page);
      await expect(composerSubmitButton(page)).toBeEnabled();
      await expect(blockingQuestionLocator(page)).toHaveCount(0);
      expect(counter.count()).toBe(1);

      await composerSubmitButton(page).click();

      await assertResultFirstToken(page, 'copy');
      const activationCount = await counter.waitForFirstTokenAndStop({
        timeout: 90_000,
      });

      // Exact 2 — not ≤2. A path that skips lens select and only clicks start
      // (old free-text semantics) would report 1 and must fail this gate.
      assertActivationBudget(
        activationCount,
        2,
        counter,
        'pure text path (C6)'
      );

      await expect(blockingQuestionLocator(page)).toHaveCount(0);
      await expect(firstTokenLocator(page)).toHaveAttribute(
        'data-has-token',
        'true'
      );
      const events = await creativeEventTypes(page);
      expect(events).toContain('first_work_created');
      expect(events).not.toContain('cold_start_skipped');

      // The other half of the replaced navigation assertion.
      await assertDeliveryCardOpensResultCenter(page);
    });
  });

  test.describe('video path (C6 base 2 + D-094 Brief confirm)', () => {
    test('select video lens (1) + start (2) + Brief confirm (3) to first token', async ({
      page,
      request,
    }) => {
      test.setTimeout(180_000);
      const counter = await installUserActivationCounter(page);
      await day0SeedPrep(page, request);

      counter.beginMeasurement();
      await assertNoSkipUsed(page, counter);
      await assertZeroBlockingBeforeSubmit(page);

      // Base C6 budget: lens select + start = 2.
      const videoChip = composerLensOption(page, 'video');
      await expect(
        videoChip,
        'video path requires a visible 做视频 mode chip'
      ).toBeVisible();
      await videoChip.click();
      expect(counter.count()).toBe(1);

      const intent = page.getByLabel('描述这次想创作的内容');
      await intent.fill('为夏季美甲写一条15秒到店种草短视频');
      await assertComposerQuoteReady(page);
      await expect(composerSubmitButton(page)).toBeEnabled();
      expect(counter.count()).toBe(1);

      await composerSubmitButton(page).click();
      expect(counter.count()).toBe(2);

      // D-094 / D-043 decision ③: any video generation requires conditional
      // Brief confirm. This EXTRA click is NOT cancelled by C6 — expected
      // total is 3 (2 base + 1 Brief), not 2.
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
        `after Brief confirm expected 3 isTrusted activations (2 base + Brief); events=${JSON.stringify(counter.events())}`
      ).toBe(3);

      // First-token endpoint is the Day-0 stop condition for all three paths.
      // Video may still be red on the current surface until Result Center /
      // video first-token projection lands — keep the hard wait (no fake-green).
      await assertVideoFirstUsableResult(page);
      counter.stop();
      const activationCount = counter.count();
      expect(
        activationCount,
        `video path (C6+D-094): expected exactly 3 isTrusted activations (lens + start + Brief confirm) to first token; got ${activationCount}: ${JSON.stringify(counter.events())}`
      ).toBe(3);
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

  test('keyboard submit path: lens select (1 click) + Cmd/Ctrl+Enter (1) = 2 activations', async ({
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
    const lensChip = composerLensOption(page, 'copy');
    await expect(lensChip).toBeVisible();
    await lensChip.click();

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

    // 1 click (lens) + 1 keyboard_submit. Cmd/Ctrl+Enter does not produce a click.
    expect(
      activationCount,
      `keyboard path under C6 expects lens click + keyboard_submit = 2; got ${activationCount}: ${JSON.stringify(counter.events())}`
    ).toBe(2);
    expect(counter.events()).toEqual([
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
    // Conflict path is exempt from the C6 2-click base budget because the
    // conditional Brief confirmation is mandatory. The new Composer must not
    // resurrect the retired Harness question form.
    await installUserActivationCounter(page);
    await day0SeedPrep(page, request);

    // Conflict fixture path: free-text that triggers the offer-price question.
    // D-081 still requires an explicit lens. This path is exempt only from
    // the two-click budget because the conflict confirmation is mandatory.
    await composerLensOption(page, 'copy').click();
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
    await composerLensOption(page, 'copy').click();
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
    await expect(page.getByTestId('result-center-shell')).toBeVisible();

    void user;
  });
});
