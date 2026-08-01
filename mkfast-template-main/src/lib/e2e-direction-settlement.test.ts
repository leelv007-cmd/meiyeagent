import assert from 'node:assert/strict';
import test from 'node:test';

import { directionSettlementProof } from '../../tests/e2e/fixtures/direction-settlement.js';

test('direction settlement proof follows each live renderer contract', () => {
  assert.deepEqual(directionSettlementProof(true), {
    attribute: 'aria-pressed',
    target: 'direction',
    value: 'true',
  });
  assert.deepEqual(directionSettlementProof(false), {
    attribute: 'data-settlement',
    target: 'card',
    value: 'answered',
  });
});
