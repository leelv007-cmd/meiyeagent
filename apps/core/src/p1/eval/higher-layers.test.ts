import assert from 'node:assert/strict';
import test from 'node:test';

import { P1DomainError } from '../foundation/domain.js';
import {
  EVAL_HIGHER_LAYER_BACKLOG,
  assertHigherLayerReadonlyGate,
  getHigherLayerBacklog,
  runHigherLayerIfEnabled,
} from './higher-layers.js';

test('L2/L3 backlog entries freeze readonly + no paid side effects', () => {
  assert.equal(EVAL_HIGHER_LAYER_BACKLOG.length, 2);
  for (const entry of EVAL_HIGHER_LAYER_BACKLOG) {
    assert.equal(entry.status, 'trigger_bound_backlog');
    assert.equal(entry.readonlyGateRequired, true);
    assert.equal(entry.paidSideEffectsForbidden, true);
  }
  assert.equal(
    getHigherLayerBacklog('l3_shadow').kind,
    'l3_shadow',
  );
});

test('readonly gate rejects paid side effects and production writes', () => {
  assert.throws(
    () =>
      assertHigherLayerReadonlyGate({
        kind: 'l2_journey_replay',
        allowPaidSideEffects: true,
      }),
    (error: unknown) =>
      error instanceof P1DomainError && error.code === 'FORBIDDEN',
  );
  assert.throws(
    () =>
      assertHigherLayerReadonlyGate({
        kind: 'l3_shadow',
        allowPaidSideEffects: false,
        writeProductionContentPackage: true,
      }),
    (error: unknown) =>
      error instanceof P1DomainError && error.code === 'FORBIDDEN',
  );
  assert.doesNotThrow(() =>
    assertHigherLayerReadonlyGate({
      kind: 'l2_journey_replay',
      allowPaidSideEffects: false,
    }),
  );
});

test('runHigherLayerIfEnabled stays backlog-blocked even when readonly', () => {
  assert.throws(
    () =>
      runHigherLayerIfEnabled({
        kind: 'l2_journey_replay',
        allowPaidSideEffects: false,
      }),
    (error: unknown) =>
      error instanceof P1DomainError &&
      error.code === 'INVALID_STATE' &&
      /trigger_bound_backlog/u.test(error.message),
  );
});
