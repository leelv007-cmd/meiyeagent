import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

describe('grant-lot production assembly', () => {
  for (const entrypoint of ['main.ts', 'job-worker.ts']) {
    it(`${entrypoint} wires grants, usage, refunds, and migration to Postgres`, async () => {
      const source = await readFile(
        new URL(`../../${entrypoint}`, import.meta.url),
        'utf8'
      );
      assert.match(source, /new PostgresGrantLotLedger\(pool\)/);
      assert.match(
        source,
        /new GrantLotAwareProductEntitlementService\(\s*foundationRepository,\s*grantLotLedger/s
      );
      assert.match(
        source,
        entrypoint === 'main.ts'
          ? /new GrantLotAwareProductEntitlementService\(\s*foundationRepository,\s*grantLotLedger,\s*recordedCommerceEnabled\s*\?\s*new RecordedAutoTopUpPaymentPort\(\)\s*:\s*undefined,\s*undefined,\s*productQuoteService\s*\)/s
          : /new GrantLotAwareProductEntitlementService\(\s*foundationRepository,\s*grantLotLedger,\s*undefined,\s*undefined,\s*billingLifecycle\s*\)/s
      );
      assert.match(
        source,
        /new FoundationModelSupplyLedger\(\s*foundation(?:LedgerService)?,\s*executionEntitlementPolicy,\s*grantLotLedger/s
      );
      assert.match(
        source,
        /migratePostgresSchema\(pool, \[[\s\S]*?foundationRepository,[\s\S]*?grantLotLedger,/
      );
    });
  }

  it('main.ts reads the Product copy quota from the grant-aware projection', async () => {
    const source = await readFile(new URL('../../main.ts', import.meta.url), 'utf8');
    assert.match(
      source,
      /productEntitlements\.getProjection\([\s\S]*?projection\.usage\.copy\.available/
    );
  });
});
