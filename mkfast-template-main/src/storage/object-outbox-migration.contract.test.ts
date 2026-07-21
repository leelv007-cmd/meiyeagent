import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('storage deletion has a tombstone and durable recovery migration', async () => {
  const migration = await readFile(
    new URL('../../drizzle/0008_storage_object_outbox.sql', import.meta.url),
    'utf8'
  );
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "deleted_at"/u);
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "purpose" text DEFAULT 'private_file' NOT NULL/u
  );
  assert.match(
    migration,
    /CREATE TABLE IF NOT EXISTS "storage_object_outbox"/u
  );
  assert.match(migration, /"claim_token" text/u);
  assert.match(migration, /"available_at" timestamp with time zone/u);
});
