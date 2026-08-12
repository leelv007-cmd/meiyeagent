import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const home = readFileSync(
  new URL('./composer-home.tsx', import.meta.url),
  'utf8'
);
const conversation = readFileSync(
  new URL('./composer-conversation.tsx', import.meta.url),
  'utf8'
);

/**
 * One control, two jobs. `attemptSubmit` returns before any generation request
 * whenever a precondition is open — the grounding branch and the fact card the
 * press reveals — while the send button read 「开始创作」 in every state. The
 * merchant pressed what they read as 开始创作 and got a question instead.
 */
test('the send control states which of its two jobs the next press does', () => {
  assert.match(home, /function composerSubmitIntent\(input:/u);
  // Grounding intent only arms in customized mode, and still reads product.state.
  assert.match(
    home,
    /groundingBlocker:\s*\n?\s*creationMode === 'customized' &&\s*\n?\s*product\.state/u
  );
  assert.match(
    home,
    /storeFactsPending:\s*creationMode === 'customized' && showProgressiveFact,/u
  );
  assert.match(home, /submitLabel=\{submitIntent\.label\}/u);
  // V31-14: a pending typed interrupt speaks first — it is the reason the next
  // press cannot start anything — and the two-jobs hint stays behind it.
  assert.match(
    home,
    /submitHint=\{pendingInterruptGate\.hint \?\? submitIntent\.hint\}/u
  );
  // The constant label is now only the branch where a press really starts a run.
  assert.doesNotMatch(home, /submitLabel=\{creation_entry_submit\(\)\}/u);
});

/**
 * WCAG 3.3.1. A blocked press used to paint a red edge with `aria-invalid` and
 * `aria-describedby` both absent, and every `role=alert` region on the page
 * empty — no signal at all for a screen reader, a colour with no cause for
 * everyone else.
 */
test('a blocked press produces a described, visible reason on the intent box', () => {
  assert.match(conversation, /aria-describedby=\{describedBy\}/u);
  assert.match(
    conversation,
    /aria-invalid=\{intentError \? true : undefined\}/u
  );
  assert.match(conversation, /id=\{INTENT_ERROR_ID\}/u);
  assert.match(conversation, /role="alert"/u);

  assert.match(home, /intentError=\{submitBlockedMessage\}/u);
});

/**
 * D-109 / D-172: the merchant unit is 积分, never money, and no internal cost
 * baseline reaches the front. The quote line printed 「预计消耗 0.06」 — a bare
 * float in an invisible unit — one line above the counted sentence next to the
 * send button.
 */
test('the quote line carries no bare cost figure', () => {
  assert.doesNotMatch(home, /预计消耗\s*\$\{/u);
  assert.doesNotMatch(home, /currentQuoteView\.amount\}/u);
  assert.match(home, /currentQuoteView\.billingNote \?\?/u);
});

test('a missing required source slot is named on send and hides quote confirmation', () => {
  assert.match(home, /missingRequiredSourceSlot:/u);
  assert.match(home, /unsatisfiedRequiredSlots\.length === 0/u);
  assert.match(home, /sourceSlotGuidance \?/u);
  assert.match(home, /<RecipeSourceSlotGuidanceCard/u);
});

test('selecting a lens defaults empty destination per Day-0 contract (QA ISSUE-006)', () => {
  // Regression: ISSUE-006 — destination chip order made offline easy to land on.
  // Found by /qa on 2026-08-07
  // Report: .gstack/qa-reports/qa-report-localhost-3000-2026-08-07.md
  // The default must stay lens-aware (D-128 / Z1): a blanket 小红书 default
  // regressed the copy journey to a 小红书 package instead of 朋友圈分段包.
  const home = readFileSync(
    new URL('./composer-home.tsx', import.meta.url),
    'utf8'
  );
  assert.match(home, /const handleLensChange = \(next: CreationLensId\) =>/u);
  assert.match(home, /copy:\s*\{\s*platform:\s*'wechat_moments'/u);
  assert.match(home, /image_text:\s*\{\s*platform:\s*'xiaohongshu'/u);
  assert.match(home, /video:\s*\{\s*platform:\s*'douyin'/u);
  assert.match(home, /distributionTarget:\s*'manual_copy'/u);
});

test('store intake confirm invalidates today recommendation after success', () => {
  // Regression: ISSUE-008 — cold chips stayed cold after store facts landed.
  // D-C4 moved the confirm out of the idle card and into the store wizard, so
  // the invalidation moved with it rather than being dropped.
  const wizard = readFileSync(
    new URL('../store-intake/store-intake-wizard.tsx', import.meta.url),
    'utf8'
  );
  assert.match(wizard, /queryKey:\s*\['harness',\s*'today-recommendation'\]/u);
  assert.match(wizard, /intake-finalize:\$\{id\}/u);
});
