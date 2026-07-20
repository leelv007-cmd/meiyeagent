import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveLiveProviderChannels } from './live-provider-adapters.js';

test('resolver reports missing credentials instead of creating configured channels', () => {
  const resolution = resolveLiveProviderChannels({});
  assert.equal(resolution.channels.length, 0);
  assert.equal(resolution.missingByChannel.length, 6);
});
