import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

describe('credit billing production assembly', () => {
  for (const entrypoint of ['main.ts', 'job-worker.ts']) {
    it(`${entrypoint} keeps legacy lots out of merchant metering`, async () => {
      const source = await readFile(
        new URL('../../assembly/core-assembly.ts', import.meta.url),
        'utf8'
      );
      assert.match(source, /new PostgresGrantLotLedger\(pool\)/);
      assert.match(
        source,
        /new PostgresCreditLedger\(pool\)/,
      );
      assert.match(
        source,
        /new CreditSubscriptionEntitlementPolicy\(\s*creditSubscriptionStore,\s*creditPlanCatalog/s,
      );
      assert.match(
        source,
        /new FoundationModelSupplyLedger\(\s*foundation(?:LedgerService)?,\s*executionEntitlementPolicy,\s*undefined,\s*\{[\s\S]*?productUsage:\s*billingLifecycle/s,
      );
      assert.doesNotMatch(
        source,
        /new FoundationModelSupplyLedger\(\s*foundation(?:LedgerService)?,\s*executionEntitlementPolicy,\s*grantLotLedger/s,
      );
      assert.match(
        source,
        /migratePostgresSchema\(pool, \[[\s\S]*?grantLotLedger,[\s\S]*?creditLedger,/
      );
    });
  }

  it('main.ts keeps both P0 ProductService assemblies billing-read-only', async () => {
    const source = await readFile(
      new URL('../../assembly/core-assembly.ts', import.meta.url),
      'utf8'
    );
    assert.equal(source.match(/legacyBillingReadOnly:\s*true/g)?.length, 2);
  });
});
