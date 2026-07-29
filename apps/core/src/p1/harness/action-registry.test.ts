import assert from 'node:assert/strict';
import test from 'node:test';

import { HARNESS_GATE_IDS } from './policy-gates.js';
import {
  HARNESS_ACTION_DEFINITIONS,
  HarnessActionAuthorizationError,
  createHarnessActionRegistry,
} from './action-registry.js';
import { sendHarnessMediaJobTerminal } from './dbos-workflow.js';

test('startup rejects missing metadata on every production Harness action', () => {
  for (const definition of HARNESS_ACTION_DEFINITIONS) {
    for (const field of ['authoritySource', 'gateIds', 'trustedCallers']) {
      const corrupted = HARNESS_ACTION_DEFINITIONS.map((candidate) =>
        candidate.actionId === definition.actionId
          ? Object.fromEntries(
              Object.entries(candidate).filter(([key]) => key !== field),
            )
          : candidate,
      );
      assert.throws(
        () => createHarnessActionRegistry(corrupted),
        /canonical gate metadata/u,
        `${definition.actionId}.${field}`,
      );
    }
  }
});

test('production Harness actions carry the complete canonical gate set', () => {
  const registry = createHarnessActionRegistry(HARNESS_ACTION_DEFINITIONS);

  for (const definition of HARNESS_ACTION_DEFINITIONS) {
    const registered = registry.definition(definition.actionId);
    assert.deepEqual(registered.gateIds, HARNESS_GATE_IDS);
    assert.ok(registered.authoritySource);
  }
  assert.equal(
    HARNESS_ACTION_DEFINITIONS.filter(({ actionId }) =>
      /clone|delete/u.test(actionId),
    ).length,
    0,
  );
  assert.throws(
    () => registry.definition('workflow.clone'),
    HarnessActionAuthorizationError,
  );
  assert.throws(
    () => registry.definition('workflow.delete'),
    HarnessActionAuthorizationError,
  );
  assert.throws(
    () => registry.authorize({ caller: 'server' } as never),
    HarnessActionAuthorizationError,
  );
});

test('media completion cannot signal a workflow in another workspace', async () => {
  await assert.rejects(
    sendHarnessMediaJobTerminal({
      workspaceId: 'workspace-a',
      jobId: 'job-1',
      kind: 'model.media-generation',
      payload: {
        submission: {
          correlationId: 'workflow-1',
          workspaceId: 'workspace-b',
        },
      },
      status: 'completed',
    }),
    HarnessActionAuthorizationError,
  );
});
