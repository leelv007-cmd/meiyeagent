import assert from 'node:assert/strict';
import test from 'node:test';

import { createCreationExecutionSnapshot } from '../execution-spine/creation-execution-snapshot.js';
import type { RouteSnapshot as FoundationRouteSnapshot } from '../foundation/domain.js';
import type { RouteSnapshot } from '../model-supply/index.js';
import { ProductionHarnessFrozenRouteSnapshotResolver } from './production-frozen-route.js';

test('production route resolver freezes the confirmed checkpoint once', async () => {
  const snapshot = mediaSnapshot();
  const checkpoint = foundationRoute(snapshot);
  const frozen = modelSupplyRoute(snapshot);
  const freezeInputs: unknown[] = [];
  const resolver = new ProductionHarnessFrozenRouteSnapshotResolver(
    {
      async getRouteSnapshot(workspaceId, routeId) {
        assert.equal(workspaceId, snapshot.workspaceId);
        assert.equal(routeId, snapshot.route.id);
        return structuredClone(checkpoint);
      },
    },
    {
      async freezeFixedRouteForExecution(input) {
        freezeInputs.push(structuredClone(input));
        return structuredClone(frozen);
      },
    },
  );

  assert.deepEqual(await resolver.resolve(snapshot), frozen);
  assert.deepEqual(freezeInputs, [
    {
      catalogModelId: snapshot.catalogModel.id,
      dataClass: ['contains_face'],
      operation: 'image.generate',
      workspaceId: snapshot.workspaceId,
    },
  ]);
});

test('production route resolver rejects stale or incomplete route facts before admission', async () => {
  const snapshot = mediaSnapshot();
  const checkpoint = foundationRoute(snapshot);
  const frozen = modelSupplyRoute(snapshot);
  const cases: Array<{
    checkpoint?: FoundationRouteSnapshot | null;
    expectedFreezes?: number;
    frozen?: RouteSnapshot;
    name: string;
  }> = [
    { name: 'missing checkpoint', checkpoint: null, expectedFreezes: 0 },
    {
      name: 'checkpoint catalog revision',
      checkpoint: { ...checkpoint, catalogRevision: 'catalog-stale' },
      expectedFreezes: 0,
    },
    {
      name: 'checkpoint model',
      checkpoint: { ...checkpoint, requestedCatalogModelId: 'model-stale' },
      expectedFreezes: 0,
    },
    {
      name: 'checkpoint selection mode',
      checkpoint: { ...checkpoint, selectionMode: 'llm_auto' },
      expectedFreezes: 0,
    },
    { name: 'frozen route id', frozen: { ...frozen, id: 'route-stale' } },
    {
      name: 'frozen catalog revision',
      frozen: { ...frozen, catalogRevisionId: 'catalog-stale' },
    },
    {
      name: 'frozen actual model',
      frozen: { ...frozen, actualCatalogModelId: 'model-stale' },
    },
    {
      name: 'frozen selection',
      frozen: {
        ...frozen,
        requestedSelection: { mode: 'auto', profile: 'quality' },
      },
    },
    {
      name: 'frozen fixed selection model',
      frozen: {
        ...frozen,
        requestedSelection: {
          mode: 'fixed',
          catalogModelId: 'model-stale',
        },
      },
    },
    {
      name: 'frozen data class',
      frozen: { ...frozen, dataClass: ['pii'] },
    },
    {
      name: 'frozen execution candidate',
      frozen: { ...frozen, allowedCandidates: [] },
    },
    {
      name: 'incomplete frozen execution candidate',
      frozen: incompleteCandidateRoute(frozen),
    },
  ];

  for (const current of cases) {
    let freezes = 0;
    const resolver = new ProductionHarnessFrozenRouteSnapshotResolver(
      {
        async getRouteSnapshot() {
          return current.checkpoint === undefined
            ? structuredClone(checkpoint)
            : structuredClone(current.checkpoint);
        },
      },
      {
        async freezeFixedRouteForExecution() {
          freezes += 1;
          return structuredClone(current.frozen ?? frozen);
        },
      },
    );

    await assert.rejects(
      resolver.resolve(snapshot),
      (error: unknown) =>
        error instanceof Error &&
        error.name === 'HarnessAdmissionError' &&
        'code' in error &&
        error.code === 'FROZEN_ROUTE_MISMATCH',
      current.name,
    );
    assert.equal(
      freezes,
      current.expectedFreezes ?? 1,
      current.name,
    );
  }
});

function mediaSnapshot() {
  return createCreationExecutionSnapshot(
    {
      actorId: 'owner-route',
      workspaceId: 'workspace-route',
      idempotencyKey: 'submission-route',
      taskId: 'task-route',
      workId: 'work-route',
      contentPackageId: 'package-route',
      expectedContentPackageRevision: 0,
      creationMode: 'customized',
      intent: '制作护理活动海报',
      surface: { id: 'surface-route', revision: 'surface-r1' },
      recipe: { id: 'recipe-route', revision: 'recipe-r1' },
      lens: 'image',
      operation: 'image.generate',
      platform: { id: 'xiaohongshu' },
      contentPackagePlatform: 'xiaohongshu',
      distributionTarget: 'export',
      deliverable: {
        kind: 'image_set',
        quantity: 1,
        aspectRatio: '9:16',
      },
      deliverables: [
        {
          id: 'image-main',
          kind: 'image',
          order: 0,
          quantity: 1,
          aspectRatio: '9:16',
        },
      ],
      sources: { assets: [] },
      rights: { revision: 'rights-r1', summary: 'authorized' },
      identity: { id: 'identity-route', revision: 'identity-r1' },
      modelPolicy: {
        id: 'policy-route',
        revision: 'policy-r1',
        mode: 'fixed',
      },
      catalogModel: { id: 'model-route', revision: 'catalog-r1' },
      quote: { id: 'quote-route', revision: 'quote-r1' },
      route: { id: 'route-confirmed', revision: 'catalog-r1' },
      briefContext: { id: 'brief-route', revision: 1 },
      contentModules: ['social_cover'],
    },
    '2026-07-29T09:00:00.000Z',
  );
}

function foundationRoute(
  snapshot: ReturnType<typeof mediaSnapshot>,
): FoundationRouteSnapshot {
  return {
    id: snapshot.route.id,
    workspaceId: snapshot.workspaceId,
    catalogRevision: snapshot.route.revision,
    policyRevision: snapshot.modelPolicy.revision,
    priceRevision: 'price-r1',
    requestedCatalogModelId: snapshot.catalogModel.id,
    selectionMode: 'fixed',
    dataClass: 'contains_face',
    dataClasses: ['contains_face'],
    fallbackConsent: false,
    allowedCandidates: [
      {
        catalogModelId: snapshot.catalogModel.id,
        deploymentId: 'deployment-route',
        region: 'cn',
        credentialMode: 'platform',
        credentialVersion: 'credential-r1',
        policyRevision: 'policy-r1',
        priceRevision: 'price-r1',
        fallbackRank: 1,
      },
    ],
    createdAt: '2026-07-29T09:00:00.000Z',
  };
}

function modelSupplyRoute(
  snapshot: ReturnType<typeof mediaSnapshot>,
): RouteSnapshot {
  return {
    id: snapshot.route.id,
    catalogRevisionId: snapshot.route.revision,
    requestedSelection: {
      mode: 'fixed',
      catalogModelId: snapshot.catalogModel.id,
    },
    candidateCatalogModelIds: [snapshot.catalogModel.id],
    actualCatalogModelId: snapshot.catalogModel.id,
    deploymentId: 'deployment-route',
    policyRevision: snapshot.modelPolicy.revision,
    priceRevision: 'price-r1',
    credentialMode: 'platform',
    credentialVersion: 'credential-r1',
    fallbackConsent: false,
    reason: 'fixed_selection',
    dataClass: ['contains_face'],
    allowedCandidates: [
      {
        catalogModelId: snapshot.catalogModel.id,
        deploymentId: 'deployment-route',
        modelModality: 'image',
        modelOperations: ['image.generate'],
        modelDisplayName: 'Route fixture',
        modelQualityRank: 100,
        modelManufacturer: 'fixture',
        modelCapabilities: ['image.generate'],
        apiFamily: 'image',
        channel: 'direct',
        region: 'domestic',
        deploymentStatus: 'active',
        allowedDataClasses: ['contains_face'],
        stableModelName: 'route-fixture',
        modelVersion: '1',
        credentialMode: 'platform',
        credentialVersion: 'credential-r1',
        policyRevision: 'policy-r1',
        priceRevision: 'price-r1',
        unitPriceMicros: 1,
        currency: 'CNY',
        unit: 'image',
        fallbackRank: 1,
      },
    ],
    createdAt: '2026-07-29T09:00:00.000Z',
  };
}

function incompleteCandidateRoute(route: RouteSnapshot) {
  const incomplete = structuredClone(route);
  const candidate = incomplete.allowedCandidates?.[0];
  assert.ok(candidate);
  candidate.modelDisplayName = '';
  return incomplete;
}
