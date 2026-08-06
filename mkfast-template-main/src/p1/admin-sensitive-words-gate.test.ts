import assert from 'node:assert/strict';
import test from 'node:test';

import { p1QueryKeys } from '@/p1/query-keys';

import {
  adminEnabledSensitiveWordsQueryKey,
  projectSensitiveWordsGateStatus,
} from './admin-sensitive-words-gate';

test('shared query key is list with status enabled only', () => {
  assert.deepEqual(
    adminEnabledSensitiveWordsQueryKey,
    p1QueryKeys.request('sensitive-words', 'list', { status: 'enabled' })
  );
});

test('pending projects to loading — never inactive or active', () => {
  const status = projectSensitiveWordsGateStatus({
    isPending: true,
    isError: false,
    isSuccess: false,
  });
  assert.equal(status.kind, 'loading');
});

test('error projects to error — never inactive (empty lexicon) or active', () => {
  const status = projectSensitiveWordsGateStatus({
    isPending: false,
    isError: true,
    isSuccess: false,
    total: 0,
  });
  assert.equal(status.kind, 'error');
});

test('success with total 0 is inactive', () => {
  const status = projectSensitiveWordsGateStatus({
    isPending: false,
    isError: false,
    isSuccess: true,
    total: 0,
  });
  assert.deepEqual(status, { kind: 'inactive', total: 0 });
});

test('success with total > 0 is active', () => {
  const status = projectSensitiveWordsGateStatus({
    isPending: false,
    isError: false,
    isSuccess: true,
    total: 3,
  });
  assert.deepEqual(status, { kind: 'active', total: 3 });
});

test('error wins over a leftover total so failure is never empty-success', () => {
  const status = projectSensitiveWordsGateStatus({
    isPending: false,
    isError: true,
    isSuccess: false,
    total: 0,
  });
  assert.equal(status.kind, 'error');
  assert.notEqual(status.kind, 'inactive');
});
