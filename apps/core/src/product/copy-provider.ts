import type {
  Asset,
  GeneratedCopyCandidateContent,
  ProductCommand,
  StoreProfile,
} from '@meiye/contracts';

type CopyBrief = Extract<ProductCommand, { type: 'generate_copy' }>['brief'];

export interface CopyProviderRequest {
  workspaceId: string;
  userId: string;
  idempotencyKey: string;
  brief: CopyBrief;
  correlationId: string;
  dataClasses: Array<'contains_face' | 'pii' | 'medical'>;
  store: Pick<StoreProfile, 'name' | 'city' | 'brandVoice'> & {
    project: { id: string; name: string; price: number };
  };
  assets: Array<Pick<Asset, 'id' | 'tags' | 'aigcStatus'>>;
}

export interface CopyCandidateDraft extends GeneratedCopyCandidateContent {
  topics: string[];
  assetOrder: string[];
}

export interface CopyGenerationEvidence {
  requestedModel: string;
  actualModel: string;
  routeSnapshotId: string;
  promptRevision: string;
  templateRevision: string;
  exampleSetRevision: string;
  providerCost: {
    amount: number;
    currency: string;
    status: string;
  };
}

export interface CopyProviderResult {
  candidates: CopyCandidateDraft[];
  evidence: CopyGenerationEvidence;
}

export interface CopyProvider {
  readonly name: string;
  readonly model: string;
  readonly region: 'domestic' | 'overseas' | 'local';
  generate(
    request: CopyProviderRequest
  ): Promise<CopyCandidateDraft[] | CopyProviderResult>;
}

export interface CopyProviderRegistry {
  domestic: CopyProvider;
  standard: CopyProvider;
}

export class DeterministicCopyProvider implements CopyProvider {
  readonly name: string;
  readonly model: string;
  readonly region: CopyProvider['region'];

  constructor(options: {
    name?: string;
    model?: string;
    region?: CopyProvider['region'];
  } = {}) {
    this.name = options.name ?? 'deterministic-fake';
    this.model = options.model ?? 'content-fixture-v1';
    this.region = options.region ?? 'local';
  }

  async generate(request: CopyProviderRequest) {
    const suffixes = ['真实门店版', '熟客推荐版', '同城到店版'];
    return suffixes.map((suffix) => ({
      title: `${request.brief.hook}｜${suffix}`,
      body: `${request.brief.hook}。这次用真实门店素材记录${request.store.project.name}细节，价格以门店确认的 ¥${request.store.project.price} 为准。到店前可先沟通日常习惯。`,
      topics: [`${request.store.city}美业`, request.store.project.name, '同城探店'],
      conversionHook: request.brief.conversionGoal,
      assetOrder: [...request.brief.assetIds],
    }));
  }
}

export const defaultCopyProviderRegistry: CopyProviderRegistry = {
  standard: new DeterministicCopyProvider(),
  domestic: new DeterministicCopyProvider({
    name: 'deterministic-domestic-fake',
    model: 'domestic-content-fixture-v1',
    region: 'domestic',
  }),
};
