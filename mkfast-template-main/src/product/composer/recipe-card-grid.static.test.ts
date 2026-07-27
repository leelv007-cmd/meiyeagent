import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

test('the card grid is the supply-layer unit, not a hand-rolled grid (U04)', () => {
  const grid = read('./recipe-card-grid.tsx');

  assert.match(grid, /from '@\/components\/heroui-pro'/u);
  assert.match(grid, /<ItemCardGroup/u);
  assert.match(grid, /<ItemCard<'button'>/u);
  // D-083: one button per card, no nested interactive controls.
  assert.doesNotMatch(grid, /<ItemCard\.Action[\s\S]*?<button/u);
});

/**
 * The upstream `item-card` truncates its title and description. D-084 forbids
 * that on the narrow / 200%-zoom path, so the app adapts the unit in
 * heroui-glass.css — and the adaptation only reaches the cards if they still
 * carry the class. Both halves are asserted here because losing either one
 * brings the ellipsis back silently: nothing throws, the sentence just stops.
 */
test('merchant sentences on the cards still wrap after the item-card swap (D-084)', () => {
  const grid = read('./recipe-card-grid.tsx');
  const glass = read('../../components/heroui-pro/heroui-glass.css');

  assert.match(grid, /meiye-item-card-stack/u);
  assert.match(
    glass,
    /\.meiye-item-card-stack \[data-slot="item-card-title"\],[\s\S]*?\[data-slot="item-card-description"\]\s*\{[\s\S]*?white-space:\s*normal/u
  );
  assert.match(
    glass,
    /\.meiye-item-card-stack\s*\{[\s\S]*?flex-direction:\s*column/u
  );
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

test('trend-chip left the supply barrel with a written reason (U04 关票)', () => {
  const barrel = read('../../components/heroui-pro/index.ts');
  const manifest = read('../../components/heroui-pro/components.json');

  assert.doesNotMatch(barrel, /export \{ TrendChip \}/u);
  assert.doesNotMatch(manifest, /"trend-chip"/u);
  // A retirement without a reason is just a deletion waiting to be undone.
  assert.match(barrel, /trend-chip\s+对话流半边没有任何/u);
  assert.match(manifest, /U04 关票再撤：trend-chip/u);
});
