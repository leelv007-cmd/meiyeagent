import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('assisted account creation records one immutable database audit', async () => {
  const migration = await readFile(
    new URL(
      '../../drizzle/0015_admin_assisted_account_audit.sql',
      import.meta.url
    ),
    'utf8'
  );

  assert.match(
    migration,
    /CREATE TABLE IF NOT EXISTS "admin_assisted_account_audit"/u
  );
  assert.match(
    migration,
    /AFTER INSERT ON "user"[\s\S]*record_admin_assisted_account_audit/u
  );
  assert.match(migration, /NEW\."provisioned_by_user_id" IS NOT NULL/u);
  assert.match(
    migration,
    /UNIQUE\s*\("subject_user_id"\)|UNIQUE INDEX[\s\S]*"subject_user_id"/u
  );
  assert.match(
    migration,
    /BEFORE UPDATE OR DELETE ON "admin_assisted_account_audit"/u
  );
  assert.match(migration, /ADMIN_ASSISTED_ACCOUNT_AUDIT_IMMUTABLE/u);
  assert.match(
    migration,
    /INSERT INTO "admin_assisted_account_audit"[\s\S]*SELECT[\s\S]*FROM "user"[\s\S]*"provisioned_by_user_id" IS NOT NULL/u
  );
});

test('Better Auth never returns the internal provisioning actor id', async () => {
  const authSource = await readFile(
    new URL('./auth.ts', import.meta.url),
    'utf8'
  );

  assert.match(
    authSource,
    /provisionedByUserId:\s*\{[\s\S]*input:\s*false,[\s\S]*returned:\s*false,/u
  );
});
