import assert from 'node:assert/strict';
import test from 'node:test';
import type { ModelCapabilityRequirementAxis } from '@meiye/contracts';

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

test('production route resolver rejects fallback candidate drift', async () => {
  const snapshot = mediaSnapshot();
  const checkpoint = foundationRoute(snapshot);
  checkpoint.fallbackConsent = true;
  checkpoint.fallbackAuthorized = true;
  checkpoint.maxAttempts = 2;
  checkpoint.allowedCandidates.push({
    ...checkpoint.allowedCandidates[0]!,
    deploymentId: 'deployment-fallback-authorized',
    fallbackRank: 2,
  });
  const frozen = modelSupplyRoute(snapshot);
  frozen.fallbackConsent = true;
  frozen.fallbackAuthorized = true;
  frozen.maxAttempts = 2;
  frozen.requestedSelection = {
    ...frozen.requestedSelection,
    fallbackConsent: true,
  };
  frozen.allowedCandidates?.push({
    ...frozen.allowedCandidates[0]!,
    deploymentId: 'deployment-fallback-drifted',
    fallbackRank: 2,
  });
  const freezeInputs: unknown[] = [];
  const resolver = new ProductionHarnessFrozenRouteSnapshotResolver(
    {
      async getRouteSnapshot() {
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

  await assert.rejects(
    resolver.resolve(snapshot),
    (error: unknown) =>
      error instanceof Error &&
      error.name === 'HarnessAdmissionError' &&
      'code' in error &&
      error.code === 'FROZEN_ROUTE_MISMATCH',
  );
  assert.deepEqual(freezeInputs, [
    {
      catalogModelId: snapshot.catalogModel.id,
      dataClass: ['contains_face'],
      fallbackConsent: true,
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
      name: 'missing frozen capability revision',
      frozen: { ...frozen, capabilityRevisionId: undefined },
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

test('unknown capability uses the live platform default and freezes fallback facts', async () => {
  const snapshot = mediaSnapshot();
  const checkpoint = foundationRoute(snapshot);
  const frozen = modelSupplyRoute(snapshot);
  const defaultOperations: string[] = [];
  const resolver = new ProductionHarnessFrozenRouteSnapshotResolver(
    {
      async getRouteSnapshot() {
        return structuredClone(checkpoint);
      },
    },
    {
      async freezeFixedRouteForExecution() {
        return structuredClone(frozen);
      },
    },
    {
      async resolve(operation) {
        defaultOperations.push(operation);
        return {
          catalogModelId: frozen.actualCatalogModelId,
          deploymentId: frozen.deploymentId,
          activationEvidenceStatus: 'live_verified',
          activationEvidenceRef: 'probe://deployment-route/live',
          configurationRevision: 'config-route-r1',
        };
      },
    },
  );
  const requirement: ModelCapabilityRequirementAxis = {
    axisId: 'imagePrimary',
    vocabularyVersion: 'model-capability-v1',
    requiredProtocolCapabilities: [],
    requiredModalities: ['image/*'],
    requiredBusinessTags: [],
    requiredModalityCapabilities: [],
    unknownPolicy: 'conservative_always_available',
  };

  const result = await resolver.resolve(snapshot, {
    requirements: [requirement],
  });

  assert.deepEqual(defaultOperations, ['image.generate']);
  assert.deepEqual(result.capabilityRequirements, [requirement]);
  assert.deepEqual(result.capabilityMatches, [
    {
      axisId: 'imagePrimary',
      deploymentId: 'deployment-route',
      outcome: 'conservative_fallback',
      reasons: ['capability_unknown:modality:image/*'],
      evidenceRefs: [],
    },
  ]);
  assert.deepEqual(result.capabilityFallbackFacts, [
    {
      axisId: 'imagePrimary',
      deploymentId: 'deployment-route',
      reason: 'capability_unknown',
      platformDefaultDeploymentId: 'deployment-route',
      activationEvidenceRef: 'probe://deployment-route/live',
      configurationRevision: 'config-route-r1',
    },
  ]);
});

test('explicit media capability remains on the confirmed route without platform fallback', async () => {
  const snapshot = mediaSnapshot();
  const frozen = modelSupplyRoute(snapshot);
  const candidate = frozen.allowedCandidates?.[0];
  assert.ok(candidate);
  candidate.capabilityProfile = {
    vocabularyVersion: 'model-capability-v1',
    protocolCapabilities: {},
    modalities: [
      {
        mime: 'image/*',
        supported: true,
        basis: 'inferred',
        evidenceRef: 'catalog-model:model-route:modality:image/*',
      },
    ],
    businessTags: [],
    modalityCapabilities: [],
  };
  let platformDefaultResolutions = 0;
  const resolver = new ProductionHarnessFrozenRouteSnapshotResolver(
    {
      async getRouteSnapshot() {
        return foundationRoute(snapshot);
      },
    },
    {
      async freezeFixedRouteForExecution() {
        return structuredClone(frozen);
      },
    },
    {
      async resolve() {
        platformDefaultResolutions += 1;
        throw new Error('Platform fallback must not run.');
      },
    },
  );
  const requirement: ModelCapabilityRequirementAxis = {
    axisId: 'imagePrimary',
    vocabularyVersion: 'model-capability-v1',
    requiredProtocolCapabilities: [],
    requiredModalities: ['image/*'],
    requiredBusinessTags: [],
    requiredModalityCapabilities: [],
    unknownPolicy: 'conservative_always_available',
  };

  const result = await resolver.resolve(snapshot, {
    requirements: [requirement],
  });

  assert.equal(platformDefaultResolutions, 0);
  assert.deepEqual(result.capabilityMatches, [
    {
      axisId: 'imagePrimary',
      deploymentId: 'deployment-route',
      outcome: 'eligible',
      reasons: [],
      evidenceRefs: ['catalog-model:model-route:modality:image/*'],
    },
  ]);
  assert.equal(result.capabilityFallbackFacts, undefined);
});

test('unknown capability refreezes a different live platform default as the final durable route', async () => {
  const snapshot = mediaSnapshot();
  const original = modelSupplyRoute(snapshot);
  const fallback = platformDefaultRoute(snapshot);
  const freezeInputs: unknown[] = [];
  const resolver = new ProductionHarnessFrozenRouteSnapshotResolver(
    {
      async getRouteSnapshot() {
        return foundationRoute(snapshot);
      },
    },
    {
      async freezeFixedRouteForExecution(input) {
        freezeInputs.push(structuredClone(input));
        return structuredClone(
          input.deploymentId === fallback.deploymentId ? fallback : original,
        );
      },
    },
    {
      async resolve() {
        return {
          catalogModelId: fallback.actualCatalogModelId,
          deploymentId: fallback.deploymentId,
          activationEvidenceStatus: 'live_verified',
          activationEvidenceRef: 'probe://deployment-default/live',
          configurationRevision: 'config-default-r1',
        };
      },
    },
  );

  const result = await resolver.resolve(snapshot, {
    requirements: [
      {
        axisId: 'imagePrimary',
        vocabularyVersion: 'model-capability-v1',
        requiredProtocolCapabilities: [],
        requiredModalities: ['image/*'],
        requiredBusinessTags: [],
        requiredModalityCapabilities: [],
        unknownPolicy: 'conservative_always_available',
      },
    ],
  });

  assert.deepEqual(freezeInputs, [
    {
      catalogModelId: snapshot.catalogModel.id,
      dataClass: ['contains_face'],
      operation: 'image.generate',
      workspaceId: snapshot.workspaceId,
    },
    {
      catalogModelId: 'model-platform-default',
      dataClass: ['contains_face'],
      deploymentId: 'deployment-default',
      operation: 'image.generate',
      workspaceId: snapshot.workspaceId,
    },
  ]);
  assert.equal(result.id, 'route-platform-default');
  assert.equal(result.actualCatalogModelId, 'model-platform-default');
  assert.equal(result.deploymentId, 'deployment-default');
  assert.equal(
    result.allowedCandidates?.[0]?.activationStatus,
    'live_verified',
  );
  assert.deepEqual(result.capabilityMatches, [
    {
      axisId: 'imagePrimary',
      deploymentId: 'deployment-route',
      outcome: 'conservative_fallback',
      reasons: ['capability_unknown:modality:image/*'],
      evidenceRefs: [],
    },
  ]);
  assert.deepEqual(result.capabilityFallbackFacts, [
    {
      axisId: 'imagePrimary',
      deploymentId: 'deployment-route',
      reason: 'capability_unknown',
      platformDefaultDeploymentId: 'deployment-default',
      activationEvidenceRef: 'probe://deployment-default/live',
      configurationRevision: 'config-default-r1',
    },
  ]);
});

test('platform registry evidence authorizes a fixture fallback route', async () => {
  const snapshot = mediaSnapshot();
  const original = modelSupplyRoute(snapshot);
  const fallback = platformDefaultRoute(snapshot);
  const fallbackCandidate = fallback.allowedCandidates?.[0];
  assert.ok(fallbackCandidate);
  fallbackCandidate.activationStatus = 'recorded';
  const resolver = new ProductionHarnessFrozenRouteSnapshotResolver(
    {
      async getRouteSnapshot() {
        return foundationRoute(snapshot);
      },
    },
    {
      async freezeFixedRouteForExecution(input) {
        return structuredClone(
          input.deploymentId === fallback.deploymentId ? fallback : original,
        );
      },
    },
    {
      async resolve() {
        return {
          catalogModelId: fallback.actualCatalogModelId,
          deploymentId: fallback.deploymentId,
          activationEvidenceStatus: 'live_verified',
        };
      },
    },
  );

  const result = await resolver.resolve(snapshot, {
    requirements: [
      {
        axisId: 'imagePrimary',
        vocabularyVersion: 'model-capability-v1',
        requiredProtocolCapabilities: [],
        requiredModalities: ['image/*'],
        requiredBusinessTags: [],
        requiredModalityCapabilities: [],
        unknownPolicy: 'conservative_always_available',
      },
    ],
  });

  assert.equal(result.deploymentId, fallback.deploymentId);
  assert.equal(result.capabilityFallbackFacts?.[0]?.axisId, 'imagePrimary');
});

function platformDefaultRoute(
  snapshot: ReturnType<typeof mediaSnapshot>,
): RouteSnapshot {
  const route = modelSupplyRoute(snapshot);
  const candidate = route.allowedCandidates?.[0];
  assert.ok(candidate);
  return {
    ...route,
    id: 'route-platform-default',
    capabilityRevisionId: 'capability-default-r1',
    requestedSelection: {
      mode: 'fixed',
      catalogModelId: 'model-platform-default',
    },
    candidateCatalogModelIds: ['model-platform-default'],
    actualCatalogModelId: 'model-platform-default',
    deploymentId: 'deployment-default',
    allowedCandidates: [
      {
        ...candidate,
        catalogModelId: 'model-platform-default',
        deploymentId: 'deployment-default',
        modelDisplayName: 'Platform default fixture',
        stableModelName: 'platform-default-fixture',
        activationStatus: 'live_verified',
      },
    ],
  };
}

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
        unitPriceMicros: 1,
        currency: 'CNY',
        unit: 'image',
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
    capabilityRevisionId: 'capability-r1',
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
