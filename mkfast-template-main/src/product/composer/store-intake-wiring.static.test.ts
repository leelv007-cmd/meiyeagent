import assert from 'node:assert/strict';
import test from 'node:test';

import {
  equalityTargets,
  hasCall,
  identifiers,
  jsxOf,
  literals,
  parseProductionSource,
  parseSourceText,
} from '../../test-support/ast-boundary';

const progressiveFact = parseProductionSource(
  new URL('./progressive-fact.ts', import.meta.url)
);
const storeRoute = parseProductionSource(
  new URL('../../routes/dashboard/store.tsx', import.meta.url)
);
const composerHome = parseProductionSource(
  new URL('./composer-home.tsx', import.meta.url)
);
const progressiveFactCard = parseProductionSource(
  new URL('./progressive-fact-card.tsx', import.meta.url)
);
const storeIntakeWizard = parseProductionSource(
  new URL('../store-intake/store-intake-wizard.tsx', import.meta.url)
);

test('pre-fix confirm_store finalizer fails the intake boundary', () => {
  const preFix = parseSourceText(
    'pre-fix.ts',
    `export const command = { action: 'confirm_store' };`
  );
  assert.ok(literals(preFix).includes('confirm_store'));
});

test('progressive store intake uses one finalizer instead of legacy profile writes', () => {
  assert.ok(literals(progressiveFact).includes('finalize_store_intake'));
  assert.equal(literals(progressiveFact).includes('confirm_store'), false);
});

test('the store profile is read-only after the W01 manual form retirement', () => {
  assert.ok(literals(storeRoute).includes('store_facts_active'));
  assert.ok(identifiers(storeRoute).has('dashboard_store_profile_title'));
  assert.equal(literals(storeRoute).includes('confirm_store'), false);
  assert.equal(literals(storeRoute).includes('save_store_draft'), false);
  assert.equal(jsxOf(storeRoute, 'details').length, 0);
  assert.equal(
    identifiers(storeRoute).has('dashboard_store_save_failed'),
    false
  );
  assert.ok(
    equalityTargets(storeRoute).some(
      (pair) => pair.left === 'search.tab' && pair.right === 'qualification'
    )
  );
});

test('the store route keeps the qualification admission entry', () => {
  assert.ok(jsxOf(storeRoute, 'QualificationForm').length >= 1);
  assert.ok(literals(storeRoute).includes('confirm_qualification'));
  assert.ok(literals(storeRoute).includes('store-qualification'));
});

test('Composer qualification gap links to the store admission entry', () => {
  assert.ok(
    jsxOf(composerHome, 'Link').some(
      (element) => element.attrs.hash === 'store-qualification'
    )
  );
});

test('Composer mounts the Day-0 reminder, and it carries no intake of its own', () => {
  assert.ok(jsxOf(composerHome, 'ProgressiveFactCard').length >= 1);
  assert.ok(literals(composerHome).includes('store_fact_history'));
  assert.ok(literals(composerHome).includes('progressive-fact-ledger-retry'));
  assert.equal(literals(composerHome).includes('asset-memory'), false);
  assert.equal(
    hasCall(progressiveFactCard, 'buildFinalizeStoreIntakeCommand'),
    false
  );
  assert.equal(jsxOf(progressiveFactCard, 'Input').length, 0);
  assert.equal(jsxOf(progressiveFactCard, 'Button').length, 0);
  assert.ok(
    jsxOf(progressiveFactCard, 'Link').some(
      (element) => element.attrs.to === '/dashboard/store'
    )
  );
  assert.equal(
    hasCall(storeIntakeWizard, 'buildFinalizeStoreIntakeCommand'),
    true
  );
});
