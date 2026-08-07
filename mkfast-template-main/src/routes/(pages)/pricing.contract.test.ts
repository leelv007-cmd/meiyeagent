import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { websiteConfig } from '@/config/website';
import {
  findSubscriptionPrice,
  formatSubscriptionPrice,
  growthConfigPlanId,
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
  // exempt from is the launch pricing contract.
  //
  // That contract changed on 2026-08-05: this test used to pin the landing's
  // own three tiers (初级 free / 中级 paid / lifetime disabled behind 敬请期待),
  // which is exactly the second plan vocabulary the user's de-tiering ruling
  // retired. Naming tiers in two places is what let them fork; the successor
  // contract is that the landing names none, so nothing is left to keep in
  // step. What survives is what a visitor still needs: the shared price handle,
  // the credit model, and the way to the catalog that does own the tiers.
  const home = read(HOME_PRICING);
  const zh = JSON.parse(read('project.inlang/messages/zh.json'));
  const en = JSON.parse(read('project.inlang/messages/en.json'));

  assert.doesNotMatch(home, /PricingShell/u);
  assert.doesNotMatch(home, /[㐀-鿿]/u);
  assert.match(home, /landing_pricing_[a-z0-9_]+/u);
  assert.match(home, /Routes\.Register/u);
  assert.match(home, /Routes\.Pricing/u);

  // The badge and the coming-soon fallback are the user's own wording
  // (landing-copy doc §2.10) and outlive the tiers they used to sit on.
  assert.equal(zh.landing_pricing_price_badge, '上线特惠');
  assert.equal(zh.landing_pricing_coming_soon, '敬请期待');

  // No tier vocabulary reaches the landing, in either locale or in the source.
  // RETIRED-METERING: the names this block printed until the de-tiering ruling.
  const retiredTierKeys = Object.keys(zh).filter((key) =>
    /^landing_pricing_(starter|growth|lifetime)_/u.test(key)
  );
  assert.deepEqual(
    retiredTierKeys,
    [],
    'per-tier landing messages are retired — the landing names no tier'
  );
  assert.doesNotMatch(
    home,
    /landing_pricing_(?:starter|growth|lifetime)_/u,
    'the landing must not render a tier of its own'
  );

  // A disabled pseudo-CTA existed only to park the unopened lifetime tier. With
  // no tiers there is nothing to park, and every CTA here has to be a real link
  // — a stronger promise than "the fake one is marked disabled".
  assert.doesNotMatch(
    home,
    /aria-disabled/u,
    'no tier to park means no disabled pseudo-CTA'
  );

  for (const key of [
    'landing_pricing_price_badge',
    'landing_pricing_coming_soon',
    'landing_pricing_cta',
    'landing_pricing_plans_link',
    'landing_pricing_credit_model_1',
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
  // Until #349 this pinned a constant: `GROWTH_CONFIG_PLAN_ID =
  // PUBLIC_PLAN_CONFIG_IDS.growth`. The point of that assertion — the landing
  // reads the shared mapping rather than a twin literal — outlived the
  // constant, which had to become a resolution once it turned out the config
  // ships two catalogs and only one of them files the tier under that key.
  assert.match(
    pricePlan,
    /export function growthConfigPlanId\(\)/u,
    'the paid tier must resolve against the catalog that is configured'
  );
  assert.match(
    pricePlan,
    /plans\[PUBLIC_PLAN_CONFIG_IDS\.growth\]/u,
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
  // Which product the paid tier resolves to, per catalog shape. This replaces
  // an `assert.equal(GROWTH_CONFIG_PLAN_ID, 'growth')` that could only ever
  // restate the mapping constant back to itself, and so held while the landing
  // was resolving to nothing at all on every non-Waffo runtime (#349). Naming
  // the answer for each catalog is what that assertion was trying to buy.
  withStubbedCatalog({ free: 0, growth: 52_200, pro: 94_000 }, () => {
    assert.equal(growthConfigPlanId(), 'growth');
  });
  withStubbedCatalog({ free: 0, lifetime: 699_000, pro: 39_900 }, () => {
    assert.equal(growthConfigPlanId(), 'pro');
  });
  withStubbedCatalog({ free: 0 }, () => {
    assert.equal(growthConfigPlanId(), undefined);
  });
});

test('the landing quotes a price under every configured catalog shape', () => {
  // #349. `0c20d957` (#304) repointed the paid tier at the config key `growth`,
  // which only exists when the Waffo catalog is configured. Every other runtime
  // — Playwright pins VITE_PAYMENT_PROVIDER=stripe, and a deployment may leave
  // it unset — kept the template catalog, where the same tier is filed under
  // `pro` carrying PUBLIC_DISPLAY_PRICE_CENTS.growthMonthly. So the landing
  // resolved to a plan that was not there and printed 敬请期待 instead of a
  // price: a public surface silently losing its only number.
  //
  // What makes this worth a resolution rather than a second literal: under the
  // Waffo catalog `pro` is a genuinely higher tier with its own price, and
  // quoting it would be a wrong number rather than a missing one. The fallback
  // may only fire when no `growth` plan exists at all.
  const monthlyLabelFor = (id: string) =>
    formatSubscriptionPrice(
      findSubscriptionPrice(id, PlanIntervals.MONTH) ?? {
        amount: 0,
        currency: 'CNY',
      }
    );

  // The template catalog: no `growth` key anywhere, paid tier filed as `pro`.
  withStubbedCatalog({ free: 0, lifetime: 699_000, pro: 39_900 }, () => {
    assert.equal(growthMonthlyPriceLabel(), monthlyLabelFor('pro'));
    assert.notEqual(growthMonthlyPriceLabel(), null);
  });

  // The Waffo catalog: both keys exist and they are different products, so the
  // landing has to keep reading Growth.
  withStubbedCatalog(
    { free: 0, growth: 52_200, lifetime: 699_000, pro: 94_000 },
    () => {
      assert.equal(growthMonthlyPriceLabel(), monthlyLabelFor('growth'));
      assert.notEqual(growthMonthlyPriceLabel(), monthlyLabelFor('pro'));
    }
  );

  // Neither key configured is the one case that may print nothing: 敬请期待 is
  // an honest empty state only when there is genuinely no price to quote.
  withStubbedCatalog({ free: 0, lifetime: 699_000 }, () => {
    assert.equal(growthMonthlyPriceLabel(), null);
  });
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
  // The handle used to hang off a per-card field, because three cards each had
  // a price and only one of them was the shared one. One price block, one
  // unconditional handle: there is no card left for it to be attached to.
  assert.match(home, /data-testid=\{PUBLIC_PAID_MONTHLY_PRICE_TESTID\}/u);
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
          '¥999'
        );
        assert.notEqual(growthMonthlyPriceLabel(), '¥999');
      }
    );
  }
  // And the stub is fully undone, so the rest of the suite sees real config.
  //
  // This used to read the restored price out of the literal key `growth` and
  // accept null when it was missing — which is exactly how #349 stayed
  // invisible here: under the template catalog that key resolves to nothing, so
  // "the landing quotes nothing" was the expected value rather than the bug.
  // Restoration is now checked by what the sentinels were for (they are gone)
  // and the real catalog is required to quote something.
  const restoredLabel = growthMonthlyPriceLabel();
  assert.notEqual(
    restoredLabel,
    null,
    'the configured catalog must quote the paid tier'
  );
  for (const sentinel of ['¥417', '¥530']) {
    assert.notEqual(restoredLabel, sentinel, 'the stub is fully undone');
  }
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

  // No subscription-management promise while there is no subscription. The
  // note moved off the paid tier onto the shared price when the tiers went.
  assert.doesNotMatch(zh.landing_pricing_price_note, /取消|暂停/u);

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

test('the closed subscription channel offers a control, not just a promise', () => {
  // The plan CTA is honestly disabled while the channel is shut, but the hint
  // under it promised「开通后第一时间通知你」with nothing to press — a promise the
  // merchant had no way to accept. The disabled button stays; the promise now
  // has a link, and it carries which plan she was reading.
  const content = read('src/components/pricing/credit-pricing-content.tsx');
  assert.match(content, /pricing_plan_notify_me/u);
  assert.match(content, /Routes\.Contact\}\?plan=\$\{plan\.id\}/u);
  assert.match(content, /variant="secondary" className="w-full" disabled/u);

  // /contact must actually receive that plan and say it back, or the link is a
  // redirect wearing a promise's clothes.
  const route = read('src/routes/(pages)/contact.tsx');
  assert.match(route, /validateSearch/u);
  assert.match(route, /planId=\{plan\}/u);
  const card = read('src/components/contact/contact-form-card.tsx');
  assert.match(card, /contact_plan_interest_notice/u);
  assert.match(card, /contact_plan_interest_message/u);
  assert.match(card, /planDisplayName/u);

  const zh = JSON.parse(read('project.inlang/messages/zh.json'));
  const en = JSON.parse(read('project.inlang/messages/en.json'));
  for (const key of [
    'contact_plan_interest_notice',
    'contact_plan_interest_message',
  ]) {
    assert.match(zh[key], /\{plan\}/u, `zh ${key} must name the plan`);
    assert.match(en[key], /\{plan\}/u, `en ${key} must name the plan`);
  }
  // The prefilled message has to clear the contact form's own 10-char floor,
  // or the merchant lands on a form that rejects what we wrote for her.
  assert.ok(
    zh.contact_plan_interest_message.replace('{plan}', '成长').length >= 10
  );
  assert.ok(
    en.contact_plan_interest_message.replace('{plan}', 'Growth').length >= 10
  );
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
    'pricing_plan_notify_me',
    'pricing_plan_payment_not_open',
    'pricing_plan_payment_not_open_hint',
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

test('the landing quotes the credit model and owns no second set of plan numbers', () => {
  // #336 AC2. RETIRED-METERING: the landing used to sell 「按条数试用额度」 and
  // 「文案 / 图片 / 视频分开计」 while /pricing sold credits — two billing models,
  // and whichever page they read second contradicted the first.
  //
  // The fix is structural rather than a wording pass, on two axes the user
  // ruled on in turn. The landing may carry no *quantity* — not a credit grant,
  // not an output count, not a tier ceiling — and since 2026-08-05 no *tier
  // name* either: naming the plans on two pages is what let the two vocabularies
  // fork, so the names now live only on /pricing. The single number left here
  // is the paid month price, and it comes from the helper /pricing prices from.
  // A page holding neither a number nor a name of its own has nothing to drift.
  const zh = JSON.parse(read('project.inlang/messages/zh.json'));
  const en = JSON.parse(read('project.inlang/messages/en.json'));
  const landingPricingKeys = Object.keys(zh).filter((key) =>
    key.startsWith('landing_pricing_')
  );
  assert.ok(landingPricingKeys.length > 0);

  for (const key of landingPricingKeys) {
    // RETIRED-METERING: the retired unit, pinned as absent.
    assert.doesNotMatch(zh[key], /额度|条数|三桶/u, key);
    assert.doesNotMatch(en[key], /allowance|per-piece|three bucket/iu, key);
    assert.doesNotMatch(
      zh[key],
      /\d/u,
      `${key} prints a number the landing would have to keep in step with /pricing`
    );
    assert.doesNotMatch(en[key], /\d/u, key);
    // RETIRED-METERING: both plan vocabularies, pinned as absent from the
    // landing — the ones it used to own, and the ones /pricing owns now. A
    // landing that cannot say either name cannot fork from either.
    assert.doesNotMatch(zh[key], /初级|中级|高级|终身版/u, key);
    assert.doesNotMatch(zh[key], /体验版|起步版|成长版|专业版/u, key);
    assert.doesNotMatch(en[key], /\b(?:starter|growth|lifetime|pro)\b/iu, key);
  }

  // The price is the single exception, and it is not written here: it arrives
  // through the shared mapping and carries the handle the browser suite reads
  // off both pages.
  const home = read(HOME_PRICING);
  assert.match(home, /growthMonthlyPriceLabel\(\)/u);
  assert.match(home, /PUBLIC_PAID_MONTHLY_PRICE_TESTID/u);
  // …and the landing names /pricing as the authority for everything else.
  assert.match(home, /Routes\.Pricing/u);
});
