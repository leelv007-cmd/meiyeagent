import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('shared asset cleanup claim migration persists object identity and receipt revision', async () => {
  const migration = await readFile(
    new URL(
      '../../drizzle/0013_storage_object_cleanup_claims.sql',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "storage_revision" text/u);
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "receipt_storage_revision" text/u
  );
  assert.match(
    migration,
    /CREATE TABLE IF NOT EXISTS "storage_object_cleanup_claims"/u
  );
  assert.match(migration, /PRIMARY KEY \("workspace_id", "object_key"\)/u);
  assert.match(migration, /'deleting'/u);
  assert.match(migration, /'registration_recovered'/u);
});
