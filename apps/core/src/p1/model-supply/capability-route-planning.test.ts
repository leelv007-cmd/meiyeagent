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
  matchRuntimeCapabilityRequirement,
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

const exactTextReferenceImageRequirement: ModelCapabilityRequirementAxis = {
  axisId: 'textResponse',
  vocabularyVersion: 'model-capability-v1',
  requiredProtocolCapabilities: [],
  requiredModalities: ['text/plain', 'image/*'],
  requiredBusinessTags: [],
  requiredModalityCapabilities: [],
  unknownPolicy: 'conservative_always_available',
};

function textModel(id: string, qualityRank: number): CatalogModel {
  return {
    id,
    modality: 'llm',
    operations: ['text.respond'],
    displayName: id,
    qualityRank,
  };
}

function textDeployment(input: {
  id: string;
  catalogModelId: string;
  supportsReferenceImage: boolean;
}): ModelDeployment {
  return {
    id: input.id,
    catalogModelId: input.catalogModelId,
    apiFamily: 'openai',
    channel: 'managed',
    region: 'domestic',
    status: 'active',
    executionChannelId: `channel-${input.id}`,
    credentialVersion: `credential-${input.id}`,
    priceRevision: `price-${input.id}`,
    unitPrice: {
      amountMicros: 100_000,
      currency: 'CNY',
      unit: 'request',
    },
    capabilityProfile: {
      vocabularyVersion: 'model-capability-v1',
      protocolCapabilities: {},
      modalities: [
        {
          mime: 'text/plain',
          supported: true,
          basis: 'explicit_override',
          evidenceRef: `test:${input.id}:text`,
        },
        {
          mime: 'image/*',
          supported: input.supportsReferenceImage,
          basis: 'explicit_override',
          evidenceRef: `test:${input.id}:reference-image`,
        },
      ],
      businessTags: [],
      modalityCapabilities: [],
    },
  };
}

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

test('exact-text route identity pins the capability revision before snapshot creation', async () => {
  const visionModel = textModel('vision-text', 90);
  const visionDeployment = textDeployment({
    id: 'vision-text-direct',
    catalogModelId: visionModel.id,
    supportsReferenceImage: true,
  });
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
        entries: [toRuntimeCapabilityEntry(visionDeployment)],
        publishedAt: `2026-07-30T00:01:0${number}.000Z`,
        ...(previousRevisionId ? { previousRevisionId } : {}),
      }),
    );
  applyRevision('exact-text-capability-r1', 1);
  const application = new ModelSupplyApplicationService({
    models: [visionModel],
    deployments: [visionDeployment],
    execution: new RecordedProviderExecutionPort(),
    capabilityHotAssembly: hotAssembly,
  });

  const first = await application.freezeAutoTextRouteForExecution({
    workspaceId: 'workspace-exact-text-revision',
    dataClass: [],
  });
  applyRevision(
    'exact-text-capability-r2',
    2,
    'exact-text-capability-r1',
  );
  const second = await application.freezeAutoTextRouteForExecution({
    workspaceId: 'workspace-exact-text-revision',
    dataClass: [],
  });

  assert.equal(first.capabilityRevisionId, 'exact-text-capability-r1');
  assert.equal(second.capabilityRevisionId, 'exact-text-capability-r2');
  assert.notEqual(second.id, first.id);
});

test('exact-text planning selects a reference-image capable deployment over a higher-ranked text-only deployment', async () => {
  const textOnlyModel = textModel('quality-text-only', 100);
  const visionModel = textModel('quality-vision', 90);
  const textOnlyDeployment = textDeployment({
    id: 'quality-text-only-direct',
    catalogModelId: textOnlyModel.id,
    supportsReferenceImage: false,
  });
  const visionDeployment = textDeployment({
    id: 'quality-vision-direct',
    catalogModelId: visionModel.id,
    supportsReferenceImage: true,
  });
  const hotAssembly = new CapabilityHotAssemblyRegistry();
  hotAssembly.applyCapabilityRevision(
    projectCapabilityRevision({
      revisionId: 'exact-text-vision-r1',
      number: 1,
      entries: [
        toRuntimeCapabilityEntry(textOnlyDeployment),
        toRuntimeCapabilityEntry(visionDeployment),
      ],
      publishedAt: '2026-07-30T00:02:00.000Z',
    }),
  );
  const application = new ModelSupplyApplicationService({
    models: [textOnlyModel, visionModel],
    deployments: [textOnlyDeployment, visionDeployment],
    execution: new RecordedProviderExecutionPort(),
    capabilityHotAssembly: hotAssembly,
  });

  const route = await application.freezeAutoTextRouteForExecution({
    workspaceId: 'workspace-exact-text-vision',
    dataClass: [],
  });

  assert.equal(route.actualCatalogModelId, visionModel.id);
  assert.equal(route.deploymentId, visionDeployment.id);
  assert.deepEqual(
    route.capabilityRequirements,
    [exactTextReferenceImageRequirement],
  );
  assert.equal(route.capabilityMatches?.[0]?.outcome, 'eligible');
});

test('exact-text planning fails closed before provider I/O when no deployment supports reference images', async () => {
  const textOnlyModel = textModel('text-only', 100);
  const textOnlyDeployment = textDeployment({
    id: 'text-only-direct',
    catalogModelId: textOnlyModel.id,
    supportsReferenceImage: false,
  });
  const hotAssembly = new CapabilityHotAssemblyRegistry();
  hotAssembly.applyCapabilityRevision(
    projectCapabilityRevision({
      revisionId: 'exact-text-no-vision-r1',
      number: 1,
      entries: [toRuntimeCapabilityEntry(textOnlyDeployment)],
      publishedAt: '2026-07-30T00:03:00.000Z',
    }),
  );
  let providerCalls = 0;
  const application = new ModelSupplyApplicationService({
    models: [textOnlyModel],
    deployments: [textOnlyDeployment],
    execution: {
      async execute() {
        providerCalls += 1;
        throw new Error('Provider I/O must not run.');
      },
    },
    capabilityHotAssembly: hotAssembly,
  });

  await assert.rejects(
    application.freezeAutoTextRouteForExecution({
      workspaceId: 'workspace-exact-text-no-vision',
      dataClass: [],
    }),
    /No compliant text\.respond deployment/u,
  );
  assert.equal(providerCalls, 0);
});

test('exact-text planning does not freeze an unknown capability as reference-image capable', async () => {
  const unknownModel = textModel('unknown-text', 100);
  const unknownDeployment: ModelDeployment = {
    ...textDeployment({
      id: 'unknown-text-direct',
      catalogModelId: unknownModel.id,
      supportsReferenceImage: true,
    }),
    capabilityProfile: undefined,
  };
  const unknownMatch = matchRuntimeCapabilityRequirement(
    unknownDeployment,
    exactTextReferenceImageRequirement,
  );
  assert.equal(unknownMatch.outcome, 'conservative_fallback');
  assert.deepEqual(unknownMatch.reasons, [
    'capability_unknown:modality:text/plain',
    'capability_unknown:modality:image/*',
  ]);

  const hotAssembly = new CapabilityHotAssemblyRegistry();
  hotAssembly.applyCapabilityRevision(
    projectCapabilityRevision({
      revisionId: 'exact-text-unknown-r1',
      number: 1,
      entries: [toRuntimeCapabilityEntry(unknownDeployment)],
      publishedAt: '2026-07-30T00:04:00.000Z',
    }),
  );
  let providerCalls = 0;
  const application = new ModelSupplyApplicationService({
    models: [unknownModel],
    deployments: [unknownDeployment],
    execution: {
      async execute() {
        providerCalls += 1;
        throw new Error('Provider I/O must not run.');
      },
    },
    capabilityHotAssembly: hotAssembly,
  });

  await assert.rejects(
    application.freezeAutoTextRouteForExecution({
      workspaceId: 'workspace-exact-text-unknown',
      dataClass: [],
    }),
    /No confirmed reference-image capable text\.respond deployment/u,
  );
  assert.equal(providerCalls, 0);
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
