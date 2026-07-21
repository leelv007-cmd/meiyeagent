import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('legacy avatar migration claims only uniquely referenced strict historical URLs', async () => {
  const migration = await readFile(
    new URL(
      '../../drizzle/0011_storage_legacy_avatar_and_canvas_recovery.sql',
      import.meta.url
    ),
    'utf8'
  );

  assert.match(
    migration,
    /CREATE TABLE IF NOT EXISTS "legacy_avatar_access_claims"/u
  );
  assert.match(migration, /HAVING count\(\*\) = 1/u);
  assert.match(migration, /pro_studio_asset_deletion_outbox/u);
  assert.match(migration, /'orphan_compensation'/u);
  assert.doesNotMatch(migration, /LIKE 'avatars\/%'/u);
});
