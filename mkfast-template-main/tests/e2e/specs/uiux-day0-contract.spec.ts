import {
  expect,
  test,
  type Page,
  type Response as PlaywrightResponse,
} from '@playwright/test';
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
  blockingQuestionLocator,
  briefConfirmButton,
  composerSubmitButton,
  creationModeChip,
  installUserActivationCounter,
  sceneTemplateCard,
  skipOnboardingButton,
  type UserActivationCounter,
} from '../fixtures/user-activation';

/**
 * V1 Day-0 experience contract hard gate — D-098 C6 rebaseline (#85 / #60).
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
 * Assertions target the CURRENT shipped surface (CreationModePicker chips +
 * scene cards). Red is honest until C/D Composer / C4 Brief UI lands; do not
 * weaken isTrusted counters or soft-pass missing steps.
 */

const PNG_FIXTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

function isFirstUsableDraftMetricResponse(response: PlaywrightResponse) {
  if (
    response.request().method() !== 'POST' ||
    !response.url().includes('/api/core/p1/harness/tasks/') ||
    !response.url().endsWith('/product-metrics')
  ) {
    return false;
  }
  const body = response.request().postDataJSON() as Record<string, unknown>;
  return (
    typeof body.idempotencyKey === 'string' &&
    body.idempotencyKey.startsWith('first-usable-draft-v1:') &&
    (body.path === 'canonical_mouse' ||
      body.path === 'keyboard' ||
      body.path === 'conflict') &&
    typeof body.timeToFirstUsableDraftMs === 'number' &&
    typeof body.userActivationCount === 'number'
  );
}

async function day0SeedPrep(
  page: Page,
  request: Parameters<typeof registerE2EUser>[0]
) {
  const user = await registerE2EUser(request);
  await loginByForm(page, user);
  await seedConfirmedStore(page);
  await page.goto('/dashboard');
  await seedComposerInlineAuthorize(page);
  return user;
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
  // Canonical path must never click "暂时跳过" (would fake-green onboarding).
  await expect(skipOnboardingButton(page)).toHaveCount(1);
  expect(counter.count()).toBe(0);
}

async function assertZeroBlockingBeforeSubmit(page: Page) {
  await expect(blockingQuestionLocator(page)).toHaveCount(0);
  await expect(briefConfirmButton(page)).toHaveCount(0);
  await expect(page.getByText('尚未完成可用性验证')).toHaveCount(0);
  await expect(page.getByText('保留原模型，但暂不可提交')).toHaveCount(0);
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

      // C6: template/scenario card click is dual-purpose (select lens + apply).
      // On the current surface this is a SceneVisualButton (e.g. 引流 · 美甲)
      // that fills intent and resolves a named preset family in one click.
      // That single activation occupies the lens-selection budget slot; do NOT
      // also click CreationModePicker here (would over-count past 2).
      const templateCard = sceneTemplateCard(page);
      await expect(
        templateCard,
        'Day-0 template path needs a visible scene/template card on the entry surface'
      ).toBeVisible();
      await templateCard.click();
      expect(
        counter.count(),
        `template card must count as exactly 1 isTrusted activation (C6 dual-purpose); events=${JSON.stringify(counter.events())}`
      ).toBe(1);

      await expect(composerSubmitButton(page)).toBeEnabled();
      await assertZeroBlockingBeforeSubmit(page);

      const acceptedMetric = page.waitForResponse(
        isFirstUsableDraftMetricResponse,
        { timeout: 90_000 }
      );
      await composerSubmitButton(page).click();

      const activationCount = await counter.waitForFirstTokenAndStop({
        timeout: 90_000,
      });
      const metricResponse = await acceptedMetric;
      expect(metricResponse.status()).toBe(202);
      expect(metricResponse.request().postDataJSON()).toMatchObject({
        idempotencyKey: expect.stringMatching(/^first-usable-draft-v1:/),
        path: 'canonical_mouse',
        timeToFirstUsableDraftMs: expect.any(Number),
        userActivationCount: activationCount,
      });
      expect(metricResponse.request().postDataJSON().path).not.toBe('conflict');

      assertActivationBudget(activationCount, 2, counter, 'template path (C6)');

      await expect(blockingQuestionLocator(page)).toHaveCount(0);
      await expect(
        page.getByTestId('harness-primary-candidate')
      ).toHaveAttribute('data-has-token', 'true');
      await expect(page.getByText('新项目到店前先看这几点')).toBeVisible();
      const events = await creativeEventTypes(page);
      expect(events).toContain('first_work_created');
      expect(events).not.toContain('cold_start_skipped');
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
      // Current chips: 做图文 | 做视频. Clicking the mode chip always counts as
      // 1 isTrusted activation even if the UI still auto-defaults a mode today.
      // When C/D Composer enforces D-081 (no auto-default), this same select
      // click remains required — red is expected if the chip is missing.
      const lensChip = creationModeChip(page, 'image_text');
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
      await expect(composerSubmitButton(page)).toBeEnabled();
      await expect(blockingQuestionLocator(page)).toHaveCount(0);
      expect(counter.count()).toBe(1);

      const acceptedMetric = page.waitForResponse(
        isFirstUsableDraftMetricResponse,
        { timeout: 90_000 }
      );
      await composerSubmitButton(page).click();

      const activationCount = await counter.waitForFirstTokenAndStop({
        timeout: 90_000,
      });
      const metricResponse = await acceptedMetric;
      expect(metricResponse.status()).toBe(202);
      expect(metricResponse.request().postDataJSON()).toMatchObject({
        idempotencyKey: expect.stringMatching(/^first-usable-draft-v1:/),
        path: 'canonical_mouse',
        timeToFirstUsableDraftMs: expect.any(Number),
        userActivationCount: activationCount,
      });
      expect(metricResponse.request().postDataJSON().path).not.toBe('conflict');

      // Exact 2 — not ≤2. A path that skips lens select and only clicks start
      // (old free-text semantics) would report 1 and must fail this gate.
      assertActivationBudget(activationCount, 2, counter, 'pure text path (C6)');

      await expect(blockingQuestionLocator(page)).toHaveCount(0);
      await expect(
        page.getByTestId('harness-primary-candidate')
      ).toHaveAttribute('data-has-token', 'true');
      await expect(page.getByText('新项目到店前先看这几点')).toBeVisible();
      const events = await creativeEventTypes(page);
      expect(events).toContain('first_work_created');
      expect(events).not.toContain('cold_start_skipped');
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
      const videoChip = creationModeChip(page, 'video');
      await expect(
        videoChip,
        'video path requires a visible 做视频 mode chip'
      ).toBeVisible();
      await videoChip.click();
      expect(counter.count()).toBe(1);

      const intent = page.getByLabel('描述这次想创作的内容');
      await intent.fill('为夏季美甲写一条15秒到店种草短视频');
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
      const activationCount = await counter.waitForFirstTokenAndStop({
        timeout: 90_000,
      });
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
    const lensChip = creationModeChip(page, 'image_text');
    await expect(lensChip).toBeVisible();
    await lensChip.click();

    const intent = page.getByLabel('描述这次想创作的内容');
    await intent.fill('快捷键提交也应直达首 token');
    await intent.press(
      process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter'
    );

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
        '<a data-activation-navigation="content" href="/dashboard/content">activation navigation content</a>'
      );
    });
    await page.locator('[data-activation-navigation="content"]').click();
    await expect(page).toHaveURL(/\/dashboard\/content$/);
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

  test('conflict path: exactly one question then continue (exempt from C6 2-click base budget)', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    // Conflict path is exempt from the C6 2-click base budget (extra question
    // card is mandatory when facts conflict). Do not re-apply free-text ≤2
    // semantics here — only assert the single-question contract + token reach.
    await installUserActivationCounter(page);
    await day0SeedPrep(page, request);

    // Conflict fixture path: free-text that triggers the offer-price question.
    // Lens default on current surface is copy; we do not assert the C6 base
    // budget on this path (exempt). When D-081 is enforced, this path still
    // remains exempt for the conflict card itself.
    const intent = page.getByLabel('描述这次想创作的内容');
    await intent.fill('把新团购做一套能发的');
    await composerSubmitButton(page).click();

    await expect(page.getByText('只需确认一件事')).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      page.getByRole('heading', { name: '这次团购价按哪个金额写？' })
    ).toBeVisible();
    // Exactly one question card — not a multi-form wall.
    await expect(
      page.getByRole('heading', { name: '这次团购价按哪个金额写？' })
    ).toHaveCount(1);

    const workUrl = page.url();
    await page
      .getByRole('textbox', { name: '这次团购价按哪个金额写？' })
      .fill('398 元');
    await page.getByRole('button', { name: '确认并继续' }).click();

    await expect(
      page.getByRole('heading', { name: '这次团购价按哪个金额写？' })
    ).toBeHidden({ timeout: 30_000 });
    await expect(page).toHaveURL(workUrl);

    // Continuation to a real token is still mandatory; original Harness task
    // must not be resubmitted.
    await expect(page.getByText('只需确认一件事')).toHaveCount(0);
    await expect(page.locator('[data-has-token="true"]').first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText('新项目到店前先看这几点')).toBeVisible();
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

    const galleryInput = page.locator('#composer-gallery-input');
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
    await page.getByLabel('描述这次想创作的内容').fill('内联授权后继续创作');
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
    await expect(page.getByText('新项目到店前先看这几点')).toBeVisible();

    void user;
  });
});
