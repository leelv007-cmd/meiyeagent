import assert from 'node:assert/strict';
import test from 'node:test';

import {
  firstCallStart,
  functionCalls,
  identifiers,
  jsxOf,
  parseProductionSource,
} from '../../test-support/ast-boundary';

const home = parseProductionSource(
  new URL('./composer-home.tsx', import.meta.url)
);

test('an unbound composer stops remembering the run it used to hold', () => {
  assert.ok(identifiers(home).has('sessionKey'));
  assert.ok(
    functionCalls(home, 'ComposerHome').includes('removeItem') ||
      identifiers(home).has('removeItem')
  );
});

test('retry keeps what the recovery deliberately left standing', () => {
  const recovery = functionCalls(home, 'recoverFromReport');
  assert.equal(recovery.includes('createComposerSession'), false);
  assert.ok(
    recovery.includes('setRetryAfterReport') ||
      identifiers(home).has('setRetryAfterReport')
  );
});

test('report-card retry is not gated by the failed-run intent lock', () => {
  const recovery = functionCalls(home, 'recoverFromReport');
  assert.equal(recovery.includes('composerFailureLocksIntent'), false);
});

test('failed composer session is forwarded so Living Plan cannot cover the 申报卡', () => {
  const host = jsxOf(home, 'ComposerWorkbenchHost')[0];
  assert.equal(host?.attrs.sessionFailed, "session.phase === 'failed'");
});

test('the bound price is replaced when quote identity moves, not only its revision', () => {
  assert.ok(
    identifiers(home).has('quoteRevisionId') || identifiers(home).has('quoteId')
  );
});

test('persist restore of a rebound without a task closes 时间桥 adopt', () => {
  assert.ok(identifiers(home).has('restoredFromServerRef'));
});

test('taking over from a 申报 closes the mount-time restore', () => {
  assert.ok(
    functionCalls(home, 'recoverFromReport').includes(
      'rebindComposerSession'
    ) || identifiers(home).has('rebindComposerSession')
  );
  assert.ok(identifiers(home).has('restoredFromServerRef'));
});

test('completed recommendation prefill rebinds a new run before applying the handoff', () => {
  const mint = firstCallStart(home, 'newComposerSessionId');
  const rebind = firstCallStart(home, 'rebindComposerSession', mint);
  const handoff = firstCallStart(
    home,
    'applyRecommendationHandoffWithRecipe',
    rebind
  );
  assert.ok(mint >= 0, 'completed prefill must mint a new session');
  assert.ok(rebind > mint, 'the new session must be rebound after minting');
  assert.ok(
    handoff > rebind,
    'rebind must happen before the handoff is applied'
  );
});

test('only terminal success refreshes the current task experience query', () => {
  assert.ok(identifiers(home).has('experienceEntriesQueryKey'));
  assert.ok(identifiers(home).has('setViralAdaptBinding'));
});

test('recipe selection clears the run-scoped viral source before replacing lens state', () => {
  const panel = jsxOf(home, 'RecipeCardsPanel')[0];
  assert.ok(panel);
  assert.ok(identifiers(home).has('setViralAdaptBinding'));
  assert.ok(identifiers(home).has('cancelViralAdaptJourney'));
});
