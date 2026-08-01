import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const home = readFileSync(
  fileURLToPath(new URL('./composer-home.tsx', import.meta.url)),
  'utf8'
);

/**
 * 一次运行一套真相 (W03 recovery / ADR-0014).
 *
 * The event stream, the pending-question poll and the workflow query keys all
 * hang off the session's own task handle. A recovery entry unbinds that handle
 * (rebindComposerSession), and these are what stop the finished run from
 * streaming into the conversation the merchant is now rewriting.
 */
test('the composer only listens to the run its session currently holds', () => {
  assert.match(home, /const taskId = session\.task\?\.taskId \?\? '';/u);
  assert.match(
    home,
    /useWorkflowEventStream\(\{\s*enabled: Boolean\(taskId\),\s*workflowId: taskId,/u
  );
  assert.match(
    home,
    /enabled: Boolean\(taskId\) && session\.phase !== 'delivered'/u
  );
  // `enabled` only decides whether the poll runs; what it *asks about* is the
  // queryFn's argument, and a poll enabled on the current handle while reading
  // a remembered one would keep answering for the finished run.
  assert.match(
    home,
    /queryFn: \(\{ signal \}\) => readPendingHarnessDecision\(taskId, signal\)/u
  );
  assert.match(home, /queryKey: decisionQueryKey/u);
  assert.match(home, /\['harness', 'decision', taskId\] as const/u);
  assert.match(home, /\['harness', 'workflow', taskId\] as const/u);
  // The stream is never pointed at anything but that handle — no URL taskId, no
  // remembered id from a run that already ended.
  assert.doesNotMatch(home, /workflowId: (?!taskId)[A-Za-z]/u);
});

test('experience basis is bound to the current workflow carrier, not workspace selectors', () => {
  const projectionStart = home.indexOf('const experienceBasis = useMemo');
  const projectionEnd = home.indexOf('useEffect', projectionStart);
  const projection = home.slice(projectionStart, projectionEnd);

  assert.ok(projectionStart >= 0, 'experience basis projection must exist');
  assert.match(projection, /workflowStream\.harnessExperienceBasis/u);
  assert.doesNotMatch(projection, /identitySelection/u);
  assert.doesNotMatch(projection, /experienceEntriesQuery/u);
});

/**
 * The handle is the tab's memory of a run it holds. A recovery unbinds it, and
 * if sessionStorage kept the old one the next reload would restore the run the
 * merchant just walked away from — stream, poll and 申报 with it (轮 5 P1-①).
 */
test('an unbound composer stops remembering the run it used to hold', () => {
  assert.match(
    home,
    /if \(!persisted\) \{[\s\S]*?store\.removeItem\(COMPOSER_SESSION_STORAGE_KEY\);[\s\S]*?\}/u
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
    home.indexOf('const attemptSubmit')
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
 * The settle window is the one waiting state the merchant can end themselves,
 * so it is the one state without a price where the send button stays live:
 * pressing it flushes the window and asks for the price now. Disabling it there
 * would make the click that resolves the wait the one click they cannot make.
 */
test('send stays pressable while the quote is only being held back', () => {
  assert.match(
    home,
    /lensId != null && !currentQuoteView && !quoteSettling/u,
    'the submit gate must exempt the settle window'
  );
  const submit = home.slice(
    home.indexOf('const attemptSubmit'),
    home.indexOf('const groundingBlocker')
  );
  assert.ok(submit.length > 0, 'submit handler must exist');
  // …and pressing it there ends the window rather than raising a hint about
  // something the merchant did not get wrong.
  assert.match(submit, /if \(quoteSettling\) \{\s*\/\//u);
  assert.match(submit, /flushQuoteSettle\(\);/u);
  // The press is also remembered. A flush on its own would move a status line
  // and nothing else, so the first press would be one the merchant has to
  // repeat — a dead press by any other name.
  assert.match(submit, /armedQuoteIdRef\.current = quoteId;/u);
  // …and it only stands inside the quote context it was made in. Any other id —
  // including none at all, after a lens switch — expires it, or a press held
  // across the gap would fire on a quote id that came back around.
  assert.match(
    home,
    /if \(quoteId !== armed\) \{[\s\S]*?armedQuoteIdRef\.current = null;\s*return;\s*\}/u
  );
  assert.doesNotMatch(home, /if \(quoteId !== null\) armedQuoteIdRef/u);
  assert.match(
    home,
    /const handleLensChange[\s\S]*?armedQuoteIdRef\.current = null;[\s\S]*?selectLens/u
  );
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
    home.indexOf('const attemptSubmit')
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
  const end = home.indexOf('onRefresh={product.refresh}', start);
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
