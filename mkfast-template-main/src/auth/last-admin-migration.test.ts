import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('database migration serializes and rejects deletion or demotion of the final admin', async () => {
  const migration = await readFile(
    new URL('../../drizzle/0002_last_admin_guard.sql', import.meta.url),
    'utf8'
  );

  assert.match(migration, /pg_advisory_xact_lock/u);
  assert.match(migration, /OLD\."role" = 'admin'/u);
  assert.match(migration, /NEW\."role" IS DISTINCT FROM 'admin'/u);
  assert.match(migration, /BEFORE DELETE OR UPDATE OF "role" ON "user"/u);
  assert.match(migration, /LAST_ADMIN_REQUIRED/u);
});
