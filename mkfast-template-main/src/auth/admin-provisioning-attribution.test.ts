import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { secureAdminProvisioningData } from './admin-provisioning-attribution';

describe('admin provisioning attribution', () => {
  it('overwrites a forged creator with the authenticated admin actor', () => {
    assert.deepEqual(
      secureAdminProvisioningData(
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
    assert.deepEqual(secureAdminProvisioningData(undefined, 'admin-user'), {
      emailVerified: true,
      provisionedByUserId: 'admin-user',
    });
  });
});
