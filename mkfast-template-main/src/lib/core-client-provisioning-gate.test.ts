import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

test('Core forward uses the degraded provisioning gate instead of hard-failing every request', async () => {
  const source = await readFile(
    resolve(process.cwd(), 'src/lib/core-client.ts'),
    'utf8'
  );

  assert.match(source, /ensureVerifiedWorkspaceProvisionedForCoreForward/u);
  assert.doesNotMatch(source, /await ensureVerifiedWorkspaceProvisioned\(\{/u);
});
