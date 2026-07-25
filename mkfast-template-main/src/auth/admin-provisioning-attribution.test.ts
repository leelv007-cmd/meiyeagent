import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ADMIN_ASSISTED_ACCOUNT_POLICY,
  applyAdminAssistedAccountPolicy,
  stripAdminProvisioningAttribution,
} from './admin-provisioning-attribution';

describe('admin provisioning attribution', () => {
  it('declares the D-128 assisted-account email verification policy', () => {
    assert.equal(ADMIN_ASSISTED_ACCOUNT_POLICY.emailVerified, true);
  });

  it('overwrites a forged creator with the authenticated admin actor', () => {
    assert.deepEqual(
      applyAdminAssistedAccountPolicy(
        {
          provisionedByUserId: 'forged-user',
          emailVerified: false,
        },
        'admin-user'
      ),
      {
        provisionedByUserId: 'admin-user',
        emailVerified: true,
      }
    );
  });

  it('adds the authenticated admin actor when the client omits attribution', () => {
    assert.deepEqual(applyAdminAssistedAccountPolicy(undefined, 'admin-user'), {
      emailVerified: true,
      provisionedByUserId: 'admin-user',
    });
  });

  it('strips attribution from every admin user update payload', () => {
    assert.deepEqual(
      stripAdminProvisioningAttribution({
        name: 'Merchant',
        provisionedByUserId: 'forged-user',
      }),
      { name: 'Merchant' }
    );
  });
});
