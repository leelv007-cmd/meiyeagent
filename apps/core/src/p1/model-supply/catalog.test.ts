import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CatalogRevisionRegistry,
  ModelPreferenceRegistry,
  createDefaultCatalogModels,
  createDefaultCapabilityRevisions,
  createDefaultDeployments,
  createDefaultExecutionChannels,
  createDefaultPriceRevisions,
  createDefaultProviderProfiles,
  createDefaultRouteRevisions,
  forwardMigratePublishedCatalogPayload,
} from './catalog.js';

test('forward-migrates a pre-upgrade published catalog with new inactive fallback models and runtime identity', () => {
  const fallbackModels = createDefaultCatalogModels();
  const fallbackDeployments = createDefaultDeployments().map((deployment) =>
    deployment.id === 'seedance-1-5-pro-tuzi-relay'
      ? {
          ...deployment,
          endpointRevision: 'tuzi-media-v1',
          providerModel: 'doubao-seedance-1-5-pro_720p',
          status: 'active' as const,
        }
      : deployment.id === 'seedance-2-tuzi-relay'
        ? {
            ...deployment,
            endpointRevision: 'tuzi-media-v1',
            providerModel: 'doubao-seedance-2-0-pro',
          }
        : deployment
  );
  const published = {
    models: fallbackModels.filter(
      (model) =>
        model.id !== 'seedance-1-5-pro' && model.id !== 'grok-latest-video'
    ),
    deployments: fallbackDeployments
      .filter(
        (deployment) =>
          deployment.id !== 'seedance-1-5-pro-tuzi-relay' &&
          deployment.id !== 'grok-latest-managed'
      )
      .map((deployment) =>
        deployment.id === 'seedance-2-tuzi-relay'
          ? {
              ...deployment,
              endpointRevision: undefined,
              providerModel: undefined,
            }
          : deployment
      ),
    capabilities: createDefaultCapabilityRevisions(),
    prices: createDefaultPriceRevisions(),
    routes: createDefaultRouteRevisions(),
    providerProfiles: createDefaultProviderProfiles(),
    executionChannels: createDefaultExecutionChannels(),
  };
  const publishedBefore = structuredClone(published);

  const migrated = forwardMigratePublishedCatalogPayload(published, {
    ...published,
    models: fallbackModels,
    deployments: fallbackDeployments,
  });

  assert.equal(
    migrated.models.find((model) => model.id === 'seedance-1-5-pro')
      ?.displayName,
    'Seedance 1.5 Pro'
  );
  const seedance15 = migrated.deployments.find(
    (deployment) => deployment.id === 'seedance-1-5-pro-tuzi-relay'
  );
  assert.equal(seedance15?.status, 'inactive');
  assert.equal(seedance15?.activationEvidence.status, 'recorded');
  assert.equal(seedance15?.unavailableReason, 'activation_evidence_missing');
  assert.equal(seedance15?.providerModel, 'doubao-seedance-1-5-pro_720p');
  assert.equal(seedance15?.endpointRevision, 'tuzi-media-v1');

  const seedance2 = migrated.deployments.find(
    (deployment) => deployment.id === 'seedance-2-tuzi-relay'
  );
  assert.equal(seedance2?.providerModel, 'doubao-seedance-2-0-pro');
  assert.equal(seedance2?.endpointRevision, 'tuzi-media-v1');
  assert.equal(
    migrated.models.some((model) => model.id === 'grok-latest-video'),
    false
  );
  assert.equal(
    migrated.deployments.some(
      (deployment) => deployment.id === 'grok-latest-managed'
    ),
    false
  );
  assert.deepEqual(published, publishedBefore);
});

test('catalog revisions transition by creating immutable draft, enabled, published and retired records', () => {
  const registry = new CatalogRevisionRegistry();
  const draft = registry.createDraft({
    models: createDefaultCatalogModels(),
    deployments: createDefaultDeployments(),
    capabilities: [{ id: 'copy-v1', operation: 'copy.generate', revision: 1 }],
    prices: [{ id: 'copy-price-v1', currency: 'CNY', amount: 1, revision: 1 }],
    routes: [{ id: 'copy-route-v1', operation: 'copy.generate', revision: 1 }],
    providerProfiles: createDefaultProviderProfiles(),
    executionChannels: createDefaultExecutionChannels(),
  });
  const enabled = registry.enable(draft.id);
  const published = registry.publish(enabled.id);
  const retired = registry.retire(published.id);

  assert.deepEqual(
    [draft.stage, enabled.stage, published.stage, retired.stage],
    ['draft', 'enabled', 'published', 'retired']
  );
  assert.notEqual(draft.id, enabled.id);
  assert.equal(published.previousRevisionId, enabled.id);
  assert.equal(Object.isFrozen(published), true);
  assert.equal(registry.published()?.id, published.id);
  assert.equal(
    retired.payload.models[0]?.displayName,
    draft.payload.models[0]?.displayName
  );
  assert.throws(() => registry.publish(draft.id), /enabled/);
});

test('default catalog keeps provider, counterparty, channel, credential owner, capability, and price revisions independent', () => {
  const profiles = createDefaultProviderProfiles();
  const channels = createDefaultExecutionChannels();
  const deployments = createDefaultDeployments();
  const nanoPrices = createDefaultPriceRevisions().filter((price) =>
    price.catalogModelId?.startsWith('nano-banana')
  );
  const nanoCapabilities = createDefaultCapabilityRevisions().filter(
    (capability) => capability.catalogModelId?.startsWith('nano-banana')
  );

  const seedream = deployments.find(
    (deployment) => deployment.catalogModelId === 'seedream-5-pro'
  );
  assert.equal(seedream?.providerProfileId, 'provider-bytedance-volcengine');
  assert.equal(seedream?.apiCounterparty, 'Volcengine');
  assert.equal(seedream?.credentialOwner, 'platform');
  assert.ok(
    channels.some(
      (channel) =>
        channel.id === seedream?.executionChannelId &&
        channel.region === 'domestic'
    )
  );
  assert.ok(
    profiles.some(
      (profile) =>
        profile.id === seedream?.providerProfileId &&
        profile.manufacturer === 'ByteDance' &&
        profile.apiCounterparty === 'Volcengine'
    )
  );
  assert.equal(nanoPrices.length, 2);
  assert.notEqual(nanoPrices[0]?.amount, nanoPrices[1]?.amount);
  assert.equal(
    new Set(nanoCapabilities.map((item) => item.catalogModelId)).size,
    2
  );
  assert.ok(createDefaultRouteRevisions().length > 0);

  const customModel = createDefaultCatalogModels().find(
    (model) => model.id === 'llm-custom'
  );
  const customDeployment = deployments.find(
    (deployment) => deployment.catalogModelId === 'llm-custom'
  );
  assert.equal(customModel?.displayName, '自定义供应商');
  assert.equal(customModel?.qualityRank, 0);
  assert.equal(customDeployment?.apiFamily, 'custom');
  assert.equal(customDeployment?.providerProfileId, 'provider-custom');
  assert.ok(
    channels.some(
      (channel) =>
        channel.id === customDeployment?.executionChannelId &&
        channel.apiFamily === 'custom'
    )
  );
  assert.ok(
    profiles.some(
      (profile) => profile.id === customDeployment?.providerProfileId
    )
  );

  const tuziDeployments = deployments.filter((deployment) =>
    deployment.id.endsWith('-tuzi-relay')
  );
  assert.deepEqual(
    tuziDeployments.map((deployment) => deployment.catalogModelId).sort(),
    [
      'gpt-image-2',
      'seedance-1-5-pro',
      'seedance-2',
      'seedream-4-5',
      'seedream-5-pro',
    ]
  );
  assert.ok(
    tuziDeployments.every(
      (deployment) =>
        deployment.apiCounterparty === 'tu-zi' &&
        deployment.executionChannelId?.includes('tuzi')
    )
  );
  const gptImageTuzi = tuziDeployments.find(
    (deployment) => deployment.catalogModelId === 'gpt-image-2'
  );
  assert.equal(gptImageTuzi?.providerProfileId, 'provider-tu-zi-openai');
  assert.equal(gptImageTuzi?.channel, 'managed');
  assert.equal(gptImageTuzi?.region, 'overseas');
  assert.equal(gptImageTuzi?.credentialOwner, 'platform');
  assert.ok(
    profiles.some(
      (profile) =>
        profile.id === gptImageTuzi?.providerProfileId &&
        profile.manufacturer === 'OpenAI' &&
        profile.apiCounterparty === 'tu-zi'
    )
  );
});

test('default deployments stay unavailable and recorded activation is never mislabeled live verified', () => {
  const inactive = createDefaultDeployments();
  assert.ok(inactive.every((deployment) => deployment.status === 'inactive'));
  assert.ok(
    inactive.every(
      (deployment) =>
        deployment.unavailableReason === 'activation_evidence_missing'
    )
  );

  const activated = createDefaultDeployments({
    activatedDeploymentIds: ['openai-direct-recorded'],
  });
  const openai = activated.find(
    (deployment) => deployment.id === 'openai-direct-recorded'
  );
  assert.equal(openai?.status, 'active');
  assert.equal(openai?.activationEvidence?.status, 'recorded');
  assert.equal(openai?.unavailableReason, undefined);

  const live = createDefaultDeployments({
    activatedDeploymentIds: ['openai-direct-recorded'],
    activationEvidenceByDeploymentId: {
      'openai-direct-recorded': {
        status: 'live_verified',
        evidenceRef: 'staging://model-activation/openai',
        verifiedAt: '2026-07-12T12:00:00.000Z',
        configurationRevision: 'runtime-openai-v1',
      },
    },
  });
  assert.equal(live[0]?.activationEvidence.status, 'live_verified');
  assert.equal(
    live[0]?.activationEvidence.evidenceRef,
    'staging://model-activation/openai'
  );

  assert.throws(
    () =>
      createDefaultDeployments({
        activatedDeploymentIds: ['openai-direct-recorded'],
        activationEvidenceByDeploymentId: {
          'anthropic-direct-recorded': {
            status: 'live_verified',
            evidenceRef: 'staging://model-activation/anthropic',
            verifiedAt: '2026-07-12T12:00:00.000Z',
            configurationRevision: 'runtime-anthropic-v1',
          },
        },
      }),
    /inactive or unknown deployment/
  );
});

test('user model preferences keep default, favorite, recent and current override separate', () => {
  const registry = new ModelPreferenceRegistry();
  registry.setWorkspaceDefault(
    'workspace-a',
    'image.generate',
    'seedream-5-pro'
  );
  registry.setUserDefault(
    'workspace-a',
    'owner-a',
    'image.generate',
    'nano-banana-2'
  );
  registry.setFavorite(
    'workspace-a',
    'owner-a',
    'image.generate',
    'gpt-image-2',
    true
  );
  registry.recordRecent(
    'workspace-a',
    'owner-a',
    'image.generate',
    'nano-banana-pro'
  );

  assert.equal(
    registry.resolve('workspace-a', 'owner-a', 'image.generate', 'gpt-image-2'),
    'gpt-image-2'
  );
  const view = registry.view('workspace-a', 'owner-a', 'image.generate');
  assert.equal(view.userDefault, 'nano-banana-2');
  assert.equal(view.workspaceDefault, 'seedream-5-pro');
  assert.deepEqual(view.favorites, ['gpt-image-2']);
  assert.deepEqual(view.recent, ['nano-banana-pro']);
});
