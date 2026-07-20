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

const { unifiedCreationWorkbenchContentCount } = await import(
  './unified-creation-workbench'
);

test('counts ContentPackages plus desktop legacy content not covered by legacySource', () => {
  assert.equal(
    unifiedCreationWorkbenchContentCount(
      [{ id: 'shared-id' }, { id: 'product-only' }],
      [{ id: 'shared-id' }],
      [
        {
          legacySource: {
            mappingConfidence: 'exact',
            sourceId: 'shared-id',
            sourceType: 'product_content_item',
          },
        },
        { legacySource: undefined },
      ]
    ),
    4
  );
});

test('falls back to the desktop legacy content count when there are no ContentPackages', () => {
  assert.equal(
    unifiedCreationWorkbenchContentCount(
      [{ id: 'product-a' }, { id: 'product-b' }],
      [{ id: 'creative-a' }],
      []
    ),
    3
  );
});
