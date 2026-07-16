import assert from 'node:assert/strict';
import test from 'node:test';
import { projectAccountUsage } from './account-usage';

test('projects output usage without collapsing reserved, settled, released, or expiry', () => {
  const rows = projectAccountUsage({
    plan: {
      tier: 'growth',
      periodEndsAt: '2026-08-01T00:00:00.000Z',
    },
    usage: {
      copy: {
        allowance: 20,
        available: 11,
        committed: 7,
        released: 3,
        reserved: 2,
      },
      image: {
        allowance: 10,
        available: 8,
        committed: 2,
        released: 1,
        reserved: 0,
      },
      audio: {
        allowance: 12,
        available: 9,
        committed: 2,
        released: 1,
        reserved: 1,
      },
      video: {
        allowance: 5,
        available: 3,
        committed: 1,
        released: 0,
        reserved: 1,
      },
    },
  });

  assert.deepEqual(rows.summary, {
    expiresAt: '2026-08-01T00:00:00.000Z',
    tier: 'growth',
  });
  assert.deepEqual(rows.resources[0], {
    allowance: 20,
    available: 11,
    released: 3,
    reserved: 2,
    resource: 'copy',
    settled: 7,
  });
  assert.deepEqual(rows.resources[3], {
    allowance: 12,
    available: 9,
    released: 1,
    reserved: 1,
    resource: 'audio',
    settled: 2,
  });
});

test('states that expiry is unavailable instead of inventing a date', () => {
  const rows = projectAccountUsage({
    plan: null,
    usage: {
      copy: {
        allowance: 0,
        available: 0,
        committed: 0,
        released: 0,
        reserved: 0,
      },
      image: {
        allowance: 0,
        available: 0,
        committed: 0,
        released: 0,
        reserved: 0,
      },
      audio: {
        allowance: 0,
        available: 0,
        committed: 0,
        released: 0,
        reserved: 0,
      },
      video: {
        allowance: 0,
        available: 0,
        committed: 0,
        released: 0,
        reserved: 0,
      },
    },
  });

  assert.equal(rows.summary.expiresAt, null);
  assert.equal(rows.summary.tier, null);
});
