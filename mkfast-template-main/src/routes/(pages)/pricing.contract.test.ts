import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const read = (file: string) =>
  readFileSync(resolve(process.cwd(), file), 'utf8');

const PRICING = 'src/routes/(pages)/pricing.tsx';
const PRICING_SHELL = 'src/components/pricing/pricing-shell.tsx';
const HOME_PRICING = 'src/components/blocks/pricing.tsx';
const PRICING_CARD = 'src/components/pricing/pricing-card.tsx';

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

test('homepage pricing section shares the Shop Window shell', () => {
  const home = read(HOME_PRICING);
  assert.match(home, /PricingShell/u);
  assert.match(home, /meiye-pricing-shell|PricingShell/u);
  assert.match(home, /from '@\/components\/pricing\/pricing-shell'/u);
});

test('dead "不可用" CTA is gone; availability is computed, not faked', () => {
  const src = read(PRICING);
  const card = read(PRICING_CARD);
  // The template dead-end label must not be rendered as a CTA on /pricing.
  assert.doesNotMatch(src, /pricing_card_not_available/u);
  // PricingCard CTAs use honest availability copy (not the dead template label).
  assert.doesNotMatch(
    card,
    /<Button[^>]*>\s*\{pricing_card_not_available\(\)\}/u
  );
  assert.match(card, /pricing_plan_payment_not_open/u);
  assert.match(card, /pricing_plan_purchase_unavailable/u);
  // Availability derives from the real payment computation.
  assert.match(src, /websiteConfig\.payment\?\.enable/u);
  assert.match(src, /hasValidPriceId/u);
  assert.match(card, /websiteConfig\.payment\?\.enable/u);
  assert.match(card, /hasValidPriceId/u);
  // Honest unavailable states with a reason line.
  assert.match(src, /pricing_plan_payment_not_open/u);
  assert.match(src, /pricing_plan_purchase_unavailable/u);
  // A real checkout path exists when a valid price id is configured.
  assert.match(src, /CheckoutButton/u);
  assert.match(card, /CheckoutButton/u);
});

test('single coherent plan presentation with quota folded in; no jargon', () => {
  const src = read(PRICING);
  // Quota (copy/image/video) is folded into the plan cards.
  assert.match(src, /pricing_output_copy_count/u);
  assert.match(src, /pricing_output_image_count/u);
  assert.match(src, /pricing_output_video_count/u);
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
