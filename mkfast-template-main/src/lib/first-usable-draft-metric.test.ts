import assert from 'node:assert/strict';
import test from 'node:test';

import { FirstUsableDraftMeasurement } from './first-usable-draft-metric';

test('first usable draft metric counts activations and exempts conflict precision', () => {
  const canonical = new FirstUsableDraftMeasurement('canonical_mouse', 100);
  canonical.recordActivation();
  assert.deepEqual(canonical.finish(942), {
    path: 'canonical_mouse',
    timeToFirstUsableDraftMs: 842,
    userActivationCount: 2,
  });

  const conflict = new FirstUsableDraftMeasurement('keyboard', 200);
  conflict.recordActivation();
  conflict.markConflict();
  assert.deepEqual(conflict.finish(1_200), {
    path: 'conflict',
    timeToFirstUsableDraftMs: 1_000,
    userActivationCount: 2,
  });
});
