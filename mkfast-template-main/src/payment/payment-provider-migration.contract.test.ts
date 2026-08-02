import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('payment persistence records the provider with an additive migration', async () => {
  const migration = await readFile(
    new URL('../../drizzle/0016_good_bastion.sql', import.meta.url),
    'utf8'
  );

  assert.match(migration, /ALTER TABLE "payment" ADD COLUMN "provider" text/u);
  assert.match(migration, /CREATE INDEX "payment_provider_idx" ON "payment"/u);
});
