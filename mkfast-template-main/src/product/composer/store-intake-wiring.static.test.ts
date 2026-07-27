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

test('progressive store intake uses one finalizer instead of legacy profile writes', () => {
  assert.match(progressiveFact, /finalize_store_intake/u);
  assert.doesNotMatch(progressiveFact, /confirm_store/u);
});

test('the store route is read-only after the W01 manual form retirement', () => {
  assert.match(storeRoute, /store_facts_active/u);
  assert.match(storeRoute, /dashboard_store_profile_title/u);
  assert.doesNotMatch(storeRoute, /confirm_store|save_store_draft/u);
  assert.doesNotMatch(storeRoute, /<details|<TextField|QualificationForm/u);
  assert.doesNotMatch(
    storeRoute,
    /dashboard_store_save_failed|store_save_failed_description/u
  );
  assert.match(storeRoute, /search\.tab === 'qualification'/u);
  assert.match(storeRoute, /to:\s*Routes\.StoreProfile,\s*search:\s*\{\}/u);
});

test('Composer mounts the card and submits exactly one finalizer command', () => {
  assert.match(composerHome, /<ProgressiveFactCard/u);
  assert.match(composerHome, /store_fact_history/u);
  assert.equal(
    composerHome.match(
      /commandP1\(\s*'asset-memory',\s*request,\s*idempotencyKey\s*\)/gu
    )?.length,
    1
  );
  assert.match(progressiveFactCard, /buildFinalizeStoreIntakeCommand/u);
  assert.match(progressiveFactCard, /progressive-fact-retry/u);
  assert.match(composerHome, /progressive-fact-ledger-retry/u);
});
