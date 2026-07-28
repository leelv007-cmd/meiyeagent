/**
 * The numbers the public pages quote — copy, not billing (D-156).
 *
 * These are what a visitor reads on the landing page and /pricing during the
 * development period. Nobody is charged them: online payment is not open
 * (D-124), pilot access is granted by redemption code, and no checkout reads
 * this file. Changing a number here is a copy edit, on par with rewording a
 * headline. It does not need a provisioning entry, a config revision, or an
 * audit trail, and it does not cascade.
 *
 * The billable price — the one a card is actually charged — does not exist
 * yet. It gets built when the E gate opens real payment, and it lands in
 * admin-config under the same governance as `plan.allowances.*`: draft,
 * publish, CAS, audit, rollback. That is a different asset with a different
 * lifecycle, and this file is deliberately not it.
 *
 * These lived in `VITE_*_AMOUNT_CENTS` until 2026-07-28. The deploy workflow
 * never injected them, so the `.default()` was already the production number —
 * an env var in appearance only. What the disguise cost: adjusting the landing
 * copy meant editing something named "price", which carried an expectation of
 * governance nobody could satisfy, because operators cannot reach a build-time
 * constant from the admin console. Commit 918007da moved the monthly figure
 * ¥399 → ¥1999 inside a landing-polish change, left the yearly and lifetime
 * figures untouched, and attributed the new number to a decision (D-123) that
 * says ¥399. The ladder guard below is what would have caught it.
 */

/** What the public pages quote, in cents (CNY). */
export type PublicDisplayPriceLadder = {
  growthMonthly: number;
  growthYearly: number;
  lifetime: number;
};

/** Displayed amounts. Copy — edit freely. */
const QUOTED_CENTS: PublicDisplayPriceLadder = {
  growthMonthly: 39900,
  growthYearly: 399000,
  lifetime: 699000,
};

/**
 * Lets the browser suite start a second copy of the app quoting a different
 * monthly figure, so it can watch both public pages follow the source rather
 * than merely agree with each other — two pages hard-coding the same literal
 * agree perfectly, and only moving the source tells the cases apart
 * (`tests/e2e/specs/public-plan-price-source.spec.ts`).
 *
 * Nothing outside the test harness sets it: the deploy workflow does not pass
 * it, and no operator console can reach it. It is named for what it overrides
 * — the quoted copy — so that it is never mistaken for a billing knob.
 */
function readQuotedMonthlyOverride(): number | null {
  const raw = (import.meta as { env?: Record<string, string | undefined> }).env
    ?.VITE_PUBLIC_QUOTED_MONTHLY_CENTS;
  if (raw === undefined || raw.trim() === '') return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export const PUBLIC_DISPLAY_PRICE_CENTS: PublicDisplayPriceLadder = {
  ...QUOTED_CENTS,
  growthMonthly: readQuotedMonthlyOverride() ?? QUOTED_CENTS.growthMonthly,
};

/**
 * Reasons this ladder does not hang together, in merchant terms.
 *
 * Free to change what the numbers *are*; not free to leave them quoting a
 * yearly plan that costs more than paying monthly, or a lifetime plan that
 * undercuts a single year. Those are not opinions about pricing, they are
 * arithmetic a visitor can do in their head — and the pair that slipped
 * through on 2026-07-28 (¥1999/月 beside an untouched ¥3990/年) failed both.
 */
export function describePriceLadderProblems(
  ladder: PublicDisplayPriceLadder = PUBLIC_DISPLAY_PRICE_CENTS
): string[] {
  const problems: string[] = [];
  const twelveMonths = ladder.growthMonthly * 12;

  if (ladder.growthYearly >= twelveMonths) {
    problems.push(
      'The yearly plan costs at least as much as twelve monthly payments, so nobody would pick it.'
    );
  }
  if (ladder.growthYearly <= ladder.growthMonthly * 2) {
    problems.push(
      'The yearly plan costs two months or less, which reads as a pricing mistake rather than a discount.'
    );
  }
  if (ladder.lifetime <= ladder.growthYearly) {
    problems.push(
      'The lifetime plan is no more expensive than a single year, so the yearly plan has nothing to offer.'
    );
  }
  return problems;
}
