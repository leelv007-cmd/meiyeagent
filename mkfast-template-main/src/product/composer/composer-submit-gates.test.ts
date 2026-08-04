import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPOSER_SUBMIT_GATES,
  type ComposerSubmitGate,
  type ComposerSubmitGateChecks,
  runComposerSubmitGateLadder,
} from './composer-submit-gates';

function checksWith(
  outcome: (gate: ComposerSubmitGate) => boolean,
  calls: ComposerSubmitGate[]
): ComposerSubmitGateChecks {
  return Object.fromEntries(
    COMPOSER_SUBMIT_GATES.map((gate) => [
      gate,
      () => {
        calls.push(gate);
        return outcome(gate);
      },
    ])
  ) as ComposerSubmitGateChecks;
}

test('attemptSubmit gate ladder blocks and passes through each gate in order', async (t) => {
  for (const [index, gate] of COMPOSER_SUBMIT_GATES.entries()) {
    await t.test(`${gate} blocks before later gates`, async () => {
      const calls: ComposerSubmitGate[] = [];
      const result = await runComposerSubmitGateLadder(
        checksWith((candidate) => candidate !== gate, calls)
      );

      assert.deepEqual(result, { gate, kind: 'blocked' });
      assert.deepEqual(calls, COMPOSER_SUBMIT_GATES.slice(0, index + 1));
    });

    await t.test(`${gate} passes through to the next gate`, async () => {
      const next = COMPOSER_SUBMIT_GATES[index + 1];
      const calls: ComposerSubmitGate[] = [];
      const result = await runComposerSubmitGateLadder(
        checksWith((candidate) => candidate !== next, calls)
      );

      if (next) {
        assert.deepEqual(result, { gate: next, kind: 'blocked' });
        assert.equal(calls.includes(gate), true);
        assert.equal(calls.includes(next), true);
      } else {
        assert.deepEqual(result, { kind: 'passed' });
        assert.deepEqual(calls, COMPOSER_SUBMIT_GATES);
      }
    });
  }
});
