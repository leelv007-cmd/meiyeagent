import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/**
 * #240 anti-revival: the Composer must not go back to printing one loading line
 * for every unmet quote precondition. The states themselves are covered by
 * `quote-readiness.test.ts` and the rendering by
 * `quote-status-line.interaction.test.tsx`; this only pins the host as a real
 * consumer of both.
 */
test('Composer routes the quote line through the precondition state machine', async () => {
  const source = await readFile(
    new URL('./composer-home.tsx', import.meta.url),
    'utf8'
  );

  // The retired branch and its two strings: anything that was not an explicit
  // catalog / quote error printed 正在读取模型与报价… with no way out.
  assert.doesNotMatch(
    source,
    /catalogQuery\.isError\s*\|\|\s*quoteQuery\.isError/u
  );
  assert.equal(source.includes("'正在读取模型与报价…'"), false);
  assert.equal(source.includes('当前模型或报价暂不可用'), false);

  assert.match(source, /<ComposerQuoteStatusLine/u);
  // Free mode may inject a no_model readiness; every other path still uses the
  // precondition state machine (`quoteReadiness`).
  assert.match(
    source,
    /readiness=\{\s*creationMode === 'free' && lensId && !selectedModel\s*\?[\s\S]*?:\s*quoteReadiness\s*\}/u
  );
  assert.match(source, /onRetry=\{retryQuoteReadiness\}/u);

  // Every precondition the state machine distinguishes is fed from the live
  // query or value that decides it — not from a constant.
  for (const [field, expression] of [
    ['surface', 'composerQueryPhase\\(surfaceQuery\\)'],
    ['catalog', 'composerQueryPhase\\(catalogQuery\\)'],
    ['preferences', 'composerQueryPhase\\(preferencesQuery\\)'],
    ['hasRecipe', 'submissionRecipe != null'],
    ['hasModel', 'selectedModel != null'],
    ['hasDestination', 'destination != null'],
    ['hasSignedSubmission', 'signedSubmission != null'],
    ['hasQuoteView', 'currentQuoteView != null'],
  ] as const) {
    assert.match(
      source,
      new RegExp(`${field}:\\s*${expression}`, 'u'),
      `${field} must be read from the live value`
    );
  }
  assert.match(
    source,
    /quote:\s*quoteInput == null \? 'disabled' : composerQueryPhase\(quoteQuery\)/u
  );

  // The quote command carries both the caller cancellation and (through
  // `requestComposerQuote`) its own deadline.
  assert.match(
    source,
    /requestComposerQuote\(\s*quoteInput,\s*commandP1,\s*\{\s*signal\s*\}\s*\)/u
  );
  assert.match(source, /retry:\s*1,/u);
});

/**
 * #240 P1: a price the current input no longer produces must not render as a
 * settled quote, and must not get a run admitted. The rule itself is
 * `currentComposerQuoteView` (unit-tested); this pins that every gate reads the
 * checked view rather than the raw draft one.
 */
test('Composer gates render and submission on the current quote, not the bound one', async () => {
  const source = await readFile(
    new URL('./composer-home.tsx', import.meta.url),
    'utf8'
  );

  assert.match(
    source,
    /const currentQuoteView = currentComposerQuoteView\(\s*quoteView,\s*quoteInput\?\.quoteId\s*\)/u
  );
  // The rendered price line, the submit button and both submission paths.
  assert.match(source, /\{currentQuoteView \? \(/u);
  assert.match(source, /currentQuoteView\.billingNote/u);
  assert.match(source, /lensId != null && !currentQuoteView/u);
  assert.match(
    source,
    /!quoteQuery\.data \|\| !currentQuoteView \|\| !submissionRecipe/u
  );

  // None of those gates may fall back to the unchecked draft view.
  assert.doesNotMatch(source, /\{quoteView \? \(/u);
  assert.doesNotMatch(source, /lensId != null && !quoteView\b/u);
  assert.doesNotMatch(source, /!quoteQuery\.data \|\| !quoteView\b/u);

  // The Brief is the fifth gate, not an exception. It renders and confirms
  // against the same identity check, and its confirm handler no longer asserts
  // `quoteQuery.data!` — after an edit the new key has no data and reading
  // `.quoteId` off it would throw.
  assert.match(
    source,
    /quote: currentQuoteView,\s*\n\s*quoteStale: currentQuoteView == null,/u
  );
  assert.match(source, /if \(!currentQuoteView \|\| !confirmedQuote\) \{/u);
  assert.doesNotMatch(source, /quoteQuery\.data!/u);
  assert.doesNotMatch(source, /quote: quoteView\b/u);
});
