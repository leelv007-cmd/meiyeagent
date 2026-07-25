import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canCreateAdminUser } from './admin-create-user';

describe('admin create user form', () => {
  it('requires a name, valid email and temporary password', () => {
    assert.equal(
      canCreateAdminUser({
        name: 'Merchant',
        email: 'merchant@example.com',
        password: 'temporary-password',
      }),
      true
    );
    assert.equal(
      canCreateAdminUser({
        name: 'Merchant',
        email: 'invalid',
        password: 'temporary-password',
      }),
      false
    );
    assert.equal(
      canCreateAdminUser({
        name: 'Merchant',
        email: 'merchant@example.com',
        password: 'short',
      }),
      false
    );
  });
});
