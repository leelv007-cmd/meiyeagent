import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createAuthPlugins } from './plugins';

test('TanStack Start cookie handling is the final Better Auth plugin', async () => {
  const plugins = createAuthPlugins();

  assert.equal(plugins.at(-1)?.id, 'tanstack-start-cookies');
  assert.equal(
    plugins.findIndex((plugin) => plugin.id === 'tanstack-start-cookies'),
    plugins.length - 1
  );

  const authSource = await readFile(
    new URL('./auth.ts', import.meta.url),
    'utf8'
  );
  assert.match(authSource, /plugins:\s*createAuthPlugins\(\),/u);
});
