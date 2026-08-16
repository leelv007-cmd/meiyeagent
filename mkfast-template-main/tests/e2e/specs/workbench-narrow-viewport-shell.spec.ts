import { expect, test, type Page } from '@playwright/test';

import { loginByForm, registerE2EUser } from '../fixtures/auth';
import { seedConfirmedStore } from '../fixtures/product';

/**
 * V31-96 — the owed narrow-viewport pass.
 *
 * The chromium project pins 1440x900, so every browser gate to date has only
 * ever seen the dual-column shell. WORKBENCH_DUAL_COLUMN_MIN_WIDTH_PX is 1240,
 * so the single-column path — the one carrying
 * `.meiye-workbench-stream-only-group` — had never been exercised in a real
 * browser at all.
 *
 * What needed a browser is exactly one thing: that the `touch-action: auto
 * !important` rule keyed on that class actually reaches that element through
 * the real stylesheet pipeline. The library writes `touch-action` after the
 * user style spread, so only CSS can drop the pan-y guard where there is no
 * drag handle, and jsdom cannot see this because it has no cascade to resolve.
 *
 * 1000px is the width that matters and the one nothing covered: wide enough to
 * be treated as a desktop (`data-viewport="desktop"`), still under 1240, so it
 * takes the single-column path. 390px was already visited by composer-reshell
 * and composer-card-family, but neither asserts this rule.
 *
 * No run is started. The workbench shell renders on /dashboard, so driving a
 * copy run first would only add a multi-minute dependency on the model and
 * quote path to a test about CSS.
 *
 * Not covered here, deliberately: V31-99's 40%/24% drag floor. Those props are
 * on the dual-column group, which does not render below 1240 — the narrow pass
 * is structurally incapable of observing them, and 1440 is where that belongs.
 * See the note at the bottom of this file for why there is no 1440 control.
 */

const STREAM_ONLY = '.meiye-workbench-stream-only-group';
const DUAL_COLUMN = '.meiye-workbench-dual-column-group';

async function openDashboard(
  page: Page,
  request: Parameters<typeof registerE2EUser>[0]
) {
  const user = await registerE2EUser(request);
  await loginByForm(page, user);
  await seedConfirmedStore(page);
}

/** Computed, not declared — the point is what the cascade actually resolved. */
function computedTouchAction(page: Page, selector: string) {
  return page
    .locator(selector)
    .evaluate(
      (element) => getComputedStyle(element as HTMLElement).touchAction
    );
}

for (const { label, width, height, viewport } of [
  {
    label: '1000px narrow desktop',
    width: 1000,
    height: 800,
    viewport: 'desktop',
  },
  { label: '390px phone', width: 390, height: 844, viewport: 'mobile' },
]) {
  test(`V31-96: the stream-only group keeps touch-action auto at ${label}`, async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(180_000);
    await openDashboard(page, request);
    await page.setViewportSize({ width, height });
    await page.goto('/dashboard');
    const home = page.getByTestId('composer-home');
    await expect(home).toBeVisible({ timeout: 60_000 });
    await expect(home).toHaveAttribute('data-viewport', viewport);

    // Guards which shell the assertion below is about, not the 1240 threshold
    // — see the note at the bottom for why this cannot speak to that.
    await expect(page.locator(DUAL_COLUMN)).toHaveCount(0);
    await expect(page.locator(STREAM_ONLY)).toHaveCount(1);

    expect(await computedTouchAction(page, STREAM_ONLY)).toBe('auto');

    // Nothing may scroll sideways at either width.
    const overflows = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth
    );
    expect(overflows).toBe(false);

    await testInfo.attach(`workbench-${width}x${height}.png`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
}

// There is deliberately no "1440 shows the dual column" control here.
//
// One was written and removed. `isWorkbenchDualColumnEligible` is
// `isWorkbenchRunVisible(phase) && width >= 1240`, and `isWorkbenchRunVisible`
// is `workbenchStateOf(phase) !== 'idle'` (workbench-state.ts:49-51). On a
// freshly opened /dashboard the phase is idle, so the dual column does not
// render at ANY width — a 1440 control without a run cannot pass, and would
// have been a test asserting the wrong reason for a true fact.
//
// The consequence for reading this file honestly: `toHaveCount(0)` on
// DUAL_COLUMN above is not evidence about the 1240 threshold, because the
// dual column is absent here for the phase reason regardless of width. The
// threshold itself is pinned by WORKBENCH_DUAL_COLUMN_MIN_WIDTH_PX and its
// unit coverage; what this spec is for is the single-column CSS, which is the
// part jsdom cannot resolve.
