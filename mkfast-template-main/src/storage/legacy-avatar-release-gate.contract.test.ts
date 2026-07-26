import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('production deployment applies storage migrations before publishing the Worker', async () => {
  // T40/E-01: the workflow moved to the repository root, where GitHub actually
  // discovers it, and publishes with the workspace wrangler (`pnpm exec`)
  // instead of `pnpx`, which would fetch a version the lockfile never pinned.
  const deploy = await readFile(
    new URL('../../../.github/workflows/deploy.yml', import.meta.url),
    'utf8'
  );
  const migration = deploy.indexOf('pnpm db:migrate:remote');
  const publish = deploy.indexOf('pnpm exec wrangler deploy');

  assert.match(deploy, /DATABASE_URL: \$\{\{ secrets\.DATABASE_URL \}\}/u);
  assert.notEqual(migration, -1);
  assert.notEqual(publish, -1);
  assert.ok(migration < publish);
});
