import assert from 'node:assert/strict';
import test from 'node:test';

import { applyMiniflareV8FlagsPatch } from './ensure-miniflare-v8-flags.mjs';

const stock = `    return {
      services: servicesArray,
      sockets,
      extensions,
      structuredLogging: this.#structuredWorkerdLogs,
      autogates: process.env.MINIFLARE_WORKERD_AUTOGATES ? process.env.MINIFLARE_WORKERD_AUTOGATES.split(" ") : []
    };`;

test('splices v8Flags from MINIFLARE_WORKERD_V8_FLAGS into assembleConfig', () => {
  const first = applyMiniflareV8FlagsPatch(stock);
  assert.equal(first.changed, true);
  assert.match(
    first.source,
    /v8Flags: process.env.MINIFLARE_WORKERD_V8_FLAGS/u
  );
  const second = applyMiniflareV8FlagsPatch(first.source);
  assert.equal(second.changed, false);
});

test('refuses to patch an unknown assembleConfig shape', () => {
  assert.throws(
    () => applyMiniflareV8FlagsPatch('return { services: [] };'),
    /refuse to guess a splice/u
  );
});
