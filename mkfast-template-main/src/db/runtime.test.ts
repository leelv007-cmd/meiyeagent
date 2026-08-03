import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DatabaseBindingUnavailableError,
  hasDatabaseBinding,
} from './runtime';

test('local runtime without Hyperdrive is unavailable without throwing', () => {
  assert.equal(hasDatabaseBinding({}), false);
  assert.equal(hasDatabaseBinding(undefined), false);
});

test('a malformed Hyperdrive binding is unavailable without throwing', () => {
  assert.equal(hasDatabaseBinding({ HYPERDRIVE: {} }), false);
  assert.equal(
    hasDatabaseBinding({ HYPERDRIVE: { connectionString: '' } }),
    false
  );
});

test('the unavailable state has a stable fail-closed error', () => {
  assert.equal(new DatabaseBindingUnavailableError().name, 'DatabaseBindingUnavailableError');
});

test('a non-empty Hyperdrive connection string enables database work', () => {
  assert.equal(
    hasDatabaseBinding({
      HYPERDRIVE: { connectionString: 'postgres://test/database' },
    }),
    true
  );
});
