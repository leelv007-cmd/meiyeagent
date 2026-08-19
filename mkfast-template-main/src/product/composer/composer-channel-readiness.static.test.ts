/**
 * F-J-01 / G-UI-MERCHANT-NO-FALLBACK: the merchant must be told the channel
 * readiness of the model that will actually run (dual-end with admin).
 *
 * T30 / #224 moved the carrier, not the guarantee. Customized creation keeps
 * model routing in the read-only signed preview; D-103 free creation restores
 * an explicit model choice outside the agent timeline.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  equalityTargets,
  identifiers,
  jsxOf,
  literals,
  parseProductionSource,
  parseSourceText,
} from '../../test-support/ast-boundary';

const home = parseProductionSource(
  new URL('./composer-home.tsx', import.meta.url)
);
const conversation = parseProductionSource(
  new URL('./composer-conversation.tsx', import.meta.url)
);
const freeCreationPanel = parseProductionSource(
  new URL('./free-creation-panel.tsx', import.meta.url)
);

test('pre-fix readiness bound to a non-running model fails the dual-end gate', () => {
  const preFix = parseSourceText(
    'pre-fix.tsx',
    'export function Bar() { return <ComposerPromptBar modelChannelReadiness={catalog[0]?.channelReadiness} />; }'
  );
  assert.equal(
    jsxOf(preFix, 'ComposerPromptBar')[0]?.attrs.modelChannelReadiness,
    'catalog[0]?.channelReadiness'
  );
});

test('composer projects channel readiness for the model that will run', () => {
  const bar = jsxOf(home, 'ComposerPromptBar')[0];
  assert.ok(bar);
  assert.ok(
    (bar.attrs.modelChannelReadiness ?? '').includes(
      'selectedModel?.channelReadiness'
    )
  );
  assert.ok(
    literals(conversation).includes('composer-model-channel-readiness')
  );
  assert.ok(
    jsxOf(conversation, 'span').some(
      (element) =>
        element.attrs['data-testid'] === 'composer-model-channel-readiness' &&
        Object.hasOwn(element.attrs, 'data-channel-readiness')
    )
  );
  assert.ok(identifiers(conversation).has('model_card_channel_single'));
  assert.ok(identifiers(conversation).has('model_card_channel_multi'));
  assert.ok(
    equalityTargets(conversation).some(
      (pair) =>
        pair.left === 'modelChannelReadiness' && pair.right === 'single_channel'
    )
  );
});

test('free creation restores explicit model choice without putting it in the agent timeline', () => {
  assert.ok(jsxOf(home, 'FreeCreationPanel').length >= 1);
  assert.ok(literals(freeCreationPanel).includes('composer-free-model-select'));
  assert.ok(jsxOf(freeCreationPanel, 'SelectTrigger').length >= 1);
  assert.equal(jsxOf(freeCreationPanel, 'select').length, 0);
  assert.equal(
    literals(conversation).includes('composer-free-model-select'),
    false
  );
});
