import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { seedConfirmedStore } from '../fixtures/product';
import { setTheme } from '../fixtures/page-health';
import { clickComposerDeliveryCard } from '../fixtures/ui-journey';

/**
 * T30 / #224 — D-114 定制创作主容器 acceptance.
 *
 * The Day-0 click budget lives in uiux-day0-contract.spec.ts; this file covers
 * what the reshell itself promises:
 *  - the run streams inside the conversation instead of navigating away, and
 *    the intermediate state is visible (not one final flash);
 *  - a refresh restores the session by re-subscribing, not by replaying a local
 *    copy of the transcript;
 *  - the submission body carries the three confirmed things, the signed preview
 *    shows them read-only, and admission accepts the same values;
 *  - the retired reuse slot form is absent from the shipped route;
 *  - both themes and the mobile viewport render the container.
 */

type SubmissionBody = {
  contentPackagePlatform?: string;
  distributionTarget?: string;
  deliverable?: { kind?: string; quantity?: number };
  catalogModel?: { id?: string; revision?: string };
  recipe?: { id?: string; revision?: string };
  creationMode?: string;
  intent?: string;
};

/**
 * The intent names a service category on purpose. D-111 asks a structured
 * question (`…:s1:industry_category`) when it cannot infer one, and a run that
 * is waiting on that question produces no token and no 成品预览卡 — these
 * journeys would be measuring a suspended workflow instead of the reshell.
 * Answering it is not an option here either: for Composer-originated runs a
 * substantive answer is rejected outright (that defect is T41's). So the Day-0
 * main path is to say what the shop does, which is what a merchant types anyway.
 */
async function startCopyRun(page: Page, intent: string) {
  await page.goto('/dashboard');
  await page.getByTestId('composer-lens-option-copy').click();
  await page.getByTestId('composer-intent-input').fill(intent);
  await expect(page.getByTestId('composer-quote-line')).toBeVisible({
    timeout: 30_000,
  });

  const requestPromise = page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      request.url().includes('/api/core/p1/composer/submissions'),
    { timeout: 120_000 }
  );
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/core/p1/composer/submissions'),
    { timeout: 120_000 }
  );
  await page.getByTestId('composer-submit').click();

  // D-094 / D-116: some paths interpose one Brief confirmation before the
  // submission is posted. Confirm it if it appears, otherwise carry on.
  const briefSurface = page.getByTestId('composer-brief-surface');
  const next = await Promise.race([
    briefSurface
      .waitFor({ state: 'visible', timeout: 60_000 })
      .then(() => 'brief' as const)
      .catch(() => 'submission' as const),
    requestPromise.then(() => 'submission' as const),
  ]);
  if (next === 'brief') {
    await page.getByTestId('composer-brief-confirm').click();
  }

  const request = await requestPromise;
  const body = request.postDataJSON() as SubmissionBody;
  const response = await responsePromise;
  const envelope = (await response.json()) as {
    data?: { work?: { id?: string }; task?: { id?: string } };
    error?: { message?: string };
  };
  expect(response.ok(), envelope.error?.message).toBeTruthy();
  return {
    body,
    taskId: envelope.data?.task?.id ?? '',
    workId: envelope.data?.work?.id ?? '',
  };
}

test.describe('D-114 Composer conversation container', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('streams the run in place and only opens Result Center on the delivery card', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    const run = await startCopyRun(page, '写一条周末皮肤护理到店预约文案');

    // The merchant's own sentence opens the transcript.
    await expect(page.getByTestId('composer-conversation')).toBeVisible();
    await expect(page.getByTestId('composer-turn-merchant')).toContainText(
      '写一条周末皮肤护理到店预约文案'
    );
    await expect(page).not.toHaveURL(/\/dashboard\/results\//u);

    // 白话进度: at least one stage announcement, and none of it engineering
    // vocabulary or internal ids (D-116).
    const stageLines = page.getByTestId('composer-stage-line');
    await expect(stageLines.first()).toBeVisible({ timeout: 120_000 });
    const announced = (await stageLines.allInnerTexts()).join('\n');
    expect(announced).not.toMatch(
      /workflow|revision|schema|provider|store_fact:|catalogModel/iu
    );
    expect(announced).not.toContain(run.taskId);

    // token 流式中间态: the candidate area must show partial text before the
    // run finishes, not a single final flash.
    const stream = page.getByTestId('composer-candidate-stream');
    await expect(stream).toHaveAttribute('data-has-token', 'true', {
      timeout: 120_000,
    });
    const partial = await page
      .getByTestId('composer-candidate-primary')
      .innerText();
    expect(partial.trim().length).toBeGreaterThan(0);
    // Default shape is one primary candidate — never a grid of parallel picks.
    await expect(page.getByTestId('composer-candidate-primary')).toHaveCount(1);

    // Delivery is a card in the flow; clicking it is the only navigation.
    const deliveryCard = page.getByTestId('composer-delivery-card');
    await expect(deliveryCard).toBeVisible({ timeout: 180_000 });
    await expect(page).not.toHaveURL(/\/dashboard\/results\//u);
    await clickComposerDeliveryCard(deliveryCard);
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/results/${encodeURIComponent(run.workId)}`, 'u'),
      { timeout: 60_000 }
    );
    await expect(page.getByTestId('result-center-shell')).toBeVisible();
  });

  test('a refresh restores the session by re-subscribing to the run', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    const run = await startCopyRun(page, '写一条新客皮肤护理到店体验文案');
    await expect(page.getByTestId('composer-conversation')).toBeVisible();
    await expect(page.getByTestId('composer-stage-line').first()).toBeVisible({
      timeout: 120_000,
    });

    await page.reload();

    // Still the Composer route — restore is not a navigation.
    await expect(page).toHaveURL(/\/dashboard(?:\?|$)/u);
    await expect(page.getByTestId('composer-conversation')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId('composer-turn-merchant')).toContainText(
      '写一条新客皮肤护理到店体验文案'
    );
    // The transcript came back from the replayed event log, so the progress
    // the browser never stored is present again.
    await expect(page.getByTestId('composer-stage-line').first()).toBeVisible({
      timeout: 120_000,
    });
    const deliveryCard = page.getByTestId('composer-delivery-card');
    await expect(deliveryCard).toBeVisible({
      timeout: 180_000,
    });
    await clickComposerDeliveryCard(deliveryCard);
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/results/${encodeURIComponent(run.workId)}`, 'u'),
      { timeout: 60_000 }
    );
  });

  test('the submission body carries what the read-only preview showed', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    await page.goto('/dashboard');
    await page.getByTestId('composer-lens-option-copy').click();
    await page.getByTestId('composer-destination-option-xiaohongshu').click();
    await page
      .getByTestId('composer-intent-input')
      .fill('写一条夏日护理预约文案');
    await expect(page.getByTestId('composer-quote-line')).toBeVisible({
      timeout: 30_000,
    });

    // The signed fields are shown, and shown read-only.
    const preview = page.getByTestId('composer-signed-preview');
    await expect(preview).toBeVisible();
    await expect(
      page.getByTestId('composer-signed-row-destination')
    ).toContainText('小红书');
    await expect(
      page.getByTestId('composer-signed-row-deliverable')
    ).toBeVisible();
    expect(
      await preview.locator('input, select, textarea').count(),
      'signed fields must not be editable form controls (T08 / D-031)'
    ).toBe(0);
    await expect(
      page.getByTestId('composer-destination-capability')
    ).toHaveText('生成后导出');

    const requestPromise = page.waitForRequest(
      (request_) =>
        request_.method() === 'POST' &&
        request_.url().includes('/api/core/p1/composer/submissions'),
      { timeout: 120_000 }
    );
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/core/p1/composer/submissions'),
      { timeout: 120_000 }
    );
    await page.getByTestId('composer-submit').click();

    const body = (await requestPromise).postDataJSON() as SubmissionBody;
    // 「发到哪」answered once in the UI, mapped to the双字段 pair (M-01).
    expect(body.contentPackagePlatform).toBe('xiaohongshu');
    expect(body.distributionTarget).toBe('export');
    expect(body.deliverable?.kind).toBeTruthy();
    expect(body.catalogModel?.id).toBeTruthy();
    expect(body.catalogModel?.revision).toBeTruthy();
    expect(body.recipe?.revision).toBeTruthy();
    // D-111: the entry declares itself; the route is the server's to decide.
    expect(body.creationMode).toBe('customized');
    expect(body.intent).toContain('夏日护理');

    // Admission re-parses the body and refuses a quote whose contract hash does
    // not fingerprint these exact signed fields, so a 2xx here is the server
    // agreeing that the frozen values are the ones the merchant saw.
    const response = await responsePromise;
    const envelope = (await response.json()) as {
      error?: { message?: string };
    };
    expect(response.ok(), envelope.error?.message).toBeTruthy();
  });

  test('the retired reuse slot form is absent from the shipped route', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);
    await page.goto('/dashboard');
    await expect(page.getByTestId('composer-home')).toBeVisible();

    // D-164②: reuse is not a recipe pill. Every pill in that row applies a
    // recipe; 旧内容换平台 hands a sentence back to the conversation instead, so
    // it lives in the chips below and nowhere else. This used to be a `count()
    // > 0` guard, which after the pill row would have skipped silently forever
    // rather than testing anything.
    await expect(
      page.getByTestId('composer-recipe-card-reuse_content')
    ).toHaveCount(0);
    await page.getByTestId('composer-reuse-chip-xiaohongshu').click();
    // Reuse is answered in the flow: the draft gets a sentence, not a panel.
    await expect(page.getByTestId('composer-intent-input')).not.toHaveValue('');

    for (const testId of [
      'composer-reuse-content-panel',
      'composer-reuse-confirm',
      'composer-reuse-lens-copy',
      'composer-reuse-carrier-wechat_moments',
      'composer-settings-row',
    ]) {
      await expect(page.getByTestId(testId)).toHaveCount(0);
    }
    await expect(page.locator('#composer-setting-input-platform')).toHaveCount(
      0
    );
    // The chips that replaced it are present and one-tap.
    await expect(page.getByTestId('composer-reuse-chips')).toBeVisible();
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`the container renders on mobile in the ${theme} theme`, async ({
      page,
      request,
    }) => {
      const user = await registerE2EUser(request);
      await loginByForm(page, user);
      await seedConfirmedStore(page);
      await setTheme(page, theme);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/dashboard');

      // Prove the theme landed. The first version switched the
      // emulated colour scheme, which cannot move a class-based
      // theme: it shipped a byte-identical light/dark screenshot
      // pair and still passed.
      await expect(page.locator('html')).toHaveClass(
        new RegExp(`\\b${theme}\\b`, 'u')
      );

      const home = page.getByTestId('composer-home');
      await expect(home).toBeVisible();
      await expect(home).toHaveAttribute('data-viewport', 'mobile');
      // The HeroUI token bridge keys on this shell class; without it every
      // vendored component falls back to HeroUI's own Glass defaults. S7 / U07
      // moved it off this page onto the shell root: the shell itself is a
      // HeroUI Pro Sidebar now, so every /dashboard and /settings route needs
      // the bridge, not only the pages that happen to render Pro components.
      await expect(
        page.locator('[data-slot="sidebar-provider"].meiye-heroui-glass')
      ).toHaveCount(1);
      await expect(page.getByTestId('composer-prompt-bar')).toBeVisible();
      await expect(page.getByTestId('composer-intent-input')).toBeVisible();
      await expect(page.getByTestId('composer-submit')).toBeVisible();

      // Nothing may scroll the page sideways on a phone.
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(1);

      // 走查截图 — the ticket asks for a visual pass, not just assertions.
      await page.screenshot({
        fullPage: true,
        path: `../.scratch/t30-composer-reshell-2026-07-25/composer-mobile-${theme}.png`,
      });
    });

    test(`the container renders on desktop in the ${theme} theme`, async ({
      page,
      request,
    }) => {
      const user = await registerE2EUser(request);
      await loginByForm(page, user);
      await seedConfirmedStore(page);
      await setTheme(page, theme);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/dashboard');

      // Prove the theme landed. The first version switched the
      // emulated colour scheme, which cannot move a class-based
      // theme: it shipped a byte-identical light/dark screenshot
      // pair and still passed.
      await expect(page.locator('html')).toHaveClass(
        new RegExp(`\\b${theme}\\b`, 'u')
      );

      await expect(page.getByTestId('composer-home')).toBeVisible();
      await expect(page.getByTestId('composer-prompt-bar')).toBeVisible();
      // The retired slot forms must be absent in the walkthrough shot too.
      await expect(page.getByTestId('composer-settings-row')).toHaveCount(0);
      await expect(
        page.getByTestId('composer-reuse-content-panel')
      ).toHaveCount(0);
      await page.screenshot({
        fullPage: true,
        path: `../.scratch/t30-composer-reshell-2026-07-25/composer-desktop-${theme}.png`,
      });
    });
  }
});
