/**
 * V31-14 production live facts reader for DBOS fence seam.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { COMPILED_EXECUTION_PLAN_SCHEMA_VERSION } from '@meiye/contracts';

import {
  buildExecutionPlanSnapshot,
  evaluateExecutionPlanStaleness,
  freezeExecutionPlanContent,
  type ExecutionPlanFrozenContent,
} from './execution-plan-admission.js';
import {
  createAuthoritativeExecutionPlanLiveFactsPorts,
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

test('missing production head adapters fail closed instead of treating frozen refs as current', async () => {
  const live = await resolveExecutionPlanLiveFactsFromPorts({
    snapshot: snapshot(),
    workspaceId: 'ws-1',
    ports: {},
  });
  assert.equal(live.rightsRevoked, true);
  assert.deepEqual(live.rightsRevisionRefs, []);
  assert.deepEqual(live.factRevisionRefs, []);
  assert.equal(live.contextDrifted, true);
  assert.notEqual(live.quoteRevision, snapshot().quoteRef.revision);
});

test('authoritative rights policy head replaces the frozen ref and requires reconfirmation', async () => {
  const frozen = {
    ...snapshot(),
    rightsRevisionRefs: ['rights:ws-1:policy-old'],
  };
  const ports = createAuthoritativeExecutionPlanLiveFactsPorts({
    facts: {
      async history() {
        return [];
      },
      async listActive() {
        return [];
      },
    },
    request: {
      actorId: 'actor-1',
      workspaceId: 'ws-1',
      packageId: 'package-1',
      expectedRevision: 0,
      workflowRevision: 1,
      creationMode: 'customized',
      rawInput: '用门店素材做图文',
      intent: {
        context: {
          workId: 'work-1',
          intent: '用门店素材做图文',
          sourceSummaries: [],
        },
        assetReferences: ['asset-1'],
      },
    },
    rights: {
      async resolve() {
        return { knownAssetIds: ['asset-1'], unauthorizedAssetIds: [] };
      },
      async resolveWithRevision() {
        return {
          knownAssetIds: ['asset-1'],
          rightsRevision: 'rights:ws-1:policy-new',
          unauthorizedAssetIds: [],
        };
      },
    },
  });

  const live = await resolveExecutionPlanLiveFactsFromPorts({
    snapshot: frozen,
    workspaceId: 'ws-1',
    ports,
  });

  assert.deepEqual(live.rightsRevisionRefs, ['rights:ws-1:policy-new']);
  assert.notEqual(live.rightsRevoked, true);
  const staleness = evaluateExecutionPlanStaleness({ snapshot: frozen, live });
  assert.equal(staleness.status, 'stale');
  assert.ok(
    staleness.status === 'stale' && staleness.diff.rightsRevisionRefs,
  );
});

test('unresolved quote and fact heads fail closed', async () => {
  const live = await resolveExecutionPlanLiveFactsFromPorts({
    snapshot: snapshot(),
    workspaceId: 'ws-1',
    ports: {
      async resolveRightsHeads({ rightsRevisionRefs }) {
        return rightsRevisionRefs.map((revisionId) => ({
          revisionId,
          revoked: false,
        }));
      },
      async resolveQuoteHead() {
        return null;
      },
      async resolveFactHeads() {
        return [];
      },
    },
  });
  assert.notEqual(live.quoteRevision, snapshot().quoteRef.revision);
  assert.deepEqual(live.factRevisionRefs, []);
  assert.equal(live.contextDrifted, true);
});

test('missing quote head is projected as a fail-closed live fact', async () => {
  const snap = snapshot();
  const live = await resolveExecutionPlanLiveFactsFromPorts({
    snapshot: snap,
    workspaceId: 'ws-1',
    ports: {
      async resolveQuoteHead() {
        return null;
      },
    },
  });
  assert.equal(live.quoteMissing, true);
});

test('an authorized rights head revision advances without being classified as revoked', async () => {
  const snap = snapshot();
  const live = await resolveExecutionPlanLiveFactsFromPorts({
    snapshot: snap,
    workspaceId: 'ws-1',
    ports: {
      async resolveRightsHeads() {
        return [
          {
            frozenRevisionId: 'rights-1',
            revisionId: 'rights-3',
            revoked: false,
          },
          { revisionId: 'rights-2', revoked: false },
        ];
      },
    },
  });
  assert.equal(live.rightsRevoked, undefined);
  assert.deepEqual(live.rightsRevisionRefs, ['rights-3', 'rights-2']);
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

test('authoritative brief head detects a material store fact changed after freeze', async () => {
  const frozenAt = '2026-08-09T00:00:00.000Z';
  const currentAt = '2026-08-09T00:05:00.000Z';
  const frozenPrice = {
    factId: 'store-project:project-1:price',
    kind: 'price' as const,
    revision: 1,
    effectiveFrom: '2026-08-08T00:00:00.000Z',
    expiresAt: null,
  };
  const currentPrice = {
    ...frozenPrice,
    revision: 2,
    effectiveFrom: '2026-08-09T00:01:00.000Z',
  };
  const ports = createAuthoritativeExecutionPlanLiveFactsPorts({
    facts: {
      async history() {
        return [];
      },
      async listActive({ at }) {
        return [at === frozenAt ? frozenPrice : currentPrice] as never;
      },
    },
    now: () => currentAt,
    request: {
      actorId: 'actor-1',
      workspaceId: 'ws-1',
      packageId: 'package-1',
      expectedRevision: 0,
      workflowRevision: 1,
      creationMode: 'customized',
      rawInput: '做图文',
      intent: {
        context: {
          workId: 'work-1',
          intent: '做图文',
          sourceSummaries: [],
        },
        assetReferences: [],
      },
      executionSnapshot: {
        createdAt: frozenAt,
        briefContext: { id: 'brief-1', revision: 1 },
      } as never,
    },
    rights: {
      async resolve() {
        return { knownAssetIds: [], unauthorizedAssetIds: [] };
      },
    },
  });

  const heads = await ports.resolveFactHeads!({
    workspaceId: 'ws-1',
    factRevisionRefs: ['brief:brief-1@1'],
  });

  assert.equal(heads[0]?.frozenRevisionId, 'brief:brief-1@1');
  assert.notEqual(heads[0]?.factRevisionId, 'brief:brief-1@1');
  assert.equal(heads[0]?.materialPriceOrDateChanged, true);
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
