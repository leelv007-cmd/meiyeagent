import assert from 'node:assert/strict';
import test from 'node:test';

import {
  callArgumentObjects,
  hasCall,
  identifiers,
  jsxOf,
  literals,
  parseProductionSource,
  parseSourceText,
  propertyValues,
} from '../../test-support/ast-boundary';

/**
 * #240 anti-revival: the Composer must not go back to printing one loading line
 * for every unmet quote precondition. The states themselves are covered by
 * `quote-readiness.test.ts` and the rendering by
 * `quote-status-line.interaction.test.tsx`; this only pins the host as a real
 * consumer of both.
 */
const source = parseProductionSource(
  new URL('./composer-home.tsx', import.meta.url)
);

test('a collapsed loading line fails the quote-precondition boundary', () => {
  const preFix = parseSourceText(
    'pre-fix.ts',
    "const message = catalogQuery.isError || quoteQuery.isError ? '当前模型或报价暂不可用' : '正在读取模型与报价…';"
  );
  assert.ok(literals(preFix).includes('正在读取模型与报价…'));
});

test('Composer routes the quote line through the precondition state machine', () => {
  assert.equal(literals(source).includes('正在读取模型与报价…'), false);
  assert.equal(literals(source).includes('当前模型或报价暂不可用'), false);
  assert.ok(jsxOf(source, 'ComposerQuoteStatusLine').length >= 1);
  assert.equal(hasCall(source, 'resolveComposerQuoteUsageLine'), true);
  const status = jsxOf(source, 'ComposerQuoteStatusLine')[0];
  assert.equal(status?.attrs.readiness, 'quoteUsage.readiness');
  assert.equal(status?.attrs.onRetry, 'retryQuoteReadiness');

  const readiness = callArgumentObjects(
    source,
    'resolveComposerQuoteReadiness'
  )[0];
  assert.ok(readiness);
  assert.equal(readiness.surface, 'composerQueryPhase(surfaceQuery)');
  assert.equal(readiness.catalog, 'composerQueryPhase(catalogQuery)');
  assert.equal(readiness.preferences, 'composerQueryPhase(preferencesQuery)');
  assert.equal(readiness.hasRecipe, 'submissionRecipe != null');
  assert.equal(readiness.hasModel, 'selectedModel != null');
  assert.equal(readiness.hasDestination, 'destination != null');
  assert.equal(readiness.hasSignedSubmission, 'signedSubmission != null');
  assert.equal(readiness.hasQuoteView, 'currentQuoteView != null');
  assert.ok((readiness.quote ?? '').includes('composerQueryPhase(quoteQuery)'));
  assert.equal(hasCall(source, 'requestComposerQuote'), true);
  assert.ok(propertyValues(source, 'retry').includes('1'));
  assert.equal(hasCall(source, 'resolveFreeCatalogModelId'), true);
});

test('Composer gates render and submission on the current quote, not the bound one', () => {
  assert.equal(hasCall(source, 'currentComposerQuoteView'), true);
  const bar = jsxOf(source, 'ComposerPromptBar')[0];
  assert.ok(bar);
  assert.ok((bar.attrs.usageSlot ?? '').includes('currentQuoteView'));
  assert.equal((bar.attrs.usageSlot ?? '').includes('quoteView ?'), false);
  assert.ok(
    identifiers(source).has('currentQuoteView') &&
      propertyValues(source, 'quote').includes('currentQuoteView')
  );
  assert.ok(
    propertyValues(source, 'quoteStale').some((value) =>
      value.includes('currentQuoteView')
    )
  );
});
