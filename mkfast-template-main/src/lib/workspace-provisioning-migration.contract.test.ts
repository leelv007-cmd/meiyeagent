import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('claim fencing has a forward migration for databases that already applied outbox v1', async () => {
  const migration = await readFile(
    new URL(
      '../../drizzle/0006_workspace_provision_claim_fencing.sql',
      import.meta.url
    ),
    'utf8'
  );

  assert.match(
    migration,
    /ALTER TABLE "workspace_provisioning_outbox"[\s\S]*ADD COLUMN IF NOT EXISTS "claim_token" text;/u
  );
});
