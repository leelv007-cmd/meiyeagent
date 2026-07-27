import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dashboardBalanceRows,
  parseDashboardBalance,
} from './dashboard-balance';

const balance = {
  copy: {
    allowance: 12,
    available: 9,
    committed: 2,
    released: 0,
    reserved: 1,
  },
  image: {
    allowance: 7,
    available: 5,
    committed: 1,
    released: 0,
    reserved: 1,
  },
  video: {
    allowance: 2,
    available: 1,
    committed: 1,
    released: 0,
    reserved: 0,
  },
};

test('projects exactly the public copy image and video balances', () => {
  assert.deepEqual(dashboardBalanceRows(balance), [
    {
      allowance: 12,
      available: 9,
      id: 'copy',
      label: '文案',
      reserved: 1,
    },
    {
      allowance: 7,
      available: 5,
      id: 'image',
      label: '图片',
      reserved: 1,
    },
    {
      allowance: 2,
      available: 1,
      id: 'video',
      label: '视频',
      reserved: 0,
    },
  ]);
});

test('rejects provider or non-launch buckets at the public adapter boundary', () => {
  assert.throws(() =>
    parseDashboardBalance({
      ...balance,
      audio: balance.copy,
    })
  );
  assert.throws(() =>
    parseDashboardBalance({
      ...balance,
      copy: {
        ...balance.copy,
        providerCostMicros: 99,
      },
    })
  );
});
