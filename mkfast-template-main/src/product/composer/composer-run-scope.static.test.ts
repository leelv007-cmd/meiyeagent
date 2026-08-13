import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const home = readFileSync(
  fileURLToPath(new URL('./composer-home.tsx', import.meta.url)),
  'utf8'
);

/**
 * The handle is the tab's memory of a run it holds. A recovery unbinds it, and
 * if sessionStorage kept the old one the next reload would restore the run the
 * merchant just walked away from — stream, poll and 申报 with it (轮 5 P1-①).
 */
test('an unbound composer stops remembering the run it used to hold', () => {
  assert.match(
    home,
    /if \(!session\.task\) \{[\s\S]*?store\.removeItem\(sessionKey\);[\s\S]*?\}/u
  );
});

/**
 * 再生成一次 continues the conversation it recovered from. Overwriting it with a
 * fresh session would take the 交付卡 of a partial delivery with it — the part
 * that did land, and the reason that entry is offered at all.
 */
test('retry keeps what the recovery deliberately left standing', () => {
  const recovery = home.slice(
    home.indexOf('const recoverFromReport'),
    home.indexOf('const handleBriefConfirm')
  );
  const retryCase = recovery.slice(
    recovery.indexOf("case 'retry':"),
    recovery.indexOf("case 'adjust_intent':")
  );
  assert.ok(retryCase.length > 0, 'retry case must exist');
  assert.doesNotMatch(retryCase, /createComposerSession/u);
  assert.match(retryCase, /setRetryAfterReport\(true\);/u);
});

/**
 * 再生成一次 keeps the sentence and the model, so the server prices it at the
 * revision already bound while the quote id moves with the new session. The
 * gate compares ids, so the bind has to as well — otherwise the recovery ends
 * on a send button that is disabled forever with nothing explaining why.
 */
test('the bound price is replaced when quote identity moves, not only its revision', () => {
  assert.match(
    home,
    /lensState\.draft\.quoteRevisionId === nextView\.revision &&\s*lensState\.draft\.quoteView\?\.quoteId === nextView\.quoteId/u
  );
});

/**
 * Adopting a server-side run is a mount-time decision. Once the merchant takes
 * the conversation over from a 申报, an unbound session must not read as an
 * empty tab inviting some other in-flight run in mid-edit.
 */
test('taking over from a 申报 closes the mount-time restore', () => {
  const recovery = home.slice(
    home.indexOf('const recoverFromReport'),
    home.indexOf('const handleBriefConfirm')
  );
  assert.ok(recovery.length > 0, 'recovery handler must exist');
  assert.match(recovery, /restoredFromServerRef\.current = true;/u);
  assert.match(
    recovery,
    /rebindComposerSession\(current, sessionIdRef\.current\)/u
  );
});

test('completed recommendation prefill rebinds a new run before applying the handoff', () => {
  const start = home.indexOf('<DashboardHomeSurface');
  const directRefreshEnd = home.indexOf('onRefresh={product.refresh}', start);
  const wrappedRefreshEnd = home.indexOf('onRefresh={async () => {', start);
  const refreshEnds = [directRefreshEnd, wrappedRefreshEnd].filter(
    (value) => value > start
  );
  const end = refreshEnds.length > 0 ? Math.min(...refreshEnds) : -1;
  const prefill = home.slice(start, end);
  const newSession = prefill.indexOf('newComposerSessionId()');
  const rebind = prefill.indexOf('rebindComposerSession(');
  const handoff = prefill.indexOf('applyRecommendationHandoffWithRecipe({');

  assert.ok(start >= 0 && end > start, 'recommendation prefill must exist');
  assert.ok(newSession >= 0, 'completed prefill must mint a new session');
  assert.ok(
    rebind > newSession,
    'the new session must be rebound after minting'
  );
  assert.ok(
    handoff > rebind,
    'rebind must happen before the handoff is applied'
  );
  assert.match(prefill, /state: reopenComposer\(current\)/u);
});

test('only terminal success refreshes the current task experience query', () => {
  const start = home.indexOf("workflowStream.workflowState !== 'success' &&");
  const end = home.indexOf('\n  useEffect(() => {', start + 1);
  const terminal = home.slice(start, end);

  assert.ok(start >= 0 && end > start, 'terminal cleanup effect must exist');
  assert.match(terminal, /setViralAdaptBinding\(null\)/u);
  assert.match(
    terminal,
    /if \(workflowStream\.workflowState === 'success'\) \{[\s\S]*?invalidateQueries\(\{[\s\S]*?queryKey: experienceEntriesQueryKey/u
  );
  assert.equal(
    (terminal.match(/queryKey: experienceEntriesQueryKey/gu) ?? []).length,
    1
  );
});

test('recipe selection clears the run-scoped viral source before replacing lens state', () => {
  const start = home.indexOf('<RecipeCardsPanel');
  const end = home.indexOf('surface={surfaceQuery.data}', start);
  const selection = home.slice(start, end);

  assert.ok(start >= 0 && end > start, 'recipe selection callback must exist');
  assert.match(selection, /setViralAdaptBinding\(null\)/u);
  assert.match(selection, /cancelViralAdaptJourney\(current\)/u);
  assert.match(selection, /setLensState\(next\)/u);
});
