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
  assert.match(home, /submitHint=\{submitIntent\.hint\}/u);
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
 * D-109 / D-123: the merchant unit is 条数, never money, and no internal cost
 * baseline reaches the front. The quote line printed 「预计消耗 0.06」 — a bare
 * float in an invisible unit — one line above the counted sentence next to the
 * send button.
 */
test('the quote line carries no bare cost figure', () => {
  assert.doesNotMatch(home, /预计消耗\s*\$\{/u);
  assert.doesNotMatch(home, /currentQuoteView\.amount\}/u);
  assert.match(home, /currentQuoteView\.billingNote \?\?/u);
});
