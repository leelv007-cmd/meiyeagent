import { expect, test } from '@playwright/test';

import {
  expectHealthyPage,
  installPageHealthMonitor,
} from '../fixtures/page-health';
import {
  MOVED_CATALOG_MONTHLY_MICROS,
  MOVED_CATALOG_PRICE_LABEL,
  MOVED_MONTHLY_AMOUNT_CENTS,
  MOVED_MONTHLY_PRICE_LABEL,
  startRepricedWebApp,
  startStubCoreCatalog,
} from '../fixtures/public-price';

/**
 * 公开价可追同源 — the ground truth for D-143, in a real browser (#242, #346).
 *
 * This is our own 套餐价 (what a shop pays us), not a shop's own service price.
 *
 * The landing once said ¥399 while /pricing said ¥499: two public pages
 * quoting different numbers for the same plan, each convinced it was right.
 * A source-level guard in `src/routes/(pages)/pricing.contract.test.ts` watches
 * the wiring, but it has no fixed point — a namespace import, a computed
 * property access, or a wrapper moves the read somewhere an AST survey cannot
 * follow. So that guard is the fast feedback layer, and this file is the
 * ground truth: what a browser renders on the two pages a visitor can reach.
 *
 * WHAT THIS FILE ASKS, AND WHY IT CHANGED (#346)
 *
 * It used to ask "do both pages print the same number, and does moving the
 * display-price source move both". #310 moved /pricing onto the Core published
 * catalog and that question stopped being answerable: the pages no longer share
 * a source, and the guard sat reading zero price elements on /pricing, passing
 * nothing at all, for weeks.
 *
 * Restating it as "same number" would have been worse than useless. Two pages
 * agreeing proves nothing about where either number came from — two hand-synced
 * literals agree perfectly, which is exactly the state the product is in today
 * (see KNOWN CONDITION). D-143's actual requirement is that every price a
 * visitor reads is traceable to one declared source, so that is what is asked
 * here, per surface:
 *
 *   A. /pricing follows the published catalog.
 *   B. the landing follows the display-price source (D-156).
 *   C. neither follows the other's source — the anti-crosstalk leg, and the one
 *      that catches what a same-number assertion cannot.
 *   D. each page quotes the paid month exactly once.
 *
 * KNOWN CONDITION (named on purpose, not blessed): the landing and /pricing are
 * two pricing assets today. The landing quotes `PUBLIC_DISPLAY_PRICE_CENTS`
 * (D-156 pilot copy, CNY on a non-Waffo runtime) while /pricing quotes the
 * governed Core catalog (HKD). Under a Waffo runtime both read HK$522 — but out
 * of two places synchronised by hand, not out of one source. Whether the
 * product should keep two assets is a pricing decision, filed for the user.
 * This file neither asserts they agree nor pretends the split is fine: it holds
 * each surface to its own source, which is what keeps the split honest until
 * that decision lands.
 */

/** Exported from `src/lib/price-plan.ts` as PUBLIC_PAID_MONTHLY_PRICE_TESTID. */
const PAID_MONTHLY_PRICE = 'public-paid-monthly-price';

/** A price as a visitor reads it: a currency mark and the amount. */
const PRICE_TEXT = /^(?:¥|HK\$)\d+$/u;

async function readQuotedPrice(
  page: import('@playwright/test').Page,
  url: string
): Promise<string> {
  await page.goto(url);
  const price = page.getByTestId(PAID_MONTHLY_PRICE);
  // Exactly one: a second copy of the paid month price on one page is the same
  // drift as a second copy across two pages, one level down.
  await expect(
    price,
    `${url} must quote the paid month price exactly once`
  ).toHaveCount(1);
  return (await price.innerText()).trim();
}

test.describe('公开价可追同源', () => {
  test('each public surface quotes the paid month exactly once, and a real price', async ({
    page,
  }) => {
    const monitor = installPageHealthMonitor(page);
    await expectHealthyPage(page, monitor, '/', { theme: 'light' });

    const landing = await readQuotedPrice(page, '/');
    const pricing = await readQuotedPrice(page, '/pricing');

    // A price at all: "both pages say 敬请期待" would otherwise pass as
    // agreement, and a shop cannot decide anything from that.
    expect(landing, 'the landing must quote a price').toMatch(PRICE_TEXT);
    expect(pricing, '/pricing must quote a price').toMatch(PRICE_TEXT);
    monitor.expectNoErrors('公开价可追');
  });

  test('moving a source moves the surface that declares it, and only that one', async ({
    page,
  }) => {
    // Two cold vite dev servers, each rendering two server-side pages.
    test.setTimeout(600_000);

    const before = {
      landing: await readQuotedPrice(page, '/'),
      pricing: await readQuotedPrice(page, '/pricing'),
    };
    expect(
      MOVED_MONTHLY_PRICE_LABEL,
      'the fixture display price must differ from the current one'
    ).not.toBe(before.landing);
    expect(
      MOVED_CATALOG_PRICE_LABEL,
      'the fixture catalog price must differ from the current one'
    ).not.toBe(before.pricing);

    // The display-price source moves. The landing declares it; /pricing does
    // not.
    const repriced = await startRepricedWebApp(MOVED_MONTHLY_AMOUNT_CENTS);
    try {
      const landing = await readQuotedPrice(page, `${repriced.baseURL}/`);
      const pricing = await readQuotedPrice(
        page,
        `${repriced.baseURL}/pricing`
      );

      expect(
        landing,
        'the landing kept quoting its own price after the display-price source moved'
      ).toBe(MOVED_MONTHLY_PRICE_LABEL);
      // Anti-crosstalk. If this ever fails, /pricing has started reading the
      // landing's source — the same defect as the two pages disagreeing, with
      // the numbers happening to line up.
      expect(
        pricing,
        '/pricing followed the display-price source it does not declare'
      ).toBe(before.pricing);
    } finally {
      await repriced.stop();
    }

    // The published catalog moves. /pricing declares it; the landing does not —
    // its number is compiled in and never asks Core for it.
    const stubCore = await startStubCoreCatalog(MOVED_CATALOG_MONTHLY_MICROS);
    const onMovedCatalog = await startRepricedWebApp(
      MOVED_MONTHLY_AMOUNT_CENTS,
      { coreServiceURL: stubCore.url }
    );
    try {
      const pricing = await readQuotedPrice(
        page,
        `${onMovedCatalog.baseURL}/pricing`
      );
      const landing = await readQuotedPrice(page, `${onMovedCatalog.baseURL}/`);

      expect(
        pricing,
        '/pricing kept quoting its own price after the published catalog moved'
      ).toBe(MOVED_CATALOG_PRICE_LABEL);
      expect(
        landing,
        'the landing followed the published catalog it does not declare'
      ).toBe(MOVED_MONTHLY_PRICE_LABEL);
    } finally {
      await onMovedCatalog.stop();
      await stubCore.stop();
    }
  });
});
