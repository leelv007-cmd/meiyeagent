import assert from 'node:assert/strict';
import test from 'node:test';

import {
  missingStoreProfileFields,
  type StoreProfileForm,
} from './store-profile-form';

const completeStore: StoreProfileForm = {
  name: 'QA 夏日美甲工作室',
  city: '上海',
  district: '静安区',
  address: '测试路 1 号',
  booking: '请提前预约',
  brandVoice: '真实克制',
  projectName: '夏日猫眼美甲',
  projectPrice: '199',
  account: '',
  accountHomepage: '',
  accountVerification: 'unverified',
  accountNotes: '',
  douyinAccount: '',
  regulated: false,
};

// Regression: ISSUE-003 — the Store UI must not enable a command that the Product schema rejects.
// Found by /qa on 2026-07-22
// Report: .gstack/qa-reports/qa-report-localhost-2026-07-22.md
test('requires every Product store fact before confirming a store', () => {
  assert.deepEqual(missingStoreProfileFields({ ...completeStore, city: '' }), [
    'city',
  ]);
  assert.deepEqual(
    missingStoreProfileFields({ ...completeStore, projectPrice: '' }),
    ['projectPrice']
  );
  assert.deepEqual(missingStoreProfileFields(completeStore), []);
});

test('accepts a confirmed zero-price project allowed by the Product schema', () => {
  assert.deepEqual(
    missingStoreProfileFields({ ...completeStore, projectPrice: '0' }),
    []
  );
});
