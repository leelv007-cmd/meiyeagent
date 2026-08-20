import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPOSER_QUOTE_CONFIRMED_MESSAGE,
  composerQueryPhase,
  composerQuoteConfirmedForMode,
  currentComposerQuoteView,
  resolveComposerQuoteReadiness,
  resolveComposerQuoteStrip,
  resolveComposerQuoteUsageLine,
  type ComposerQuoteReadinessInput,
} from './quote-readiness';

/** Everything present and settled: the only shape that reaches a quote. */
function settled(
  overrides: Partial<ComposerQuoteReadinessInput> = {}
): ComposerQuoteReadinessInput {
  return {
    lensSelected: true,
    surface: 'success',
    catalog: 'success',
    preferences: 'success',
    quote: 'pending',
    hasRecipe: true,
    hasModel: true,
    hasDestination: true,
    hasSignedSubmission: true,
    hasQuoteView: false,
    settling: false,
    ...overrides,
  };
}

test('no lens is idle and says nothing', () => {
  const readiness = resolveComposerQuoteReadiness(
    settled({ lensSelected: false })
  );
  assert.equal(readiness.state, 'idle');
  assert.equal(readiness.message, null);
  assert.equal(readiness.retry, null);
});

test('a bound quote view is ready and leaves the line to the host', () => {
  const readiness = resolveComposerQuoteReadiness(
    settled({ hasQuoteView: true })
  );
  assert.equal(readiness.state, 'ready');
  assert.equal(readiness.message, null);
  assert.equal(readiness.retry, null);
});

test('the three precondition reads in flight are the only honest loading', () => {
  for (const pending of ['surface', 'catalog', 'preferences'] as const) {
    const readiness = resolveComposerQuoteReadiness(
      settled({ [pending]: 'pending' })
    );
    assert.equal(readiness.state, 'loading', pending);
    assert.equal(readiness.message, '正在读取模型与报价…', pending);
    assert.equal(readiness.retry, null, pending);
  }
});

test('a failed surface read is a failure with a surface retry, never loading', () => {
  const readiness = resolveComposerQuoteReadiness(
    settled({ surface: 'error' })
  );
  assert.equal(readiness.state, 'failed');
  assert.equal(readiness.message, '刚才没能算出这次要花多少。');
  assert.equal(readiness.retry, 'surface');
});

test('a failed preferences read stops masquerading as quote loading', () => {
  const readiness = resolveComposerQuoteReadiness(
    // The catalog succeeded and the model resolved from the previous render:
    // before #240 this still printed 正在读取模型与报价… under the error card.
    settled({ preferences: 'error', quote: 'disabled' })
  );
  assert.equal(readiness.state, 'failed');
  assert.equal(readiness.message, '刚才没能算出这次要花多少。');
  assert.equal(readiness.retry, 'catalog');
});

test('a failed catalog read retries the catalog side', () => {
  const readiness = resolveComposerQuoteReadiness(
    settled({ catalog: 'error' })
  );
  assert.equal(readiness.state, 'failed');
  assert.equal(readiness.retry, 'catalog');
});

test('a failed quote request is retryable rather than terminal', () => {
  const readiness = resolveComposerQuoteReadiness(settled({ quote: 'error' }));
  assert.equal(readiness.state, 'failed');
  assert.equal(readiness.message, '刚才没能算出这次要花多少。');
  assert.equal(readiness.retry, 'quote');
});

test('an error outranks a still-pending sibling read', () => {
  const readiness = resolveComposerQuoteReadiness(
    settled({ catalog: 'error', surface: 'pending' })
  );
  // Waiting on the surface cannot make the catalog succeed, so the merchant is
  // told now instead of after the other read settles.
  assert.equal(readiness.state, 'failed');
});

test('a lens with no published recipe names the recipe, not a spinner', () => {
  const readiness = resolveComposerQuoteReadiness(
    settled({ hasRecipe: false, quote: 'disabled' })
  );
  assert.equal(readiness.state, 'no_recipe');
  assert.equal(
    readiness.message,
    '这个方向暂时没有可用的模板，换个方向或稍后再试。'
  );
  assert.equal(readiness.retry, 'surface');
});

test('a catalog that answered 200 without an executable model is unavailable, not loading', () => {
  const readiness = resolveComposerQuoteReadiness(
    // catalog + preferences both 200; `deepseek-v4-pro` missing / unavailable /
    // unpriced, so `resolveCreationModelSelection` returned undefined.
    settled({ hasModel: false, quote: 'disabled' })
  );
  assert.equal(readiness.state, 'no_model');
  assert.equal(
    readiness.message,
    '这个方向暂时没有可用的模型，先算不出花多少。'
  );
  assert.equal(readiness.retry, 'catalog');
});

test('a missing destination asks for the platform instead of stalling', () => {
  const readiness = resolveComposerQuoteReadiness(
    settled({
      hasDestination: false,
      hasSignedSubmission: false,
      quote: 'disabled',
    })
  );
  assert.equal(readiness.state, 'invalid_submission');
  assert.equal(readiness.message, '先选一个要发去的平台，才能算这次花多少。');
  assert.equal(readiness.retry, null);
});

test('a destination that is present but a signed submission that will not parse says so', () => {
  const readiness = resolveComposerQuoteReadiness(
    settled({ hasSignedSubmission: false, quote: 'disabled' })
  );
  assert.equal(readiness.state, 'invalid_submission');
  assert.equal(
    readiness.message,
    '还差一点信息才能算这次花多少，补齐后会自动更新。'
  );
  assert.equal(readiness.retry, null);
});

test('every precondition met and the request in flight is requesting, not loading', () => {
  const readiness = resolveComposerQuoteReadiness(settled());
  assert.equal(readiness.state, 'requesting');
  assert.equal(readiness.message, '正在算这次大概花多少…');
  // Deadline-bounded, so a stuck request becomes `failed` on its own instead of
  // offering a button that would post the same quote twice.
  assert.equal(readiness.retry, null);
});

/**
 * Held is not in flight. The composer holds the request back while the billable
 * payload is still moving, and borrowing `requesting` for that would claim a
 * request the merchant could never see land — a request state with no request
 * behind it (#236 轮 3 P1-b).
 */
test('a held request says it is waiting for the merchant, never that it is calculating', () => {
  const readiness = resolveComposerQuoteReadiness(settled({ settling: true }));
  assert.equal(readiness.state, 'settling');
  assert.equal(readiness.message, '等你改完这句就去算这次花多少。');
  assert.notEqual(readiness.message, '正在算这次大概花多少…');
  // It ends by itself the moment they stop typing, so there is nothing to retry.
  assert.equal(readiness.retry, null);
});

test('settling never outranks a state that will not resolve by waiting', () => {
  // A failed read, a missing precondition and an already-bound price all stand
  // whatever the window is doing: none of them are 「still being written」.
  assert.equal(
    resolveComposerQuoteReadiness(settled({ settling: true, surface: 'error' }))
      .state,
    'failed'
  );
  assert.equal(
    resolveComposerQuoteReadiness(settled({ settling: true, hasModel: false }))
      .state,
    'no_model'
  );
  assert.equal(
    resolveComposerQuoteReadiness(
      settled({ settling: true, hasSignedSubmission: false })
    ).state,
    'invalid_submission'
  );
  assert.equal(
    resolveComposerQuoteReadiness(
      settled({ settling: true, hasQuoteView: true })
    ).state,
    'ready'
  );
});

test('missing preconditions outrank the quote query phase', () => {
  // The quote query is disabled precisely *because* the model is missing; the
  // merchant is told which one, not that something is being requested.
  const states = (['no_recipe', 'no_model', 'invalid_submission'] as const).map(
    (_, index) =>
      resolveComposerQuoteReadiness(
        settled({
          quote: 'disabled',
          ...(index === 0 ? { hasRecipe: false } : {}),
          ...(index === 1 ? { hasModel: false } : {}),
          ...(index === 2 ? { hasSignedSubmission: false } : {}),
        })
      ).state
  );
  assert.deepEqual(states, ['no_recipe', 'no_model', 'invalid_submission']);
});

test('the enumeration covers every reachable shape exactly once', () => {
  const reached = new Set(
    [
      settled({ lensSelected: false }),
      settled({ hasQuoteView: true }),
      settled({ surface: 'pending' }),
      settled({ surface: 'error' }),
      settled({ hasRecipe: false }),
      settled({ hasModel: false }),
      settled({ hasSignedSubmission: false }),
      settled({ settling: true }),
      settled(),
    ].map((input) => resolveComposerQuoteReadiness(input).state)
  );
  assert.deepEqual([...reached].sort(), [
    'failed',
    'idle',
    'invalid_submission',
    'loading',
    'no_model',
    'no_recipe',
    'ready',
    'requesting',
    'settling',
  ]);
});

test('a bound view survives only while it belongs to the current input', () => {
  const view = { quoteId: 'composer:s1:copy:446da3bd5a608f63', amount: 12 };

  assert.equal(currentComposerQuoteView(view, view.quoteId), view);
  // The merchant edited the sentence: quote identity moved, the old price did
  // not, and #240 P1 says the old price must stop counting as ready.
  assert.equal(
    currentComposerQuoteView(view, 'composer:s1:copy:4fd11c8c222ce6ae'),
    null
  );
  // No current input at all (a precondition dropped out) is equally not ready.
  assert.equal(currentComposerQuoteView(view, undefined), null);
  assert.equal(currentComposerQuoteView(view, null), null);
  assert.equal(currentComposerQuoteView(null, view.quoteId), null);
});

test('a stale view does not reach ready, the live state does', () => {
  // `hasQuoteView` is what the host feeds from `currentComposerQuoteView`, so a
  // stale view arrives here as false and the merchant sees the real state.
  const stale = resolveComposerQuoteReadiness(
    settled({ hasQuoteView: false, quote: 'pending' })
  );
  assert.equal(stale.state, 'requesting');

  const staleAfterConflict = resolveComposerQuoteReadiness(
    settled({ hasQuoteView: false, quote: 'error' })
  );
  assert.equal(staleAfterConflict.state, 'failed');
  assert.equal(staleAfterConflict.retry, 'quote');
});

test('a bound quote and a needs-more readiness never share the usage line', () => {
  const needsMore = resolveComposerQuoteReadiness(
    settled({ hasSignedSubmission: false, quote: 'disabled' })
  );
  assert.equal(
    needsMore.message,
    '还差一点信息才能算这次花多少，补齐后会自动更新。'
  );

  const confirmed = resolveComposerQuoteUsageLine({
    billingNote: null,
    hasQuoteView: true,
    readiness: needsMore,
    showConfirmed: true,
  });
  assert.deepEqual(confirmed, {
    kind: 'confirmed',
    text: COMPOSER_QUOTE_CONFIRMED_MESSAGE,
  });

  const waiting = resolveComposerQuoteUsageLine({
    billingNote: null,
    hasQuoteView: false,
    readiness: needsMore,
    showConfirmed: true,
  });
  assert.deepEqual(waiting, {
    kind: 'status',
    readiness: needsMore,
  });

  const hiddenForSlot = resolveComposerQuoteUsageLine({
    billingNote: null,
    hasQuoteView: true,
    readiness: needsMore,
    showConfirmed: false,
  });
  assert.equal(hiddenForSlot.kind, 'hidden');
});

test('a billing note wins over the settled-usage fallback', () => {
  const line = resolveComposerQuoteUsageLine({
    billingNote: '按生成成片 15 秒计费',
    hasQuoteView: true,
    readiness: resolveComposerQuoteReadiness(settled({ hasQuoteView: true })),
    showConfirmed: true,
  });
  assert.deepEqual(line, {
    kind: 'confirmed',
    text: '按生成成片 15 秒计费',
  });
});

test('query phase reads error before success', () => {
  assert.equal(
    composerQueryPhase({ isError: true, isSuccess: false }),
    'error'
  );
  assert.equal(
    composerQueryPhase({ isError: false, isSuccess: true }),
    'success'
  );
  assert.equal(
    composerQueryPhase({ isError: false, isSuccess: false }),
    'pending'
  );
});

test('FREE confirms a bound quote without customized source slots', () => {
  assert.equal(
    composerQuoteConfirmedForMode({
      creationMode: 'free',
      unsatisfiedRequiredSlotCount: 2,
    }),
    true
  );
  assert.equal(
    composerQuoteConfirmedForMode({
      creationMode: 'customized',
      unsatisfiedRequiredSlotCount: 1,
    }),
    false
  );
  assert.equal(
    composerQuoteConfirmedForMode({
      creationMode: 'customized',
      unsatisfiedRequiredSlotCount: 0,
    }),
    true
  );
});

test('a confirmed quote line replaces the pre-confirm credit chip', () => {
  const confirmed = resolveComposerQuoteUsageLine({
    billingNote: null,
    hasQuoteView: true,
    readiness: resolveComposerQuoteReadiness(settled({ hasQuoteView: true })),
    showConfirmed: true,
  });
  const strip = resolveComposerQuoteStrip({
    creditQuoteVisible: true,
    hasQuoteView: true,
    usage: confirmed,
  });
  assert.deepEqual(strip, {
    showCreditQuote: false,
    showQuoteLine: true,
    showStatus: false,
  });
});

test('a missing quote may speak status; it cannot mint a quote line', () => {
  const waiting = resolveComposerQuoteUsageLine({
    billingNote: null,
    hasQuoteView: false,
    readiness: resolveComposerQuoteReadiness(
      settled({ hasSignedSubmission: false, quote: 'disabled' })
    ),
    showConfirmed: true,
  });
  assert.deepEqual(
    resolveComposerQuoteStrip({
      creditQuoteVisible: true,
      hasQuoteView: false,
      usage: waiting,
    }),
    {
      showCreditQuote: false,
      showQuoteLine: false,
      showStatus: true,
    }
  );
});
