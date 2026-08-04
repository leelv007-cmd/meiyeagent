/**
 * F-J-01 / G-UI-MERCHANT-NO-FALLBACK: the merchant must be told the channel
 * readiness of the model that will actually run (dual-end with admin).
 *
 * T30 / #224 moved the carrier, not the guarantee. Customized creation keeps
 * model routing in the read-only signed preview; D-103 free creation restores
 * an explicit model choice outside the agent timeline.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

function read(file: string) {
  return readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
}

const home = read('./composer-home.tsx');
const conversation = read('./composer-conversation.tsx');
const freeCreationPanel = read('./free-creation-panel.tsx');

test('composer projects channel readiness for the model that will run', () => {
  // The readiness value reaches the surface from the resolved catalog model.
  // Allow whitespace/newlines between `{` and the selectedModel access (P1 shell
  // formatting); the binding must still be the catalog model that will run.
  assert.match(
    home,
    /modelChannelReadiness=\{\s*selectedModel\?\.channelReadiness/u
  );

  assert.match(conversation, /composer-model-channel-readiness/);
  assert.match(conversation, /data-channel-readiness=/);
  assert.match(conversation, /model_card_channel_single/);
  assert.match(conversation, /model_card_channel_multi/);
  assert.match(
    conversation,
    /modelChannelReadiness === ['"]single_channel['"]/
  );
});

test('free creation restores explicit model choice without putting it in the agent timeline', () => {
  assert.match(home, /<FreeCreationPanel/u);
  assert.match(freeCreationPanel, /composer-free-model-select/u);
  assert.doesNotMatch(conversation, /composer-free-model-select/u);
});
