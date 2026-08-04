import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { BUSINESS_SIDEBAR_ITEMS } from '@/config/sidebar-config';
import { BUSINESS_NAVIGATION } from '@/lib/uiux/navigation';

const source = readFileSync(
  fileURLToPath(new URL('./mobile-nav.tsx', import.meta.url)),
  'utf8'
);

/**
 * The sidebar and the bottom bar are one navigation seen from two viewports.
 * They used to be two hand-kept lists, which is how the 素材 route ended up with
 * a different label, a different icon and a different position depending on the
 * screen. U07 gives them one list; this keeps them on it.
 */
test('the phone reads the same navigation list as the sidebar (U07)', () => {
  assert.match(source, /BUSINESS_SIDEBAR_ITEMS/u);
  assert.match(source, /BUSINESS_SIDEBAR_ITEMS\.map/u);

  // No second copy of the destinations: adding a route to the shell must not
  // require remembering this file.
  assert.doesNotMatch(source, /Routes\.ContentLibrary/u);
  assert.doesNotMatch(source, /Routes\.AssetLibrary/u);
  assert.doesNotMatch(source, /Routes\.StoreProfile/u);
  // The workbench route is named only to decide when it counts as current
  // (`isDashboardPath` plus the entry test) — never to build an entry.
  assert.doesNotMatch(source, /to=\{Routes\.Dashboard\}/u);
});

/**
 * This assertion used to fix four destinations (D-136, 2026-07-27). D-164④
 * (2026-07-29) makes 记忆 a first-class destination, and the coordinator ruled
 * on the ticket that the later, more specific decision supersedes the earlier
 * one at this point. Updated to five deliberately — the assertion still exists
 * to catch a destination appearing without a decision behind it, which is what
 * it was for.
 */
test('the business destinations stay in sync between the two viewports', () => {
  assert.deepEqual(
    BUSINESS_SIDEBAR_ITEMS.map((item) => item.href),
    BUSINESS_NAVIGATION.map((item) => item.href)
  );
  assert.deepEqual(
    BUSINESS_SIDEBAR_ITEMS.map((item) => item.id),
    ['workbench', 'content', 'assets', 'store', 'memory']
  );
});

/**
 * The bottom bar lays the destinations out on a fixed grid, so the column
 * count is part of the same contract — a fifth entry on a four-column grid
 * wraps into a second row and covers the content behind it.
 */
test('the phone grid has one column per destination', () => {
  assert.match(source, /grid-cols-5/u);
  assert.equal(BUSINESS_SIDEBAR_ITEMS.length, 5);
});

/**
 * Mobile and desktop share the 素材 / Materials label (`product_navigation_assets`
 * via `item.label`). Identity (口吻) remains reachable inside the assets surface
 * and dedicated routes, not via a different bottom-bar word. The former
 * `MOBILE_LABEL_OVERRIDES` dual label (口吻与素材 / Voices & assets) is gone —
 * do not reintroduce a separate nav word without a product decision.
 */
test('mobile assets entry shares the desktop 素材 label; no dual-label override', () => {
  assert.doesNotMatch(source, /MOBILE_LABEL_OVERRIDES/u);
  assert.doesNotMatch(source, /product_navigation_identity_assets/u);
  assert.match(source, /item\.label/u);
  // Journey tests still find the assets slot by stable test id.
  assert.match(source, /mobile-identity-assets-entry/u);
  assert.match(source, /assets: 'mobile-identity-assets-entry'/u);
});
