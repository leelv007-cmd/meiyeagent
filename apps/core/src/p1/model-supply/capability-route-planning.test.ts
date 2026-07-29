import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ModelCapabilityProfile,
  ModelCapabilityRequirementAxis,
} from '@meiye/contracts';
import {
  ModelSupplyApplicationService,
  RecordedProviderExecutionPort,
  type CatalogModel,
  type ModelDeployment,
} from './index.js';
import {
  CapabilityHotAssemblyRegistry,
  projectCapabilityRevision,
  toRuntimeCapabilityEntry,
} from '../supply-registry/hot-assembly.js';

const model: CatalogModel = {
  id: 'image-model',
  modality: 'image',
  operations: ['image.generate'],
  displayName: 'Image model',
  qualityRank: 100,
};

function capabilityProfile(supported: boolean): ModelCapabilityProfile {
  return {
    vocabularyVersion: 'model-capability-v1',
    protocolCapabilities: {},
    modalities: [],
    businessTags: [],
    modalityCapabilities: [
      {
        modality: 'image/*',
        capability: 'cjk-text-render',
        supported,
        channelBound: false,
        basis: 'explicit_override',
        evidenceRef: `test:cjk-text-render:${supported}`,
      },
    ],
  };
}

function deployment(id: string, supported: boolean): ModelDeployment {
  return {
    id,
    catalogModelId: model.id,
    apiFamily: 'image',
    channel: 'managed',
    region: 'domestic',
    status: 'active',
    executionChannelId: `channel-${id}`,
    credentialVersion: `credential-${id}`,
    priceRevision: `price-${id}`,
    unitPrice: {
      amountMicros: 100_000,
      currency: 'CNY',
      unit: 'image',
    },
    capabilityProfile: capabilityProfile(supported),
  };
}

const requirement: ModelCapabilityRequirementAxis = {
  axisId: 'briefImage',
  vocabularyVersion: 'model-capability-v1',
  requiredProtocolCapabilities: [],
  requiredModalities: [],
  requiredBusinessTags: [],
  requiredModalityCapabilities: [
    {
      modality: 'image/*',
      capability: 'cjk-text-render',
    },
  ],
  unknownPolicy: 'conservative_always_available',
};

test('fixed-route planning selects the deployment that satisfies the required capability axis', async () => {
  const application = new ModelSupplyApplicationService({
    models: [model],
    deployments: [
      deployment('unsupported-first', false),
      deployment('supported-second', true),
    ],
    execution: new RecordedProviderExecutionPort(),
  });

  const route = await application.freezeFixedRouteForExecution({
    workspaceId: 'workspace-capability',
    operation: 'image.generate',
    catalogModelId: model.id,
    dataClass: [],
    capabilityRequirements: [requirement],
  });

  assert.equal(route.deploymentId, 'supported-second');
  assert.deepEqual(route.capabilityRequirements, [requirement]);
  assert.deepEqual(route.capabilityMatches, [
    {
      axisId: 'briefImage',
      deploymentId: 'supported-second',
      outcome: 'eligible',
      reasons: [],
      evidenceRefs: ['test:cjk-text-render:true'],
    },
  ]);
});

test('capability requirements are part of the stable frozen route identity', async () => {
  const application = new ModelSupplyApplicationService({
    models: [model],
    deployments: [deployment('supported', true)],
    execution: new RecordedProviderExecutionPort(),
  });
  const input = {
    workspaceId: 'workspace-capability-identity',
    operation: 'image.generate' as const,
    catalogModelId: model.id,
    dataClass: [],
    capabilityRequirements: [requirement],
  };

  const first = await application.freezeFixedRouteForExecution(input);
  const replay = await application.freezeFixedRouteForExecution(input);
  const differentAxis = await application.freezeFixedRouteForExecution({
    ...input,
    capabilityRequirements: [
      {
        ...requirement,
        axisId: 'noteImage',
      },
    ],
  });

  assert.equal(replay.id, first.id);
  assert.notEqual(differentAxis.id, first.id);
});

test('the frozen capability revision changes route identity even without requirements', async () => {
  const runtimeDeployment = deployment('revisioned', true);
  const hotAssembly = new CapabilityHotAssemblyRegistry();
  const applyRevision = (
    revisionId: string,
    number: number,
    previousRevisionId?: string,
  ) =>
    hotAssembly.applyCapabilityRevision(
      projectCapabilityRevision({
        revisionId,
        number,
        entries: [toRuntimeCapabilityEntry(runtimeDeployment)],
        publishedAt: `2026-07-30T00:00:0${number}.000Z`,
        ...(previousRevisionId ? { previousRevisionId } : {}),
      }),
    );
  applyRevision('capability-r1', 1);
  const application = new ModelSupplyApplicationService({
    models: [model],
    deployments: [runtimeDeployment],
    execution: new RecordedProviderExecutionPort(),
    capabilityHotAssembly: hotAssembly,
  });
  const input = {
    workspaceId: 'workspace-capability-revision',
    operation: 'image.generate' as const,
    catalogModelId: model.id,
    dataClass: [],
  };

  const first = await application.freezeFixedRouteForExecution(input);
  applyRevision('capability-r2', 2, 'capability-r1');
  const second = await application.freezeFixedRouteForExecution(input);

  assert.equal(first.capabilityRevisionId, 'capability-r1');
  assert.equal(second.capabilityRevisionId, 'capability-r2');
  assert.notEqual(second.id, first.id);
});

test('fixed unknown capability stays primary instead of becoming an authorized model substitution', async () => {
  const fallbackModel: CatalogModel = {
    ...model,
    id: 'fallback-image-model',
    displayName: 'Fallback image model',
    qualityRank: 90,
  };
  const requestedDeployment: ModelDeployment = {
    ...deployment('requested-unknown', true),
    capabilityProfile: undefined,
  };
  const fallbackDeployment: ModelDeployment = {
    ...deployment('fallback-supported', true),
    catalogModelId: fallbackModel.id,
  };
  const application = new ModelSupplyApplicationService({
    models: [model, fallbackModel],
    deployments: [requestedDeployment, fallbackDeployment],
    execution: new RecordedProviderExecutionPort(),
    planningControlPlane: {
      async readPlanningState() {
        return {
          routePolicy: {
            operation: 'image.generate',
            qualityTier: 'quality',
            hardConstraints: ['deployment_active'],
            candidateDeploymentIds: [
              requestedDeployment.id,
              fallbackDeployment.id,
            ],
            maxAttempts: 2,
            fallbackAuthorized: true,
            modelSubstitutionDegradationSurfaces: {
              [fallbackDeployment.id]: ['text_rendering_consistency'],
            },
          },
        };
      },
    },
  });

  const route = await application.freezeFixedRouteForExecution({
    workspaceId: 'workspace-fixed-conservative',
    operation: 'image.generate',
    catalogModelId: model.id,
    dataClass: [],
    capabilityRequirements: [requirement],
  });

  assert.equal(route.actualCatalogModelId, model.id);
  assert.equal(route.deploymentId, requestedDeployment.id);
  assert.equal(route.capabilityMatches?.[0]?.outcome, 'conservative_fallback');
});
