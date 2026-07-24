import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { RecordedAdapterRouter, recordedRequest } from './adapters.js';
import { ModelSupplyApplicationService } from './index.js';
import {
  arkMediaConfigurationRevisionsFromEnv,
  directModelConfigurationRevisionFromEnv,
  modelMediaExecutionMode,
  modelRuntimeAssemblyFromEnv,
  tuziMediaConfigurationRevisionsFromEnv,
  volcengineTtsConfigurationRevisionFromEnv,
} from './runtime-config.js';

test('runtime env assembly exposes honest disabled, recorded, and gateway modes', async () => {
  const disabled = modelRuntimeAssemblyFromEnv({
    MODEL_EXECUTION_MODE: 'disabled',
  });
  assert.equal(disabled.runtime.activation, 'disabled');
  assert.equal(
    disabled.deployments.filter((deployment) => deployment.status === 'active')
      .length,
    0
  );

  const recorded = modelRuntimeAssemblyFromEnv({
    MODEL_EXECUTION_MODE: 'recorded',
  });
  assert.equal(recorded.runtime.activation, 'recorded_only');
  assert.ok(
    recorded.deployments.every((deployment) => deployment.status === 'inactive')
  );
  assert.ok(
    recorded.deployments.every(
      (deployment) => deployment.activationEvidence.status === 'recorded'
    )
  );
  const recordedService = new ModelSupplyApplicationService({
    models: recorded.models,
    deployments: recorded.deployments,
    execution: recorded.runtime.execution,
    runtimeCapabilities: recorded.runtimeCapabilities,
  });
  assert.throws(
    () =>
      recordedService.freezeFixedRoute({
        workspaceId: 'workspace-recorded-contract',
        operation: 'copy.generate',
        catalogModelId: 'llm-openai',
        dataClass: [],
      }),
    /not active/i
  );
  const recordedProbe = await recordedService.executeCopyQualityProbe({
    workspaceId: 'workspace-recorded-contract',
    actorId: 'admin-a',
    idempotencyKey: 'recorded-contract-probe',
    operation: 'copy.generate',
    selection: { mode: 'fixed', catalogModelId: 'llm-openai' },
    dataClass: [],
    prompt: JSON.stringify({ grounding: { name: '测试门店' } }),
  });
  assert.equal(recordedProbe.copyCandidates.length, 3);
  assert.equal(
    recordedProbe.snapshot.allowedCandidates?.[0]?.deploymentStatus,
    'inactive'
  );
  assert.throws(
    () =>
      modelRuntimeAssemblyFromEnv({
        MODEL_EXECUTION_MODE: 'fixture',
      }),
    /restricted to APP_ENV=e2e/
  );
  const fixture = modelRuntimeAssemblyFromEnv({
    APP_ENV: 'e2e',
    MODEL_EXECUTION_MODE: 'fixture',
  });
  assert.equal(fixture.runtime.activation, 'local_fixture_verified');
  assert.equal(modelMediaExecutionMode(fixture.runtime), 'fixture');
  assert.ok(
    fixture.deployments
      .filter(
        (deployment) =>
          deployment.catalogModelId !== 'seed-tts-2' &&
          deployment.apiFamily !== 'audio',
      )
      .every(
        (deployment) =>
          deployment.status === 'active' &&
          deployment.activationEvidence.status === 'recorded' &&
          deployment.activationEvidence.evidenceRef === undefined,
      ),
  );
  assert.ok(
    fixture.deployments
      .filter(
        (deployment) =>
          deployment.apiFamily === 'audio' &&
          deployment.catalogModelId !== 'seed-tts-2',
      )
      .every(
        (deployment) =>
          deployment.status === 'active' &&
          deployment.activationEvidence.status === 'live_verified' &&
          Boolean(deployment.activationEvidence.evidenceRef),
      ),
  );
  assert.equal(
    fixture.deployments.find(
      (deployment) => deployment.catalogModelId === 'seed-tts-2',
    )?.status,
    'inactive',
  );
  const fixtureService = new ModelSupplyApplicationService({
    models: fixture.models,
    deployments: fixture.deployments,
    execution: fixture.runtime.execution,
    runtimeCapabilities: fixture.runtimeCapabilities,
  });
  const customProbe = await fixtureService.executeCopyQualityProbe({
    workspaceId: 'workspace-custom-fixture',
    actorId: 'admin-a',
    idempotencyKey: 'custom-fixture-probe',
    operation: 'copy.generate',
    selection: { mode: 'fixed', catalogModelId: 'llm-custom' },
    dataClass: [],
    prompt: JSON.stringify({ grounding: { name: '测试门店' } }),
  });
  assert.equal(
    customProbe.snapshot.allowedCandidates?.[0]?.apiFamily,
    'custom'
  );
  assert.equal(customProbe.copyCandidates.length, 3);
  assert.ok(customProbe.providerCost.amount > 0);
  const gateway = modelRuntimeAssemblyFromEnv({
    MODEL_EXECUTION_MODE: 'gateway',
    MODEL_GATEWAY_POC: 'litellm',
  });
  assert.equal(gateway.runtime.gateway, 'litellm');
  const veo = gateway.deployments.find(
    (deployment) => deployment.catalogModelId === 'veo-latest'
  );
  assert.equal(veo?.executionChannelId, 'channel-fal-shared-queue');
  assert.equal(veo?.apiCounterparty, 'fal');
  assert.equal(veo?.lifecycleRevision, 'fal-queue-poc-v1');
  assert.equal(
    gateway.deployments.find(
      (deployment) => deployment.catalogModelId === 'seedance-2'
    )?.executionChannelId,
    'channel-seedance-ark-direct'
  );
  assert.ok(
    gateway.deployments
      .filter((deployment) =>
        ['llm-openai', 'llm-anthropic', 'llm-gemini'].includes(
          deployment.catalogModelId
        )
      )
      .every((deployment) => deployment.channel === 'litellm')
  );
  assert.ok(
    gateway.deployments
      .filter((deployment) => deployment.catalogModelId === 'gpt-image-2')
      .every((deployment) => deployment.channel !== 'litellm')
  );
});

test('gateway mode routes only LLM through the gateway and keeps recorded media functional', async () => {
  const gateway = modelRuntimeAssemblyFromEnv({
    MODEL_EXECUTION_MODE: 'gateway',
    MODEL_GATEWAY_POC: 'bifrost',
  });

  const image = await gateway.runtime.execution.execute(
    recordedRequest('gpt-image-2', 'image.generate')
  );
  assert.equal(image.kind, 'completed');
  if (image.kind !== 'completed') throw new Error('Expected recorded image.');
  assert.equal(image.contentType, 'image/png');
  assert.ok(image.assetBytes?.byteLength);
  const imageMetadata = await sharp(image.assetBytes).metadata();
  assert.equal(imageMetadata.height, 320);
  assert.equal(imageMetadata.width, 320);
});

test('direct runtime activates only one explicitly configured LLM catalog model', () => {
  const configured = {
    MODEL_DIRECT_API_KEY: 'configured-secret',
    MODEL_DIRECT_BASE_URL: 'https://provider.example.test/v1',
    MODEL_DIRECT_CATALOG_MODEL_ID: 'llm-openai',
    MODEL_DIRECT_CREDENTIAL_VERSION: 'staging-key-v3',
    MODEL_DIRECT_ENDPOINT_REVISION: 'openai-compatible-v2',
    MODEL_DIRECT_INPUT_COST_PER_MILLION: '1.25',
    MODEL_DIRECT_MODEL: 'provider-copy-model',
    MODEL_DIRECT_OUTPUT_COST_PER_MILLION: '3.5',
    MODEL_EXECUTION_MODE: 'direct',
  };
  const direct = modelRuntimeAssemblyFromEnv(configured);

  assert.equal(direct.runtime.activation, 'configured_unverified');
  assert.equal(
    direct.deployments.filter((deployment) => deployment.status === 'active')
      .length,
    0
  );
  assert.equal(direct.runtimeCapabilities.length, 0);
  const unverifiedService = new ModelSupplyApplicationService({
    models: direct.models,
    deployments: direct.deployments,
    execution: new RecordedAdapterRouter(),
    runtimeCapabilities: direct.runtimeCapabilities,
  });
  assert.throws(
    () =>
      unverifiedService.freezeFixedRoute({
        workspaceId: 'workspace-direct-unverified',
        operation: 'copy.generate',
        catalogModelId: 'llm-openai',
        dataClass: [],
      }),
    /not active|No active deployment/i
  );

  const verifiedAt = '2026-07-12T12:00:00.000Z';
  const configurationRevision =
    directModelConfigurationRevisionFromEnv(configured);
  const envClaim = modelRuntimeAssemblyFromEnv({
    ...configured,
    MODEL_DIRECT_ACTIVATION_EVIDENCE_REF:
      'staging://model-activation/llm-openai/2026-07-12',
    MODEL_DIRECT_ACTIVATION_CONFIGURATION_REVISION: configurationRevision,
    MODEL_DIRECT_ACTIVATION_VERIFIED_AT: verifiedAt,
  });
  assert.equal(envClaim.runtime.activation, 'configured_unverified');
  const probeRunId = `activation-probe-${'a'.repeat(24)}`;
  const verified = modelRuntimeAssemblyFromEnv(configured, {
    'openai-direct-recorded': {
      configurationRevision,
      evidenceRef: probeRunId,
      status: 'live_verified',
      verifiedAt,
    },
  });
  const active = verified.deployments.find(
    (deployment) => deployment.status === 'active'
  );
  assert.equal(verified.runtime.activation, 'live_verified');
  assert.equal(active?.activationEvidence.status, 'live_verified');
  assert.equal(
    active?.activationEvidence.evidenceRef,
    probeRunId
  );
  assert.equal(active?.activationEvidence.verifiedAt, verifiedAt);
  assert.equal(
    active?.activationEvidence.configurationRevision,
    configurationRevision
  );
  assert.equal(active?.providerModel, 'provider-copy-model');
  assert.equal(active?.endpointRevision, 'openai-compatible-v2');
  assert.equal(active?.credentialVersion, 'staging-key-v3');
  const activeModel = verified.models.find(
    (model) => model.id === 'llm-openai'
  );
  assert.equal(activeModel?.stableModelName, 'provider-copy-model');
  assert.equal(activeModel?.version, 'openai-compatible-v2');
  const verifiedService = new ModelSupplyApplicationService({
    models: verified.models,
    deployments: verified.deployments,
    execution: new RecordedAdapterRouter(),
    runtimeCapabilities: verified.runtimeCapabilities,
  });
  const snapshot = verifiedService.freezeFixedRoute({
    workspaceId: 'workspace-direct-verified',
    operation: 'copy.generate',
    catalogModelId: 'llm-openai',
    dataClass: [],
  });
  assert.equal(snapshot.providerModel, 'provider-copy-model');
  assert.equal(snapshot.endpointRevision, 'openai-compatible-v2');
  assert.equal(snapshot.credentialVersion, 'staging-key-v3');
  assert.equal(
    snapshot.allowedCandidates?.[0]?.providerModel,
    'provider-copy-model'
  );
  assert.equal(
    snapshot.allowedCandidates?.[0]?.stableModelName,
    'provider-copy-model'
  );
  assert.equal(
    snapshot.allowedCandidates?.[0]?.modelVersion,
    'openai-compatible-v2'
  );
  assert.equal(
    verifiedService.constrainRuntimeDeployments([
      { ...active!, credentialVersion: 'different-key-version' },
    ])[0]?.status,
    'inactive'
  );

  assert.equal(
    modelRuntimeAssemblyFromEnv(
      { ...configured, MODEL_DIRECT_MODEL: 'provider-copy-model-v2' },
      {
        'openai-direct-recorded': {
          configurationRevision,
          evidenceRef: probeRunId,
          status: 'live_verified',
          verifiedAt,
        },
      }
    ).runtime.activation,
    'configured_unverified'
  );
  assert.doesNotThrow(
    () =>
      modelRuntimeAssemblyFromEnv({
        ...configured,
        MODEL_DIRECT_CATALOG_MODEL_ID: 'llm-anthropic',
      }),
    'llm-anthropic is a native API family and must be accepted'
  );
  assert.throws(
    () =>
      modelRuntimeAssemblyFromEnv({
        MODEL_DIRECT_API_KEY: 'configured-secret',
        MODEL_DIRECT_BASE_URL: 'https://provider.example.test/v1',
        MODEL_DIRECT_CATALOG_MODEL_ID: 'gpt-image-2',
        MODEL_DIRECT_INPUT_COST_PER_MILLION: '1',
        MODEL_DIRECT_MODEL: 'provider-image-model',
        MODEL_DIRECT_OUTPUT_COST_PER_MILLION: '1',
        MODEL_EXECUTION_MODE: 'direct',
      }),
    /API family/
  );
});

test('DeepSeek direct defaults consume the finalized credential key', () => {
  const direct = modelRuntimeAssemblyFromEnv({
    DEEPSEEK_API_KEY: 'deepseek-configured-secret',
    MODEL_DIRECT_CATALOG_MODEL_ID: 'deepseek-v4-pro',
    MODEL_DIRECT_CREDENTIAL_VERSION: 'deepseek-key-v1',
    MODEL_DIRECT_ENDPOINT_REVISION: 'deepseek-openai-compatible-v1',
    MODEL_DIRECT_INPUT_COST_PER_MILLION: '1',
    MODEL_DIRECT_OUTPUT_COST_PER_MILLION: '2',
    MODEL_EXECUTION_MODE: 'direct',
  });

  const model = direct.models.find(
    (candidate) => candidate.id === 'deepseek-v4-pro',
  );
  assert.equal(model?.stableModelName, 'deepseek-v4-pro');
  assert.equal(model?.version, 'deepseek-openai-compatible-v1');
});

test('runtime assembly warns only when live activation evidence has configuration drift', () => {
  const configured = {
    MODEL_DIRECT_API_KEY: 'configured-secret',
    MODEL_DIRECT_BASE_URL: 'https://provider.example.test/v1',
    MODEL_DIRECT_CATALOG_MODEL_ID: 'llm-openai',
    MODEL_DIRECT_CREDENTIAL_VERSION: 'staging-key-v3',
    MODEL_DIRECT_ENDPOINT_REVISION: 'openai-compatible-v2',
    MODEL_DIRECT_INPUT_COST_PER_MILLION: '1.25',
    MODEL_DIRECT_MODEL: 'provider-copy-model',
    MODEL_DIRECT_OUTPUT_COST_PER_MILLION: '3.5',
    MODEL_EXECUTION_MODE: 'direct',
  };
  const deploymentId = 'openai-direct-recorded';
  const configurationRevision =
    directModelConfigurationRevisionFromEnv(configured);
  const evidence = {
    configurationRevision,
    evidenceRef: `activation-probe-${'a'.repeat(24)}`,
    status: 'live_verified' as const,
    verifiedAt: '2026-07-17T00:00:00.000Z',
  };

  const matching = modelRuntimeAssemblyFromEnv(configured, {
    [deploymentId]: evidence,
  });
  assert.deepEqual(matching.warnings, []);

  const drifted = modelRuntimeAssemblyFromEnv(configured, {
    [deploymentId]: {
      ...evidence,
      configurationRevision: '0'.repeat(64),
    },
  });
  assert.equal(drifted.runtime.activation, 'configured_unverified');
  assert.equal(drifted.warnings.length, 1);
  assert.equal(drifted.warnings[0]?.deploymentId, deploymentId);
  assert.match(drifted.warnings[0]?.message ?? '', /openai-direct-recorded/);
  assert.match(
    drifted.warnings[0]?.message ?? '',
    /configuration drift, activation evidence invalidated, re-probe required/,
  );
});

test('direct runtime accepts the custom LLM deployment with an explicit protocol', () => {
  const configured = {
    MODEL_DIRECT_API_KEY: 'configured-secret',
    MODEL_DIRECT_BASE_URL: 'https://custom.example.test/v1',
    MODEL_DIRECT_CATALOG_MODEL_ID: 'llm-custom',
    MODEL_DIRECT_CREDENTIAL_VERSION: 'custom-key-v1',
    MODEL_DIRECT_CUSTOM_PROTOCOL: 'openai_chat',
    MODEL_DIRECT_ENDPOINT_REVISION: 'custom-openai-v1',
    MODEL_DIRECT_INPUT_COST_PER_MILLION: '1',
    MODEL_DIRECT_MODEL: 'custom-copy-model',
    MODEL_DIRECT_OUTPUT_COST_PER_MILLION: '2',
    MODEL_EXECUTION_MODE: 'direct',
  };
  const runtime = modelRuntimeAssemblyFromEnv(configured);

  assert.equal(runtime.runtime.activation, 'configured_unverified');
  const deployment = runtime.deployments.find(
    (candidate) => candidate.catalogModelId === 'llm-custom'
  );
  assert.equal(deployment?.apiFamily, 'custom');
  assert.equal(deployment?.providerModel, 'custom-copy-model');
  assert.notEqual(
    directModelConfigurationRevisionFromEnv(configured),
    directModelConfigurationRevisionFromEnv({
      ...configured,
      MODEL_DIRECT_CUSTOM_PROTOCOL: 'anthropic_messages',
    })
  );
});

test('direct runtime rejects missing or misplaced custom protocol configuration', () => {
  const configured = {
    MODEL_DIRECT_API_KEY: 'configured-secret',
    MODEL_DIRECT_BASE_URL: 'https://custom.example.test/v1',
    MODEL_DIRECT_CATALOG_MODEL_ID: 'llm-custom',
    MODEL_DIRECT_CREDENTIAL_VERSION: 'custom-key-v1',
    MODEL_DIRECT_ENDPOINT_REVISION: 'custom-v1',
    MODEL_DIRECT_INPUT_COST_PER_MILLION: '1',
    MODEL_DIRECT_MODEL: 'custom-copy-model',
    MODEL_DIRECT_OUTPUT_COST_PER_MILLION: '2',
    MODEL_EXECUTION_MODE: 'direct',
  };

  assert.throws(
    () => modelRuntimeAssemblyFromEnv(configured),
    /MODEL_DIRECT_CUSTOM_PROTOCOL must be/
  );
  assert.throws(
    () =>
      modelRuntimeAssemblyFromEnv({
        ...configured,
        MODEL_DIRECT_CATALOG_MODEL_ID: 'llm-openai',
        MODEL_DIRECT_CUSTOM_PROTOCOL: 'openai_chat',
      }),
    /only supported by the custom API family/
  );
});

test('Ark media runtime activates Seedream and Seedance independently only with matching live evidence', () => {
  const configured = {
    ARK_MEDIA_API_KEY: 'configured-ark-secret',
    ARK_MEDIA_BASE_URL: 'https://ark.example.test/api/v3',
    ARK_MEDIA_CREDENTIAL_VERSION: 'ark-key-v3',
    ARK_MEDIA_ENDPOINT_REVISION: 'ark-media-v1',
    ARK_MEDIA_SOURCE_URL_TTL_SECONDS: '3600',
    ARK_SEEDANCE_COST_PER_MILLION_TOKENS_CNY: '28',
    ARK_SEEDANCE_ESTIMATED_TOKENS_PER_SECOND: '10000',
    ARK_SEEDANCE_MODEL: 'doubao-seedance-2-0-test',
    ARK_SEEDREAM_COST_PER_IMAGE_CNY: '0.22',
    ARK_SEEDREAM_MODEL: 'doubao-seedream-5-0-test',
    MODEL_EXECUTION_MODE: 'recorded',
    MODEL_MEDIA_EXECUTION_MODE: 'ark',
  };
  const unverified = modelRuntimeAssemblyFromEnv(configured);
  assert.equal(unverified.runtime.activation, 'configured_unverified');
  assert.ok(unverified.runtime.media);
  assert.equal(unverified.runtimeCapabilities.length, 0);
  assert.ok(
    unverified.deployments
      .filter((deployment) =>
        ['seedream-5-pro', 'seedance-2'].includes(deployment.catalogModelId)
      )
      .every((deployment) => deployment.status === 'inactive')
  );

  const revisions = arkMediaConfigurationRevisionsFromEnv(configured);
  const revisionsWithAssetHosts = arkMediaConfigurationRevisionsFromEnv({
    ...configured,
    ARK_MEDIA_ASSET_SOURCE_HOSTS:
      'images.provider-cdn.test, videos.provider-cdn.test',
  });
  const revisionsWithReorderedAssetHosts = arkMediaConfigurationRevisionsFromEnv({
    ...configured,
    ARK_MEDIA_ASSET_SOURCE_HOSTS:
      'videos.provider-cdn.test,images.provider-cdn.test',
  });
  assert.notEqual(revisions.image, revisionsWithAssetHosts.image);
  assert.notEqual(revisions.video, revisionsWithAssetHosts.video);
  assert.deepEqual(
    revisionsWithAssetHosts,
    revisionsWithReorderedAssetHosts,
  );
  for (const invalidHosts of [
    '*.provider-cdn.test',
    'https://provider-cdn.test',
    'provider-cdn.test/path',
    'provider-cdn.test:8443',
  ]) {
    assert.throws(
      () =>
        arkMediaConfigurationRevisionsFromEnv({
          ...configured,
          ARK_MEDIA_ASSET_SOURCE_HOSTS: invalidHosts,
        }),
      /must contain exact comma-separated hostnames/,
    );
  }
  const verifiedAt = '2026-07-14T12:00:00.000Z';
  const verified = modelRuntimeAssemblyFromEnv(configured, {
    'seedance-2-direct': {
      configurationRevision: revisions.video,
      evidenceRef: `activation-probe-${'b'.repeat(24)}`,
      status: 'live_verified',
      verifiedAt,
    },
    'seedream-5-pro-direct': {
      configurationRevision: revisions.image,
      evidenceRef: `activation-probe-${'c'.repeat(24)}`,
      status: 'live_verified',
      verifiedAt,
    },
  });

  assert.equal(verified.runtime.activation, 'live_verified');
  assert.deepEqual(
    verified.runtimeCapabilities
      .map((capability) => capability.catalogModelId)
      .sort(),
    ['seedance-2', 'seedream-5-pro']
  );
  const seedream = verified.deployments.find(
    (deployment) => deployment.catalogModelId === 'seedream-5-pro'
  );
  const seedance = verified.deployments.find(
    (deployment) => deployment.catalogModelId === 'seedance-2'
  );
  assert.equal(seedream?.status, 'active');
  assert.equal(seedream?.providerModel, 'doubao-seedream-5-0-test');
  assert.equal(seedream?.credentialVersion, 'ark-key-v3');
  assert.equal(seedream?.endpointRevision, 'ark-media-v1');
  assert.equal(
    seedream?.activationEvidence.configurationRevision,
    revisions.image
  );
  assert.equal(
    seedream?.activationEvidence.evidenceRef,
    `activation-probe-${'c'.repeat(24)}`
  );
  assert.equal(seedance?.status, 'active');
  assert.equal(seedance?.providerModel, 'doubao-seedance-2-0-test');
  assert.equal(
    seedance?.activationEvidence.configurationRevision,
    revisions.video
  );

  const service = new ModelSupplyApplicationService({
    models: verified.models,
    deployments: verified.deployments,
    execution: verified.runtime.execution,
    runtimeCapabilities: verified.runtimeCapabilities,
  });
  const imageSnapshot = service.freezeFixedRoute({
    workspaceId: 'workspace-ark-verified',
    operation: 'image.generate',
    catalogModelId: 'seedream-5-pro',
    dataClass: [],
  });
  assert.equal(imageSnapshot.providerModel, 'doubao-seedream-5-0-test');
  assert.equal(imageSnapshot.endpointRevision, 'ark-media-v1');
  assert.equal(imageSnapshot.credentialVersion, 'ark-key-v3');
  assert.equal(
    imageSnapshot.deploymentLifecycleRevision,
    'ark-media:ark-media-v1:doubao-seedream-5-0-test'
  );
  assert.equal(
    imageSnapshot.allowedCandidates?.[0]?.activationStatus,
    'live_verified'
  );

  assert.throws(
    () =>
      modelRuntimeAssemblyFromEnv({
        MODEL_EXECUTION_MODE: 'recorded',
        MODEL_MEDIA_EXECUTION_MODE: 'unknown',
      }),
    /MODEL_MEDIA_EXECUTION_MODE must contain unique providers/
  );
});

test('all five base modes keep Ark media assembly and activation evidence independent', async () => {
  const ark = {
    ARK_MEDIA_API_KEY: 'configured-ark-secret',
    ARK_MEDIA_BASE_URL: 'https://ark.example.test/api/v3',
    ARK_MEDIA_CREDENTIAL_VERSION: 'ark-key-v3',
    ARK_MEDIA_ENDPOINT_REVISION: 'ark-media-v1',
    ARK_MEDIA_SOURCE_URL_TTL_SECONDS: '3600',
    ARK_SEEDANCE_COST_PER_MILLION_TOKENS_CNY: '28',
    ARK_SEEDANCE_ESTIMATED_TOKENS_PER_SECOND: '10000',
    ARK_SEEDANCE_MODEL: 'doubao-seedance-2-0-test',
    ARK_SEEDREAM_COST_PER_IMAGE_CNY: '0.22',
    ARK_SEEDREAM_MODEL: 'doubao-seedream-5-0-test',
    MODEL_MEDIA_EXECUTION_MODE: 'ark',
  };
  const direct = {
    MODEL_DIRECT_API_KEY: 'configured-direct-secret',
    MODEL_DIRECT_BASE_URL: 'https://llm.example.test/v1',
    MODEL_DIRECT_CATALOG_MODEL_ID: 'llm-openai',
    MODEL_DIRECT_CREDENTIAL_VERSION: 'llm-key-v1',
    MODEL_DIRECT_ENDPOINT_REVISION: 'llm-direct-v1',
    MODEL_DIRECT_INPUT_COST_PER_MILLION: '1',
    MODEL_DIRECT_MODEL: 'provider-copy-model',
    MODEL_DIRECT_OUTPUT_COST_PER_MILLION: '2',
  };
  const modes = [
    { mode: 'disabled', env: {} },
    { mode: 'recorded', env: {} },
    { mode: 'fixture', env: { APP_ENV: 'e2e' } },
    { mode: 'gateway', env: { MODEL_GATEWAY_POC: 'bifrost' } },
    { mode: 'direct', env: direct },
  ] as const;

  for (const entry of modes) {
    const env = {
      ...ark,
      ...entry.env,
      MODEL_EXECUTION_MODE: entry.mode,
    };
    const unverified = modelRuntimeAssemblyFromEnv(env);
    assert.equal(unverified.runtime.mode, entry.mode);
    assert.equal(
      modelMediaExecutionMode(unverified.runtime),
      entry.mode === 'fixture' ? 'fixture' : 'ark',
    );
    assert.ok(unverified.runtime.media);
    assert.equal(
      Boolean(unverified.runtime.arkMedia),
      entry.mode !== 'fixture',
    );
    assert.equal(
      unverified.deployments.find(
        (deployment) => deployment.id === 'seedance-2-direct',
      )?.status,
      entry.mode === 'fixture' ? 'active' : 'inactive',
    );
    const unverifiedService = new ModelSupplyApplicationService({
      models: unverified.models,
      deployments: unverified.deployments,
      execution: unverified.runtime.execution,
      runtimeCapabilities: unverified.runtimeCapabilities,
    });
    if (entry.mode === 'fixture') {
      const fixtureResult = await unverified.runtime.execution.execute(
        recordedRequest('seedance-2', 'video.generate', {
          durationSeconds: 1,
        }),
      );
      assert.equal(fixtureResult.kind, 'completed');
      assert.doesNotThrow(() =>
        unverifiedService.freezeFixedRoute({
          workspaceId: 'workspace-fixture-video',
          operation: 'video.generate',
          catalogModelId: 'seedance-2',
          dataClass: [],
        }),
      );
    } else {
      assert.throws(
        () =>
          unverifiedService.freezeFixedRoute({
            workspaceId: `workspace-${entry.mode}-unverified-video`,
            operation: 'video.generate',
            catalogModelId: 'seedance-2',
            dataClass: [],
          }),
        /not active|No active deployment/i,
      );
    }

    const revision = arkMediaConfigurationRevisionsFromEnv(env).video;
    const verified = modelRuntimeAssemblyFromEnv(env, {
      'seedance-2-direct': {
        configurationRevision: revision,
        evidenceRef: `activation-probe-${'a'.repeat(24)}`,
        status: 'live_verified',
        verifiedAt: '2026-07-18T00:00:00.000Z',
      },
    });
    const seedance = verified.deployments.find(
      (deployment) => deployment.id === 'seedance-2-direct',
    );
    assert.equal(verified.runtime.mode, entry.mode);
    assert.equal(
      verified.runtime.activation,
      entry.mode === 'fixture' ? 'local_fixture_verified' : 'live_verified',
    );
    assert.equal(
      modelMediaExecutionMode(verified.runtime),
      entry.mode === 'fixture' ? 'fixture' : 'ark',
    );
    assert.equal(seedance?.status, 'active');
    assert.equal(
      seedance?.activationEvidence.status,
      entry.mode === 'fixture' ? 'recorded' : 'live_verified',
    );
    assert.ok(
      verified.runtimeCapabilities.some(
        (capability) => capability.id === 'seedance-2-direct',
      ),
    );
    const verifiedService = new ModelSupplyApplicationService({
      models: verified.models,
      deployments: verified.deployments,
      execution: verified.runtime.execution,
      runtimeCapabilities: verified.runtimeCapabilities,
    });
    const snapshot = verifiedService.freezeFixedRoute({
      workspaceId: `workspace-${entry.mode}-verified-video`,
      operation: 'video.generate',
      catalogModelId: 'seedance-2',
      dataClass: [],
    });
    assert.equal(snapshot.actualCatalogModelId, 'seedance-2');
  }

  const disabled = modelRuntimeAssemblyFromEnv({
    MODEL_EXECUTION_MODE: 'disabled',
    MODEL_MEDIA_EXECUTION_MODE: 'disabled',
  });
  const rejected = await disabled.runtime.execution.execute(
    recordedRequest('seedance-2', 'video.generate'),
  );
  assert.equal(rejected.kind, 'failure');
  assert.equal(rejected.providerCost.amount, 0);
});

test('Tuzi media runtime supports independent evidence and Ark coexistence', () => {
  const configured = {
    MODEL_EXECUTION_MODE: 'recorded',
    MODEL_MEDIA_EXECUTION_MODE: 'ark,tuzi',
    ARK_MEDIA_API_KEY: 'configured-ark-secret',
    ARK_MEDIA_BASE_URL: 'https://ark.example.test/api/v3',
    ARK_MEDIA_CREDENTIAL_VERSION: 'ark-key-v1',
    ARK_MEDIA_ENDPOINT_REVISION: 'ark-media-v1',
    ARK_MEDIA_SOURCE_URL_TTL_SECONDS: '3600',
    ARK_SEEDANCE_COST_PER_MILLION_TOKENS_CNY: '28',
    ARK_SEEDANCE_ESTIMATED_TOKENS_PER_SECOND: '10000',
    ARK_SEEDANCE_MODEL: 'ark-video-model',
    ARK_SEEDREAM_COST_PER_IMAGE_CNY: '0.22',
    ARK_SEEDREAM_MODEL: 'ark-image-model',
    TUZI_MEDIA_API_KEY: 'configured-tuzi-secret',
    TUZI_MEDIA_BASE_URL: 'https://api.tu-zi.example/v1',
    TUZI_MEDIA_CREDENTIAL_VERSION: 'tuzi-key-v2',
    TUZI_MEDIA_ENDPOINT_REVISION: 'tuzi-media-v1',
    TUZI_MEDIA_SOURCE_URL_TTL_SECONDS: '3600',
    TUZI_SEEDANCE_COST_PER_MILLION_TOKENS_CNY: '30',
    TUZI_SEEDANCE_ESTIMATED_TOKENS_PER_SECOND: '12000',
    TUZI_SEEDANCE_MODEL: 'doubao-seedance-1-5-pro_720p',
    TUZI_GPT_IMAGE_2_COST_PER_IMAGE_CNY: '0.25',
    TUZI_GPT_IMAGE_2_MODEL: 'gpt-image-2',
  };
  const revisions = tuziMediaConfigurationRevisionsFromEnv(configured);
  const verifiedAt = '2026-07-15T12:00:00.000Z';
  const tuziOnly = modelRuntimeAssemblyFromEnv({
    ...configured,
    MODEL_MEDIA_EXECUTION_MODE: 'tuzi',
  });
  assert.equal(
    tuziOnly.models.find((model) => model.id === 'gpt-image-2')?.displayName,
    'tu-zi · gpt-image-2'
  );
  assert.equal(tuziOnly.runtimeCapabilities.length, 0);
  assert.equal(
    tuziOnly.deployments.find(
      (deployment) => deployment.id === 'gpt-image-2-tuzi-relay'
    )?.status,
    'inactive'
  );
  const assembly = modelRuntimeAssemblyFromEnv(configured, {
    'seedance-1-5-pro-tuzi-relay': {
      configurationRevision: revisions.video,
      evidenceRef: `activation-probe-${'d'.repeat(24)}`,
      status: 'live_verified',
      verifiedAt,
    },
    'gpt-image-2-tuzi-relay': {
      configurationRevision: revisions.image,
      evidenceRef: `activation-probe-${'e'.repeat(24)}`,
      status: 'live_verified',
      verifiedAt,
    },
  });

  assert.ok(assembly.runtime.arkMedia);
  assert.ok(assembly.runtime.tuziMedia);
  assert.deepEqual(
    assembly.runtimeCapabilities.map((capability) => capability.id).sort(),
    ['gpt-image-2-tuzi-relay', 'seedance-1-5-pro-tuzi-relay']
  );
  const image = assembly.deployments.find(
    (deployment) => deployment.id === 'gpt-image-2-tuzi-relay'
  );
  assert.equal(image?.status, 'active');
  assert.equal(image?.providerModel, 'gpt-image-2');
  assert.equal(image?.credentialVersion, 'tuzi-key-v2');
  assert.equal(
    image?.activationEvidence.configurationRevision,
    revisions.image
  );
  assert.equal(
    assembly.deployments.find(
      (deployment) => deployment.id === 'seedream-5-pro-direct'
    )?.status,
    'inactive'
  );

  assert.equal(
    modelRuntimeAssemblyFromEnv(
      {
        ...configured,
        TUZI_GPT_IMAGE_2_MODEL: 'changed-image-model',
        TUZI_IMAGE_CATALOG_MODEL_ID: 'gpt-image-2',
      },
      {
        'gpt-image-2-tuzi-relay': {
          configurationRevision: revisions.image,
          evidenceRef: `activation-probe-${'e'.repeat(24)}`,
          status: 'live_verified',
          verifiedAt,
        },
      }
    ).deployments.find(
      (deployment) => deployment.id === 'gpt-image-2-tuzi-relay'
    )?.status,
    'inactive'
  );
});

test('Tuzi video runtime maps a known Seedance 1.5 provider model to its honest catalog identity', () => {
  const configured = {
    MODEL_EXECUTION_MODE: 'recorded',
    MODEL_MEDIA_EXECUTION_MODE: 'tuzi',
    TUZI_MEDIA_API_KEY: 'configured-tuzi-secret',
    TUZI_MEDIA_BASE_URL: 'https://api.tu-zi.example/v1',
    TUZI_MEDIA_CREDENTIAL_VERSION: 'tuzi-key-v2',
    TUZI_MEDIA_ENDPOINT_REVISION: 'tuzi-media-v1',
    TUZI_MEDIA_SOURCE_URL_TTL_SECONDS: '3600',
    TUZI_SEEDANCE_COST_PER_MILLION_TOKENS_CNY: '30',
    TUZI_SEEDANCE_ESTIMATED_TOKENS_PER_SECOND: '12000',
    TUZI_SEEDANCE_MODEL: 'doubao-seedance-1-5-pro_720p',
    TUZI_GPT_IMAGE_2_COST_PER_IMAGE_CNY: '0.25',
    TUZI_GPT_IMAGE_2_MODEL: 'gpt-image-2',
  };
  const revisions = tuziMediaConfigurationRevisionsFromEnv(configured);
  const assembly = modelRuntimeAssemblyFromEnv(configured, {
    'seedance-1-5-pro-tuzi-relay': {
      configurationRevision: revisions.video,
      evidenceRef: `activation-probe-${'d'.repeat(24)}`,
      status: 'live_verified',
      verifiedAt: '2026-07-15T12:00:00.000Z',
    },
  });

  assert.equal(
    assembly.runtime.tuziMedia?.video.catalogModelId,
    'seedance-1-5-pro',
  );
  assert.deepEqual(
    assembly.runtimeCapabilities.map((capability) => capability.id),
    ['seedance-1-5-pro-tuzi-relay'],
  );
  const deployment = assembly.deployments.find(
    (candidate) => candidate.id === 'seedance-1-5-pro-tuzi-relay',
  );
  assert.equal(deployment?.status, 'active');
  assert.equal(deployment?.providerModel, 'doubao-seedance-1-5-pro_720p');
  assert.equal(
    assembly.configurationRevisions['seedance-1-5-pro-tuzi-relay'],
    revisions.video,
  );
});

test('Tuzi video runtime rejects an explicit catalog identity that mismatches the provider model', () => {
  assert.throws(
    () =>
      modelRuntimeAssemblyFromEnv({
        MODEL_EXECUTION_MODE: 'recorded',
        MODEL_MEDIA_EXECUTION_MODE: 'tuzi',
        TUZI_MEDIA_API_KEY: 'configured-tuzi-secret',
        TUZI_MEDIA_BASE_URL: 'https://api.tu-zi.example/v1',
        TUZI_MEDIA_CREDENTIAL_VERSION: 'tuzi-key-v2',
        TUZI_MEDIA_ENDPOINT_REVISION: 'tuzi-media-v1',
        TUZI_MEDIA_SOURCE_URL_TTL_SECONDS: '3600',
        TUZI_SEEDANCE_COST_PER_MILLION_TOKENS_CNY: '30',
        TUZI_SEEDANCE_ESTIMATED_TOKENS_PER_SECOND: '12000',
        TUZI_SEEDANCE_MODEL: 'doubao-seedance-1-5-pro_720p',
        TUZI_VIDEO_CATALOG_MODEL_ID: 'seedance-2',
        TUZI_GPT_IMAGE_2_COST_PER_IMAGE_CNY: '0.25',
        TUZI_GPT_IMAGE_2_MODEL: 'gpt-image-2',
      }),
    /TUZI_VIDEO_CATALOG_MODEL_ID seedance-2 does not match provider model doubao-seedance-1-5-pro_720p/,
  );
});

test('Tuzi video runtime rejects an unknown provider model even with an explicit catalog identity', () => {
  assert.throws(
    () =>
      modelRuntimeAssemblyFromEnv({
        MODEL_EXECUTION_MODE: 'recorded',
        MODEL_MEDIA_EXECUTION_MODE: 'tuzi',
        TUZI_MEDIA_API_KEY: 'configured-tuzi-secret',
        TUZI_MEDIA_BASE_URL: 'https://api.tu-zi.example/v1',
        TUZI_MEDIA_CREDENTIAL_VERSION: 'tuzi-key-v2',
        TUZI_MEDIA_ENDPOINT_REVISION: 'tuzi-media-v1',
        TUZI_MEDIA_SOURCE_URL_TTL_SECONDS: '3600',
        TUZI_SEEDANCE_COST_PER_MILLION_TOKENS_CNY: '30',
        TUZI_SEEDANCE_ESTIMATED_TOKENS_PER_SECOND: '12000',
        TUZI_SEEDANCE_MODEL: 'tuzi-video-model',
        TUZI_VIDEO_CATALOG_MODEL_ID: 'seedance-2',
        TUZI_GPT_IMAGE_2_COST_PER_IMAGE_CNY: '0.25',
        TUZI_GPT_IMAGE_2_MODEL: 'gpt-image-2',
      }),
    /TUZI_SEEDANCE_MODEL tuzi-video-model is not a recognized Seedance provider model/,
  );
});

test('Tuzi Seedream configuration preserves the selected model brand', () => {
  const configured = {
    MODEL_EXECUTION_MODE: 'recorded',
    MODEL_MEDIA_EXECUTION_MODE: 'tuzi',
    TUZI_MEDIA_API_KEY: 'configured-tuzi-secret',
    TUZI_MEDIA_BASE_URL: 'https://api.tu-zi.example/v1',
    TUZI_MEDIA_CREDENTIAL_VERSION: 'tuzi-key-v2',
    TUZI_MEDIA_ENDPOINT_REVISION: 'tuzi-media-v1',
    TUZI_MEDIA_SOURCE_URL_TTL_SECONDS: '3600',
    TUZI_SEEDANCE_COST_PER_MILLION_TOKENS_CNY: '30',
    TUZI_SEEDANCE_ESTIMATED_TOKENS_PER_SECOND: '12000',
    TUZI_SEEDANCE_MODEL: 'doubao-seedance-1-5-pro_720p',
    TUZI_GPT_IMAGE_2_COST_PER_IMAGE_CNY: '0.05',
    TUZI_GPT_IMAGE_2_MODEL: 'doubao-seedream-4-5-251128',
  };
  const revisions = tuziMediaConfigurationRevisionsFromEnv(configured);
  const assembly = modelRuntimeAssemblyFromEnv(configured, {
    'seedream-4-5-tuzi-relay': {
      configurationRevision: revisions.image,
      evidenceRef: `activation-probe-${'e'.repeat(24)}`,
      status: 'live_verified',
      verifiedAt: '2026-07-15T12:00:00.000Z',
    },
  });

  assert.equal(
    assembly.models.find((model) => model.id === 'seedream-4-5')?.displayName,
    'tu-zi · doubao-seedream-4-5-251128',
  );
  assert.equal(
    assembly.models.find((model) => model.id === 'gpt-image-2')?.displayName,
    'GPT Image 2',
  );
  assert.deepEqual(
    assembly.runtimeCapabilities.map((capability) => capability.id),
    ['seedream-4-5-tuzi-relay'],
  );
  assert.equal(
    assembly.deployments.find(
      (deployment) => deployment.id === 'seedream-4-5-tuzi-relay',
    )?.providerModel,
    'doubao-seedream-4-5-251128',
  );
  assert.throws(() =>
    modelRuntimeAssemblyFromEnv({
      ...configured,
      TUZI_IMAGE_CATALOG_MODEL_ID: 'gpt-image-2',
    }),
  );
});

test('Volcengine TTS requires approved pricing and matching probe evidence before activation', () => {
  const configured = {
    MODEL_EXECUTION_MODE: 'recorded',
    MODEL_MEDIA_EXECUTION_MODE: 'volcengine_tts',
    VOLCENGINE_TTS_ACCESS_TOKEN: 'fixture-access-token',
    VOLCENGINE_TTS_APP_ID: 'fixture-app-id',
    VOLCENGINE_TTS_APPROVED_PRICE_PER_TEXT_WORD_CNY: '0.002',
    VOLCENGINE_TTS_CREDENTIAL_VERSION: 'tts-credential-v1',
    VOLCENGINE_TTS_ENDPOINT:
      'wss://openspeech.bytedance.com/api/v3/tts/bidirection',
    VOLCENGINE_TTS_ENDPOINT_REVISION: 'bidirectional-v3',
    VOLCENGINE_TTS_MODEL: 'seed-tts-2.0-standard',
    VOLCENGINE_TTS_PRICE_REVISION: 'tts-price-approved-v1',
    VOLCENGINE_TTS_RESOURCE_ID: 'seed-tts-2.0',
    VOLCENGINE_TTS_SPEAKER: 'fixture-speaker',
  };
  assert.throws(
    () =>
      modelRuntimeAssemblyFromEnv({
        ...configured,
        VOLCENGINE_TTS_APPROVED_PRICE_PER_TEXT_WORD_CNY: '',
      }),
    /VOLCENGINE_TTS_APPROVED_PRICE_PER_TEXT_WORD_CNY/u,
  );

  const unverified = modelRuntimeAssemblyFromEnv(configured);
  const unverifiedDeployment = unverified.deployments.find(
    (deployment) => deployment.id === 'seed-tts-2-volcengine-direct',
  );
  assert.equal(unverified.runtime.activation, 'configured_unverified');
  assert.equal(modelMediaExecutionMode(unverified.runtime), 'volcengine_tts');
  assert.ok(unverified.runtime.media);
  assert.equal(unverifiedDeployment?.status, 'inactive');
  assert.deepEqual(unverifiedDeployment?.unitPrice, {
    amountMicros: 2_000,
    currency: 'CNY',
    unit: 'text_word',
  });
  assert.equal(
    volcengineTtsConfigurationRevisionFromEnv(configured),
    volcengineTtsConfigurationRevisionFromEnv({
      ...configured,
      VOLCENGINE_TTS_ACCESS_TOKEN: 'rotated-secret-same-version',
    }),
  );
  assert.notEqual(
    volcengineTtsConfigurationRevisionFromEnv(configured),
    volcengineTtsConfigurationRevisionFromEnv({
      ...configured,
      VOLCENGINE_TTS_SPEAKER: 'another-speaker',
    }),
  );
  assert.notEqual(
    volcengineTtsConfigurationRevisionFromEnv(configured),
    volcengineTtsConfigurationRevisionFromEnv({
      ...configured,
      VOLCENGINE_TTS_ACCESS_TOKEN: '',
      VOLCENGINE_TTS_API_KEY: 'fixture-api-key',
      VOLCENGINE_TTS_APP_ID: '',
    }),
  );

  const revision = volcengineTtsConfigurationRevisionFromEnv(configured);
  const verified = modelRuntimeAssemblyFromEnv(configured, {
    'seed-tts-2-volcengine-direct': {
      configurationRevision: revision,
      evidenceRef: `activation-probe-${'d'.repeat(24)}`,
      status: 'live_verified',
      verifiedAt: '2026-07-16T08:00:00.000Z',
    },
  });
  const deployment = verified.deployments.find(
    (candidate) => candidate.id === 'seed-tts-2-volcengine-direct',
  );
  assert.equal(verified.runtime.activation, 'live_verified');
  assert.equal(deployment?.status, 'active');
  assert.equal(deployment?.providerModel, 'seed-tts-2.0-standard');
  assert.equal(deployment?.endpointRevision, 'bidirectional-v3');
  assert.equal(deployment?.credentialVersion, 'tts-credential-v1');
  assert.equal(deployment?.priceRevision, 'tts-price-approved-v1');
  assert.deepEqual(
    verified.runtimeCapabilities.map((capability) => capability.catalogModelId),
    ['seed-tts-2'],
  );

  const repriced = modelRuntimeAssemblyFromEnv(
    {
      ...configured,
      VOLCENGINE_TTS_PRICE_REVISION: 'tts-price-approved-v2',
    },
    {
      'seed-tts-2-volcengine-direct': {
        configurationRevision: revision,
        evidenceRef: `activation-probe-${'d'.repeat(24)}`,
        status: 'live_verified',
        verifiedAt: '2026-07-16T08:00:00.000Z',
      },
    },
  );
  const repricedDeployment = repriced.deployments.find(
    (candidate) => candidate.id === 'seed-tts-2-volcengine-direct',
  );
  assert.equal(repriced.runtime.activation, 'configured_unverified');
  assert.equal(repricedDeployment?.status, 'inactive');
  assert.equal(repricedDeployment?.priceRevision, 'tts-price-approved-v2');
});
