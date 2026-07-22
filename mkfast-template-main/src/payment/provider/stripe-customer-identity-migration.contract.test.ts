import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Stripe customer bindings are audited, cleared on duplicates, and uniquely indexed', async () => {
  const migration = await readFile(
    new URL(
      '../../../drizzle/0012_stripe_customer_identity_binding.sql',
      import.meta.url
    ),
    'utf8'
  );

  assert.match(
    migration,
    /CREATE TABLE IF NOT EXISTS "stripe_customer_binding_audit"/u
  );
  assert.match(
    migration,
    /INSERT INTO "stripe_customer_binding_audit"[\s\S]*'duplicate_customer_id'/u
  );
  assert.match(
    migration,
    /UPDATE "user"[\s\S]*SET "customer_id" = NULL[\s\S]*WHERE "customer_id" IS NOT NULL/u
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS "user_customer_id_uidx"[\s\S]*WHERE "customer_id" IS NOT NULL/u
  );
  assert.doesNotMatch(migration, /DELETE FROM "user"/u);
});

test('the auth schema declares the same partial unique customer binding index', async () => {
  const schema = await readFile(
    new URL('../../db/auth.schema.ts', import.meta.url),
    'utf8'
  );

  assert.match(schema, /uniqueIndex\('user_customer_id_uidx'\)/u);
  assert.match(schema, /\.where\(sql`\$\{table\.customerId\} IS NOT NULL`\)/u);
});
