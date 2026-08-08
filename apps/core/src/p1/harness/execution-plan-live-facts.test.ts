/**
 * V31-14 production live facts reader for DBOS fence seam.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { COMPILED_EXECUTION_PLAN_SCHEMA_VERSION } from '@meiye/contracts';

import {
  buildExecutionPlanSnapshot,
  freezeExecutionPlanContent,
  type ExecutionPlanFrozenContent,
} from './execution-plan-admission.js';
import {
  createResolveExecutionPlanLiveFacts,
  resolveExecutionPlanLiveFactsFromPorts,
} from './execution-plan-live-facts.js';

function snapshot() {
  const content = {
    planId: 'plan-1',
    planRevision: 1,
    intentDeclaration: { summary: '推广' },
    contextBundleRef: {
      bundleId: 'bundle-1',
      revision: 1,
      hash: 'ctx-hash-1',
    },
    executionPlan: {
      schemaVersion: COMPILED_EXECUTION_PLAN_SCHEMA_VERSION,
      units: [
        {
          unitId: 'unit-1',
          unitType: 'copy.generate',
          primitive: 'generate' as const,
        },
      ],
      dependencyGroups: [{ groupId: 'g1', unitIds: ['unit-1'] }],
      boundedRetry: {
        'unit-1': {
          maxAttempts: 1,
          maxCostCents: 0,
          retry: { enabled: false as const },
        },
      },
    },
    deliverables: [{ deliverableId: 'd1', kind: 'copy', quantity: 1 }],
    promptRevisionRefs: {},
    skillManifestRefs: {},
    routeRequirements: [],
    quoteRef: { id: 'quote-1', revision: 1 },
    rightsRevisionRefs: ['rights-1', 'rights-2'],
    factRevisionRefs: ['fact-1'],
    boundedExecution: {
      schemaVersion: 'bounded-execution-snapshot/v1' as const,
      maxIterations: 10,
      maxCostCents: 100,
      maxWallClockMs: 60_000,
      maxDelegations: 2,
      requiredLimits: ['maxIterations', 'maxCostCents'] as const,
      consumption: {
        iterations: 0,
        costCents: 0,
        wallClockMs: 0,
        delegations: 0,
      },
      stopReason: null,
      triggeredLimit: null,
    },
    harnessReleaseId: 'release-1',
    approvalBasis: 'policy_exempt_copy',
  } as unknown as ExecutionPlanFrozenContent;
  const { snapshotHash } = freezeExecutionPlanContent(content);
  return buildExecutionPlanSnapshot({ content, snapshotHash });
}

test('revoked rights head → rightsRevoked true', async () => {
  const snap = snapshot();
  const live = await resolveExecutionPlanLiveFactsFromPorts({
    snapshot: snap,
    workspaceId: 'ws-1',
    ports: {
      async resolveRightsHeads() {
        return [
          { revisionId: 'rights-1', revoked: false },
          { revisionId: 'rights-2', revoked: true },
        ];
      },
      async resolveQuoteHead() {
        return { quoteId: 'quote-1', revision: 1 };
      },
      async resolveFactHeads() {
        return [{ factRevisionId: 'fact-1' }];
      },
    },
  });
  assert.equal(live.rightsRevoked, true);
  assert.deepEqual(live.rightsRevisionRefs, ['rights-1']);
  assert.equal(live.quoteRevision, 1);
});

test('missing rights head treated as revoked', async () => {
  const snap = snapshot();
  const live = await resolveExecutionPlanLiveFactsFromPorts({
    snapshot: snap,
    workspaceId: 'ws-1',
    ports: {
      async resolveRightsHeads() {
        return [{ revisionId: 'rights-1', revoked: false }];
      },
    },
  });
  assert.equal(live.rightsRevoked, true);
});

test('material price/date fact change sets contextDrifted', async () => {
  const snap = snapshot();
  const live = await resolveExecutionPlanLiveFactsFromPorts({
    snapshot: snap,
    workspaceId: 'ws-1',
    ports: {
      async resolveFactHeads() {
        return [
          { factRevisionId: 'fact-1', materialPriceOrDateChanged: true },
        ];
      },
    },
  });
  assert.equal(live.contextDrifted, true);
});

test('createResolveExecutionPlanLiveFacts skips when no snapshot on request', async () => {
  const resolve = createResolveExecutionPlanLiveFacts({});
  const live = await resolve({
    workflowId: 'wf-1',
    request: {
      actorId: 'a',
      workspaceId: 'ws-1',
      packageId: 'p',
      expectedRevision: 1,
      workflowRevision: 1,
      creationMode: 'customized',
      rawInput: 'x',
      intent: {
        context: { workId: 'w', intent: 'x', sourceSummaries: [] },
        assetReferences: [],
      },
    },
  });
  assert.equal(live, undefined);
});

test('createResolveExecutionPlanLiveFacts binds snapshot path', async () => {
  const snap = snapshot();
  const resolve = createResolveExecutionPlanLiveFacts({
    async resolveQuoteHead() {
      return { quoteId: 'quote-1', revision: 2 };
    },
  });
  const live = await resolve({
    workflowId: 'wf-1',
    request: {
      actorId: 'a',
      workspaceId: 'ws-1',
      packageId: 'p',
      expectedRevision: 1,
      workflowRevision: 1,
      creationMode: 'customized',
      rawInput: 'x',
      intent: {
        context: { workId: 'w', intent: 'x', sourceSummaries: [] },
        assetReferences: [],
      },
      executionPlanSnapshot: snap,
    },
  });
  assert.equal(live?.quoteRevision, 2);
});
