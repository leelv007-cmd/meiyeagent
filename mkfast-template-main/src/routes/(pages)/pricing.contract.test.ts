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
import ts from 'typescript';

type PriceLookupSurvey = {
  /** What `findSubscriptionPrice` is called locally, honouring `as` aliases. */
  binding: string;
  /** First argument of each direct call, in source order. */
  callArguments: ts.Node[];
  /** Any use that is not a direct call — an alias, a re-export, a hand-off. */
  otherUses: string[];
};

/**
 * Survey every use of `findSubscriptionPrice` in a file, through the AST.
 *
 * Text matching kept losing this argument: an `as` alias renames the callee, a
 * wrapper hides the argument behind another function, and a comment mentioning
 * the name inflates any count you take. The compiler sees none of that — it
 * resolves the import to a local binding and comments do not exist in the
 * tree — so ask it instead of guessing at the source text.
 */
function surveyPriceLookups(
  sourceText: string,
  fileName: string
): PriceLookupSurvey {
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX
  );

  let binding: string | undefined;
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const named = statement.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const element of named.elements) {
      // `propertyName` is set only for `imported as local`.
      const imported = (element.propertyName ?? element.name).text;
      if (imported === 'findSubscriptionPrice') binding = element.name.text;
    }
  }
  assert.ok(
    binding,
    'the page must import findSubscriptionPrice to price anything'
  );

  const callArguments: ts.Node[] = [];
  const otherUses: string[] = [];
  const describe = (node: ts.Node) => {
    const { line } = source.getLineAndCharacterOfPosition(
      node.getStart(source)
    );
    return `line ${line + 1}: ${ts.SyntaxKind[node.parent.kind]}`;
  };
  const visit = (node: ts.Node) => {
    // The import itself is a declaration, not a use.
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node) && node.text === binding) {
      const parent = node.parent;
      if (parent && ts.isCallExpression(parent) && parent.expression === node) {
        callArguments.push(parent.arguments[0]);
      } else {
        otherUses.push(describe(node));
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);

  return { binding, callArguments, otherUses };
}

/** True for the expression `plan.configPlanId`, as a tree rather than a string. */
function isDisplayPlanKey(node: ts.Node | undefined) {
  return (
    !!node &&
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'plan' &&
    node.name.text === 'configPlanId'
  );
}

/** The real monthly amount for the paid tier, read straight from config. */
function realGrowthMonthlyAmount() {
  return findSubscriptionPrice('pro', PlanIntervals.MONTH)?.amount ?? 0;
}

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
  // Rose-gold appears only as the subscription spark accent.
  assert.match(src, /var\(--spark\)/u);
  assert.match(src, /IconSparkles/u);
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

  // Both surfaces read the payment configuration through the same helper.
  assert.match(home, /growthMonthlyPriceLabel\(\)/u);
  assert.match(pricing, /findSubscriptionPrice\(/u);
  assert.match(pricePlan, /export function growthMonthlyPriceLabel/u);
  assert.match(pricePlan, /export function findSubscriptionPrice/u);
  assert.match(pricePlan, /getPricePlans\(\)\[configPlanId\]/u);
});

test('one product key, one source: repointing a tier moves both pages at once', () => {
  // Calling the same helper is not the same as quoting the same product.
  // /pricing used to carry its own `configPlanId: 'pro'` literal for the paid
  // card while the landing priced off GROWTH_CONFIG_PLAN_ID — two independent
  // copies of the plan key, so repointing that one row at another product made
  // the pages disagree again while every "same helper" assertion stayed green.
  const pricing = read(PRICING);
  const pricePlan = read(PRICE_PLAN);

  // The mapping exists in exactly one place …
  assert.match(pricePlan, /export const PUBLIC_PLAN_CONFIG_IDS = \{/u);
  assert.match(
    pricePlan,
    /export const GROWTH_CONFIG_PLAN_ID = PUBLIC_PLAN_CONFIG_IDS\.growth;/u,
    'the landing price must resolve through the shared mapping, not a twin literal'
  );

  // … and /pricing reads it rather than keeping its own copy.
  assert.match(pricing, /configPlanId: PUBLIC_PLAN_CONFIG_IDS\.starter,/u);
  assert.match(pricing, /configPlanId: PUBLIC_PLAN_CONFIG_IDS\.growth,/u);
  assert.doesNotMatch(
    pricing,
    /configPlanId: ['"`]/u,
    'a literal plan key here is a second source that can drift from the landing'
  );

  // Storing the key in the mapping is worth nothing if the page then prices a
  // different key anyway. Every price lookup on this page must go through the
  // display plan's own configPlanId — a literal argument here reintroduces the
  // fork one level down, where the DISPLAY_PLANS assertions above cannot see it.
  const survey = surveyPriceLookups(pricing, PRICING);

  // 中级 monthly + 中级 yearly + the CTA's monthly. Three cards, but only the
  // paid one is priced, and it is priced twice: once to show and once to decide
  // whether checkout is reachable.
  const EXPECTED_PRICE_LOOKUPS = 3;

  // Every use must be a call. Handing the function to a variable, a wrapper or
  // a re-export moves the argument somewhere this guard cannot read it, so the
  // hand-off is the failure — there is no legitimate reason for one here.
  assert.deepEqual(
    survey.otherUses,
    [],
    `${survey.binding} must only ever be called directly on this page`
  );
  assert.equal(
    survey.callArguments.length,
    EXPECTED_PRICE_LOOKUPS,
    'a price lookup was added or removed — is the new one keyed by the display plan?'
  );
  for (const argument of survey.callArguments) {
    assert.ok(
      isDisplayPlanKey(argument),
      `price every card by plan.configPlanId, never by ${argument?.getText() ?? 'nothing'}`
    );
  }
});

test('the mapping states exactly which product backs each public tier', () => {
  // Pin the values themselves. Everything else in this file proves the two
  // surfaces agree with *each other*; without this they could agree on the
  // wrong product — 中级 silently priced as 终身版 reads as consistent.
  assert.deepEqual(
    { ...PUBLIC_PLAN_CONFIG_IDS },
    { starter: 'free', growth: 'pro' }
  );
  assert.equal(GROWTH_CONFIG_PLAN_ID, 'pro');
});

test('both public surfaces keep the handle the browser reads the price by', () => {
  // The browser gate (tests/e2e/specs/public-plan-price-source.spec.ts) can
  // only compare the two pages if it can find the price on each. Losing the
  // testid on one of them turns that gate into "element not found", which is a
  // red run whose message points at the test rather than at the reshell that
  // dropped the attribute. Say it here, where the reason is written down.
  const home = read(HOME_PRICING);
  const pricing = read(PRICING);
  assert.equal(PUBLIC_PAID_MONTHLY_PRICE_TESTID, 'public-paid-monthly-price');
  assert.match(home, /PUBLIC_PAID_MONTHLY_PRICE_TESTID/u);
  assert.match(home, /data-testid=\{plan\.priceTestId\}/u);
  assert.match(pricing, /data-testid=\{PUBLIC_PAID_MONTHLY_PRICE_TESTID\}/u);
});

test('the landing reads the pro product out of the catalogue every time it is asked', () => {
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
  for (const proAmount of [41_700, 53_000]) {
    withStubbedCatalog({ free: 0, pro: proAmount, lifetime: 99_900 }, () => {
      const priceFiledUnderPro = formatSubscriptionPrice(
        findSubscriptionPrice('pro', PlanIntervals.MONTH) ?? {
          amount: 0,
          currency: 'CNY',
        }
      );
      assert.equal(
        growthMonthlyPriceLabel(),
        priceFiledUnderPro,
        `the landing must quote the pro product at ${proAmount} cents`
      );
      // The catalogue really does discriminate: another product would have
      // produced a visibly different number, so the assertion above is
      // load-bearing rather than accidentally true.
      assert.equal(
        formatSubscriptionPrice(
          findSubscriptionPrice('lifetime', PlanIntervals.MONTH) ?? {
            amount: 0,
            currency: 'CNY',
          }
        ),
        'CN¥999'
      );
      assert.notEqual(growthMonthlyPriceLabel(), '¥999');
    });
  }
  // And the stub is fully undone, so the rest of the suite sees real config.
  assert.equal(
    growthMonthlyPriceLabel(),
    formatSubscriptionPrice({
      amount: realGrowthMonthlyAmount(),
      currency: 'CNY',
    })
  );
});

test('the page loads the credit catalogue without displaying #310 pricing', () => {
  const pricing = read(PRICING);
  assert.match(pricing, /loader: \(\) => getPublicPlanCatalog\(\)/u);
  assert.match(pricing, /Route\.useLoaderData\(\)/u);
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

test('dead "不可用" CTA is gone; availability is computed, not faked', () => {
  const src = read(PRICING);
  // The template dead-end label must not be rendered as a CTA on /pricing.
  assert.doesNotMatch(src, /pricing_card_not_available/u);
  // Availability derives from the real payment computation.
  assert.match(src, /websiteConfig\.payment\?\.enable/u);
  assert.match(src, /hasValidPriceId/u);
  // Honest unavailable states with a reason line.
  assert.match(src, /pricing_plan_payment_not_open/u);
  assert.match(src, /pricing_plan_purchase_unavailable/u);
  // A real checkout path exists when a valid price id is configured.
  assert.match(src, /CheckoutButton/u);
});

test('single coherent plan presentation does not pre-empt #310', () => {
  const src = read(PRICING);
  assert.doesNotMatch(src, /quota\.credits/u);
  assert.doesNotMatch(src, /pricing_output_copy_count/u);
  assert.doesNotMatch(src, /pricing_output_image_count/u);
  assert.doesNotMatch(src, /pricing_output_video_count/u);
  // The "并发任务" jargon label is not used; merchant language replaces it.
  assert.doesNotMatch(src, /pricing_output_concurrency_label/u);
  assert.match(src, /pricing_plan_concurrency_label/u);
  // The separate second row (raw PricingTable) is not stacked on this page.
  assert.doesNotMatch(src, /PricingTable/u);
});

test('new pricing copy is merchant Chinese and reaches zh/en parity', () => {
  const zh = JSON.parse(read('project.inlang/messages/zh.json'));
  const en = JSON.parse(read('project.inlang/messages/en.json'));
  const keys = [
    'pricing_plan_concurrency_label',
    'pricing_plan_login_to_subscribe',
    'pricing_plan_payment_not_open',
    'pricing_plan_payment_not_open_hint',
    'pricing_plan_price_custom',
    'pricing_plan_price_free',
    'pricing_plan_purchase_unavailable',
    'pricing_plan_purchase_unavailable_hint',
    'pricing_plan_recommended',
    'pricing_plan_subscribe',
    'pricing_plan_subtitle',
    'pricing_plan_yearly_hint',
  ];
  for (const key of keys) {
    assert.equal(typeof zh[key], 'string', `zh missing ${key}`);
    assert.equal(typeof en[key], 'string', `en missing ${key}`);
    assert.ok(zh[key].length > 0, `zh empty ${key}`);
    assert.ok(en[key].length > 0, `en empty ${key}`);
  }
  // Merchant language: no "并发" jargon in the page-facing strings.
  assert.doesNotMatch(zh.pricing_plan_concurrency_label, /并发/u);
  assert.doesNotMatch(zh.pricing_plan_subtitle, /并发/u);
  assert.equal(zh.pricing_plan_concurrency_label, '可同时进行的创作数');
});

test('template design doc is retired and points at the root design system', () => {
  const doc = read('docs/DESIGN.md');
  assert.match(doc, /RETIRED/u);
  assert.match(doc, /门店橱窗/u);
  assert.match(doc, /美业内容2\/DESIGN\.md/u);
  assert.match(doc, /Do not treat this file as authoritative/u);
});
