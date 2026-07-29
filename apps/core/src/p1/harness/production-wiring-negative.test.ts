import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertWiringInventoryClosure,
  defineWiringNegativeCorpus,
  WIRING_NEGATIVE_CASE_IDS,
} from '../testing/wiring-negative-corpus.js';
import { HARNESS_ACTION_CARRIERS } from './action-carriers.js';
import {
  createHarnessActionRegistry,
  HARNESS_ACTION_DEFINITIONS,
  HarnessActionAuthorizationError,
} from './action-registry.js';

const actionInventoryKeys = HARNESS_ACTION_DEFINITIONS.map(
  ({ actionId }) => actionId,
);
const carrierKeys = Object.values(HARNESS_ACTION_CARRIERS);

const negativeCorpus = defineWiringNegativeCorpus({
  'available-but-unbound'() {
    const registry = createHarnessActionRegistry(HARNESS_ACTION_DEFINITIONS);
    assert.throws(
      () =>
        registry.authorize({
          actionId: HARNESS_ACTION_CARRIERS.start,
          caller: 'worker',
        }),
      HarnessActionAuthorizationError,
    );
  },
  'dynamic-not-in-inventory'() {
    const registry = createHarnessActionRegistry(HARNESS_ACTION_DEFINITIONS);
    assert.throws(
      () => registry.definition('workflow.dynamic_continuation'),
      HarnessActionAuthorizationError,
    );
  },
  'inventory-blind-to-closure'() {
    assert.doesNotThrow(() =>
      assertWiringInventoryClosure(actionInventoryKeys, carrierKeys),
    );
    const blindInventory = actionInventoryKeys.filter(
      (key) => key !== HARNESS_ACTION_CARRIERS.mediaQueueSubmit,
    );
    assert.throws(
      () => assertWiringInventoryClosure(blindInventory, carrierKeys),
      /workflow\.media_queue_submit/u,
    );
  },
  'invalid-shape-silently-inert'() {
    const corrupted = HARNESS_ACTION_DEFINITIONS.map((definition) =>
      definition.actionId === HARNESS_ACTION_CARRIERS.subscription
        ? { ...definition, authoritySource: undefined }
        : definition,
    );
    assert.throws(
      () => createHarnessActionRegistry(corrupted),
      /canonical gate metadata/u,
    );
  },
  'duplicate-authority-key'() {
    assert.throws(
      () =>
        createHarnessActionRegistry([
          ...HARNESS_ACTION_DEFINITIONS,
          HARNESS_ACTION_DEFINITIONS[0],
        ]),
      /duplicated/u,
    );
  },
});

for (const caseId of WIRING_NEGATIVE_CASE_IDS) {
  test(`Harness action wiring negative corpus detects ${caseId}`, () => {
    negativeCorpus[caseId]();
  });
}
