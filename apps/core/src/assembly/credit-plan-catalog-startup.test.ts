import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('production assembly validates the published credit catalog without boot-time mutation', async () => {
  const source = await readFile(
    new URL('./core-assembly.ts', import.meta.url),
    'utf8'
  );

  assert.match(
    source,
    /await assertPublishedCreditPlanCatalogAtStartup\(creditPlanCatalog\)/u
  );
  assert.doesNotMatch(source, /ensureCreditPlanCatalogDefaults/u);
  assert.doesNotMatch(source, /migrateCreditPlanCatalogCurrencyToHkd/u);
});
