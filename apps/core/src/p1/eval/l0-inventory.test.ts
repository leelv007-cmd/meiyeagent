import assert from 'node:assert/strict';
import test from 'node:test';

import {
  L0_CONTRACT_INVENTORY,
  listL0Gaps,
  listL0Inventory,
} from './l0-inventory.js';

test('L0 inventory is non-empty and lists explicit gaps', () => {
  assert.ok(L0_CONTRACT_INVENTORY.length >= 10);
  const gaps = listL0Gaps();
  assert.ok(gaps.length >= 1);
  assert.ok(gaps.every((entry) => entry.status === 'gap'));
  assert.ok(listL0Inventory('covered').length >= 5);
});

test('every inventory id is unique', () => {
  const ids = L0_CONTRACT_INVENTORY.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
});
