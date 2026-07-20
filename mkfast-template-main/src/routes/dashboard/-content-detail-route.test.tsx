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

const { stableContentPackageSelection } = await import('./content_/$contentId');

test('maps the stable path parameter to the same package selection as the query address', () => {
  assert.deepEqual(stableContentPackageSelection('package/a b'), {
    packageId: 'package/a b',
  });
});
