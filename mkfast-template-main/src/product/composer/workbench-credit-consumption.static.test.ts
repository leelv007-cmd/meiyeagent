import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('workbench consumes the backend credit balance and quote through all three surfaces', async () => {
  const source = await readFile(
    new URL('./composer-home.tsx', import.meta.url),
    'utf8'
  );
  const creditSource = await readFile(
    new URL('./workbench-credit.ts', import.meta.url),
    'utf8'
  );
  const navigationSource = await readFile(
    new URL('./credit-purchase-navigation.ts', import.meta.url),
    'utf8'
  );

  assert.match(source, /projectWorkbenchCreditBalance/u);
  assert.match(source, /projectWorkbenchCreditQuote/u);
  assert.match(source, /projectWorkbenchCreditShortfall/u);
  // The topbar balance is no longer a capsule of this file's own: it is handed
  // to the shell's single credits entry, which prints it and carries the same
  // handle (dashboard-header.tsx). Two assertions, because "composer stopped
  // rendering it" and "the shell renders it" are separate ways to break.
  const header = await readFile(
    new URL('../../components/layout/dashboard-header.tsx', import.meta.url),
    'utf8'
  );
  assert.match(source, /creditsSummary=\{/u);
  assert.match(source, /workbenchCreditBalance\.visible/u);
  // Conditional attribute, so the handle appears as a string literal rather
  // than as `data-testid="…"`: it is only set when a balance was handed in.
  assert.match(header, /'workbench-credit-topbar-balance'/u);
  assert.match(source, /data-testid="workbench-credit-quote"/u);
  assert.match(source, /data-testid="workbench-credit-shortfall"/u);
  assert.match(source, /data-testid="workbench-credit-shortfall-alert"/u);
  assert.equal(
    source.match(/<WorkbenchCreditPurchaseActions\s*\/>/gu)?.length,
    2
  );
  assert.match(
    navigationSource,
    /booster:\s*\{\s*to:\s*'\/pricing',\s*hash:\s*'credit-boosters'\s*\}/u
  );
  assert.match(
    navigationSource,
    /upgrade:\s*\{\s*to:\s*'\/pricing',\s*hash:\s*'subscription-plans'\s*\}/u
  );
  assert.match(
    source,
    /const quotaBlocked = legacyQuotaBlocked \|\| workbenchCreditShortfall\.visible/u
  );
  assert.match(source, /submitDisabled=\{[\s\S]*?quotaBlocked\s+\|\|/u);
  assert.match(
    source,
    /\{legacyQuotaBlocked && !workbenchCreditShortfall\.visible \? \(\s+<ComposerCreditRecoveryHost/u
  );
  assert.doesNotMatch(
    source,
    /\{quotaBlocked \? \(\s+<ComposerCreditRecoveryHost/u
  );
  assert.doesNotMatch(
    creditSource,
    /confirmedAmount|authorizedCeiling|unitRate|currency|provider|token|usd/iu
  );
});
