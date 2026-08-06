import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAdminCommandEntries,
  filterAdminCommandEntries,
} from './admin-command-model';
import { Routes } from '@/lib/routes';

test('command entries include six-domain navigation and recordable entities', () => {
  const entries = buildAdminCommandEntries();
  const navigation = entries.filter((entry) => entry.kind === 'navigation');
  const entities = entries.filter((entry) => entry.kind === 'entity');

  assert.ok(navigation.length >= 10);
  assert.ok(entities.length >= 4);
  assert.ok(navigation.some((entry) => entry.href === Routes.Admin));
  assert.ok(
    navigation.some((entry) => entry.href === Routes.AdminRefundReview)
  );
  assert.ok(entities.some((entry) => entry.href === Routes.AdminUsers));
});

test('filter matches label and keywords for search hits', () => {
  const entries = buildAdminCommandEntries();
  const refundHits = filterAdminCommandEntries(entries, 'refund');
  assert.ok(refundHits.length >= 1);
  assert.ok(
    refundHits.some((entry) => entry.href === Routes.AdminRefundReview)
  );

  const empty = filterAdminCommandEntries(entries, 'zzz-not-a-page');
  assert.equal(empty.length, 0);
});
