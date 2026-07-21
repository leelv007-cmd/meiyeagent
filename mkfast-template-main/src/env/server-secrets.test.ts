import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allowsDevSecretDefaults,
  isStrictSecretEnv,
  isWeakSecretValue,
  WEAK_SECRET_VALUES,
} from './secret-hardening.ts';

test('allowsDevSecretDefaults is true outside production/staging', () => {
  assert.equal(allowsDevSecretDefaults({ APP_ENV: 'e2e' }), true);
  assert.equal(allowsDevSecretDefaults({ APP_ENV: 'development' }), true);
  assert.equal(allowsDevSecretDefaults({ APP_ENV: 'test' }), true);
  assert.equal(allowsDevSecretDefaults({ NODE_ENV: 'test' }), true);
  assert.equal(allowsDevSecretDefaults({}), true);
  assert.equal(allowsDevSecretDefaults({ APP_ENV: 'production' }), false);
  assert.equal(allowsDevSecretDefaults({ APP_ENV: 'staging' }), false);
  assert.equal(allowsDevSecretDefaults({ NODE_ENV: 'production' }), false);
});

test('isStrictSecretEnv only for production/staging (or bare NODE_ENV=production)', () => {
  assert.equal(isStrictSecretEnv({ APP_ENV: 'production' }), true);
  assert.equal(isStrictSecretEnv({ APP_ENV: 'staging' }), true);
  assert.equal(isStrictSecretEnv({ NODE_ENV: 'production' }), true);
  assert.equal(
    isStrictSecretEnv({ APP_ENV: 'e2e', NODE_ENV: 'production' }),
    false
  );
  assert.equal(isStrictSecretEnv({}), false);
});

test('weak secret placeholders are enumerated for production rejection', () => {
  for (const value of WEAK_SECRET_VALUES) {
    assert.equal(isWeakSecretValue(value), true, value);
  }
  assert.equal(isWeakSecretValue('prod-rotation-token'), false);
});
