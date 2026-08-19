/**
 * Consumer-proof wiring: P2-09 panel is mounted on Composer and submission
 * injects generation params (D-150).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  callArgumentObjects,
  hasCall,
  hasValueImport,
  identifiers,
  jsxOf,
  parseProductionSource,
  parseSourceText,
  propertyValues,
} from '../../test-support/ast-boundary';

const home = parseProductionSource(
  new URL('./composer-home.tsx', import.meta.url)
);
const freePanel = parseProductionSource(
  new URL('./free-creation-panel.tsx', import.meta.url)
);
const client = parseProductionSource(
  new URL('./composer-submission-client.ts', import.meta.url)
);

test('ungated generation-params panel fails the consumer-proof boundary', () => {
  const preFix = parseSourceText(
    'pre-fix.tsx',
    'export function Panel() { return <ComposerGenerationParamsPanel />; }'
  );
  assert.equal(jsxOf(preFix, 'ComposerGenerationParamsPanel').length, 1);
});

test('ComposerHome signs generation params before quoting and reuses that payload on submit', () => {
  assert.equal(jsxOf(freePanel, 'ComposerGenerationParamsPanel').length, 1);
  assert.ok(identifiers(freePanel).has('generationParamsEnabled'));
  assert.ok(
    jsxOf(home, 'FreeCreationPanel').some(
      (element) =>
        element.attrs.generationParamsEnabled === 'generationParamsEnabled'
    )
  );
  assert.equal(hasCall(home, 'buildSubmissionGenerationParams'), true);
  assert.equal(hasCall(home, 'isComposerGenerationParamsSupported'), true);
  assert.ok(identifiers(home).has('signedGeneration'));
  const signed = callArgumentObjects(
    home,
    'composerSubmissionSignedFieldsSchema.safeParse'
  );
  const signedFields = propertyValues(home, 'beautyVoiceRole');
  assert.ok(
    signedFields.some((value) => value.includes('signedGeneration')) ||
      signed.some((props) =>
        (props.beautyVoiceRole ?? '').includes('signedGeneration')
      )
  );
  assert.ok(
    propertyValues(home, 'thinkingLevel').some((value) =>
      value.includes('signedGeneration')
    )
  );
  const freePanelMount = jsxOf(home, 'FreeCreationPanel')[0];
  assert.ok(freePanelMount);
  assert.notEqual(freePanelMount.attrs.freePanel, 'null');
});

test('browser submission reuses the shared signed contract for generation params', () => {
  assert.equal(
    hasValueImport(client, 'composerSubmissionSignedFieldsSchema'),
    true
  );
  assert.equal(hasCall(client, 'extend'), true);
  assert.equal(identifiers(client).has('beautyVoiceRoleSchema'), false);
  assert.equal(identifiers(client).has('thinkingLevelSchema'), false);
});
