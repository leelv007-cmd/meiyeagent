/**
 * Recorded/fake dual-channel fixtures for MP-04T text conformance.
 * official_direct + upstream_reseller — independent of live credentials.
 */
import type { SupplyChannelKind } from '@meiye/contracts';
import type {
  ProviderExecutionPort,
  ProviderExecutionRequest,
  ProviderExecutionResponse,
} from '../../provider-lifecycle.js';
import type {
  CatalogModel,
  ModelDeployment,
} from '../../supply-contracts.js';
import type {
  GatewayFingerprintMetadata,
  GatewayFingerprintProduct,
  TextConformanceOperation,
} from '../types.js';
import { fingerprintProductForChannel } from './normalize.js';

export type TextFixtureScenario =
  | 'success'
  | 'auth_401'
  | 'rate_limit_429'
  | 'server_5xx'
  | 'usage_missing';

export interface TextChannelFixtureSpec {
  channelKind: SupplyChannelKind;
  catalogModelId: string;
  catalogStableModelName: string;
  deploymentId: string;
  providerProfileId: string;
  executionChannelId: string;
  providerModel: string;
  /** Declared alias for mapping confidence (optional). */
  declaredAlias?: {
    providerModel: string;
    catalogModelId: string;
    mappingRevision?: string;
  };
  endpointRevision: string;
  configurationRevision: string;
  protocolFamily: string;
  gatewayFingerprint: GatewayFingerprintMetadata;
  region: 'domestic' | 'overseas';
  apiFamily: ModelDeployment['apiFamily'];
}

export interface TextChannelFixture extends TextChannelFixtureSpec {
  model: CatalogModel;
  deployment: ModelDeployment;
  port: ProviderExecutionPort;
  setScenario(scenario: TextFixtureScenario): void;
}

const OFFICIAL_DIRECT_SPEC: TextChannelFixtureSpec = {
  channelKind: 'official_direct',
  catalogModelId: 'llm-doubao-seed-mini',
  catalogStableModelName: 'doubao-seed-2-0-mini-260428',
  deploymentId: 'dep-text-ark-official',
  providerProfileId: 'pp-volcengine-ark',
  executionChannelId: 'ec-ark-official-cn',
  providerModel: 'doubao-seed-2-0-mini-260428',
  declaredAlias: {
    providerModel: 'doubao-seed-2-0-mini-260428',
    catalogModelId: 'llm-doubao-seed-mini',
    mappingRevision: 'map-ark-seed-mini-v1',
  },
  endpointRevision: 'ark-chat-v3',
  configurationRevision: 'cfg-text-ark-official-v1',
  protocolFamily: 'ark_native_openai_compatible',
  gatewayFingerprint: {
    product: 'official_native',
    version: 'ark-2026-07',
    evidence: 'fixture:official_direct',
  },
  region: 'domestic',
  apiFamily: 'openai',
};

const UPSTREAM_RESELLER_SPEC: TextChannelFixtureSpec = {
  channelKind: 'upstream_reseller',
  catalogModelId: 'llm-gemini-flash',
  catalogStableModelName: 'gemini-3-flash-preview',
  deploymentId: 'dep-text-tuzi-reseller',
  providerProfileId: 'pp-tuzi-upstream',
  executionChannelId: 'ec-tuzi-openai-compat',
  providerModel: 'gemini-3-flash-preview',
  declaredAlias: {
    providerModel: 'gemini-3-flash-preview',
    catalogModelId: 'llm-gemini-flash',
    mappingRevision: 'map-tuzi-gemini-flash-v1',
  },
  endpointRevision: 'tuzi-openai-compat-v2',
  configurationRevision: 'cfg-text-tuzi-reseller-v1',
  protocolFamily: 'openai_compatible',
  gatewayFingerprint: {
    product: 'new_api',
    version: 'new-api-fixture',
    evidence: 'fixture:upstream_reseller',
  },
  region: 'overseas',
  apiFamily: 'openai',
};

/**
 * Fake ProviderExecutionPort that returns normalized success / error shapes.
 * One-shot only — Product Core owns retries (conformance asserts attemptCount).
 */
export class TextConformanceFakePort implements ProviderExecutionPort {
  private scenario: TextFixtureScenario = 'success';

  constructor(
    private readonly options: {
      catalogModelId: string;
      channelKind: SupplyChannelKind;
      gatewayFingerprintProduct: GatewayFingerprintProduct;
    }
  ) {}

  setScenario(scenario: TextFixtureScenario) {
    this.scenario = scenario;
  }

  async execute(
    request: ProviderExecutionRequest
  ): Promise<ProviderExecutionResponse> {
    const operation = request.submission.operation;
    if (
      request.model.id !== this.options.catalogModelId ||
      (operation !== 'copy.generate' &&
        operation !== 'copy.adapt' &&
        operation !== 'text.respond')
    ) {
      return {
        kind: 'failure',
        acceptance: 'rejected_before_accept',
        errorCode: 'incompatible_request',
        retryable: false,
        message: 'Text conformance fake received incompatible request.',
        providerCost: { amount: 0, currency: 'USD', usage: {} },
      };
    }

    const scenario = this.scenario;
    this.scenario = 'success';

    if (scenario === 'auth_401') {
      return {
        kind: 'failure',
        acceptance: 'rejected_before_accept',
        errorCode: 'auth_failed',
        retryable: false,
        message: 'Recorded 401 unauthorized',
        providerCost: { amount: 0, currency: 'USD', usage: {} },
      };
    }
    if (scenario === 'rate_limit_429') {
      return {
        kind: 'failure',
        acceptance: 'rejected_before_accept',
        errorCode: 'rate_limited',
        retryable: true,
        message: 'Recorded 429 rate limited',
        providerCost: { amount: 0, currency: 'USD', usage: {} },
      };
    }
    if (scenario === 'server_5xx') {
      return {
        kind: 'failure',
        acceptance: 'acceptance_unknown',
        errorCode: 'upstream_5xx',
        retryable: true,
        message: 'Recorded 503 upstream',
        providerCost: { amount: 0, currency: 'USD', usage: {} },
      };
    }

    const usage =
      scenario === 'usage_missing'
        ? {}
        : { inputTokens: 24, outputTokens: 96 };
    const baseCost = {
      amount: scenario === 'usage_missing' ? 0 : 0.02,
      currency:
        this.options.channelKind === 'official_direct'
          ? ('CNY' as const)
          : ('USD' as const),
      usage,
    };

    if (operation === 'text.respond') {
      return {
        kind: 'completed',
        providerTaskRef: `fake-${this.options.channelKind}-text`,
        text: request.submission.prompt.slice(0, 120) || 'ok',
        providerCost: baseCost,
      };
    }
    if (operation === 'copy.adapt') {
      return {
        kind: 'completed',
        providerTaskRef: `fake-${this.options.channelKind}-adapt`,
        platformVariants: {
          xiaohongshu: {
            title: '小红书｜到店体验',
            body: '可核对门店与项目信息。',
            conversionHook: '收藏后预约',
            topics: ['同城美业'],
          },
          douyin: {
            title: '抖音｜预约前看这点',
            body: '说清风格、时间与价格口径。',
            conversionHook: '评论区留言',
            topics: ['同城探店'],
          },
          video_account: {
            title: '视频号｜熟客分享',
            body: '从真实问题切入，不做夸大承诺。',
            conversionHook: '转发给朋友',
            topics: ['熟客推荐'],
          },
        },
        providerCost: baseCost,
      };
    }
    return {
      kind: 'completed',
      providerTaskRef: `fake-${this.options.channelKind}-copy`,
      copyCandidates: [
        {
          title: '标题 A',
          body: '正文 A — 可核对事实',
          conversionHook: '先沟通',
        },
        {
          title: '标题 B',
          body: '正文 B — 另一套结构',
          conversionHook: '收藏后再约',
        },
        {
          title: '标题 C',
          body: '正文 C — 第三种切入',
          conversionHook: '到店前留言',
        },
      ],
      providerCost: baseCost,
    };
  }
}

function toFixture(spec: TextChannelFixtureSpec): TextChannelFixture {
  const port = new TextConformanceFakePort({
    catalogModelId: spec.catalogModelId,
    channelKind: spec.channelKind,
    gatewayFingerprintProduct: fingerprintProductForChannel(
      spec.channelKind,
      spec.gatewayFingerprint.product
    ),
  });
  const model: CatalogModel = {
    id: spec.catalogModelId,
    displayName: spec.catalogModelId,
    modality: 'llm',
    operations: ['copy.generate', 'copy.adapt', 'text.respond'],
    qualityRank: 80,
    manufacturer:
      spec.channelKind === 'official_direct' ? 'volcengine' : 'google',
    stableModelName: spec.catalogStableModelName,
    version: spec.endpointRevision,
  };
  const deployment: ModelDeployment = {
    id: spec.deploymentId,
    catalogModelId: spec.catalogModelId,
    providerProfileId: spec.providerProfileId,
    executionChannelId: spec.executionChannelId,
    providerModel: spec.providerModel,
    endpointRevision: spec.endpointRevision,
    apiCounterparty: spec.providerProfileId,
    credentialOwner: 'platform',
    apiFamily: spec.apiFamily,
    channel: spec.channelKind === 'official_direct' ? 'direct' : 'managed',
    region: spec.region,
    status: 'active',
    credentialMode: 'platform',
    credentialVersion: 'fixture-v1',
  };
  return {
    ...spec,
    model,
    deployment,
    port,
    setScenario: (scenario) => port.setScenario(scenario),
  };
}

export function officialDirectTextFixture(): TextChannelFixture {
  return toFixture(OFFICIAL_DIRECT_SPEC);
}

export function upstreamResellerTextFixture(): TextChannelFixture {
  return toFixture(UPSTREAM_RESELLER_SPEC);
}

/** Both fixture paths required for dual-channel matrix claims. */
export function dualChannelTextFixtures(): {
  officialDirect: TextChannelFixture;
  upstreamReseller: TextChannelFixture;
} {
  return {
    officialDirect: officialDirectTextFixture(),
    upstreamReseller: upstreamResellerTextFixture(),
  };
}

export function textConformancePrompt(
  operation: TextConformanceOperation = 'copy.generate'
): string {
  if (operation === 'text.respond') {
    return '用一句话说明补水护理到店前需要确认的事项。';
  }
  if (operation === 'copy.adapt') {
    return JSON.stringify({
      source: {
        title: '基础补水护理到店笔记',
        body: '成都椿屿皮肤管理，基础补水护理，价格以到店确认为准。',
      },
    });
  }
  return JSON.stringify({
    brief: {
      hook: '下班后想做一次节奏清楚的日常护理',
      platform: 'xiaohongshu',
      scenario: '项目种草',
    },
    grounding: {
      city: '成都',
      name: '椿屿皮肤管理',
      project: '基础补水护理',
      price: 299,
    },
    instructions: {
      candidateCount: 3,
      preserveFacts: true,
      prohibitInventedPrices: true,
      requireMaterialDifferences: true,
    },
  });
}
