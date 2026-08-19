import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAuthClientBaseUrl } from './client';
import { resolveTrustedAuthOrigins } from './trusted-origins';

test('auth client keeps browser navigation requests on the current origin', () => {
  assert.equal(
    resolveAuthClientBaseUrl('http://127.0.0.1:3000'),
    'http://127.0.0.1:3000'
  );
});

test('local development trusts the loopback origin used by the browser', () => {
  assert.deepEqual(resolveTrustedAuthOrigins(true), ['http://127.0.0.1:3000']);
  assert.deepEqual(resolveTrustedAuthOrigins(true, '3001'), [
    'http://127.0.0.1:3001',
  ]);
  assert.deepEqual(resolveTrustedAuthOrigins(false), []);
});
