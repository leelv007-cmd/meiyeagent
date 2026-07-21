/**
 * F-J-01 / G-UI-MERCHANT-NO-FALLBACK: composer primary model select must
 * project single-channel / multi-channel readiness (dual-end with admin).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const home = readFileSync(
  fileURLToPath(new URL('./composer-home.tsx', import.meta.url)),
  'utf8'
);

test('composer catalog model select projects channel readiness (merchant dual-end)', () => {
  assert.match(home, /composer-catalog-model-select/);
  assert.match(home, /composer-model-channel-readiness/);
  assert.match(home, /data-channel-readiness=/);
  assert.match(home, /model_card_channel_single/);
  assert.match(home, /model_card_channel_multi/);
  assert.match(home, /channelReadiness === ['"]single_channel['"]/);
});
