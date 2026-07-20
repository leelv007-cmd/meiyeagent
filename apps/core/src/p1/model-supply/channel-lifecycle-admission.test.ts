import assert from 'node:assert/strict';
import test from 'node:test';
import { CapabilityHotAssemblyRegistry } from '../supply-registry/hot-assembly.js';
import {
  ModelSupplyApplicationService,
  ModelSupplyProviderAdmissionError,
  RecordedProviderExecutionPort,
  type CatalogModel,
  type ModelDeployment,
} from './index.js';

const model: CatalogModel = {
  id: 'copy-production',
  modality: 'llm',
  operations: ['copy.generate'],
  displayName: 'Production copy',
  qualityRank: 90,
};

const deployment: ModelDeployment = {
  id: 'copy-production-direct',
  catalogModelId: model.id,
  executionChannelId: 'channel-production-direct',
  apiFamily: 'openai',
  channel: 'direct',
  region: 'domestic',
  status: 'active',
};

const imageModel: CatalogModel = {
  id: 'image-production',
  modality: 'image',
  operations: ['image.generate'],
  displayName: 'Production image',
  qualityRank: 90,
};

const imageDeployment: ModelDeployment = {
  id: 'image-production-direct',
  catalogModelId: imageModel.id,
  executionChannelId: 'channel-image-production-direct',
  apiFamily: 'image',
  channel: 'direct',
  region: 'domestic',
  status: 'active',
};

function hotAssembly() {
  const registry = new CapabilityHotAssemblyRegistry();
  registry.applyCapabilityRevision({
    revisionId: 'cap-production-r1',
    number: 1,
    entries: [
      {
        deploymentId: deployment.id,
        catalogModelId: model.id,
        executionChannelId: deployment.executionChannelId,
        apiFamily: deployment.apiFamily,
        channel: deployment.channel,
        region: deployment.region,
        adapterKey: 'direct-llm',
      },
      {
        deploymentId: imageDeployment.id,
        catalogModelId: imageModel.id,
        executionChannelId: imageDeployment.executionChannelId,
        apiFamily: imageDeployment.apiFamily,
        channel: imageDeployment.channel,
        region: imageDeployment.region,
        adapterKey: 'ark-media',
      },
    ],
    publishedAt: '2026-07-20T00:00:00.000Z',
  });
  return registry;
}

test('production submit does not invoke a quarantined execution channel', async () => {
  const lifecycle = hotAssembly();
  lifecycle.isolateChannel(
    deployment.executionChannelId!,
    'operator quarantine',
  );
  let providerCalls = 0;
  const recorded = new RecordedProviderExecutionPort();
  const application = new ModelSupplyApplicationService({
    models: [model],
    deployments: [deployment],
    capabilityHotAssembly: lifecycle,
    execution: {
      async execute(request) {
        providerCalls += 1;
        return recorded.execute(request);
      },
    },
  });

  const result = await application.submit({
    workspaceId: 'workspace-production',
    actorId: 'owner-production',
    idempotencyKey: 'quarantined-submit-1',
    operation: 'copy.generate',
    selection: { mode: 'fixed', catalogModelId: model.id },
    dataClass: [],
    prompt: 'This must not reach the provider.',
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.failureCode, 'channel_isolated');
  assert.equal(result.attempt.acceptance, 'rejected_before_accept');
  assert.equal(providerCalls, 0);
});

test('media provider submit does not invoke a stop-new execution channel', async () => {
  const lifecycle = hotAssembly();
  lifecycle.isolateChannel(
    imageDeployment.executionChannelId!,
    'operator stop new tasks',
  );
  const application = new ModelSupplyApplicationService({
    models: [imageModel],
    deployments: [imageDeployment],
    capabilityHotAssembly: lifecycle,
    execution: new RecordedProviderExecutionPort(),
  });
  let providerCalls = 0;

  await assert.rejects(
    application.executeMediaProviderEffect({
      submission: {
        workspaceId: 'workspace-production',
        actorId: 'owner-production',
        idempotencyKey: 'blocked-media-submit-1',
        operation: 'image.generate',
        selection: { mode: 'fixed', catalogModelId: imageModel.id },
        dataClass: [],
        prompt: 'This image must not reach the provider.',
      },
      effectIdempotencyKey: 'blocked-media-effect-1',
      stage: 'submit',
      async execute() {
        providerCalls += 1;
        return {
          acceptance: 'accepted' as const,
          taskRef: 'provider-task-should-not-exist',
        };
      },
    }),
    (error: unknown) =>
      error instanceof ModelSupplyProviderAdmissionError &&
      error.errorCode === 'channel_isolated',
  );
  assert.equal(providerCalls, 0);
});

test('media provider lifecycle drains accepted work before completing', async () => {
  const lifecycle = hotAssembly();
  const application = new ModelSupplyApplicationService({
    models: [imageModel],
    deployments: [imageDeployment],
    capabilityHotAssembly: lifecycle,
    execution: new RecordedProviderExecutionPort(),
  });
  const acceptedSubmission = {
    workspaceId: 'workspace-production',
    actorId: 'owner-production',
    idempotencyKey: 'accepted-media-submit-1',
    operation: 'image.generate' as const,
    selection: {
      mode: 'fixed' as const,
      catalogModelId: imageModel.id,
    },
    dataClass: [],
    prompt: 'Track this provider task through drain.',
  };

  await application.executeMediaProviderEffect({
    submission: acceptedSubmission,
    effectIdempotencyKey: 'accepted-media-effect-1',
    stage: 'submit',
    async execute() {
      return {
        acceptance: 'accepted' as const,
        taskRef: 'provider-task-accepted-1',
      };
    },
  });
  assert.equal(
    lifecycle.getChannelLifecycle(imageDeployment.executionChannelId!)
      .inFlightCount,
    1,
  );

  lifecycle.startChannelDrain(
    imageDeployment.executionChannelId!,
    'operator draining channel',
  );
  let blockedProviderCalls = 0;
  await assert.rejects(
    application.executeMediaProviderEffect({
      submission: {
        ...acceptedSubmission,
        idempotencyKey: 'blocked-during-drain-media-submit-2',
      },
      effectIdempotencyKey: 'blocked-during-drain-media-effect-2',
      stage: 'submit',
      async execute() {
        blockedProviderCalls += 1;
        return {
          acceptance: 'accepted' as const,
          taskRef: 'provider-task-should-not-exist',
        };
      },
    }),
    (error: unknown) =>
      error instanceof ModelSupplyProviderAdmissionError &&
      error.errorCode === 'channel_draining',
  );
  assert.equal(blockedProviderCalls, 0);
  assert.deepEqual(
    {
      mode: lifecycle.getChannelLifecycle(
        imageDeployment.executionChannelId!,
      ).mode,
      inFlightCount: lifecycle.getChannelLifecycle(
        imageDeployment.executionChannelId!,
      ).inFlightCount,
    },
    { mode: 'draining', inFlightCount: 1 },
  );

  await application.executeMediaProviderEffect({
    submission: acceptedSubmission,
    effectIdempotencyKey: 'accepted-media-poll-1',
    stage: 'poll',
    async execute() {
      return { status: 'completed' as const };
    },
  });
  assert.deepEqual(
    {
      mode: lifecycle.getChannelLifecycle(
        imageDeployment.executionChannelId!,
      ).mode,
      inFlightCount: lifecycle.getChannelLifecycle(
        imageDeployment.executionChannelId!,
      ).inFlightCount,
    },
    { mode: 'draining', inFlightCount: 0 },
  );
  assert.equal(
    lifecycle.completeChannelDrain(
      imageDeployment.executionChannelId!,
      'provider task reached terminal state',
    ).mode,
    'accepting',
  );
});
