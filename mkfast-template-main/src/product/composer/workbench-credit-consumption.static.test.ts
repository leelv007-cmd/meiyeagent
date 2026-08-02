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

  assert.match(source, /projectWorkbenchCreditBalance/u);
  assert.match(source, /projectWorkbenchCreditQuote/u);
  assert.match(source, /projectWorkbenchCreditShortfall/u);
  assert.match(source, /data-testid="workbench-credit-balance"/u);
  assert.match(source, /data-testid="workbench-credit-quote"/u);
  assert.match(source, /data-testid="workbench-credit-shortfall"/u);
  assert.match(source, /to="\/settings\/credits"/u);
  assert.match(source, /to="\/pricing"/u);
  assert.match(
    source,
    /const quotaBlocked = legacyQuotaBlocked \|\| workbenchCreditShortfall\.visible/u
  );
  assert.match(source, /submitDisabled=\{[\s\S]*?quotaBlocked\s+\|\|/u);
  assert.match(
    source,
    /if \(quotaBlocked\) \{\s+setSubmissionQuotaBlocked\(true\);/u
  );
  assert.doesNotMatch(
    creditSource,
    /confirmedAmount|authorizedCeiling|unitRate|currency|provider|token|usd/iu
  );
});
