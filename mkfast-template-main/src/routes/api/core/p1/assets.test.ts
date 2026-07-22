import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:workers') {
      return {
        shortCircuit: true,
        url: 'data:text/javascript,export const env = {}',
      };
    }
    return nextResolve(specifier, context);
  },
});

const { workspaceAssetHandlers } = await import('./assets');

test('registers GET and HEAD for the workspace asset BFF', () => {
  assert.equal(typeof workspaceAssetHandlers.GET, 'function');
  assert.equal(typeof workspaceAssetHandlers.HEAD, 'function');
});
