import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  MODEL_CAPABILITY_VOCABULARY_VERSION,
  type ModelCapabilityProfile,
} from '@meiye/contracts';
import {
  createModelExecutionRuntime,
  type ModelExecutionRuntime,
  type ModelExecutionRuntimeMode,
} from './adapters.js';
import type { ArkMediaExecutionOptions } from './ark-media-adapter.js';
import type { TuziMediaExecutionOptions } from './tuzi-media-adapter.js';
import {
  createDefaultCatalogModels,
  createDefaultDeployments,
  type ActivationEvidence,
  type PublishedDeployment,
} from './catalog.js';
import type { CatalogModel, RuntimeDeploymentCapability } from './index.js';
import type { CustomLlmProtocol } from './ai-sdk-runner.js';
import type { AdapterRuntimeConfig } from './provider-lifecycle.js';
import {
  VolcengineBidirectionalTtsAdapter,
  type VolcengineTtsAuth,
} from './volcengine-tts-adapter.js';
import {
  FileSystemVolcengineTtsTaskStore,
  type VolcengineTtsLifecycleOptions,
} from './volcengine-tts-lifecycle.js';
import { NodeVolcengineTtsSocketFactory } from './volcengine-tts-node-socket.js';

type MediaProviderMode = 'ark' | 'tuzi' | 'volcengine_tts';

interface VolcengineTtsRuntimeConfig {
  approvedPricePerTextWordCny: number;
  authKind: VolcengineTtsAuth['kind'];
  credentialVersion: string;
  endpoint: string;
  endpointRevision: string;
  lifecycle: VolcengineTtsLifecycleOptions;
  model: string;
  priceRevision: string;
  resourceId: 'seed-tts-2.0' | 'seed-icl-2.0';
  speaker: string;
}

export interface ModelRuntimeAssemblyWarning {
  code: 'configuration_drift';
  deploymentId: string;
  message: string;
}

export interface ModelRuntimeCapability extends RuntimeDeploymentCapability {
  adapterKey?: string;
  adapterBindingRevision?: string;
  adapterConfig?: AdapterRuntimeConfig;
}

export interface ModelRuntimeAssembly {
  configurationRevisions: Readonly<Record<string, string>>;
  deployments: PublishedDeployment[];
  models: CatalogModel[];
  runtime: ModelExecutionRuntime;
  runtimeCapabilities: ModelRuntimeCapability[];
  warnings: ModelRuntimeAssemblyWarning[];
}

function fixtureLlmCapabilityProfile(
  model: CatalogModel,
): ModelCapabilityProfile | undefined {
  if (model.modality !== 'llm') return undefined;

  const evidencePrefix = `local-fixture:${model.id}`;
  return {
    vocabularyVersion: MODEL_CAPABILITY_VOCABULARY_VERSION,
    protocolCapabilities: {
      'structured-output': {
        value: true,
        basis: 'inferred',
        evidenceRef: `${evidencePrefix}:protocol:structured-output`,
      },
    },
    modalities: [
      {
        mime: 'text/plain',
        supported: true,
        basis: 'inferred',
        evidenceRef: `${evidencePrefix}:modality:text/plain`,
      },
    ],
    businessTags: [],
    modalityCapabilities: [],
  };
}

export function modelMediaExecutionMode(
  runtime: Pick<
    ModelExecutionRuntime,
    'arkMedia' | 'media' | 'mode' | 'tuziMedia' | 'volcengineTts'
  >,
) {
  if (runtime.mode === 'fixture' && runtime.media) return 'fixture' as const;
  const providers: MediaProviderMode[] = [];
  if (runtime.arkMedia) providers.push('ark');
  if (runtime.tuziMedia) providers.push('tuzi');
  if (runtime.volcengineTts) providers.push('volcengine_tts');
  return providers.length > 0 ? providers.join(',') : ('disabled' as const);
}

export function modelRuntimeAssemblyFromEnv(
  env: NodeJS.ProcessEnv,
  activationEvidenceByDeploymentId: Readonly<Record<string, ActivationEvidence>> = {}
): ModelRuntimeAssembly {
  const warnings: ModelRuntimeAssemblyWarning[] = [];
  const mode = parseMode(env);
  const mediaMode = parseMediaMode(env);
  const externalMediaEnabled = mode !== 'fixture';
  const documentedModels = createDefaultCatalogModels();
  const direct =
    mode === 'direct' ? directOptions(env, documentedModels) : undefined;
  const arkMedia = externalMediaEnabled && mediaMode.has('ark')
    ? arkMediaOptions(env)
    : undefined;
  const tuziMedia = externalMediaEnabled && mediaMode.has('tuzi')
    ? tuziMediaOptions(env)
    : undefined;
  const tuziImageDeploymentId = tuziMedia
    ? tuziImageDeploymentIdForCatalogModel(tuziMedia.image.catalogModelId)
    : undefined;
  const tuziVideoDeploymentId = tuziMedia
    ? tuziVideoDeploymentIdForCatalogModel(tuziMedia.video.catalogModelId)
    : undefined;
  const volcengineTts = externalMediaEnabled && mediaMode.has('volcengine_tts')
    ? volcengineTtsOptions(env)
    : undefined;
  const documented = createDefaultDeployments();
  const models = documentedModels.map((model) => {
    if (direct && model.id === direct.catalogModelId) {
      return {
        ...model,
        stableModelName: direct.model,
        version: direct.endpointRevision,
      };
    }
    if (arkMedia && model.id === arkMedia.image.catalogModelId) {
      return {
        ...model,
        stableModelName: arkMedia.image.model,
        version: arkMedia.endpointRevision,
      };
    }
    if (arkMedia && model.id === arkMedia.video.catalogModelId) {
      return {
        ...model,
        stableModelName: arkMedia.video.model,
        version: arkMedia.endpointRevision,
      };
    }
    if (tuziMedia && model.id === tuziMedia.image.catalogModelId) {
      return {
        ...model,
        displayName: `tu-zi · ${tuziMedia.image.model}`,
        stableModelName: tuziMedia.image.model,
        version: tuziMedia.endpointRevision,
      };
    }
    if (tuziMedia && model.id === tuziMedia.video.catalogModelId) {
      return {
        ...model,
        displayName: `tu-zi · ${tuziMedia.video.model}`,
        stableModelName: tuziMedia.video.model,
        version: tuziMedia.endpointRevision,
      };
    }
    if (volcengineTts && model.id === 'seed-tts-2') {
      return {
        ...model,
        stableModelName: volcengineTts.model,
        version: volcengineTts.endpointRevision,
      };
    }
    return model;
  });
  const directConfigurationRevision = direct
    ? directModelConfigurationRevision(direct)
    : undefined;
  const directDeploymentId = direct
    ? documented.find(
        (deployment) => deployment.catalogModelId === direct.catalogModelId
      )?.id
    : undefined;
  const directEvidence = directConfigurationRevision && directDeploymentId
    ? verifiedProbeEvidence(
        activationEvidenceByDeploymentId[directDeploymentId],
        directConfigurationRevision,
        directDeploymentId,
        warnings,
      )
    : undefined;
  const arkRevisions = arkMedia
    ? mediaConfigurationRevisions(arkMedia)
    : undefined;
  const arkImageEvidence = arkRevisions
    ? verifiedProbeEvidence(
        activationEvidenceByDeploymentId['seedream-5-pro-direct'],
        arkRevisions.image,
        'seedream-5-pro-direct',
        warnings,
      )
    : undefined;
  const arkVideoEvidence = arkRevisions
    ? verifiedProbeEvidence(
        activationEvidenceByDeploymentId['seedance-2-direct'],
        arkRevisions.video,
        'seedance-2-direct',
        warnings,
      )
    : undefined;
  const tuziRevisions = tuziMedia
    ? mediaConfigurationRevisions(tuziMedia)
    : undefined;
  const tuziImageEvidence = tuziRevisions
    ? verifiedProbeEvidence(
        activationEvidenceByDeploymentId[tuziImageDeploymentId!],
        tuziRevisions.image,
        tuziImageDeploymentId!,
        warnings,
      )
    : undefined;
  const tuziVideoEvidence = tuziRevisions
    ? verifiedProbeEvidence(
        activationEvidenceByDeploymentId[tuziVideoDeploymentId!],
        tuziRevisions.video,
        tuziVideoDeploymentId!,
        warnings,
      )
    : undefined;
  const volcengineTtsRevision = volcengineTts
    ? volcengineTtsConfigurationRevision(volcengineTts)
    : undefined;
  const volcengineTtsEvidence = volcengineTtsRevision
    ? verifiedProbeEvidence(
        activationEvidenceByDeploymentId['seed-tts-2-volcengine-direct'],
        volcengineTtsRevision,
        'seed-tts-2-volcengine-direct',
        warnings,
      )
    : undefined;
  const gateway =
    mode === 'gateway' ? parseGateway(env.MODEL_GATEWAY_POC) : undefined;
  const configuredRuntime = createModelExecutionRuntime({
    mode,
    ...(direct ? { direct } : {}),
    ...(arkMedia ? { arkMedia } : {}),
    ...(tuziMedia ? { tuziMedia } : {}),
    ...(volcengineTts ? { volcengineTts: volcengineTts.lifecycle } : {}),
    ...(gateway ? { gateway } : {}),
  });
  const runtime: ModelExecutionRuntime =
    directEvidence ||
    arkImageEvidence ||
    arkVideoEvidence ||
    tuziImageEvidence ||
    tuziVideoEvidence ||
    volcengineTtsEvidence
      ? { ...configuredRuntime, activation: 'live_verified' }
      : configuredRuntime;
  const gatewayChannel = gateway ?? 'bifrost';
  const activeDeploymentIds = new Set<string>();
  const explicitActivationEvidence: Record<string, ActivationEvidence> = {};
  if (mode === 'fixture') {
    for (const deployment of documented) {
      activeDeploymentIds.add(deployment.id);
      // E2E fixture-only synthetic probe for audio fixtures. Not production
      // activation: seed-tts still needs approved price before it can open.
      if (
        deployment.apiFamily === 'audio' &&
        deployment.catalogModelId !== 'seed-tts-2'
      ) {
        explicitActivationEvidence[deployment.id] = {
          configurationRevision: 'f'.repeat(64),
          evidenceRef: `activation-probe-${'f'.repeat(24)}`,
          status: 'live_verified',
          verifiedAt: '2026-07-16T00:00:00.000Z',
        };
      }
    }
  } else {
    if (directEvidence && direct) {
      for (const deployment of documented) {
        if (deployment.catalogModelId === direct.catalogModelId) {
          activeDeploymentIds.add(deployment.id);
        }
      }
    }
    if (arkImageEvidence) activeDeploymentIds.add('seedream-5-pro-direct');
    if (arkVideoEvidence) activeDeploymentIds.add('seedance-2-direct');
    if (tuziImageEvidence && tuziImageDeploymentId) {
      activeDeploymentIds.add(tuziImageDeploymentId);
    }
    if (tuziVideoEvidence && tuziVideoDeploymentId) {
      activeDeploymentIds.add(tuziVideoDeploymentId);
    }
    if (volcengineTtsEvidence) {
      activeDeploymentIds.add('seed-tts-2-volcengine-direct');
    }
  }
  if (directEvidence && direct) {
    const deployment = documented.find(
      (candidate) => candidate.catalogModelId === direct.catalogModelId
    );
    if (deployment) explicitActivationEvidence[deployment.id] = directEvidence;
  }
  if (arkImageEvidence) {
    explicitActivationEvidence['seedream-5-pro-direct'] = arkImageEvidence;
  }
  if (arkVideoEvidence) {
    explicitActivationEvidence['seedance-2-direct'] = arkVideoEvidence;
  }
  if (tuziImageEvidence && tuziImageDeploymentId) {
    explicitActivationEvidence[tuziImageDeploymentId] = tuziImageEvidence;
  }
  if (tuziVideoEvidence && tuziVideoDeploymentId) {
    explicitActivationEvidence[tuziVideoDeploymentId] = tuziVideoEvidence;
  }
  if (volcengineTtsEvidence) {
    explicitActivationEvidence['seed-tts-2-volcengine-direct'] =
      volcengineTtsEvidence;
  }
  const fixtureMediaPricing =
    mode === 'fixture'
      ? Object.fromEntries(
          documented.flatMap((deployment) =>
            (deployment.apiFamily === 'image' ||
              deployment.apiFamily === 'media') &&
            deployment.unitPrice
              ? [
                  [
                    deployment.id,
                    {
                      priceRevision: `${deployment.priceRevision}:fixture-cny`,
                      unitPrice: {
                        ...deployment.unitPrice,
                        currency: 'CNY' as const,
                      },
                    },
                  ] as const,
                ]
              : [],
          ),
        )
      : {};
  const deploymentPricingById = {
    ...fixtureMediaPricing,
    ...(volcengineTts
      ? {
          'seed-tts-2-volcengine-direct': {
            priceRevision: volcengineTts.priceRevision,
            unitPrice: {
              amountMicros: Math.round(
                volcengineTts.approvedPricePerTextWordCny * 1_000_000,
              ),
              currency: 'CNY' as const,
              unit: 'text_word',
            },
          },
        }
      : {}),
  };
  const deployments = createDefaultDeployments({
    activatedDeploymentIds: [...activeDeploymentIds],
    ...(Object.keys(explicitActivationEvidence).length > 0
      ? { activationEvidenceByDeploymentId: explicitActivationEvidence }
      : { activationEvidenceStatus: 'recorded' as const }),
    ...(Object.keys(deploymentPricingById).length > 0
      ? { deploymentPricingById }
      : {}),
  }).map((deployment) => {
    if (mode === 'fixture' && deployment.status === 'active') {
      const model = models.find(
        (candidate) => candidate.id === deployment.catalogModelId,
      );
      const capabilityProfile = model
        ? fixtureLlmCapabilityProfile(model)
        : undefined;
      if (capabilityProfile) {
        return { ...deployment, capabilityProfile };
      }
    }
    if (
      mode === 'direct' &&
      direct &&
      deployment.catalogModelId === direct.catalogModelId
    ) {
      return {
        ...deployment,
        providerModel: direct.model,
        endpointRevision: direct.endpointRevision,
        credentialAccountId: 'credential-account:platform:model.direct',
        credentialVersion: direct.credentialVersion,
        lifecycleRevision: `direct-runtime:${direct.endpointRevision}:${direct.model}`,
      };
    }
    if (
      arkMedia &&
      (deployment.id === 'seedream-5-pro-direct' ||
        deployment.id === 'seedance-2-direct')
    ) {
      const providerModel =
        deployment.catalogModelId === arkMedia.image.catalogModelId
          ? arkMedia.image.model
          : arkMedia.video.model;
      return {
        ...deployment,
        providerModel,
        endpointRevision: arkMedia.endpointRevision,
        credentialAccountId: 'credential-account:platform:ark.media',
        credentialVersion: arkMedia.credentialVersion,
        lifecycleRevision: `ark-media:${arkMedia.endpointRevision}:${providerModel}`,
      };
    }
    if (
      tuziMedia &&
      (deployment.id === tuziImageDeploymentId ||
        deployment.id === tuziVideoDeploymentId)
    ) {
      const providerModel =
        deployment.id === tuziImageDeploymentId
          ? tuziMedia.image.model
          : tuziMedia.video.model;
      return {
        ...deployment,
        providerModel,
        endpointRevision: tuziMedia.endpointRevision,
        credentialVersion: tuziMedia.credentialVersion,
        lifecycleRevision: `tuzi-media:${tuziMedia.endpointRevision}:${providerModel}`,
      };
    }
    if (
      volcengineTts &&
      deployment.id === 'seed-tts-2-volcengine-direct'
    ) {
      return {
        ...deployment,
        providerModel: volcengineTts.model,
        endpointRevision: volcengineTts.endpointRevision,
        credentialVersion: volcengineTts.credentialVersion,
        lifecycleRevision: `volcengine-tts:${volcengineTts.endpointRevision}:${volcengineTts.model}`,
      };
    }
    if (mode !== 'gateway') {
      return deployment;
    }
    const model = models.find(
      (candidate) => candidate.id === deployment.catalogModelId
    );
    if (model?.modality === 'llm') {
      const profile = deployment.providerProfileId?.replace(/^provider-/, '');
      return {
        ...deployment,
        channel: gatewayChannel,
        apiCounterparty: gatewayChannel === 'bifrost' ? 'Bifrost' : 'LiteLLM',
        credentialOwner: 'provider_managed' as const,
        executionChannelId: `channel-${gatewayChannel}-${profile}-gateway`,
        lifecycleRevision: `${gatewayChannel}-poc-v1`,
      };
    }
    if (model?.id === 'veo-latest') {
      return {
        ...deployment,
        apiCounterparty: 'fal',
        executionChannelId: 'channel-fal-shared-queue',
        lifecycleRevision: 'fal-queue-poc-v1',
      };
    }
    return deployment;
  });
  const runtimeCapabilities = deployments
    .filter((deployment) => deployment.status === 'active')
    .map((deployment) => ({
      id: deployment.id,
      catalogModelId: deployment.catalogModelId,
      apiFamily: deployment.apiFamily,
      channel: deployment.channel,
      region: deployment.region,
      executionChannelId: deployment.executionChannelId,
      providerModel: deployment.providerModel,
      endpointRevision: deployment.endpointRevision,
      lifecycleRevision: deployment.lifecycleRevision,
      credentialAccountId: deployment.credentialAccountId,
      credentialVersion: deployment.credentialVersion,
      capabilityProfile: deployment.capabilityProfile,
      ...(direct &&
        directConfigurationRevision &&
        deployment.id === directDeploymentId
        ? {
            adapterKey: 'direct-llm',
            adapterBindingRevision: directConfigurationRevision,
            adapterConfig: {
              baseUrl: direct.baseUrl,
              providerModel: direct.model,
              endpointRevision: direct.endpointRevision,
              apiFamily: direct.apiFamily,
              ...(direct.customProtocol
                ? { customProtocol: direct.customProtocol }
                : {}),
              inputCostPerMillion: direct.inputCostPerMillion,
              outputCostPerMillion: direct.outputCostPerMillion,
              currency: direct.currency ?? 'USD',
            } satisfies AdapterRuntimeConfig,
          }
        : {}),
    }));
  const configurationRevisions: Record<string, string> = {};
  if (directDeploymentId && directConfigurationRevision) {
    configurationRevisions[directDeploymentId] = directConfigurationRevision;
  }
  if (arkRevisions) {
    configurationRevisions['seedream-5-pro-direct'] = arkRevisions.image;
    configurationRevisions['seedance-2-direct'] = arkRevisions.video;
  }
  if (tuziRevisions) {
    configurationRevisions[tuziImageDeploymentId!] = tuziRevisions.image;
    configurationRevisions[tuziVideoDeploymentId!] = tuziRevisions.video;
  }
  if (volcengineTtsRevision) {
    configurationRevisions['seed-tts-2-volcengine-direct'] =
      volcengineTtsRevision;
  }
  return {
    configurationRevisions,
    deployments,
    models,
    runtime,
    runtimeCapabilities,
    warnings,
  };
}

function verifiedProbeEvidence(
  evidence: ActivationEvidence | undefined,
  currentConfigurationRevision: string,
  deploymentId: string,
  warnings: ModelRuntimeAssemblyWarning[],
): ActivationEvidence | undefined {
  if (!evidence || evidence.status !== 'live_verified') return undefined;
  if (!/^activation-probe-[a-f0-9]{24,64}$/.test(evidence.evidenceRef ?? '')) {
    return undefined;
  }
  if (evidence.configurationRevision !== currentConfigurationRevision) {
    warnings.push({
      code: 'configuration_drift',
      deploymentId,
      message: `deploymentId=${deploymentId}: configuration drift, activation evidence invalidated, re-probe required`,
    });
    return undefined;
  }
  const timestamp = Date.parse(evidence.verifiedAt ?? '');
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== evidence.verifiedAt
  ) {
    return undefined;
  }
  return structuredClone(evidence);
}

function directModelConfigurationRevision(direct: {
  apiFamily: 'openai' | 'anthropic' | 'gemini' | 'custom';
  baseUrl: string;
  customProtocol?: CustomLlmProtocol;
  model: string;
  credentialVersion: string;
  endpointRevision: string;
}) {
  const configuration: Record<string, string> = {
    baseUrl: direct.baseUrl,
    model: direct.model,
    credentialVersion: direct.credentialVersion,
    endpointRevision: direct.endpointRevision,
  };
  if (direct.apiFamily === 'custom') {
    configuration.apiFamily = direct.apiFamily;
    configuration.customProtocol = direct.customProtocol!;
  }
  return createHash('sha256')
    .update(JSON.stringify(configuration))
    .digest('hex');
}

export function directModelConfigurationRevisionFromEnv(
  env: NodeJS.ProcessEnv
) {
  return directModelConfigurationRevision(
    directOptions(env, createDefaultCatalogModels())
  );
}

function mediaConfigurationRevisions(
  options: ArkMediaExecutionOptions<string>,
) {
  const common = {
    assetSourceHosts: options.assetSourceHosts ?? [],
    baseUrl: options.baseUrl,
    credentialVersion: options.credentialVersion,
    endpointRevision: options.endpointRevision,
    sourceUrlTtlSeconds: options.sourceUrlTtlSeconds,
  };
  const revision = (configuration: Record<string, unknown>) =>
    createHash('sha256')
      .update(JSON.stringify({ ...common, ...configuration }))
      .digest('hex');
  return {
    image: revision({
      catalogModelId: options.image.catalogModelId,
      costPerImage: options.image.costPerImage,
      model: options.image.model,
    }),
    video: revision({
      catalogModelId: options.video.catalogModelId,
      costPerMillionTokens: options.video.costPerMillionTokens,
      estimatedTokensPerSecond: options.video.estimatedTokensPerSecond,
      model: options.video.model,
    }),
  };
}

export function arkMediaConfigurationRevisionsFromEnv(env: NodeJS.ProcessEnv) {
  return mediaConfigurationRevisions(arkMediaOptions(env));
}

export function tuziMediaConfigurationRevisionsFromEnv(env: NodeJS.ProcessEnv) {
  return mediaConfigurationRevisions(tuziMediaOptions(env));
}

function volcengineTtsConfigurationRevision(
  options: VolcengineTtsRuntimeConfig,
) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        approvedPricePerTextWordCny:
          options.approvedPricePerTextWordCny,
        authKind: options.authKind,
        credentialVersion: options.credentialVersion,
        endpoint: options.endpoint,
        endpointRevision: options.endpointRevision,
        model: options.model,
        priceRevision: options.priceRevision,
        resourceId: options.resourceId,
        speaker: options.speaker,
      }),
    )
    .digest('hex');
}

export function volcengineTtsConfigurationRevisionFromEnv(
  env: NodeJS.ProcessEnv,
) {
  return volcengineTtsConfigurationRevision(volcengineTtsOptions(env));
}

function parseMediaMode(env: NodeJS.ProcessEnv): ReadonlySet<MediaProviderMode> {
  const mode = env.MODEL_MEDIA_EXECUTION_MODE?.trim() || 'disabled';
  if (mode === 'disabled') return new Set();
  const providers = mode.split(',').map((provider) => provider.trim());
  if (
    providers.length === 0 ||
    new Set(providers).size !== providers.length ||
    providers.some(
      (provider) =>
        provider !== 'ark' &&
        provider !== 'tuzi' &&
        provider !== 'volcengine_tts',
    )
  ) {
    throw new Error(
      'MODEL_MEDIA_EXECUTION_MODE must contain unique providers from ark, tuzi, and volcengine_tts, or be disabled.'
    );
  }
  return new Set(providers as MediaProviderMode[]);
}

function parseMode(env: NodeJS.ProcessEnv): ModelExecutionRuntimeMode {
  const mode = env.MODEL_EXECUTION_MODE ?? 'recorded';
  if (
    mode !== 'disabled' &&
    mode !== 'recorded' &&
    mode !== 'fixture' &&
    mode !== 'gateway' &&
    mode !== 'direct'
  ) {
    throw new Error(
      'MODEL_EXECUTION_MODE must be disabled, recorded, fixture, gateway, or direct.'
    );
  }
  if (mode === 'fixture' && env.APP_ENV !== 'e2e') {
    throw new Error(
      'MODEL_EXECUTION_MODE=fixture is restricted to APP_ENV=e2e.'
    );
  }
  return mode;
}

function parseGateway(value: string | undefined): 'bifrost' | 'litellm' {
  const gateway = value ?? 'bifrost';
  if (gateway !== 'bifrost' && gateway !== 'litellm') {
    throw new Error('MODEL_GATEWAY_POC must be bifrost or litellm.');
  }
  return gateway;
}

function directOptions(env: NodeJS.ProcessEnv, models: CatalogModel[]) {
  const catalogModelId = required(
    env.MODEL_DIRECT_CATALOG_MODEL_ID,
    'MODEL_DIRECT_CATALOG_MODEL_ID'
  );
  const catalogModel = models.find((model) => model.id === catalogModelId);
  const deployment = createDefaultDeployments().find(
    (candidate) => candidate.catalogModelId === catalogModelId
  );
  const llmFamilies = ['openai', 'anthropic', 'gemini', 'custom'] as const;
  const apiFamily = llmFamilies.find(
    (family) => family === deployment?.apiFamily
  );
  if (
    !catalogModel ||
    catalogModel.modality !== 'llm' ||
    !catalogModel.operations.includes('copy.generate') ||
    !apiFamily
  ) {
    throw new Error(
      'MODEL_DIRECT_CATALOG_MODEL_ID must name an LLM catalog model in an API family (openai, anthropic, gemini, or custom) that supports copy.generate.'
    );
  }
  const customProtocol = parseCustomProtocol(env, apiFamily);
  const isDeepSeek = catalogModelId.startsWith('deepseek-v4-');
  return {
    apiFamily,
    apiKey: isDeepSeek
      ? required(
          env.DEEPSEEK_API_KEY || env.MODEL_DIRECT_API_KEY,
          'DEEPSEEK_API_KEY',
        )
      : required(env.MODEL_DIRECT_API_KEY, 'MODEL_DIRECT_API_KEY'),
    baseUrl: isDeepSeek
      ? 'https://api.deepseek.com'
      : required(env.MODEL_DIRECT_BASE_URL, 'MODEL_DIRECT_BASE_URL'),
    catalogModelId,
    ...(isDeepSeek ? { currency: 'CNY' as const } : {}),
    credentialVersion: required(
      env.MODEL_DIRECT_CREDENTIAL_VERSION,
      'MODEL_DIRECT_CREDENTIAL_VERSION'
    ),
    endpointRevision: required(
      env.MODEL_DIRECT_ENDPOINT_REVISION,
      'MODEL_DIRECT_ENDPOINT_REVISION'
    ),
    inputCostPerMillion: nonNegativeNumber(
      env.MODEL_DIRECT_INPUT_COST_PER_MILLION,
      'MODEL_DIRECT_INPUT_COST_PER_MILLION'
    ),
    model: isDeepSeek
      ? catalogModelId
      : required(env.MODEL_DIRECT_MODEL, 'MODEL_DIRECT_MODEL'),
    outputCostPerMillion: nonNegativeNumber(
      env.MODEL_DIRECT_OUTPUT_COST_PER_MILLION,
      'MODEL_DIRECT_OUTPUT_COST_PER_MILLION'
    ),
    ...(isDeepSeek
      ? {
          maxOutputTokens: 384_000,
          reasoningEffort: 'high' as const,
          thinking: { type: 'enabled' as const },
        }
      : {}),
    ...(customProtocol ? { customProtocol } : {}),
  };
}

function parseCustomProtocol(
  env: NodeJS.ProcessEnv,
  apiFamily: 'openai' | 'anthropic' | 'gemini' | 'custom'
): CustomLlmProtocol | undefined {
  const value = env.MODEL_DIRECT_CUSTOM_PROTOCOL?.trim();
  if (apiFamily !== 'custom') {
    if (value) {
      throw new Error(
        'MODEL_DIRECT_CUSTOM_PROTOCOL is only supported by the custom API family.'
      );
    }
    return undefined;
  }
  if (
    value !== 'openai_chat' &&
    value !== 'anthropic_messages' &&
    value !== 'gemini_generate_content'
  ) {
    throw new Error(
      'MODEL_DIRECT_CUSTOM_PROTOCOL must be openai_chat, anthropic_messages, or gemini_generate_content for the custom API family.'
    );
  }
  return value;
}

function arkMediaOptions(env: NodeJS.ProcessEnv): ArkMediaExecutionOptions {
  const assetSourceHosts = mediaAssetSourceHosts(
    env.ARK_MEDIA_ASSET_SOURCE_HOSTS,
    'ARK_MEDIA_ASSET_SOURCE_HOSTS',
  );
  return {
    apiKey: requiredArk(env.ARK_MEDIA_API_KEY, 'ARK_MEDIA_API_KEY'),
    ...(assetSourceHosts.length > 0 ? { assetSourceHosts } : {}),
    baseUrl: requiredArk(env.ARK_MEDIA_BASE_URL, 'ARK_MEDIA_BASE_URL'),
    credentialVersion: requiredArk(
      env.ARK_MEDIA_CREDENTIAL_VERSION,
      'ARK_MEDIA_CREDENTIAL_VERSION'
    ),
    endpointRevision: requiredArk(
      env.ARK_MEDIA_ENDPOINT_REVISION,
      'ARK_MEDIA_ENDPOINT_REVISION'
    ),
    image: {
      catalogModelId: 'seedream-5-pro',
      costPerImage: nonNegativeArkNumber(
        env.ARK_SEEDREAM_COST_PER_IMAGE_CNY,
        'ARK_SEEDREAM_COST_PER_IMAGE_CNY'
      ),
      model: requiredArk(env.ARK_SEEDREAM_MODEL, 'ARK_SEEDREAM_MODEL'),
    },
    sourceUrlTtlSeconds: positiveArkInteger(
      env.ARK_MEDIA_SOURCE_URL_TTL_SECONDS,
      'ARK_MEDIA_SOURCE_URL_TTL_SECONDS'
    ),
    video: {
      catalogModelId: 'seedance-2',
      costPerMillionTokens: nonNegativeArkNumber(
        env.ARK_SEEDANCE_COST_PER_MILLION_TOKENS_CNY,
        'ARK_SEEDANCE_COST_PER_MILLION_TOKENS_CNY'
      ),
      estimatedTokensPerSecond: nonNegativeArkNumber(
        env.ARK_SEEDANCE_ESTIMATED_TOKENS_PER_SECOND,
        'ARK_SEEDANCE_ESTIMATED_TOKENS_PER_SECOND'
      ),
      model: requiredArk(env.ARK_SEEDANCE_MODEL, 'ARK_SEEDANCE_MODEL'),
    },
  };
}

function tuziImageCatalogModelId(
  configuredCatalogModelId: string | undefined,
  providerModel: string,
) {
  const inferred = providerModel.includes('seedream-4-5')
    ? 'seedream-4-5'
    : providerModel.includes('seedream-5')
      ? 'seedream-5-pro'
      : providerModel === 'gpt-image-2'
        ? 'gpt-image-2'
        : undefined;
  const configured = configuredCatalogModelId?.trim();
  if (configured && inferred && configured !== inferred) {
    throw new Error(
      `TUZI_IMAGE_CATALOG_MODEL_ID ${configured} does not match provider model ${providerModel}.`,
    );
  }
  const catalogModelId = configured || inferred;
  if (
    catalogModelId !== 'gpt-image-2' &&
    catalogModelId !== 'seedream-4-5' &&
    catalogModelId !== 'seedream-5-pro'
  ) {
    throw new Error(
      'TUZI_IMAGE_CATALOG_MODEL_ID must explicitly identify gpt-image-2, seedream-4-5, or seedream-5-pro when the provider model cannot be inferred.',
    );
  }
  return catalogModelId;
}

function tuziImageDeploymentIdForCatalogModel(catalogModelId: string) {
  switch (catalogModelId) {
    case 'gpt-image-2':
      return 'gpt-image-2-tuzi-relay';
    case 'seedream-4-5':
      return 'seedream-4-5-tuzi-relay';
    case 'seedream-5-pro':
      return 'seedream-5-pro-tuzi-relay';
    default:
      throw new Error(
        `Unsupported Tuzi image catalog model: ${catalogModelId}`,
      );
  }
}

function tuziVideoCatalogModelId(
  configuredCatalogModelId: string | undefined,
  providerModel: string,
) {
  const normalized = providerModel.trim().toLowerCase();
  const inferred = /(?:^|[^a-z0-9])seedance[-_.]?1[-_.]?5(?:[-_.]|$)/.test(
    normalized,
  )
    ? 'seedance-1-5-pro'
    : /(?:^|[^a-z0-9])seedance[-_.]?2(?:[-_.]?0)?(?:[-_.]|$)/.test(
          normalized,
        )
      ? 'seedance-2'
      : undefined;
  const configured = configuredCatalogModelId?.trim();
  if (!inferred) {
    throw new Error(
      `TUZI_SEEDANCE_MODEL ${providerModel} is not a recognized Seedance provider model.`,
    );
  }
  if (configured && inferred && configured !== inferred) {
    throw new Error(
      `TUZI_VIDEO_CATALOG_MODEL_ID ${configured} does not match provider model ${providerModel}.`,
    );
  }
  return inferred;
}

function tuziVideoDeploymentIdForCatalogModel(catalogModelId: string) {
  switch (catalogModelId) {
    case 'seedance-1-5-pro':
      return 'seedance-1-5-pro-tuzi-relay';
    case 'seedance-2':
      return 'seedance-2-tuzi-relay';
    default:
      throw new Error(
        `Unsupported Tuzi video catalog model: ${catalogModelId}`,
      );
  }
}

function tuziMediaOptions(env: NodeJS.ProcessEnv): TuziMediaExecutionOptions {
  const assetSourceHosts = mediaAssetSourceHosts(
    env.TUZI_MEDIA_ASSET_SOURCE_HOSTS,
    'TUZI_MEDIA_ASSET_SOURCE_HOSTS',
  );
  const imageModel = requiredMedia(
    env.TUZI_GPT_IMAGE_2_MODEL,
    'TUZI_GPT_IMAGE_2_MODEL',
    'Tuzi',
  );
  const videoModel = requiredMedia(
    env.TUZI_SEEDANCE_MODEL,
    'TUZI_SEEDANCE_MODEL',
    'Tuzi',
  );
  return {
    apiKey: requiredMedia(env.TUZI_MEDIA_API_KEY, 'TUZI_MEDIA_API_KEY', 'Tuzi'),
    ...(assetSourceHosts.length > 0 ? { assetSourceHosts } : {}),
    baseUrl: requiredMedia(
      env.TUZI_MEDIA_BASE_URL,
      'TUZI_MEDIA_BASE_URL',
      'Tuzi'
    ),
    credentialVersion: requiredMedia(
      env.TUZI_MEDIA_CREDENTIAL_VERSION,
      'TUZI_MEDIA_CREDENTIAL_VERSION',
      'Tuzi'
    ),
    endpointRevision: requiredMedia(
      env.TUZI_MEDIA_ENDPOINT_REVISION,
      'TUZI_MEDIA_ENDPOINT_REVISION',
      'Tuzi'
    ),
    image: {
      catalogModelId: tuziImageCatalogModelId(
        env.TUZI_IMAGE_CATALOG_MODEL_ID,
        imageModel
      ),
      costPerImage: nonNegativeMediaNumber(
        env.TUZI_GPT_IMAGE_2_COST_PER_IMAGE_CNY,
        'TUZI_GPT_IMAGE_2_COST_PER_IMAGE_CNY',
        'Tuzi'
      ),
      model: imageModel,
    },
    sourceUrlTtlSeconds: positiveMediaInteger(
      env.TUZI_MEDIA_SOURCE_URL_TTL_SECONDS,
      'TUZI_MEDIA_SOURCE_URL_TTL_SECONDS',
      'Tuzi'
    ),
    video: {
      catalogModelId: tuziVideoCatalogModelId(
        env.TUZI_VIDEO_CATALOG_MODEL_ID,
        videoModel,
      ),
      costPerMillionTokens: nonNegativeMediaNumber(
        env.TUZI_SEEDANCE_COST_PER_MILLION_TOKENS_CNY,
        'TUZI_SEEDANCE_COST_PER_MILLION_TOKENS_CNY',
        'Tuzi'
      ),
      estimatedTokensPerSecond: nonNegativeMediaNumber(
        env.TUZI_SEEDANCE_ESTIMATED_TOKENS_PER_SECOND,
        'TUZI_SEEDANCE_ESTIMATED_TOKENS_PER_SECOND',
        'Tuzi'
      ),
      model: videoModel,
    },
  };
}

function volcengineTtsOptions(
  env: NodeJS.ProcessEnv,
): VolcengineTtsRuntimeConfig {
  const apiKey = env.VOLCENGINE_TTS_API_KEY?.trim();
  const appId = env.VOLCENGINE_TTS_APP_ID?.trim();
  const accessToken = env.VOLCENGINE_TTS_ACCESS_TOKEN?.trim();
  if (apiKey && (appId || accessToken)) {
    throw new Error(
      'Volcengine TTS API-key and legacy credentials cannot be configured together.',
    );
  }
  const auth: VolcengineTtsAuth = apiKey
    ? { apiKey, kind: 'api_key' }
    : {
        accessToken: requiredTts(
          accessToken,
          'VOLCENGINE_TTS_ACCESS_TOKEN',
        ),
        appId: requiredTts(appId, 'VOLCENGINE_TTS_APP_ID'),
        kind: 'legacy',
      };
  const speaker = requiredTts(
    env.VOLCENGINE_TTS_SPEAKER,
    'VOLCENGINE_TTS_SPEAKER',
  );
  const endpoint = requiredTts(
    env.VOLCENGINE_TTS_ENDPOINT,
    'VOLCENGINE_TTS_ENDPOINT',
  );
  const resourceId = requiredTts(
    env.VOLCENGINE_TTS_RESOURCE_ID,
    'VOLCENGINE_TTS_RESOURCE_ID',
  );
  if (resourceId !== 'seed-tts-2.0' && resourceId !== 'seed-icl-2.0') {
    throw new Error(
      'VOLCENGINE_TTS_RESOURCE_ID must be seed-tts-2.0 or seed-icl-2.0.',
    );
  }
  const approvedPricePerTextWordCny = nonNegativeTtsNumber(
    env.VOLCENGINE_TTS_APPROVED_PRICE_PER_TEXT_WORD_CNY,
    'VOLCENGINE_TTS_APPROVED_PRICE_PER_TEXT_WORD_CNY',
  );
  const credentialVersion = requiredTts(
    env.VOLCENGINE_TTS_CREDENTIAL_VERSION,
    'VOLCENGINE_TTS_CREDENTIAL_VERSION',
  );
  const endpointRevision = requiredTts(
    env.VOLCENGINE_TTS_ENDPOINT_REVISION,
    'VOLCENGINE_TTS_ENDPOINT_REVISION',
  );
  const model = requiredTts(
    env.VOLCENGINE_TTS_MODEL,
    'VOLCENGINE_TTS_MODEL',
  );
  const priceRevision = requiredTts(
    env.VOLCENGINE_TTS_PRICE_REVISION,
    'VOLCENGINE_TTS_PRICE_REVISION',
  );
  const synthesis = new VolcengineBidirectionalTtsAdapter({
    auth,
    defaultSpeaker: speaker,
    endpoint,
    model,
    resourceId,
    socketFactory: new NodeVolcengineTtsSocketFactory(),
  });
  return {
    approvedPricePerTextWordCny,
    authKind: auth.kind,
    credentialVersion,
    endpoint,
    endpointRevision,
    lifecycle: {
      approvedPricePerTextWordCny,
      credentialVersion,
      priceRevision,
      synthesis,
      taskStore: new FileSystemVolcengineTtsTaskStore(
        join(
          env.P1_ASSET_STORAGE_DIR ?? './.data/p1-assets',
          '.provider-recovery',
          'volcengine-tts',
        ),
      ),
    },
    model,
    priceRevision,
    resourceId,
    speaker,
  };
}

function required(value: string | undefined, name: string) {
  if (!value?.trim()) throw new Error(`${name} is required in direct mode.`);
  return value.trim();
}

function requiredTts(value: string | undefined, name: string) {
  if (!value?.trim()) {
    throw new Error(`${name} is required in Volcengine TTS media mode.`);
  }
  return value.trim();
}

function nonNegativeTtsNumber(value: string | undefined, name: string) {
  const parsed = Number(value);
  if (!value?.trim() || !Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      `${name} must be a non-negative number in Volcengine TTS media mode.`,
    );
  }
  return parsed;
}

function mediaAssetSourceHosts(value: string | undefined, name: string) {
  if (!value?.trim()) return [];
  const hosts = value
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (
    hosts.length === 0 ||
    hosts.some((host) => {
      try {
        const parsed = new URL(`https://${host}`);
        return (
          parsed.hostname !== host ||
          parsed.port !== '' ||
          parsed.pathname !== '/' ||
          host.includes('*')
        );
      } catch {
        return true;
      }
    })
  ) {
    throw new Error(`${name} must contain exact comma-separated hostnames.`);
  }
  return [...new Set(hosts)].sort();
}

function requiredArk(value: string | undefined, name: string) {
  return requiredMedia(value, name, 'Ark');
}

function requiredMedia(
  value: string | undefined,
  name: string,
  provider: 'Ark' | 'Tuzi'
) {
  if (!value?.trim()) {
    throw new Error(`${name} is required in ${provider} media mode.`);
  }
  return value.trim();
}

function nonNegativeNumber(value: string | undefined, name: string) {
  const parsed = Number(value);
  if (!value?.trim() || !Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number in direct mode.`);
  }
  return parsed;
}

function nonNegativeArkNumber(value: string | undefined, name: string) {
  return nonNegativeMediaNumber(value, name, 'Ark');
}

function nonNegativeMediaNumber(
  value: string | undefined,
  name: string,
  provider: 'Ark' | 'Tuzi'
) {
  const parsed = Number(value);
  if (!value?.trim() || !Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      `${name} must be a non-negative number in ${provider} media mode.`
    );
  }
  return parsed;
}

function positiveArkInteger(value: string | undefined, name: string) {
  return positiveMediaInteger(value, name, 'Ark');
}

function positiveMediaInteger(
  value: string | undefined,
  name: string,
  provider: 'Ark' | 'Tuzi'
) {
  const parsed = Number(value);
  if (!value?.trim() || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `${name} must be a positive integer in ${provider} media mode.`
    );
  }
  return parsed;
}
