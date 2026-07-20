import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALL_ZERO_INTEGRATION_SECRET_STORE_KEY,
  allowsDevSecretDefaults,
  assertIntegrationSecretStoreKey,
  assertStrongSecret,
  isAllZeroIntegrationSecretStoreKey,
  isStrictSecretEnv,
  isWeakSecretValue,
} from './secret-hardening.js';

test('allowsDevSecretDefaults is true outside production/staging', () => {
  assert.equal(allowsDevSecretDefaults({ APP_ENV: 'development' }), true);
  assert.equal(allowsDevSecretDefaults({ APP_ENV: 'e2e' }), true);
  assert.equal(allowsDevSecretDefaults({ APP_ENV: 'test' }), true);
  assert.equal(allowsDevSecretDefaults({ NODE_ENV: 'test' }), true);
  assert.equal(allowsDevSecretDefaults({}), true);
  assert.equal(allowsDevSecretDefaults({ APP_ENV: 'production' }), false);
  assert.equal(allowsDevSecretDefaults({ APP_ENV: 'staging' }), false);
  assert.equal(isStrictSecretEnv({ NODE_ENV: 'production' }), true);
});

test('isWeakSecretValue recognizes known placeholders', () => {
  assert.equal(isWeakSecretValue('better-auth-secret'), true);
  assert.equal(isWeakSecretValue('change-me'), true);
  assert.equal(isWeakSecretValue('local-core-service-token'), true);
  assert.equal(isWeakSecretValue('local-canvas-service-token'), true);
  assert.equal(isWeakSecretValue('dev-token'), true);
  assert.equal(isWeakSecretValue('test-token'), true);
  assert.equal(isWeakSecretValue('test-service-token'), true);
  assert.equal(isWeakSecretValue('secret'), true);
  assert.equal(isWeakSecretValue('password'), true);
  assert.equal(isWeakSecretValue('token'), true);
  assert.equal(isWeakSecretValue('prod-strong-token-ok'), false);
});

test('assertStrongSecret allows weak values only outside production/staging', () => {
  assert.doesNotThrow(() =>
    assertStrongSecret('CORE_SERVICE_TOKEN', 'change-me', { APP_ENV: 'e2e' })
  );
  assert.doesNotThrow(() =>
    assertStrongSecret('CORE_SERVICE_TOKEN', 'change-me', {})
  );
  assert.throws(
    () =>
      assertStrongSecret('CORE_SERVICE_TOKEN', 'change-me', {
        APP_ENV: 'production',
      }),
    /rejects weak placeholder/
  );
  assert.throws(
    () =>
      assertStrongSecret('CORE_SERVICE_TOKEN', 'dev-token', {
        APP_ENV: 'production',
      }),
    /rejects weak placeholder/
  );
  assert.throws(
    () =>
      assertStrongSecret('CORE_SERVICE_TOKEN', undefined, {
        APP_ENV: 'staging',
      }),
    /is required/
  );
  assert.throws(
    () =>
      assertStrongSecret('CORE_SERVICE_TOKEN', 'short-but-ok!', {
        APP_ENV: 'production',
      }),
    /at least 16 characters/
  );
  assert.doesNotThrow(() =>
    assertStrongSecret('CORE_SERVICE_TOKEN', 'prod-strong-token', {
      APP_ENV: 'production',
    })
  );
});

test('assertIntegrationSecretStoreKey refuses all-zero key in production/staging', () => {
  assert.equal(
    isAllZeroIntegrationSecretStoreKey(ALL_ZERO_INTEGRATION_SECRET_STORE_KEY),
    true
  );
  assert.doesNotThrow(() =>
    assertIntegrationSecretStoreKey(ALL_ZERO_INTEGRATION_SECRET_STORE_KEY, {
      APP_ENV: 'e2e',
    })
  );
  assert.throws(
    () =>
      assertIntegrationSecretStoreKey(ALL_ZERO_INTEGRATION_SECRET_STORE_KEY, {
        APP_ENV: 'production',
      }),
    /all-zero fixture key/
  );
  assert.doesNotThrow(() =>
    assertIntegrationSecretStoreKey('a'.repeat(64), { APP_ENV: 'production' })
  );
});
