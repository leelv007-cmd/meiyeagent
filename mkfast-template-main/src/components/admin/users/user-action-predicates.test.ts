import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canBanUser,
  canSetPlatformRole,
  canUnbanUser,
  isPlatformAdmin,
} from './user-action-predicates';

const base = {
  id: 'user-1',
  banned: false as boolean | null,
  role: 'user' as string | null,
};

describe('user action predicates', () => {
  it('allows ban only for active identified users', () => {
    assert.equal(canBanUser(base), true);
    assert.equal(canBanUser({ ...base, banned: true }), false);
    assert.equal(canBanUser({ ...base, id: '' }), false);
  });

  it('allows unban only for banned identified users', () => {
    assert.equal(canUnbanUser(base), false);
    assert.equal(canUnbanUser({ ...base, banned: true }), true);
    assert.equal(canUnbanUser({ ...base, banned: true, id: '' }), false);
  });

  it('allows platform role change when the target is identified', () => {
    assert.equal(canSetPlatformRole(base), true);
    assert.equal(canSetPlatformRole({ ...base, id: '' }), false);
  });

  it('detects platform admin role', () => {
    assert.equal(isPlatformAdmin(base), false);
    assert.equal(isPlatformAdmin({ ...base, role: 'admin' }), true);
  });
});
