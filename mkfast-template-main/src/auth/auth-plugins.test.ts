import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthPlugins } from './plugins';

test('TanStack Start cookie handling is the final Better Auth plugin', () => {
  const plugins = createAuthPlugins();

  assert.equal(plugins.at(-1)?.id, 'tanstack-start-cookies');
  assert.equal(
    plugins.findIndex((plugin) => plugin.id === 'tanstack-start-cookies'),
    plugins.length - 1
  );
});
