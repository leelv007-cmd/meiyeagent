import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('plan checkout migrations freeze the exact commerce authority', async () => {
  const [migration, creditsMigration, journal] = await Promise.all([
    readFile(
      new URL(
        '../../drizzle/0026_plan_checkout_commerce_authority.sql',
        import.meta.url
      ),
      'utf8'
    ),
    readFile(
      new URL(
        '../../drizzle/0027_plan_checkout_frozen_credits.sql',
        import.meta.url
      ),
      'utf8'
    ),
    readFile(
      new URL('../../drizzle/meta/_journal.json', import.meta.url),
      'utf8'
    ),
  ]);
  for (const column of [
    'commerce_plan_revision',
    'commerce_payment_mapping_revision',
    'commerce_amount_micros',
    'commerce_currency',
    'commerce_tier',
    'commerce_period',
    'commerce_billing_period',
  ]) {
    assert.match(migration, new RegExp(`"${column}"`, 'u'));
  }
  assert.match(journal, /0026_plan_checkout_commerce_authority/u);
  assert.match(creditsMigration, /"commerce_credits"/u);
  assert.match(journal, /0027_plan_checkout_frozen_credits/u);
});
