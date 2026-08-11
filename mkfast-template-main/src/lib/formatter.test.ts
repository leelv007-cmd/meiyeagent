import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDate, formatDateTime } from './formatter';

test('formats dates with stable Chinese numeric fields', () => {
  const date = new Date(2026, 7, 2, 3, 4, 5);

  assert.equal(formatDate(date), '2026/08/02');
  assert.equal(formatDateTime(date), '2026/08/02 03:04:05');
});
