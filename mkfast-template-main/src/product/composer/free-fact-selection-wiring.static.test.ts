import assert from 'node:assert/strict';
import test from 'node:test';

import {
  callArgumentObjects,
  hasCall,
  identifiers,
  jsxOf,
  parseProductionSource,
  parseSourceText,
  propertyValues,
} from '../../test-support/ast-boundary';

const source = parseProductionSource(
  new URL('./composer-home.tsx', import.meta.url)
);

test('pre-fix auto-select of loaded facts fails the selection boundary', () => {
  const preFix = parseSourceText(
    'pre-fix.ts',
    'setSelectedFreeFactRefs(storeFacts.data.map((row) => row.ref));'
  );
  assert.equal(hasCall(preFix, 'setSelectedFreeFactRefs'), true);
  const productionArgs = callArgumentObjects(source, 'setSelectedFreeFactRefs');
  assert.equal(
    productionArgs.some((props) => Object.hasOwn(props, 'data')),
    false,
    'loading facts must never auto-select them'
  );
});

test('ComposerHome owns the merchant selection and submits only its active exact refs', () => {
  assert.equal(hasCall(source, 'useOwnedFreeFactSelection'), true);
  assert.ok(identifiers(source).has('freeFactSelectionOwner'));
  const selector = jsxOf(source, 'FreeFactSelector')[0];
  assert.ok(selector);
  assert.equal(selector.attrs.onSelectionChange, 'setSelectedFreeFactRefs');
  assert.equal(hasCall(source, 'currentSelectedFreeFactRefs'), true);
  assert.ok(
    propertyValues(source, 'requestedFactRefs').includes(
      'requestedFreeFactRefs'
    )
  );
  const runArgs = callArgumentObjects(source, 'useComposerThreadController');
  assert.ok(
    runArgs.some((props) => Object.hasOwn(props, 'onAgentBinding')),
    'a successful run must clear this-run-only selections'
  );
  assert.equal(hasCall(source, 'clearSelectedFreeFactRefs'), true);
});
