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

test('exposes the write verb the five-step intake needs (W02 ①)', () => {
  assert.equal(typeof workspaceAssetHandlers.PUT, 'function');
  // Reads and deletes are not symmetric here: nothing in the product deletes a
  // workspace asset through this BFF, so the verb stays unregistered.
  assert.equal(
    'DELETE' in workspaceAssetHandlers,
    false,
    'DELETE must not be reachable from the browser'
  );
});
