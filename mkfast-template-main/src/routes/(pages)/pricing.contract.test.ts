import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { websiteConfig } from '@/config/website';
import {
  findSubscriptionPrice,
  formatSubscriptionPrice,
  GROWTH_CONFIG_PLAN_ID,
  growthMonthlyPriceLabel,
  PUBLIC_PAID_MONTHLY_PRICE_TESTID,
  PUBLIC_PLAN_CONFIG_IDS,
} from '@/lib/price-plan';
import type { PricePlan } from '@/payment/types';
import { PaymentTypes, PlanIntervals } from '@/payment/types';

/**
 * Run `body` against a catalogue where each product carries its own price.
 *
 * Distinct prices are the point: they turn "which product did this surface
 * read?" into an observable number, so a surface that resolves the wrong key
 * fails with a wrong price rather than passing on a shared one.
 */
function withStubbedCatalog(amounts: Record<string, number>, body: () => void) {
  const plans = websiteConfig.payment?.price?.plans as Record<
    string,
    PricePlan
  >;
  assert.ok(plans, 'payment plans must exist to stub');
  const original = { ...plans };
  for (const key of Object.keys(plans)) delete plans[key];
  for (const [id, amount] of Object.entries(amounts)) {
    plans[id] = {
      id,
      name: id,
      description: id,
      isFree: amount === 0,
      isLifetime: false,
      prices: [
        {
          type: PaymentTypes.SUBSCRIPTION,
          priceId: `price-${id}`,
          amount,
          currency: 'CNY',
          interval: PlanIntervals.MONTH,
        },
      ],
    } as PricePlan;
  }
  try {
    body();
  } finally {
    for (const key of Object.keys(plans)) delete plans[key];
    Object.assign(plans, original);
  }
}

const read = (file: string) =>
  readFileSync(resolve(process.cwd(), file), 'utf8');

const PRICING = 'src/routes/(pages)/pricing.tsx';
const PRICING_SHELL = 'src/components/pricing/pricing-shell.tsx';
const HOME_PRICING = 'src/components/landing/pricing.tsx';
const PRICE_PLAN = 'src/lib/price-plan.ts';
const WEBSITE_CONFIG = 'src/config/website.ts';

test('pricing page is reskinned to brand tokens, not the template skin', () => {
  const src = read(PRICING);
  const shell = read(PRICING_SHELL);
  // No template orange accent, no template font on this page.
  assert.doesNotMatch(src, /Bricolage/u);
  assert.doesNotMatch(shell, /Bricolage/u);
  assert.doesNotMatch(src, /0\.553 0\.195 38/u);
  assert.doesNotMatch(shell, /0\.553 0\.195 38/u);
  // Brand-scoped shell with ink primary + Inter stack, correct in both themes.
  assert.match(src, /PricingShell/u);
  assert.match(shell, /meiye-pricing-shell/u);
  assert.match(shell, /--primary:\s*var\(--ink\)/u);
  assert.match(shell, /Inter, "HarmonyOS Sans"/u);
  assert.match(shell, /\.dark \.meiye-pricing-shell/u);
  // Rose-gold appears only as the subscription spark accent (credit matrix cards).
  const content = read('src/components/pricing/credit-pricing-content.tsx');
  assert.match(content, /var\(--spark\)/u);
  assert.match(content, /IconSparkles/u);
});

test('landing pricing speaks the launch contract in the landing scope', () => {
  // The LIKEPAGE landing is exempt from PricingShell — it runs the SaaS
  // template's own visual system, scoped under `.meiye-landing`. What it is not
  // exempt from is the launch pricing contract: 初级 free / 中级 paid /
  // lifetime disabled.
  const home = read(HOME_PRICING);
  const zh = JSON.parse(read('project.inlang/messages/zh.json'));
  const en = JSON.parse(read('project.inlang/messages/en.json'));

  assert.doesNotMatch(home, /PricingShell/u);
  assert.doesNotMatch(home, /[㐀-鿿]/u);
  assert.match(home, /landing_pricing_[a-z0-9_]+/u);
  assert.match(home, /Routes\.Register/u);
  assert.match(home, /Routes\.Pricing/u);
  assert.match(home, /aria-disabled/u);

  // The pricing block's wording is the user's own call (landing-copy doc §2.10):
  // a 上线特惠 badge over the paid tier, lifetime disabled behind 敬请期待.
  assert.equal(zh.landing_pricing_growth_badge, '上线特惠');
  assert.equal(zh.landing_pricing_coming_soon, '敬请期待');
  // The paid CTA reaches registration, and the lifetime tier has no href at
  // all — pricing.tsx renders an aria-disabled span whenever href is absent.
  assert.match(
    home,
    /name: landing_pricing_growth_name\(\)[\s\S]*?href: Routes\.Register/u
  );
  // The lifetime tier carries no href at all, and the card renders a really
  // disabled button for any tier without one. Asserting the absence of a link
  // rather than a particular field name keeps this honest across reshells.
  assert.doesNotMatch(
    home,
    /name: landing_pricing_lifetime_name\(\)[\s\S]*?href:/u,
    'the lifetime tier must not gain a link'
  );
  assert.match(home, /disabled\s*\n\s*aria-disabled="true"/u);
  for (const key of [
    'landing_pricing_growth_badge',
    'landing_pricing_coming_soon',
  ]) {
    assert.equal(typeof en[key], 'string', `en missing ${key}`);
    assert.ok(en[key].length > 0, `en empty ${key}`);
  }
});

test('one price, one source: the landing and /pricing cannot disagree', () => {
  // D-143. The landing used to carry its own `landing_pricing_growth_price`
  // message reading ¥399 while /pricing computed ¥499 from the payment
  // configuration — two public pages quoting different prices for the same
  // plan. The fix is structural: neither page owns a price literal, both call
  // the same helper, so there is no second number left to drift.
  //
  // FAST FEEDBACK LAYER, NOT THE GROUND TRUTH (#242). Everything below reads
  // source text and the module the pages import. Against someone working
  // around it — a namespace import, a computed property access, a wrapper —
  // this has no fixed point, and five rounds of tightening it returned less
  // each time. What a visitor actually reads is settled in a browser, by
  // tests/e2e/specs/public-plan-price-source.spec.ts: it takes the price text
  // off both rendered pages, and moves the quoted display-price source to check
  // both pages move with it. Trust that one; keep this one because it fails in
  // a second.
  const home = read(HOME_PRICING);
  const pricing = read(PRICING);
  const pricePlan = read(PRICE_PLAN);
  const zh = JSON.parse(read('project.inlang/messages/zh.json'));
  const en = JSON.parse(read('project.inlang/messages/en.json'));

  assert.equal(zh.landing_pricing_growth_price, undefined);
  assert.equal(en.landing_pricing_growth_price, undefined);
  for (const [locale, messages] of [
    ['zh', zh],
    ['en', en],
  ] as const) {
    for (const [key, value] of Object.entries(messages)) {
      if (!key.startsWith('landing_pricing_') && !key.startsWith('pricing_'))
        continue;
      assert.doesNotMatch(
        String(value),
        /¥\s*\d/u,
        `${locale}.${key} hard-codes a price`
      );
    }
  }

  // Landing still uses the shared helper; /pricing now prices from the published
  // credit catalogue (#310) and only reads payment price ids for checkout CTAs
  // through findSubscriptionPrice inside the credit matrix module.
  assert.match(home, /growthMonthlyPriceLabel\(\)/u);
  assert.match(pricePlan, /export function growthMonthlyPriceLabel/u);
  assert.match(pricePlan, /export function findSubscriptionPrice/u);
  assert.match(pricePlan, /getPricePlans\(\)\[configPlanId\]/u);
  const content = read('src/components/pricing/credit-pricing-content.tsx');
  assert.match(content, /findSubscriptionPrice\(/u);
  assert.match(pricing, /getPublicPlanCatalog/u);
});

test('landing mapping stays shared; credit matrix prices published catalog ids', () => {
  const pricing = read(PRICING);
  const pricePlan = read(PRICE_PLAN);
  const content = read('src/components/pricing/credit-pricing-content.tsx');

  assert.match(pricePlan, /export const PUBLIC_PLAN_CONFIG_IDS = \{/u);
  assert.match(
    pricePlan,
    /export const GROWTH_CONFIG_PLAN_ID = PUBLIC_PLAN_CONFIG_IDS\.growth;/u,
    'the landing price must resolve through the shared mapping, not a twin literal'
  );
  // Shell does not reintroduce DISPLAY_PLANS configPlanId forks.
  assert.doesNotMatch(pricing, /configPlanId:/u);
  // Checkout price lookups are keyed by the published plan offer id.
  assert.match(content, /findSubscriptionPrice\(\s*plan\.id/u);
});

test('the mapping states exactly which product backs each public tier', () => {
  // Pin the values themselves. Everything else in this file proves the two
  // surfaces agree with *each other*; without this they could agree on the
  // wrong product — 中级 silently priced as 终身版 reads as consistent.
  assert.deepEqual(
    { ...PUBLIC_PLAN_CONFIG_IDS },
    { starter: 'free', growth: 'growth' }
  );
  assert.equal(GROWTH_CONFIG_PLAN_ID, 'growth');
});

test('subscription checkout submits the published plan offer id', () => {
  const content = read('src/components/pricing/credit-pricing-content.tsx');
  assert.match(
    content,
    /planId=\{plan\.id\}/u,
    'checkout must submit the published plan offer id used for display'
  );
});

test('landing keeps the shared paid monthly price handle; credit matrix uses plan price testids', () => {
  const home = read(HOME_PRICING);
  const content = read('src/components/pricing/credit-pricing-content.tsx');
  assert.equal(PUBLIC_PAID_MONTHLY_PRICE_TESTID, 'public-paid-monthly-price');
  assert.match(home, /PUBLIC_PAID_MONTHLY_PRICE_TESTID/u);
  assert.match(home, /data-testid=\{plan\.priceTestId\}/u);
  // Credit matrix exposes per-plan published prices for browser assertions.
  assert.match(content, /pricing-price-\$\{plan\.id\}/u);
});

test('the landing reads the Growth product out of the catalogue every time it is asked', () => {
  // Against a catalogue where every product carries a different price, the
  // number the landing prints says which product it read. Comparing it to
  // PUBLIC_PLAN_CONFIG_IDS.growth would prove nothing — that is the helper's
  // own expression — so it is compared to the price filed under the literal
  // key this tier is pinned to above, computed from the stub rather than
  // written out, so the expectation cannot drift from the fixture.
  //
  // Two sentinel prices in succession, neither of them the real one. One
  // sentinel is a coin flip: a hard-coded string or a value memoised at module
  // load can match it. Moving the catalogue and watching the label move with
  // it is what rules those out.
  for (const growthAmount of [41_700, 53_000]) {
    withStubbedCatalog(
      { free: 0, growth: growthAmount, pro: 99_900, lifetime: 120_000 },
      () => {
        const priceFiledUnderGrowth = formatSubscriptionPrice(
          findSubscriptionPrice('growth', PlanIntervals.MONTH) ?? {
            amount: 0,
            currency: 'CNY',
          }
        );
        assert.equal(
          growthMonthlyPriceLabel(),
          priceFiledUnderGrowth,
          `the landing must quote the Growth product at ${growthAmount} cents`
        );
        // The catalogue really does discriminate: another product would have
        // produced a visibly different number, so the assertion above is
        // load-bearing rather than accidentally true.
        assert.equal(
          formatSubscriptionPrice(
            findSubscriptionPrice('pro', PlanIntervals.MONTH) ?? {
              amount: 0,
              currency: 'CNY',
            }
          ),
          'CN¥999'
        );
        assert.notEqual(growthMonthlyPriceLabel(), 'CN¥999');
      }
    );
  }
  // And the stub is fully undone, so the rest of the suite sees real config.
  const restoredGrowth = findSubscriptionPrice('growth', PlanIntervals.MONTH);
  assert.equal(
    growthMonthlyPriceLabel(),
    restoredGrowth ? formatSubscriptionPrice(restoredGrowth) : null
  );
});

test('the page loads the credit catalogue and renders the #310 credit matrix', () => {
  const pricing = read(PRICING);
  assert.match(pricing, /loader: \(\) => getPublicPlanCatalog\(\)/u);
  assert.match(pricing, /Route\.useLoaderData\(\)/u);
  assert.match(pricing, /CreditPricingContent/u);
  assert.doesNotMatch(pricing, /quota\.credits/u);
  assert.doesNotMatch(
    pricing,
    /quota:\s*\{[^}]*copy:\s*\d/u,
    'quota literals belong in admin-config, not on the page'
  );
});

test('the retired PricingCard chain took its second quota copy set with it', () => {
  // The template card/table were never mounted, yet they were fed their own
  // 每月 30 条文案 / 每月 100 条文案 feature lists — a second set of quota
  // numbers nobody could see and nobody kept in step (D-143 W06 ④).
  const config = read(WEBSITE_CONFIG);
  const zh = JSON.parse(read('project.inlang/messages/zh.json'));
  assert.doesNotMatch(config, /pricing_plans_\w+_(?:features|limits)/u);
  for (const key of [
    'pricing_plans_free_features',
    'pricing_plans_pro_features',
    'pricing_plans_lifetime_features',
    'pricing_card_not_available',
    'pricing_card_popular',
  ]) {
    assert.equal(zh[key], undefined, `${key} should be gone`);
  }
});

test('landing pricing discloses the pilot payment stance in the footnote', () => {
  // The 上线特惠 badge and the upgrade CTA are the user's own wording and
  // are restored; the footnote is what carries the clarification that online
  // payment is not open during the pilot (D-124) and that credits come from a
  // redemption code (D-128). That disclosure is load-bearing — it is the reason
  // the badge is allowed to stand, so it may not be weakened.
  const zh = JSON.parse(read('project.inlang/messages/zh.json'));
  const en = JSON.parse(read('project.inlang/messages/en.json'));
  const landingPricingKeys = Object.keys(zh).filter((key) =>
    key.startsWith('landing_pricing_')
  );
  assert.ok(landingPricingKeys.length > 0);

  for (const key of landingPricingKeys) {
    // No invented urgency beyond the approved launch-special framing.
    assert.doesNotMatch(zh[key], /限时|特价|折扣|优惠价/u, key);
    assert.doesNotMatch(en[key], /limited time|discount/iu, key);
    // No hard-sell purchase imperative — there is no checkout to reach.
    assert.doesNotMatch(
      zh[key],
      /立即(?:购买|订阅|升级)|马上(?:购买|订阅)/u,
      key
    );
  }

  // No subscription-management promise while there is no subscription.
  assert.doesNotMatch(zh.landing_pricing_growth_note, /取消|暂停/u);

  // The footnote states the pilot payment stance, matching /pricing's own
  // "purchase not open" projection instead of contradicting it.
  assert.match(zh.landing_pricing_footnote_prefix, /未开放/u);
  assert.match(zh.landing_pricing_footnote_prefix, /兑换码/u);
  assert.match(en.landing_pricing_footnote_prefix, /not open/iu);
  assert.match(en.landing_pricing_footnote_prefix, /redemption code/iu);
});

test('credit matrix page wires published catalog and honest checkout seams', () => {
  const src = read(PRICING);
  assert.match(src, /getPublicPlanCatalog/u);
  assert.match(src, /CreditPricingContent/u);
  assert.doesNotMatch(src, /pricing_card_not_available/u);
  assert.doesNotMatch(src, /PricingTable/u);
  // Legacy allowance / output-count vocabulary stays off the page shell.
  assert.doesNotMatch(src, /pricing_output_copy_count/u);
  assert.doesNotMatch(src, /pricing_output_image_count/u);
  assert.doesNotMatch(src, /pricing_output_video_count/u);
});

test('credit matrix module owns anchors, cycle switcher and checkout CTAs', () => {
  const content = read('src/components/pricing/credit-pricing-content.tsx');
  assert.match(content, /id="subscription-plans"/u);
  assert.match(content, /id="credit-boosters"/u);
  assert.match(content, /pricing_billing_cycle_yearly/u);
  assert.match(content, /pricing_reference_disclaimer/u);
  assert.match(content, /CheckoutButton/u);
  assert.match(content, /CreditPackageCheckoutButton/u);
  assert.match(content, /websiteConfig\.payment\?\.enable/u);
  assert.match(content, /pricing_plan_payment_not_open/u);
  assert.match(content, /pricing_plan_purchase_unavailable/u);
});

test('new pricing copy is merchant Chinese and reaches zh/en parity', () => {
  const zh = JSON.parse(read('project.inlang/messages/zh.json'));
  const en = JSON.parse(read('project.inlang/messages/en.json'));
  const keys = [
    'pricing_billing_cycle_label',
    'pricing_billing_cycle_single_month',
    'pricing_billing_cycle_monthly',
    'pricing_billing_cycle_yearly',
    'pricing_booster_heading',
    'pricing_booster_buy',
    'pricing_reference_disclaimer',
    'pricing_reference_estimate',
    'pricing_trial_no_purchase',
    'pricing_plan_login_to_subscribe',
    'pricing_plan_payment_not_open',
    'pricing_plan_purchase_unavailable',
    'pricing_plan_subscribe',
    'pricing_plan_subtitle',
  ];
  for (const key of keys) {
    assert.equal(typeof zh[key], 'string', `zh missing ${key}`);
    assert.equal(typeof en[key], 'string', `en missing ${key}`);
    assert.ok(zh[key].length > 0, `zh empty ${key}`);
    assert.ok(en[key].length > 0, `en empty ${key}`);
  }
  assert.doesNotMatch(zh.pricing_plan_subtitle, /并发/u);
  assert.equal(zh.pricing_billing_cycle_yearly, '包年付费');
});

test('template design doc is retired and points at the root design system', () => {
  const doc = read('docs/DESIGN.md');
  assert.match(doc, /RETIRED/u);
  assert.match(doc, /门店橱窗/u);
  assert.match(doc, /美业内容2\/DESIGN\.md/u);
  assert.match(doc, /Do not treat this file as authoritative/u);
});
