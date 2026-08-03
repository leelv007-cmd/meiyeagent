import assert from 'node:assert/strict';
import test from 'node:test';

import {
  expectedWaffoWebhookMode,
  selectWaffoWebhookPublicKey,
  sdkWaffoEnvironment,
} from './waffo-environment';

test('Waffo environment authority selects exactly one key and SDK mode', () => {
  const keys = { prod: 'production-key', test: 'test-key' };

  assert.equal(sdkWaffoEnvironment('test'), 'test');
  assert.equal(expectedWaffoWebhookMode('test'), 'test');
  assert.equal(selectWaffoWebhookPublicKey('test', keys), 'test-key');

  assert.equal(sdkWaffoEnvironment('production'), 'prod');
  assert.equal(expectedWaffoWebhookMode('production'), 'prod');
  assert.equal(
    selectWaffoWebhookPublicKey('production', keys),
    'production-key'
  );
});

test('Waffo environment authority does not cross-fallback public keys', () => {
  assert.equal(
    selectWaffoWebhookPublicKey('test', { prod: 'production-key' }),
    undefined
  );
  assert.equal(
    selectWaffoWebhookPublicKey('production', { test: 'test-key' }),
    undefined
  );
});
