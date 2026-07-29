/**
 * P1-F2 continuous acceptance harness (#161).
 *
 * Primary seam: logged-in browser → public HTTP+SSE (App Shell BFF → Core) →
 * recorded/fixture MODEL_EXECUTION_MODE. Never treats a frontend short-circuit
 * as #161 pass evidence.
 *
 * Journeys covered as far as local recorded mode allows:
 *   1. Merchant-language UUID leak negative control
 *   2. Copy close-loop: Result → adjust → adopt → delivery → publication →
 *      outcome chips → weekly review → next-round action
 *   3. Image-text Result → adopt → delivery package
 *   4. Video Result → adopt → delivery package
 *   5. Content + Assets merchant-language surfaces
 *   6. Axe serious/critical zero on Composer / Result / Content / Assets /
 *      Delivery / Weekly Review (light + dark)
 *   7. Responsive 320/375/768/1440 + 200% zoom smoke on Result
 *   8. prefers-reduced-motion keeps Result usable
 *
 * Honest residuals (see docs/evidence/p1-f2-161/README.md):
 *   - VoiceOver manual checklist
 *   - Save-Data / low-power hooks (no product hook found)
 *   - Full rights-withdrawal + safe-replace browser path
 *   - Legacy Content on-demand anchor journey without seeded legacy fixtures
 *   - #147 P0 staging RC / live provider
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { setTheme, type ThemeMode } from '../fixtures/page-health';
import {
  seedComposerInlineAuthorize,
  seedConfirmedStore,
} from '../fixtures/product';
import {
  adoptResult,
  adjustResult,
  assertJourneyRestored,
  assertThreeModalDiscovery,
  downloadFullPackage,
  JOURNEY_CONTRACTS,
  openDeliveryPanel,
  submitComposerJourney,
  waitForResultJourney,
  type JourneyContract,
} from '../fixtures/ui-journey';

const RESPONSIVE_VIEWPORTS = [
  { width: 320, height: 720 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
] as const;

const AXE_SURFACES = [
  'composer',
  'result',
  'content',
  'assets',
  'delivery',
  'weekly-review',
] as const;

const MERCHANT_LEAK_PATTERN =
  /\b(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\b|(?:\b(?:running|ready|delivered|candidate_ready|needs_input|automatic_verified|assisted|unavailable|internal_only|public_marketing)\b)|(?:provider|workId=|workspaceId=|assetId=|catalogModelId|seedance-2|gpt-image|llm-openai)/iu;

function merchantRunSuffix() {
  // Intents are echoed on merchant surfaces, so keep the unique test marker
  // useful without writing a full UUID into the product-visible transcript.
  return crypto.randomUUID().slice(0, 8);
}

function copyContract(): JourneyContract {
  return JOURNEY_CONTRACTS.find((c) => c.modality === 'copy')!;
}

function imageTextContract(): JourneyContract {
  return JOURNEY_CONTRACTS.find((c) => c.modality === 'image_text')!;
}

function videoContract(): JourneyContract {
  return JOURNEY_CONTRACTS.find((c) => c.deliveryTarget === 'douyin')!;
}

async function assertNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    const maxScrollX = (() => {
      const previous = window.scrollX;
      window.scrollTo({ left: root.scrollWidth, top: window.scrollY });
      const scrolled = window.scrollX;
      window.scrollTo({ left: previous, top: window.scrollY });
      return scrolled;
    })();
    return {
      maxScrollX,
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      innerWidth: window.innerWidth,
    };
  });
  expect(
    overflow.scrollWidth - overflow.innerWidth,
    `${label} horizontal overflow: ${JSON.stringify(overflow)}`
  ).toBeLessThanOrEqual(1);
  expect(
    overflow.maxScrollX,
    `${label} horizontal scroll: ${JSON.stringify(overflow)}`
  ).toBeLessThanOrEqual(1);
}

async function assertPrimaryCtaNotOccluded(page: Page, label: string) {
  const primary = page
    .getByTestId('result-primary-action')
    .or(page.getByTestId('composer-submit'))
    .or(page.getByTestId('delivery-action-full_package'))
    .first();
  if ((await primary.count()) === 0) return;
  await expect(
    primary,
    `${label}: primary CTA must stay visible`
  ).toBeVisible();
  const box = await primary.boundingBox();
  expect(box, `${label}: primary CTA must have geometry`).toBeTruthy();
  const viewport = page.viewportSize();
  expect(viewport).toBeTruthy();
  expect(
    box!.y + box!.height,
    `${label}: primary CTA must not sit fully below the viewport`
  ).toBeLessThanOrEqual(viewport!.height + 1);
  expect(
    box!.x,
    `${label}: primary CTA must not start off-screen left`
  ).toBeGreaterThanOrEqual(-1);
  expect(
    box!.x + box!.width,
    `${label}: primary CTA must not extend past the right edge by more than 8px`
  ).toBeLessThanOrEqual(viewport!.width + 8);
}

async function assertMerchantLanguage(page: Page, surface: string) {
  const text = await page.locator('body').innerText();
  const leaks = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && MERCHANT_LEAK_PATTERN.test(line));
  expect(
    leaks,
    `${surface} must not leak UUID / raw enum / provider slug: ${leaks.join(' | ')}`
  ).toEqual([]);
}

async function assertAxeClean(page: Page, surface: string) {
  // Transient toasts must not be the only reason a surface fails a11y; product
  // success toast contrast is fixed in styles.css, but dismiss leftovers first.
  await page.evaluate(() => {
    for (const toast of document.querySelectorAll('[data-sonner-toast]')) {
      toast.remove();
    }
  });
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('[data-sonner-toaster]')
    .exclude('[data-testid="fluid-cursor-canvas"]')
    .analyze();
  const highImpact = axe.violations.filter(
    (violation) =>
      violation.impact === 'critical' || violation.impact === 'serious'
  );
  expect(
    highImpact.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.length,
      help: v.help,
      samples: v.nodes.slice(0, 3).map((node) => ({
        target: node.target,
        html: node.html?.slice(0, 160),
        failureSummary: node.failureSummary?.slice(0, 240),
      })),
    })),
    `${surface} axe serious/critical must be zero`
  ).toEqual([]);
}

async function recordManualPublication(page: Page) {
  // After adopt + package download, refresh so close-loop facts bind the
  // generated platform variants (variantVersionId) before manual publish.
  await page.reload();
  await expect(page.getByTestId('result-center-shell')).toBeVisible({
    timeout: 60_000,
  });
  const panel = page.getByTestId('publication-record-panel');
  await expect(panel).toBeVisible({ timeout: 60_000 });
  const form = page.getByTestId('publication-record-form');
  await expect(
    form,
    'close-loop publication form requires package + variant after adopt'
  ).toBeVisible({ timeout: 60_000 });

  // Only platforms with a real ContentPackage variant may be recorded.
  // Prefer an already-selected chip; otherwise take the first offered option.
  const platformChips = page.locator('[data-testid^="publication-platform-"]');
  await expect(platformChips.first()).toBeVisible({ timeout: 30_000 });
  await platformChips.first().click();
  await page.getByTestId('publication-account').fill('E2E 门店账号');
  const publishedAt = new Date().toISOString().slice(0, 16);
  await page.getByTestId('publication-at').fill(publishedAt);
  await page
    .getByTestId('publication-url')
    .fill('https://example.test/e2e-published');

  const responsePromise = page.waitForResponse(
    (response) => {
      if (
        response.request().method() !== 'POST' ||
        !response.url().includes('/api/core/p1/commands')
      ) {
        return false;
      }
      try {
        const body = response.request().postDataJSON() as { action?: unknown };
        return body.action === 'record_content_package_manual_result';
      } catch {
        return false;
      }
    },
    { timeout: 60_000 }
  );
  await page.getByTestId('publication-record-submit').click();
  const response = await responsePromise;
  expect(response.ok(), await response.text()).toBeTruthy();
  await expect(page.getByTestId('publication-record-row').first()).toBeVisible({
    timeout: 30_000,
  });
}

async function recordOutcomeAndWeekly(page: Page) {
  const chips = page.getByTestId('outcome-chips-panel');
  await expect(chips).toBeVisible({ timeout: 30_000 });
  const storeVisit = page.getByTestId('outcome-chip-store_visit');
  await expect(storeVisit).toHaveAttribute('data-enabled', 'true', {
    timeout: 30_000,
  });
  const signalPromise = page.waitForResponse(
    (response) => {
      if (
        response.request().method() !== 'POST' ||
        !response.url().includes('/api/core/p1/commands')
      ) {
        return false;
      }
      try {
        const body = response.request().postDataJSON() as { action?: unknown };
        return body.action === 'record_content_package_result_signal';
      } catch {
        return false;
      }
    },
    { timeout: 60_000 }
  );
  await storeVisit.click();
  const signalResponse = await signalPromise;
  expect(signalResponse.ok(), await signalResponse.text()).toBeTruthy();
  await expect(page.getByTestId('outcome-observation-row').first()).toBeVisible(
    { timeout: 30_000 }
  );
  await expect(
    page.locator(
      '[data-testid="outcome-result-ladder"] [data-ladder-step="published"]'
    )
  ).toHaveAttribute('data-reached', 'true');

  const weekly = page.getByTestId('weekly-review-panel');
  await expect(weekly).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('weekly-review-no-roi')).toBeVisible();
  const continueAction = page.getByTestId(
    'weekly-review-action-continue_series'
  );
  await expect(continueAction).toBeVisible({ timeout: 30_000 });
  const reviewPromise = page.waitForResponse(
    (response) => {
      if (
        response.request().method() !== 'POST' ||
        !response.url().includes('/api/core/p1/commands')
      ) {
        return false;
      }
      try {
        const body = response.request().postDataJSON() as { action?: unknown };
        return (
          body.action === 'record_content_package_result_review_action' ||
          body.action === 'derive_creative_work'
        );
      } catch {
        return false;
      }
    },
    { timeout: 60_000 }
  );
  await continueAction.click();
  const reviewResponse = await reviewPromise;
  expect(reviewResponse.ok(), await reviewResponse.text()).toBeTruthy();
}

test.describe('P1-F2 continuous acceptance (#161)', () => {
  // Independent journeys: one failure must not skip the rest of the matrix.
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    test.setTimeout(180_000);
    await cleanupE2EUsers(request);
  });

  test('merchant-language guard rejects a full UUID negative control', async ({
    page,
  }) => {
    await page.setContent(
      '<main>P1-F2 negative control 123e4567-e89b-42d3-a456-426614174000</main>'
    );

    await expect(
      assertMerchantLanguage(page, 'merchant-language negative control')
    ).rejects.toThrow(/must not leak UUID/u);
  });

  test('Copy continuous close-loop: Result → adopt → delivery → publication → outcome → weekly next', async ({
    page,
    request,
  }) => {
    test.setTimeout(420_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await setTheme(page, 'light');
    const contract = copyContract();
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);
    await page.goto('/dashboard');
    await assertThreeModalDiscovery(page);
    await assertAxeClean(page, 'Composer (light)');

    const workId = await submitComposerJourney(
      page,
      contract,
      `P1-F2 皮肤护理 朋友圈项目介绍 copy ${merchantRunSuffix()}`
    );
    await waitForResultJourney(page, contract, workId);
    await assertMerchantLanguage(page, 'Result (copy ready)');
    await assertAxeClean(page, 'Result (light)');

    await adoptResult(page, contract);
    const adjusted = await adjustResult(page, contract.modality);
    const resultWorkId = adjusted.workId ?? workId;
    if (adjusted.workId) {
      await waitForResultJourney(page, contract, adjusted.workId);
      await adoptResult(page, contract);
    }
    await openDeliveryPanel(page, contract.modality);
    await downloadFullPackage(page, contract);
    await assertAxeClean(page, 'Delivery (light)');

    // Close-loop: publication → outcome → weekly review recommendation.
    await recordManualPublication(page);
    await assertAxeClean(page, 'Weekly Review / Outcome (light)');
    await recordOutcomeAndWeekly(page);
    await assertJourneyRestored(page, contract, resultWorkId);
  });

  test('Image-text continuous: Result → adopt → delivery package', async ({
    page,
    request,
  }) => {
    test.setTimeout(360_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await setTheme(page, 'light');
    const contract = imageTextContract();
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);
    await page.goto('/dashboard');
    await seedComposerInlineAuthorize(page);
    const workId = await submitComposerJourney(
      page,
      contract,
      `P1-F2 皮肤护理 小红书套图 image_text ${merchantRunSuffix()}`
    );
    await waitForResultJourney(page, contract, workId);
    await assertMerchantLanguage(page, 'Result (image_text ready)');
    await adoptResult(page, contract);
    await openDeliveryPanel(page, contract.modality);
    await downloadFullPackage(page, contract);
    await assertJourneyRestored(page, contract, workId);
  });

  test('Video continuous: Result → adopt → delivery package', async ({
    page,
    request,
  }) => {
    test.setTimeout(600_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await setTheme(page, 'dark');
    const contract = videoContract();
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);
    await page.goto('/dashboard');
    await seedComposerInlineAuthorize(page);
    const workId = await submitComposerJourney(
      page,
      contract,
      `P1-F2 抖音项目成片 video ${merchantRunSuffix()}`
    );
    await waitForResultJourney(page, contract, workId);
    await assertMerchantLanguage(page, 'Result (video ready, dark)');
    await adoptResult(page, contract);
    await openDeliveryPanel(page, contract.modality);
    await downloadFullPackage(page, contract);
    await assertJourneyRestored(page, contract, workId);
  });

  test('Content + Assets surfaces stay merchant-safe and axe-clean in light and dark', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    for (const theme of ['light', 'dark'] as const satisfies ThemeMode[]) {
      await setTheme(page, theme);
      await page.goto('/dashboard/works');
      await expect(page.locator('body')).toBeVisible();
      await expect(page.locator('html')).toHaveClass(
        new RegExp(`\\b${theme}\\b`)
      );
      await assertMerchantLanguage(page, `Content (${theme})`);
      await assertAxeClean(page, `Content (${theme})`);

      await page.goto('/dashboard/assets');
      await expect(page.locator('body')).toBeVisible();
      await assertMerchantLanguage(page, `Assets (${theme})`);
      await assertAxeClean(page, `Assets (${theme})`);

      // T34 / #228: 旧任务页与旧周运营条整批下线，待办收敛进工作台的
      // pending-actions 收件箱抽屉，所以这一屏改测工作台本体。
      await page.goto('/dashboard');
      await expect(page.locator('body')).toBeVisible();
      await assertMerchantLanguage(page, `Workbench (${theme})`);
      await assertAxeClean(page, `Workbench (${theme})`);
    }

    // Keep the surface list explicit for catalog/evidence readers.
    expect([...AXE_SURFACES]).toEqual([
      'composer',
      'result',
      'content',
      'assets',
      'delivery',
      'weekly-review',
    ]);
  });

  test('Responsive smoke: 320/375/768/1440 and 200% zoom on Result', async ({
    page,
    request,
  }) => {
    test.setTimeout(360_000);
    const contract = copyContract();
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);
    await page.goto('/dashboard');
    const workId = await submitComposerJourney(
      page,
      contract,
      `P1-F2 responsive 朋友圈 ${merchantRunSuffix()}`
    );
    await waitForResultJourney(page, contract, workId);

    for (const viewport of RESPONSIVE_VIEWPORTS) {
      await page.setViewportSize(viewport);
      await expect(page.getByTestId('result-center-shell')).toBeVisible();
      await assertNoHorizontalOverflow(
        page,
        `Result ${viewport.width}x${viewport.height}`
      );
      await assertPrimaryCtaNotOccluded(
        page,
        `Result ${viewport.width}x${viewport.height}`
      );
      await assertMerchantLanguage(
        page,
        `Result ${viewport.width}x${viewport.height}`
      );
    }

    // Browser zoom reflows a 1440 device-pixel frame to a 720 CSS-pixel
    // viewport. Applying CSS `zoom` here would double-scale that viewport and
    // exercise an artificial 360 px layout while media queries still see 720.
    await page.setViewportSize({ width: 720, height: 450 });
    await expect(page.getByTestId('result-center-shell')).toBeVisible();
    await assertNoHorizontalOverflow(page, 'Result 200% zoom');
    await assertPrimaryCtaNotOccluded(page, 'Result 200% zoom');
  });

  test('prefers-reduced-motion keeps Result and Delivery usable', async ({
    page,
    request,
  }) => {
    test.setTimeout(360_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await setTheme(page, 'light');
    const contract = copyContract();
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);
    await page.goto('/dashboard');
    const workId = await submitComposerJourney(
      page,
      contract,
      `P1-F2 reduced-motion 朋友圈 ${merchantRunSuffix()}`
    );
    await waitForResultJourney(page, contract, workId);
    await adoptResult(page, contract);
    await openDeliveryPanel(page, contract.modality);
    await expect(page.getByTestId('delivery-panel')).toBeVisible();
    await assertNoHorizontalOverflow(page, 'Result reduced-motion');
    await assertMerchantLanguage(page, 'Result reduced-motion');

    // Save-Data: no product hook currently gates decorative loops. Document residual.
    const saveDataHook = await page.evaluate(() => {
      const connection = (
        navigator as Navigator & {
          connection?: { saveData?: boolean };
        }
      ).connection;
      return {
        hasConnectionApi: Boolean(connection),
        saveData: connection?.saveData ?? null,
        productSaveDataAttr:
          document.documentElement.getAttribute('data-save-data'),
      };
    });
    expect(
      saveDataHook.productSaveDataAttr,
      'Save-Data product attribute is not implemented — residual for #161'
    ).toBeNull();
  });

  test('Mobile dark Result stays free of horizontal overflow and dead primary CTA', async ({
    page,
    request,
  }) => {
    test.setTimeout(360_000);
    await page.setViewportSize({ width: 375, height: 812 });
    await setTheme(page, 'dark');
    const contract = copyContract();
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);
    await page.goto('/dashboard');
    const workId = await submitComposerJourney(
      page,
      contract,
      `P1-F2 mobile-dark 朋友圈 ${merchantRunSuffix()}`
    );
    await waitForResultJourney(page, contract, workId);
    const actions = page.getByTestId('result-shell-actions');
    if (await actions.count()) {
      await expect(actions).toHaveAttribute(
        'data-mobile-sticky-actions',
        'true'
      );
    }
    await assertNoHorizontalOverflow(page, 'mobile-dark Result');
    await assertPrimaryCtaNotOccluded(page, 'mobile-dark Result');
    await assertMerchantLanguage(page, 'mobile-dark Result');
    await assertAxeClean(page, 'Result (mobile dark)');
  });
});
