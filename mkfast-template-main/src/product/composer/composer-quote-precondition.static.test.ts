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
  assert.match(source, /readiness=\{quoteReadiness\}/u);
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
    ['hasQuoteView', 'quoteView != null'],
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
