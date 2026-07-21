import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('production deployment applies storage migrations before publishing the Worker', async () => {
  const deploy = await readFile(
    new URL('../../.github/workflows/deploy.yml', import.meta.url),
    'utf8'
  );
  const migration = deploy.indexOf('pnpm db:migrate:remote');
  const publish = deploy.indexOf('pnpx wrangler deploy');

  assert.match(deploy, /DATABASE_URL: \$\{\{ secrets\.DATABASE_URL \}\}/u);
  assert.notEqual(migration, -1);
  assert.notEqual(publish, -1);
  assert.ok(migration < publish);
});
