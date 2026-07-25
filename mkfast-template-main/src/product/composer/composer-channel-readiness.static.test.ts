/**
 * F-J-01 / G-UI-MERCHANT-NO-FALLBACK: the merchant must be told the channel
 * readiness of the model that will actually run (dual-end with admin).
 *
 * T30 / #224 moved the carrier, not the guarantee. The model picker was one of
 * the T08 signed fields, so the reshell stopped rendering it as an editable
 * control; readiness now rides the read-only signed preview. This file pins the
 * new location and additionally pins that the picker did not come back.
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

test('composer projects channel readiness for the model that will run', () => {
  // The readiness value reaches the surface from the resolved catalog model.
  assert.match(
    home,
    /modelChannelReadiness=\{selectedModel\?\.channelReadiness/
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

test('the retired model select stays retired (T08 signed fields are not a form)', () => {
  assert.doesNotMatch(home, /composer-catalog-model-select/);
  assert.doesNotMatch(conversation, /composer-catalog-model-select/);
});
