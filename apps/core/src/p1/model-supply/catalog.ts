import { randomUUID } from 'node:crypto';
import type {
  CanvasGenerationCapability,
  CatalogModel,
  DataClass,
  ModelDeployment,
  ModelOperation,
} from './index.js';

function canvasCapabilitiesFor(
  deployment: Pick<ModelDeployment, 'apiFamily' | 'catalogModelId'>,
): CanvasGenerationCapability[] {
  if (deployment.catalogModelId.startsWith('llm-')) {
    return [{
      operation: 'text.respond',
      parameters: ['maxOutputTokens', 'temperature'],
      inputAssetRoles: ['reference_image'],
    }];
  }
  if (deployment.apiFamily === 'image') {
    return [
      { operation: 'image.generate', parameters: ['width', 'height'], inputAssetRoles: ['reference_image'] },
      { operation: 'image.edit', parameters: ['width', 'height'], inputAssetRoles: ['reference_image'] },
    ];
  }
  if (deployment.apiFamily === 'media') {
    return [{
      operation: 'video.generate',
      parameters: ['durationSeconds'],
      inputAssetRoles: ['reference_image', 'reference_video'],
    }];
  }
  if (deployment.apiFamily === 'audio') {
    return deployment.catalogModelId === 'audio-speech-fixture'
      ? [{
          operation: 'audio.speech',
          parameters: [
            'format',
            'language',
            'maxDurationSeconds',
            'speed',
            'tone',
            'voice',
          ],
          inputAssetRoles: ['reference_audio'],
        }]
      : [{
          operation: 'audio.sfx',
          parameters: ['durationSeconds', 'format'],
          inputAssetRoles: ['reference_audio'],
        }];
  }
  return [];
}

export type RevisionStage = 'draft' | 'enabled' | 'published' | 'retired';

export interface ActivationEvidence {
  status: 'documented' | 'recorded' | 'live_verified';
  verifiedAt?: string;
  evidenceRef?: string;
  configurationRevision?: string;
}

export interface PublishedDeployment extends ModelDeployment {
  activationEvidence: ActivationEvidence;
  allowedDataClasses?: Array<'public' | DataClass>;
  unavailableReason?:
    | 'activation_evidence_missing'
    | 'credential_unavailable'
    | 'region_unavailable'
    | 'deployment_unavailable'
    | 'retired';
}

export interface CapabilityRevision {
  id: string;
  catalogModelId?: string;
  operation: ModelOperation;
  revision: number;
}

export interface PriceRevision {
  id: string;
  catalogModelId?: string;
  currency: 'CNY' | 'USD';
  amount: number;
  revision: number;
  unit?: string;
}

export interface RouteRevision {
  id: string;
  catalogModelId?: string;
  operation: ModelOperation;
  revision: number;
}

export interface ProviderProfileRevision {
  id: string;
  manufacturer: string;
  apiCounterparty: string;
  lifecycle: 'documented' | 'recorded' | 'live_verified';
  revision: number;
}

export interface ExecutionChannelRevision {
  id: string;
  providerProfileId: string;
  apiCounterparty: string;
  apiFamily: ModelDeployment['apiFamily'];
  channel: ModelDeployment['channel'];
  region: ModelDeployment['region'];
  credentialOwner: NonNullable<ModelDeployment['credentialOwner']>;
  revision: number;
}

export interface CatalogRevisionPayload {
  models: CatalogModel[];
  deployments: PublishedDeployment[];
  capabilities: CapabilityRevision[];
  prices: PriceRevision[];
  routes: RouteRevision[];
  /** Optional only for reading historical pre-P1 catalog revisions. */
  providerProfiles?: ProviderProfileRevision[];
  /** Optional only for reading historical pre-P1 catalog revisions. */
  executionChannels?: ExecutionChannelRevision[];
}

export interface CatalogRevision {
  id: string;
  number: number;
  stage: RevisionStage;
  previousRevisionId?: string;
  payload: CatalogRevisionPayload;
  createdAt: string;
  actorId?: string;
  correlationId?: string;
  reason?: string;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
  }
  return value;
}

function copyPayload(payload: CatalogRevisionPayload): CatalogRevisionPayload {
  return structuredClone(payload);
}

export class CatalogRevisionRegistry {
  private readonly revisions = new Map<string, CatalogRevision>();
  private sequence = 0;

  constructor(initial: CatalogRevision[] = []) {
    for (const revision of [...initial].sort(
      (left, right) => left.number - right.number
    )) {
      if (this.revisions.has(revision.id)) {
        throw new Error(`Duplicate catalog revision ${revision.id}.`);
      }
      const restored = deepFreeze(structuredClone(revision));
      this.revisions.set(restored.id, restored);
      this.sequence = Math.max(this.sequence, restored.number);
    }
  }

  createDraft(
    payload: CatalogRevisionPayload,
    audit?: { actorId: string; correlationId: string }
  ) {
    return this.create(
      'draft',
      copyPayload(payload),
      undefined,
      undefined,
      audit
    );
  }

  enable(
    id: string,
    reason?: string,
    audit?: { actorId: string; correlationId: string }
  ) {
    return this.transition(id, 'draft', 'enabled', reason, audit);
  }

  publish(
    id: string,
    reason?: string,
    audit?: { actorId: string; correlationId: string }
  ) {
    return this.transition(id, 'enabled', 'published', reason, audit);
  }

  retire(
    id: string,
    reason?: string,
    audit?: { actorId: string; correlationId: string }
  ) {
    return this.transition(id, 'published', 'retired', reason, audit);
  }

  get(id: string) {
    return this.revisions.get(id);
  }

  published() {
    return [...this.revisions.values()]
      .filter((revision) => revision.stage === 'published')
      .at(-1);
  }

  list() {
    return [...this.revisions.values()].sort(
      (left, right) => left.number - right.number
    );
  }

  private transition(
    id: string,
    expected: RevisionStage,
    next: RevisionStage,
    reason?: string,
    audit?: { actorId: string; correlationId: string }
  ) {
    const current = this.revisions.get(id);
    if (!current) throw new Error(`Unknown catalog revision ${id}.`);
    if (current.stage !== expected) {
      throw new Error(
        `Catalog revision must be ${expected} before it can become ${next}.`
      );
    }
    return this.create(
      next,
      copyPayload(current.payload),
      current.id,
      reason,
      audit
    );
  }

  private create(
    stage: RevisionStage,
    payload: CatalogRevisionPayload,
    previousRevisionId?: string,
    reason?: string,
    audit?: { actorId: string; correlationId: string }
  ) {
    const revision = deepFreeze<CatalogRevision>({
      id: randomUUID(),
      number: ++this.sequence,
      stage,
      ...(previousRevisionId ? { previousRevisionId } : {}),
      ...(reason ? { reason } : {}),
      ...(audit ? structuredClone(audit) : {}),
      payload,
      createdAt: new Date().toISOString(),
    });
    this.revisions.set(revision.id, revision);
    return revision;
  }
}

export function createDefaultCatalogModels(): CatalogModel[] {
  const definitions: Array<
    CatalogModel &
      Required<
        Pick<
          CatalogModel,
          'manufacturer' | 'stableModelName' | 'version' | 'capabilities'
        >
      >
  > = [
    {
      id: 'llm-openai',
      displayName: 'OpenAI Direct',
      manufacturer: 'OpenAI',
      stableModelName: 'recorded-openai-copy',
      version: 'recorded-v1',
      modality: 'llm',
      operations: ['copy.generate', 'copy.adapt', 'text.respond'],
      capabilities: ['copy.generate', 'copy.adapt', 'text.respond'],
      qualityRank: 95,
    },
    {
      id: 'llm-anthropic',
      displayName: 'Anthropic Direct',
      manufacturer: 'Anthropic',
      stableModelName: 'recorded-anthropic-copy',
      version: 'recorded-v1',
      modality: 'llm',
      operations: ['copy.generate', 'copy.adapt', 'text.respond'],
      capabilities: ['copy.generate', 'copy.adapt', 'text.respond'],
      qualityRank: 90,
    },
    {
      id: 'llm-gemini',
      displayName: 'Gemini Direct',
      manufacturer: 'Google',
      stableModelName: 'recorded-gemini-copy',
      version: 'recorded-v1',
      modality: 'llm',
      operations: ['copy.generate', 'copy.adapt', 'text.respond'],
      capabilities: ['copy.generate', 'copy.adapt', 'text.respond'],
      qualityRank: 88,
    },
    {
      id: 'llm-domestic',
      displayName: 'Domestic LLM Direct',
      manufacturer: 'Domestic provider',
      stableModelName: 'recorded-domestic-copy',
      version: 'recorded-v1',
      modality: 'llm',
      operations: ['copy.generate', 'copy.adapt', 'text.respond'],
      capabilities: ['copy.generate', 'copy.adapt', 'text.respond'],
      qualityRank: 86,
    },
    {
      id: 'llm-custom',
      displayName: '自定义供应商',
      manufacturer: 'Custom provider',
      stableModelName: 'recorded-custom-copy',
      version: 'recorded-v1',
      modality: 'llm',
      operations: ['copy.generate', 'copy.adapt', 'text.respond'],
      capabilities: ['copy.generate', 'copy.adapt', 'text.respond'],
      qualityRank: 0,
    },
    {
      id: 'gpt-image-2',
      displayName: 'GPT Image 2',
      manufacturer: 'OpenAI',
      stableModelName: 'gpt-image-2',
      version: '2',
      modality: 'image',
      operations: ['image.generate', 'image.edit'],
      capabilities: ['image.generate', 'image.edit'],
      qualityRank: 95,
    },
    {
      id: 'nano-banana-2',
      displayName: 'Nano Banana 2',
      manufacturer: 'Google',
      stableModelName: 'nano-banana-2',
      version: '2',
      modality: 'image',
      operations: ['image.generate', 'image.edit'],
      capabilities: ['image.generate', 'image.edit'],
      qualityRank: 82,
    },
    {
      id: 'nano-banana-pro',
      displayName: 'Nano Banana Pro',
      manufacturer: 'Google',
      stableModelName: 'nano-banana-pro',
      version: 'pro',
      modality: 'image',
      operations: ['image.generate', 'image.edit'],
      capabilities: ['image.generate', 'image.edit'],
      qualityRank: 90,
    },
    {
      id: 'seedream-5-pro',
      displayName: 'Seedream 5.0 Pro',
      manufacturer: 'ByteDance',
      stableModelName: 'seedream-5.0-pro',
      version: '5.0-pro',
      modality: 'image',
      operations: ['image.generate', 'image.edit'],
      capabilities: ['image.generate', 'image.edit'],
      qualityRank: 88,
    },
    {
      id: 'seedance-2',
      displayName: 'Seedance 2.0',
      manufacturer: 'ByteDance',
      stableModelName: 'seedance-2.0',
      version: '2.0',
      modality: 'video',
      operations: ['video.generate'],
      capabilities: ['video.generate'],
      qualityRank: 90,
    },
    {
      id: 'kling-latest',
      displayName: 'Kling latest',
      manufacturer: 'Kuaishou',
      stableModelName: 'kling-latest',
      version: 'recorded-contract-2026-07-11',
      modality: 'video',
      operations: ['video.generate'],
      capabilities: ['video.generate'],
      qualityRank: 89,
    },
    {
      id: 'grok-latest-video',
      displayName: 'Grok latest video',
      manufacturer: 'xAI',
      stableModelName: 'grok-latest-video',
      version: 'recorded-contract-2026-07-11',
      modality: 'video',
      operations: ['video.generate'],
      capabilities: ['video.generate'],
      qualityRank: 87,
    },
    {
      id: 'veo-latest',
      displayName: 'Veo latest',
      manufacturer: 'Google',
      stableModelName: 'veo-latest',
      version: 'recorded-contract-2026-07-11',
      modality: 'video',
      operations: ['video.generate'],
      capabilities: ['video.generate'],
      qualityRank: 92,
    },
    {
      id: 'audio-speech-fixture',
      displayName: 'Audio speech recorded fixture',
      manufacturer: 'Recorded fixture',
      stableModelName: 'audio-speech-fixture',
      version: 'recorded-v1',
      modality: 'audio',
      operations: ['audio.speech'],
      capabilities: ['audio.speech'],
      qualityRank: 1,
    },
    {
      id: 'audio-sfx-fixture',
      displayName: 'Audio SFX recorded fixture',
      manufacturer: 'Recorded fixture',
      stableModelName: 'audio-sfx-fixture',
      version: 'recorded-v1',
      modality: 'audio',
      operations: ['audio.sfx'],
      capabilities: ['audio.sfx'],
      qualityRank: 1,
    },
  ];
  return definitions.map((model) => structuredClone(model));
}

export function createDefaultProviderProfiles(): ProviderProfileRevision[] {
  const definitions: Array<[string, string, string]> = [
    ['openai', 'OpenAI', 'OpenAI'],
    ['anthropic', 'Anthropic', 'Anthropic'],
    ['google', 'Google', 'Google'],
    ['domestic-llm', 'Domestic provider', 'Domestic provider'],
    ['custom', 'Custom provider', 'Custom provider'],
    ['bytedance-volcengine', 'ByteDance', 'Volcengine'],
    ['tu-zi', 'ByteDance', 'tu-zi'],
    ['tu-zi-openai', 'OpenAI', 'tu-zi'],
    ['kuaishou-kling', 'Kuaishou', 'Kling API'],
    ['xai', 'xAI', 'xAI'],
    ['audio-fixture', 'Recorded fixture', 'Recorded fixture'],
  ];
  return definitions.map(([id, manufacturer, apiCounterparty]) => ({
    id: `provider-${id}`,
    manufacturer,
    apiCounterparty,
    lifecycle: 'recorded' as const,
    revision: 1,
  }));
}

export function createDefaultExecutionChannels(): ExecutionChannelRevision[] {
  const definitions: Array<
    [
      string,
      string,
      string,
      ModelDeployment['apiFamily'],
      ModelDeployment['channel'],
      ModelDeployment['region'],
      NonNullable<ModelDeployment['credentialOwner']>,
    ]
  > = [
    [
      'openai-direct',
      'provider-openai',
      'OpenAI',
      'openai',
      'direct',
      'overseas',
      'platform',
    ],
    [
      'anthropic-direct',
      'provider-anthropic',
      'Anthropic',
      'anthropic',
      'direct',
      'overseas',
      'platform',
    ],
    [
      'google-direct',
      'provider-google',
      'Google',
      'gemini',
      'direct',
      'overseas',
      'platform',
    ],
    [
      'domestic-llm-direct',
      'provider-domestic-llm',
      'Domestic provider',
      'openai',
      'direct',
      'domestic',
      'platform',
    ],
    [
      'custom-llm-direct',
      'provider-custom',
      'Custom provider',
      'custom',
      'direct',
      'overseas',
      'platform',
    ],
    [
      'openai-image-managed',
      'provider-openai',
      'OpenAI',
      'image',
      'managed',
      'overseas',
      'provider_managed',
    ],
    [
      'google-image-managed',
      'provider-google',
      'Google',
      'image',
      'managed',
      'overseas',
      'provider_managed',
    ],
    [
      'seedream-volcengine-direct',
      'provider-bytedance-volcengine',
      'Volcengine',
      'image',
      'direct',
      'domestic',
      'platform',
    ],
    [
      'seedance-ark-direct',
      'provider-bytedance-volcengine',
      'Volcengine Ark',
      'media',
      'direct',
      'domestic',
      'platform',
    ],
    [
      'tuzi-seedream-relay',
      'provider-tu-zi',
      'tu-zi',
      'image',
      'direct',
      'domestic',
      'platform',
    ],
    [
      'tuzi-gpt-image-2-relay',
      'provider-tu-zi-openai',
      'tu-zi',
      'image',
      'managed',
      'overseas',
      'platform',
    ],
    [
      'tuzi-seedance-relay',
      'provider-tu-zi',
      'tu-zi',
      'media',
      'direct',
      'domestic',
      'platform',
    ],
    [
      'kling-direct',
      'provider-kuaishou-kling',
      'Kling API',
      'media',
      'direct',
      'domestic',
      'platform',
    ],
    [
      'xai-video-managed',
      'provider-xai',
      'xAI',
      'media',
      'managed',
      'overseas',
      'provider_managed',
    ],
    [
      'google-video-managed',
      'provider-google',
      'Google',
      'media',
      'managed',
      'overseas',
      'provider_managed',
    ],
    [
      'fal-shared-queue',
      'provider-google',
      'fal',
      'media',
      'managed',
      'overseas',
      'provider_managed',
    ],
    [
      'replicate-prediction-control',
      'provider-google',
      'Replicate',
      'media',
      'managed',
      'overseas',
      'provider_managed',
    ],
    [
      'audio-fixture-recorded',
      'provider-audio-fixture',
      'Recorded fixture',
      'audio',
      'direct',
      'overseas',
      'platform',
    ],
    [
      'bifrost-openai-gateway',
      'provider-openai',
      'Bifrost',
      'openai',
      'bifrost',
      'overseas',
      'provider_managed',
    ],
    [
      'bifrost-anthropic-gateway',
      'provider-anthropic',
      'Bifrost',
      'anthropic',
      'bifrost',
      'overseas',
      'provider_managed',
    ],
    [
      'bifrost-google-gateway',
      'provider-google',
      'Bifrost',
      'gemini',
      'bifrost',
      'overseas',
      'provider_managed',
    ],
    [
      'bifrost-domestic-llm-gateway',
      'provider-domestic-llm',
      'Bifrost',
      'openai',
      'bifrost',
      'domestic',
      'provider_managed',
    ],
    [
      'litellm-openai-gateway',
      'provider-openai',
      'LiteLLM',
      'openai',
      'litellm',
      'overseas',
      'provider_managed',
    ],
    [
      'litellm-anthropic-gateway',
      'provider-anthropic',
      'LiteLLM',
      'anthropic',
      'litellm',
      'overseas',
      'provider_managed',
    ],
    [
      'litellm-google-gateway',
      'provider-google',
      'LiteLLM',
      'gemini',
      'litellm',
      'overseas',
      'provider_managed',
    ],
    [
      'litellm-domestic-llm-gateway',
      'provider-domestic-llm',
      'LiteLLM',
      'openai',
      'litellm',
      'domestic',
      'provider_managed',
    ],
  ];
  return definitions.map(
    ([
      id,
      providerProfileId,
      apiCounterparty,
      apiFamily,
      channel,
      region,
      credentialOwner,
    ]) => ({
      id: `channel-${id}`,
      providerProfileId,
      apiCounterparty,
      apiFamily: apiFamily as ModelDeployment['apiFamily'],
      channel: channel as ModelDeployment['channel'],
      region: region as ModelDeployment['region'],
      credentialOwner: credentialOwner as NonNullable<
        ModelDeployment['credentialOwner']
      >,
      revision: 1,
    })
  );
}

export function createDefaultCapabilityRevisions(): CapabilityRevision[] {
  return createDefaultCatalogModels().flatMap((model) =>
    model.operations.map((operation, index) => ({
      id: `${model.id}:${operation}:capability-v1`,
      catalogModelId: model.id,
      operation,
      revision: index + 1,
    }))
  );
}

export function createDefaultPriceRevisions(): PriceRevision[] {
  const amountByModel: Record<string, number> = {
    'gpt-image-2': 0.12,
    'nano-banana-2': 0.08,
    'nano-banana-pro': 0.14,
    'seedream-5-pro': 0.06,
    'seedance-2': 0.45,
    'kling-latest': 0.52,
    'grok-latest-video': 0.58,
    'veo-latest': 0.64,
    'audio-speech-fixture': 0.01,
    'audio-sfx-fixture': 0.01,
  };
  return createDefaultCatalogModels().map((model) => ({
    id: `${model.id}:price-v1`,
    catalogModelId: model.id,
    currency: 'USD' as const,
    amount: amountByModel[model.id] ?? 0.02,
    revision: 1,
    unit:
      model.modality === 'llm'
        ? 'recorded_request'
        : model.modality === 'audio'
          ? 'recorded_audio_unit'
          : 'recorded_media_unit',
  }));
}

export function createDefaultRouteRevisions(): RouteRevision[] {
  return createDefaultCatalogModels().flatMap((model) =>
    model.operations.map((operation) => ({
      id: `${model.id}:${operation}:route-v1`,
      catalogModelId: model.id,
      operation,
      revision: 1,
    }))
  );
}

export function createDefaultDeployments(
  options: {
    activatedDeploymentIds?: string[];
    activationEvidenceStatus?: Exclude<
      ActivationEvidence['status'],
      'live_verified'
    >;
    activationEvidenceByDeploymentId?: Readonly<
      Record<string, ActivationEvidence>
    >;
  } = {}
): PublishedDeployment[] {
  const definitions: Array<
    Omit<
      PublishedDeployment,
      'status' | 'activationEvidence' | 'unavailableReason'
    >
  > = [
    {
      id: 'openai-direct-recorded',
      catalogModelId: 'llm-openai',
      providerProfileId: 'provider-openai',
      executionChannelId: 'channel-openai-direct',
      apiCounterparty: 'OpenAI',
      credentialOwner: 'platform',
      lifecycleRevision: 'deployment-v1',
      apiFamily: 'openai',
      channel: 'direct',
      region: 'overseas',
    },
    {
      id: 'anthropic-direct-recorded',
      catalogModelId: 'llm-anthropic',
      providerProfileId: 'provider-anthropic',
      executionChannelId: 'channel-anthropic-direct',
      apiCounterparty: 'Anthropic',
      credentialOwner: 'platform',
      lifecycleRevision: 'deployment-v1',
      apiFamily: 'anthropic',
      channel: 'direct',
      region: 'overseas',
    },
    {
      id: 'gemini-direct-recorded',
      catalogModelId: 'llm-gemini',
      providerProfileId: 'provider-google',
      executionChannelId: 'channel-google-direct',
      apiCounterparty: 'Google',
      credentialOwner: 'platform',
      lifecycleRevision: 'deployment-v1',
      apiFamily: 'gemini',
      channel: 'direct',
      region: 'overseas',
    },
    {
      id: 'domestic-llm-direct-recorded',
      catalogModelId: 'llm-domestic',
      providerProfileId: 'provider-domestic-llm',
      executionChannelId: 'channel-domestic-llm-direct',
      apiCounterparty: 'Domestic provider',
      credentialOwner: 'platform',
      lifecycleRevision: 'deployment-v1',
      apiFamily: 'openai',
      channel: 'direct',
      region: 'domestic',
    },
    {
      id: 'custom-llm-direct-recorded',
      catalogModelId: 'llm-custom',
      providerProfileId: 'provider-custom',
      executionChannelId: 'channel-custom-llm-direct',
      apiCounterparty: 'Custom provider',
      credentialOwner: 'platform',
      lifecycleRevision: 'deployment-v1',
      apiFamily: 'custom',
      channel: 'direct',
      region: 'overseas',
    },
    {
      id: 'gpt-image-2-managed',
      catalogModelId: 'gpt-image-2',
      providerProfileId: 'provider-openai',
      executionChannelId: 'channel-openai-image-managed',
      apiCounterparty: 'OpenAI',
      credentialOwner: 'provider_managed',
      lifecycleRevision: 'deployment-v1',
      apiFamily: 'image',
      channel: 'managed',
      region: 'overseas',
    },
    {
      id: 'gpt-image-2-tuzi-relay',
      catalogModelId: 'gpt-image-2',
      providerProfileId: 'provider-tu-zi-openai',
      executionChannelId: 'channel-tuzi-gpt-image-2-relay',
      apiCounterparty: 'tu-zi',
      credentialOwner: 'platform',
      lifecycleRevision: 'deployment-v1',
      apiFamily: 'image',
      channel: 'managed',
      region: 'overseas',
    },
    {
      id: 'nano-banana-2-managed',
      catalogModelId: 'nano-banana-2',
      providerProfileId: 'provider-google',
      executionChannelId: 'channel-google-image-managed',
      apiCounterparty: 'Google',
      credentialOwner: 'provider_managed',
      lifecycleRevision: 'deployment-v1',
      apiFamily: 'image',
      channel: 'managed',
      region: 'overseas',
    },
    {
      id: 'nano-banana-pro-managed',
      catalogModelId: 'nano-banana-pro',
      providerProfileId: 'provider-google',
      executionChannelId: 'channel-google-image-managed',
      apiCounterparty: 'Google',
      credentialOwner: 'provider_managed',
      lifecycleRevision: 'deployment-v1',
      apiFamily: 'image',
      channel: 'managed',
      region: 'overseas',
    },
    {
      id: 'seedream-5-pro-direct',
      catalogModelId: 'seedream-5-pro',
      providerProfileId: 'provider-bytedance-volcengine',
      executionChannelId: 'channel-seedream-volcengine-direct',
      apiCounterparty: 'Volcengine',
      credentialOwner: 'platform',
      lifecycleRevision: 'deployment-v1',
      apiFamily: 'image',
      channel: 'direct',
      region: 'domestic',
    },
    {
      id: 'seedance-2-direct',
      catalogModelId: 'seedance-2',
      providerProfileId: 'provider-bytedance-volcengine',
      executionChannelId: 'channel-seedance-ark-direct',
      apiCounterparty: 'Volcengine Ark',
      credentialOwner: 'platform',
      lifecycleRevision: 'deployment-v1',
      apiFamily: 'media',
      channel: 'direct',
      region: 'domestic',
    },
    {
      id: 'seedream-5-pro-tuzi-relay',
      catalogModelId: 'seedream-5-pro',
      providerProfileId: 'provider-tu-zi',
      executionChannelId: 'channel-tuzi-seedream-relay',
      apiCounterparty: 'tu-zi',
      credentialOwner: 'platform',
      lifecycleRevision: 'deployment-v1',
      apiFamily: 'image',
      channel: 'direct',
      region: 'domestic',
    },
    {
      id: 'seedance-2-tuzi-relay',
      catalogModelId: 'seedance-2',
      providerProfileId: 'provider-tu-zi',
      executionChannelId: 'channel-tuzi-seedance-relay',
      apiCounterparty: 'tu-zi',
      credentialOwner: 'platform',
      lifecycleRevision: 'deployment-v1',
      apiFamily: 'media',
      channel: 'direct',
      region: 'domestic',
    },
    {
      id: 'kling-latest-direct',
      catalogModelId: 'kling-latest',
      providerProfileId: 'provider-kuaishou-kling',
      executionChannelId: 'channel-kling-direct',
      apiCounterparty: 'Kling API',
      credentialOwner: 'platform',
      lifecycleRevision: 'deployment-v1',
      apiFamily: 'media',
      channel: 'direct',
      region: 'domestic',
    },
    {
      id: 'grok-latest-managed',
      catalogModelId: 'grok-latest-video',
      providerProfileId: 'provider-xai',
      executionChannelId: 'channel-xai-video-managed',
      apiCounterparty: 'xAI',
      credentialOwner: 'provider_managed',
      lifecycleRevision: 'deployment-v1',
      apiFamily: 'media',
      channel: 'managed',
      region: 'overseas',
    },
    {
      id: 'veo-latest-managed',
      catalogModelId: 'veo-latest',
      providerProfileId: 'provider-google',
      executionChannelId: 'channel-google-video-managed',
      apiCounterparty: 'Google',
      credentialOwner: 'provider_managed',
      lifecycleRevision: 'deployment-v1',
      apiFamily: 'media',
      channel: 'managed',
      region: 'overseas',
    },
    {
      id: 'audio-speech-fixture-recorded',
      catalogModelId: 'audio-speech-fixture',
      providerProfileId: 'provider-audio-fixture',
      executionChannelId: 'channel-audio-fixture-recorded',
      apiCounterparty: 'Recorded fixture',
      credentialOwner: 'platform',
      lifecycleRevision: 'recorded-audio-v1',
      apiFamily: 'audio',
      channel: 'direct',
      region: 'overseas',
    },
    {
      id: 'audio-sfx-fixture-recorded',
      catalogModelId: 'audio-sfx-fixture',
      providerProfileId: 'provider-audio-fixture',
      executionChannelId: 'channel-audio-fixture-recorded',
      apiCounterparty: 'Recorded fixture',
      credentialOwner: 'platform',
      lifecycleRevision: 'recorded-audio-v1',
      apiFamily: 'audio',
      channel: 'direct',
      region: 'overseas',
    },
  ];
  const activated = new Set(options.activatedDeploymentIds ?? []);
  for (const [deploymentId, evidence] of Object.entries(
    options.activationEvidenceByDeploymentId ?? {}
  )) {
    if (
      !activated.has(deploymentId) ||
      !definitions.some((deployment) => deployment.id === deploymentId)
    ) {
      throw new Error(
        `Activation evidence references inactive or unknown deployment ${deploymentId}.`
      );
    }
    if (
      evidence.status === 'live_verified' &&
      (!evidence.evidenceRef?.trim() ||
        !evidence.configurationRevision?.trim() ||
        !evidence.verifiedAt ||
        !Number.isFinite(Date.parse(evidence.verifiedAt)) ||
        new Date(Date.parse(evidence.verifiedAt)).toISOString() !==
          evidence.verifiedAt)
    ) {
      throw new Error(
        `Live activation evidence for ${deploymentId} requires an evidence reference, canonical UTC timestamp, and configuration revision.`
      );
    }
  }
  return definitions.map((deployment) => {
    const active = activated.has(deployment.id);
    const explicitEvidence =
      options.activationEvidenceByDeploymentId?.[deployment.id];
    const activationEvidence: ActivationEvidence = explicitEvidence
      ? structuredClone(explicitEvidence)
      : { status: options.activationEvidenceStatus ?? 'recorded' };
    const price = createDefaultPriceRevisions().find(
      (candidate) => candidate.catalogModelId === deployment.catalogModelId
    );
    return {
      ...deployment,
      canvasGenerationCapabilities: canvasCapabilitiesFor(deployment),
      status: active ? 'active' : 'inactive',
      policyRevision: 'data-class-policy-v1',
      priceRevision:
        price?.id ?? `${deployment.catalogModelId}:price-unavailable`,
      credentialMode: 'platform' as const,
      credentialVersion: 'recorded-credential-v1',
      ...(price
        ? {
            unitPrice: {
              amountMicros: Math.round(price.amount * 1_000_000),
              currency: price.currency,
              unit: price.unit ?? 'recorded_request',
            },
          }
        : {}),
      allowedDataClasses:
        deployment.region === 'domestic'
          ? ['public', 'contains_face', 'pii', 'medical']
          : ['public'],
      activationEvidence: active ? activationEvidence : { status: 'recorded' },
      ...(active
        ? {}
        : { unavailableReason: 'activation_evidence_missing' as const }),
    };
  });
}

export interface PreferenceView {
  workspaceDefault?: string;
  userDefault?: string;
  favorites: string[];
  recent: string[];
}

function preferenceKey(
  workspaceId: string,
  userId: string,
  operation: ModelOperation
) {
  return `${workspaceId}:${userId}:${operation}`;
}

export class ModelPreferenceRegistry {
  private readonly workspaceDefaults = new Map<string, string>();
  private readonly userDefaults = new Map<string, string>();
  private readonly favoriteModels = new Map<string, Set<string>>();
  private readonly recentModels = new Map<string, string[]>();

  setWorkspaceDefault(
    workspaceId: string,
    operation: ModelOperation,
    modelId: string
  ) {
    this.workspaceDefaults.set(`${workspaceId}:${operation}`, modelId);
  }

  setUserDefault(
    workspaceId: string,
    userId: string,
    operation: ModelOperation,
    modelId: string
  ) {
    this.userDefaults.set(
      preferenceKey(workspaceId, userId, operation),
      modelId
    );
  }

  setFavorite(
    workspaceId: string,
    userId: string,
    operation: ModelOperation,
    modelId: string,
    favorite: boolean
  ) {
    const key = preferenceKey(workspaceId, userId, operation);
    const values = this.favoriteModels.get(key) ?? new Set<string>();
    favorite ? values.add(modelId) : values.delete(modelId);
    this.favoriteModels.set(key, values);
  }

  recordRecent(
    workspaceId: string,
    userId: string,
    operation: ModelOperation,
    modelId: string
  ) {
    const key = preferenceKey(workspaceId, userId, operation);
    const values = (this.recentModels.get(key) ?? []).filter(
      (value) => value !== modelId
    );
    this.recentModels.set(key, [modelId, ...values].slice(0, 20));
  }

  resolve(
    workspaceId: string,
    userId: string,
    operation: ModelOperation,
    currentOverride?: string
  ) {
    return (
      currentOverride ??
      this.userDefaults.get(preferenceKey(workspaceId, userId, operation)) ??
      this.workspaceDefaults.get(`${workspaceId}:${operation}`)
    );
  }

  view(
    workspaceId: string,
    userId: string,
    operation: ModelOperation
  ): PreferenceView {
    const key = preferenceKey(workspaceId, userId, operation);
    const workspaceDefault = this.workspaceDefaults.get(
      `${workspaceId}:${operation}`
    );
    const userDefault = this.userDefaults.get(key);
    return {
      ...(workspaceDefault ? { workspaceDefault } : {}),
      ...(userDefault ? { userDefault } : {}),
      favorites: [...(this.favoriteModels.get(key) ?? [])],
      recent: [...(this.recentModels.get(key) ?? [])],
    };
  }
}
