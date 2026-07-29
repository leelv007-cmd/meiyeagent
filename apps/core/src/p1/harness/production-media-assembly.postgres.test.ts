import assert from 'node:assert/strict';
import test from 'node:test';

import { mediaAdmissionRequest } from './dbos-media-admission.fixture.js';
import {
  createProductionHarnessMediaAssembly,
} from './production-media-assembly.js';
import {
  HarnessTaskAdmissionService,
  type HarnessWorkflowInput,
} from './task-admission.js';

const PRODUCTION_JOIN_PENDING =
  'Production media assembly must join admission to DBOS and ContentPackage delivery.';

test('production media assembly joins admission to one durable media delivery', async () => {
  const workflowId = 'production-media-assembly-red';
  const workspaceId = 'workspace-production-media-assembly-red';
  const admitted = mediaAdmissionRequest(workflowId, workspaceId);
  let frozenRequest: HarnessWorkflowInput | undefined;

  const admission = new HarnessTaskAdmissionService(
    {
      async claim(input) {
        frozenRequest = input.request;
        return { kind: 'created' };
      },
    },
    {
      async start(input) {
        assert.deepEqual(input.request.boundedExecution, {
          schemaVersion: 'bounded-execution-snapshot/v1',
          maxIterations: 4,
          maxCostCents: 'unset',
          maxWallClockMs: 'unset',
          maxDelegations: 'unset',
          requiredLimits: ['maxIterations'],
          consumption: {
            iterations: 0,
            costCents: 0,
            wallClockMs: 0,
            delegations: 0,
          },
          stopReason: null,
          triggeredLimit: null,
        });

        // Step 2 replaces this sentinel with the DBOS workflow built by the
        // shared production assembly factory. Keep submit() as the test entry.
        void createProductionHarnessMediaAssembly;
        throw new Error(PRODUCTION_JOIN_PENDING);
      },
    },
    undefined,
    undefined,
    {
      async resolve() {
        return {
          maxIterations: 4,
          maxCostCents: 'unset',
          maxWallClockMs: 'unset',
          maxDelegations: 'unset',
          requiredLimits: ['maxIterations'],
        };
      },
    },
  );

  await admission.submit({
    taskId: workflowId,
    ...admitted.request,
  });

  assert.ok(frozenRequest);
  assert.fail(PRODUCTION_JOIN_PENDING);
});
