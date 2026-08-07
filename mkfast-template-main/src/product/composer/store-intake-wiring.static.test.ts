import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const progressiveFact = readFileSync(
  new URL('./progressive-fact.ts', import.meta.url),
  'utf8'
);
const storeRoute = readFileSync(
  new URL('../../routes/dashboard/store.tsx', import.meta.url),
  'utf8'
);
const composerHome = readFileSync(
  new URL('./composer-home.tsx', import.meta.url),
  'utf8'
);
const progressiveFactCard = readFileSync(
  new URL('./progressive-fact-card.tsx', import.meta.url),
  'utf8'
);
const storeIntakeWizard = readFileSync(
  new URL('../store-intake/store-intake-wizard.tsx', import.meta.url),
  'utf8'
);

test('progressive store intake uses one finalizer instead of legacy profile writes', () => {
  assert.match(progressiveFact, /finalize_store_intake/u);
  assert.doesNotMatch(progressiveFact, /confirm_store/u);
});

test('the store profile is read-only after the W01 manual form retirement', () => {
  assert.match(storeRoute, /store_facts_active/u);
  assert.match(storeRoute, /dashboard_store_profile_title/u);
  assert.doesNotMatch(storeRoute, /confirm_store|save_store_draft/u);
  assert.doesNotMatch(storeRoute, /<details/u);
  assert.doesNotMatch(
    storeRoute,
    /dashboard_store_save_failed|store_save_failed_description/u
  );
  assert.match(storeRoute, /search\.tab === 'qualification'/u);
  assert.match(storeRoute, /to:\s*Routes\.StoreProfile,\s*search:\s*\{\}/u);
});

/*
 * D-151④ retired the manual *store profile* form. The regulated-category
 * admission gate is a different mechanism and stayed in scope: this route is the
 * only web entry for `confirm_qualification`.
 */
test('the store route keeps the qualification admission entry', () => {
  assert.match(storeRoute, /<QualificationForm/u);
  assert.match(storeRoute, /type: 'confirm_qualification'/u);
  assert.match(storeRoute, /id="store-qualification"/u);
});

test('Composer qualification gap links to the store admission entry', () => {
  assert.match(composerHome, /hash="store-qualification"/u);
});

/*
 * D-C4: the idle screen keeps one input surface. The Day-0 card stopped being
 * an intake — no field, no finalizer — and became a reminder pointing at the
 * store page, where the same projection and the same `finalize_store_intake`
 * command still run inside the wizard.
 */
test('Composer mounts the Day-0 reminder, and it carries no intake of its own', () => {
  assert.match(composerHome, /<ProgressiveFactCard/u);
  assert.match(composerHome, /store_fact_history/u);
  assert.match(composerHome, /progressive-fact-ledger-retry/u);
  assert.equal(
    composerHome.match(
      /commandP1\(\s*'asset-memory',\s*request,\s*idempotencyKey\s*\)/gu
    )?.length,
    undefined
  );
  assert.doesNotMatch(progressiveFactCard, /buildFinalizeStoreIntakeCommand/u);
  assert.doesNotMatch(progressiveFactCard, /<Input|<Button/u);
  assert.match(progressiveFactCard, /to="\/dashboard\/store"/u);
  assert.match(storeIntakeWizard, /buildFinalizeStoreIntakeCommand/u);
});
