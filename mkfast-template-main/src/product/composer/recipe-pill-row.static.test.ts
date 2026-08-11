import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

/**
 * D-164② replaced the recipe card grid with a pill row, so U04's supply-layer
 * `item-card` unit is no longer what draws this surface: a pill is the same
 * control as the lens axis one line above it, and that axis is hand-rolled.
 * The clauses U04 protected on the grid are re-anchored here, on the row that
 * actually renders.
 *
 * Left behind by that swap and NOT removed by #261: `ItemCard` / `ItemCardGroup`
 * keep no product consumer (only `routes/heroui-spike/`, a vendor spike), and
 * `.meiye-item-card-stack` in heroui-glass.css keeps no caller. Both are U04
 * assets; retiring them is that ticket's call, not this one's.
 */
test('the recipe pills are one button each, in the lens axis family (D-083)', () => {
  const row = read('./recipe-pill-row.tsx');

  // One <button> per recipe, and nothing interactive nested inside it.
  assert.match(row, /<button\b/u);
  assert.doesNotMatch(row, /<button[\s\S]*?<(?:button|a|input|select)\b/u);
  // Same touch target and focus ring the lens axis uses — they are one control
  // surface, so a pill that misses either reads as a different kind of thing.
  assert.match(row, /min-h-12 min-w-12/u);
  assert.match(row, /focus-visible:ring-2/u);
  // The grouping is native (fieldset/legend), not a div wearing role="group".
  assert.match(row, /<fieldset/u);
  assert.doesNotMatch(row, /role="group"/u);
});

/**
 * D-084 forbids an ellipsis on the narrow / 200%-zoom path. The grid needed a
 * CSS adaptation to win that against the vendored unit's own truncation; a pill
 * is a plain button, so it only has to keep the wrap class and stay clear of
 * the Tailwind clamps. Asserted on the source because the failure is silent:
 * nothing throws, the merchant's sentence just stops.
 */
test('merchant sentences on the pills still wrap (D-084)', () => {
  const row = read('./recipe-pill-row.tsx');

  assert.match(row, /COMPOSER_CARD_TEXT_CLASS/u);
  // The Tailwind clamps as class tokens — `data-no-truncate` is the opposite
  // claim and must not be mistaken for one of them.
  assert.doesNotMatch(row, /line-clamp-\d/u);
  assert.doesNotMatch(row, /['\s]truncate['\s]/u);
});

/**
 * Same failure mode as the ellipsis above, on the other unit: upstream styles
 * `chain-of-thought` step labels as a foldable reasoning trace (`--muted`), and
 * because the vendored sheet is unlayered, a Tailwind colour on the call site
 * loses to it silently. D-116 makes those lines something the merchant reads.
 */
test('the transcript pane never fades a card the merchant has to read', () => {
  const conversation = read('./composer-conversation.tsx');
  const glass = read('../../components/heroui-pro/heroui-glass.css');

  assert.match(conversation, /meiye-conversation-pane/u);
  assert.match(
    glass,
    /\.meiye-conversation-pane\s*\{[\s\S]*?mask-image:\s*none/u
  );
});

test('白话进度 announcements keep delivery-statement contrast (D-116)', () => {
  const card = read('./composer-progress-card.tsx');
  const glass = read('../../components/heroui-pro/heroui-glass.css');

  assert.match(card, /meiye-progress-rail/u);
  assert.match(
    glass,
    /\.meiye-progress-rail \.chain-of-thought__step-label,[\s\S]*?\.chain-of-thought__trigger\s*\{[\s\S]*?color:\s*var\(--foreground\)/u
  );
  // The reduced-motion fallback for the shimmering trigger drops it to 60%
  // opacity upstream; less motion must not mean less contrast.
  assert.match(
    glass,
    /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.meiye-progress-rail \.text-shimmer\s*\{[\s\S]*?opacity:\s*1/u
  );
});

/**
 * 「暂不可用」的原因是店主此刻唯一需要读的字，而 opacity 会连着它一起乘：整颗
 * 0.6 时 ink-60 落到白瓷上只剩 2.5:1。pill 上没有缩略图可压暗，所以不可用态
 * 只许换文字色。
 */
test('an unavailable pill changes colour, never opacity', () => {
  const row = read('./recipe-pill-row.tsx');

  // A pill has no thumbnail to dim, so the unavailable state only recolours.
  assert.doesNotMatch(row, /opacity-\d/u);
  assert.match(row, /cursor-not-allowed/u);
  assert.match(row, /text-muted-foreground/u);
});

test('trend-chip stays outside the pinned HeroUI inventory', () => {
  const barrel = read('../../components/heroui-pro/index.ts');
  const manifest = read('../../components/heroui-pro/components.json');

  assert.doesNotMatch(barrel, /export \{ TrendChip \}/u);
  assert.doesNotMatch(manifest, /"trend-chip"/u);
  assert.match(manifest, /U04 关票再撤：trend-chip/u);
});
