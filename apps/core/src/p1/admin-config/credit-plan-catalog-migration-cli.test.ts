import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  creditPlanCatalogMigrationCliUsage,
  parseCreditPlanCatalogMigrationCliArguments,
} from './credit-plan-catalog-migration-cli.js';

test('credit plan migration command keeps dry-run read-only and requires CAS for writes', () => {
  assert.deepEqual(parseCreditPlanCatalogMigrationCliArguments(['dry-run']), {
    action: 'dry-run',
  });
  assert.deepEqual(
    parseCreditPlanCatalogMigrationCliArguments(['--', 'dry-run']),
    { action: 'dry-run' }
  );
  assert.deepEqual(
    parseCreditPlanCatalogMigrationCliArguments([
      'apply',
      'plan.credits.starter',
      '4',
    ]),
    {
      action: 'apply',
      expectedRevision: 4,
      key: 'plan.credits.starter',
    }
  );
  assert.deepEqual(
    parseCreditPlanCatalogMigrationCliArguments([
      'rollback',
      'plan.credits.starter',
      '5',
      '4',
    ]),
    {
      action: 'rollback',
      expectedRevision: 5,
      key: 'plan.credits.starter',
      targetRevision: 4,
    }
  );
  assert.throws(
    () =>
      parseCreditPlanCatalogMigrationCliArguments([
        'apply',
        'plan.credits.starter',
      ]),
    /expected revision/i
  );
  assert.throws(
    () =>
      parseCreditPlanCatalogMigrationCliArguments([
        'apply',
        'plan.credits.reference_numbers',
        '4',
      ]),
    /unknown migration key/i
  );
  assert.match(creditPlanCatalogMigrationCliUsage, /dry-run/u);
  assert.match(creditPlanCatalogMigrationCliUsage, /expected-revision/u);
});

test('migration CLI awaits database work before pool cleanup and never bootstraps catalog state', async () => {
  const source = await readFile(
    new URL('./credit-plan-catalog-migration-cli.ts', import.meta.url),
    'utf8'
  );

  assert.match(
    source,
    /return await previewCreditPlanCatalogCurrencyToHkdMigration\(repository\)/u
  );
  assert.match(
    source,
    /return await applyCreditPlanCatalogCurrencyToHkdMigration\(repository,/u
  );
  assert.match(
    source,
    /return await rollbackCreditPlanCatalogCurrencyToHkdMigration\(repository,/u
  );
  assert.doesNotMatch(source, /repository\.migrate\(/u);
});
