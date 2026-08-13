import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isStoreProfilePlatformDefault,
  STORE_INTAKE_FIELD_PROVENANCE,
  STORE_PROFILE_PLATFORM_DEFAULTS,
} from './store-profile-defaults.js';

test('platform defaults are the Day-0 fallback trio and nothing else', () => {
  assert.deepEqual(STORE_PROFILE_PLATFORM_DEFAULTS, {
    district: '本区',
    address: '门店地址待补充',
    booking: '到店咨询预约',
  });
  assert.equal(isStoreProfilePlatformDefault('district', '本区'), true);
  assert.equal(isStoreProfilePlatformDefault('address', '门店地址待补充'), true);
  assert.equal(isStoreProfilePlatformDefault('booking', '到店咨询预约'), true);
  assert.equal(isStoreProfilePlatformDefault('district', '西湖区'), false);
  assert.equal(isStoreProfilePlatformDefault('name', '本区'), false);
  assert.equal(isStoreProfilePlatformDefault('brandVoice', '本区'), false);
  assert.deepEqual([...STORE_INTAKE_FIELD_PROVENANCE], [
    'merchant_stated',
    'ai_suggestion',
    'platform_default',
  ]);
});
