import type { SceneId } from '@/product/creation-entry-model';

export const MARKETING_ENTRY_IDS = [
  'project_exposure',
  'hot_topic',
  'brand_ip',
  'promotion_conversion',
  'promotional_material',
] as const;

export type MarketingEntryId = (typeof MARKETING_ENTRY_IDS)[number];

export interface MarketingEntryCapability {
  mainRecommendation: boolean;
  platformDeliverables: boolean;
  factsAndRights: boolean;
  quickEdit: boolean;
  publishExport: boolean;
  asyncRecovery: boolean;
  remix: boolean;
}

export type MarketingEntryCapabilities = Partial<
  Record<MarketingEntryId, MarketingEntryCapability>
>;

const CONTEXTS: Record<
  MarketingEntryId,
  { intent: string; presetFamilies: string[] }
> = {
  project_exposure: {
    intent:
      '为本店一个真实项目或服务制作一套可发布内容，用已授权的证据素材解释项目价值，并引导顾客咨询或预约。',
    presetFamilies: ['before_after', 'package_explainer'],
  },
  hot_topic: {
    intent:
      '结合有明确来源和时效的热点、同城信号或节点，为本店制作原创角度的可发布内容；如果相关性不足就转为常青内容。',
    presetFamilies: ['package_explainer'],
  },
  brand_ip: {
    intent:
      '用已确认的品牌或个人表达身份制作一条系列内容，保持口吻和栏目一致，并给出下一条续写建议。',
    presetFamilies: ['package_explainer'],
  },
  promotion_conversion: {
    intent:
      '为本店当前促销或团购制作一套可发布内容，只使用已核验的价格、权益和有效期，并给出预约、买券或到店行动。',
    presetFamilies: ['price_card', 'package_explainer'],
  },
  promotional_material: {
    intent:
      '为本店当前用途制作成套宣传物料，明确尺寸、可替换文字与素材，并交付可导出、可复用的成品。',
    presetFamilies: ['price_card', 'before_after', 'package_explainer'],
  },
};

const SECONDARY_SCENES: Record<MarketingEntryId, SceneId[]> = {
  project_exposure: [
    'lead-gen-hair',
    'lead-gen-nail',
    'lead-gen-skin',
    'seeding-hair',
    'seeding-nail',
    'seeding-skin',
  ],
  hot_topic: [],
  brand_ip: ['retention-nail'],
  promotion_conversion: ['promotion-nail'],
  promotional_material: [],
};

export function completeMarketingCapability(): MarketingEntryCapability {
  return {
    mainRecommendation: true,
    platformDeliverables: true,
    factsAndRights: true,
    quickEdit: true,
    publishExport: true,
    asyncRecovery: true,
    remix: true,
  };
}

export function productionMarketingEntryCapabilities(): MarketingEntryCapabilities {
  return Object.fromEntries(
    MARKETING_ENTRY_IDS.map((entryId) => [
      entryId,
      completeMarketingCapability(),
    ])
  );
}

export function marketingEntryReleased(
  capability: MarketingEntryCapability | undefined
) {
  return Boolean(capability && Object.values(capability).every(Boolean));
}

export function releasedMarketingEntries(
  capabilities: MarketingEntryCapabilities
): MarketingEntryId[] {
  return MARKETING_ENTRY_IDS.filter((entryId) =>
    marketingEntryReleased(capabilities[entryId])
  );
}

export function marketingEntryContext(entryId: MarketingEntryId) {
  return { entryId, ...CONTEXTS[entryId] };
}

export function secondaryScenesForEntry(entryId: MarketingEntryId) {
  return [...SECONDARY_SCENES[entryId]];
}
