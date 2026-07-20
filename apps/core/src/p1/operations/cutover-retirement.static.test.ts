import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const APPLICATION_SERVICE = fileURLToPath(
  new URL('./application-service.ts', import.meta.url)
);
const FOUNDATION_MODULE = fileURLToPath(
  new URL('./foundation-module.ts', import.meta.url)
);
const MIGRATION_SERVICE = fileURLToPath(
  new URL('./content-package-migration.ts', import.meta.url)
);

test('Z1 removes every CreativeContent acceptance write seam and keeps migration read-only', () => {
  const application = readFileSync(APPLICATION_SERVICE, 'utf8');
  const foundation = readFileSync(FOUNDATION_MODULE, 'utf8');
  const migration = readFileSync(MIGRATION_SERVICE, 'utf8');

  assert.doesNotMatch(application, /acceptCreativeAsset/u);
  assert.doesNotMatch(application, /creativeContents\.push\s*\(/u);
  assert.doesNotMatch(foundation, /accept_creative_asset/u);
  assert.match(migration, /creativeContents/u);
  assert.doesNotMatch(migration, /creativeContents\.push\s*\(/u);
});
