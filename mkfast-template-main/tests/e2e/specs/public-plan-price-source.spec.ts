import { expect, test } from '@playwright/test';

import {
  expectHealthyPage,
  installPageHealthMonitor,
} from '../fixtures/page-health';
import {
  MOVED_MONTHLY_AMOUNT_CENTS,
  MOVED_MONTHLY_PRICE_LABEL,
  startRepricedWebApp,
} from '../fixtures/public-price';

/**
 * 两页套餐价同源 — the ground truth for D-143, in a real browser (#242).
 *
 * This is our own 套餐价 (what a shop pays us), not a shop's own service price.
 *
 * The landing once said ¥399 while /pricing said ¥499: two public pages
 * quoting different numbers for the same plan, each convinced it was right.
 * The structural fix routed both through one helper, and a source-level guard
 * in `src/routes/(pages)/pricing.contract.test.ts` watches that routing. But a
 * source guard has no fixed point — a namespace import, a computed property
 * access, or a wrapper moves the read somewhere the AST survey cannot follow,
 * and the guard stays green while a visitor reads two different prices. So the
 * guard is the fast feedback layer, and this file is the ground truth: what a
 * browser actually renders on the two pages a visitor can reach.
 *
 * Two things have to hold, and only the second one is about 同源:
 *
 * 1. The two pages print the same price right now.
 * 2. Moving the governed price moves both of them. Agreement at one value is
 *    equally consistent with both pages hard-coding the same literal; only a
 *    move tells the two apart. The governed entry is
 *    `VITE_GROWTH_MONTHLY_AMOUNT_CENTS` — the payment configuration key
 *    registered as C-1b in `docs/ops/provisioning-manifest.md`, which is where
 *    operations sets the 中级 month price. Not a code constant, and nothing in
 *    this file edits product source.
 */

/** Exported from `src/lib/price-plan.ts` as PUBLIC_PAID_MONTHLY_PRICE_TESTID. */
const PAID_MONTHLY_PRICE = 'public-paid-monthly-price';

/** A price as a visitor reads it: the ¥ and the yuan, nothing else. */
const PRICE_TEXT = /^¥\d+$/u;

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
    `${url} must quote the 中级 month price exactly once`
  ).toHaveCount(1);
  await expect(price).toBeVisible();
  return (await price.innerText()).trim();
}

test.describe('两页套餐价同源', () => {
  test('the landing and /pricing quote the same 中级 month price', async ({
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
    expect(
      pricing,
      'the landing and /pricing quote different prices for the same plan'
    ).toBe(landing);
    monitor.expectNoErrors('两页套餐价');
  });

  test('moving the governed price moves both pages together', async ({
    page,
  }) => {
    // A cold vite dev server plus two server-rendered pages on it.
    test.setTimeout(420_000);

    const before = {
      landing: await readQuotedPrice(page, '/'),
      pricing: await readQuotedPrice(page, '/pricing'),
    };
    expect(
      MOVED_MONTHLY_PRICE_LABEL,
      'the fixture price must differ from the current one, or nothing moves'
    ).not.toBe(before.landing);

    const repriced = await startRepricedWebApp(MOVED_MONTHLY_AMOUNT_CENTS);
    try {
      const after = {
        landing: await readQuotedPrice(page, `${repriced.baseURL}/`),
        pricing: await readQuotedPrice(page, `${repriced.baseURL}/pricing`),
      };

      // Both moved, both to the value operations set, and to each other.
      expect(
        after.landing,
        'the landing kept quoting its own price after the governed one moved'
      ).toBe(MOVED_MONTHLY_PRICE_LABEL);
      expect(
        after.pricing,
        '/pricing kept quoting its own price after the governed one moved'
      ).toBe(MOVED_MONTHLY_PRICE_LABEL);
      expect(after.landing).not.toBe(before.landing);
      expect(after.pricing).not.toBe(before.pricing);
    } finally {
      await repriced.stop();
    }
  });
});
