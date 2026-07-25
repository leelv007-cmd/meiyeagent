import {
  EXAMPLE_STORE_INDUSTRIES,
  PLATFORM_SAMPLE_ID_PREFIX,
  PLATFORM_SAMPLE_PROVENANCE,
  isPlatformSampleId,
  type ExampleStore,
  type ExampleStoreIndustry,
  type ProductState,
} from '@meiye/contracts';

/**
 * D-126 cold-start sample stores (C-5: 护发 / 皮肤管理 / 生发).
 *
 * Platform-maintained material only. Every id lives in the reserved
 * `platform-sample:` namespace so tenant projections can prove the absence of
 * sample entities in a merchant's own workspace (see `platform-sample.ts`).
 */

function sampleId(parts: string) {
  return `${PLATFORM_SAMPLE_ID_PREFIX}${parts}`;
}

function seedExampleStores(): ExampleStore[] {
  return [
    {
      id: sampleId('store/hair-care'),
      industry: 'hair_care',
      provenance: PLATFORM_SAMPLE_PROVENANCE,
      name: '向叶头皮护理工作室（示例）',
      readOnly: true,
      hidden: true,
      assets: 4,
      contentCards: 3,
      packages: 1,
      profile: { city: '杭州', project: '头皮深层清洁', confirmedPrice: 268 },
      facts: [
        {
          id: sampleId('fact/hair-care/location'),
          label: '门店位置',
          value: '杭州拱墅区，地铁口步行 5 分钟',
        },
        {
          id: sampleId('fact/hair-care/project'),
          label: '主推项目',
          value: '头皮深层清洁 268 元，含头皮检测与养护，约 70 分钟',
        },
        {
          id: sampleId('fact/hair-care/audience'),
          label: '常见客群',
          value: '出油快、易扁塌的上班族，多为一周洗三到四次头',
        },
        {
          id: sampleId('fact/hair-care/tone'),
          label: '说话风格',
          value: '像熟客推荐，讲实际感受，不承诺疗效',
        },
      ],
      assetPreviews: [
        {
          id: sampleId('asset/hair-care/scalp-check'),
          label: '头皮检测仪画面',
          authorizationStatus: 'authorized',
        },
        {
          id: sampleId('asset/hair-care/wash-room'),
          label: '洗护区环境',
          authorizationStatus: 'authorized',
        },
        {
          id: sampleId('asset/hair-care/technician'),
          label: '技师操作过程',
          authorizationStatus: 'authorized',
        },
        {
          id: sampleId('asset/hair-care/after-blowout'),
          label: '护理后蓬松效果',
          authorizationStatus: 'authorized',
        },
      ],
      contentPreviews: [
        {
          id: sampleId('content/hair-care/oily-scalp'),
          title: '一天不洗就塌，先看头皮还是先换洗发水',
          platform: 'xiaohongshu',
          summary: '从顾客最常问的一句话切入，把头皮清洁讲成日常可感的事。',
        },
        {
          id: sampleId('content/hair-care/first-visit'),
          title: '第一次做头皮护理，70 分钟里发生了什么',
          platform: 'douyin',
          summary: '按流程拆成四段，让没做过的顾客知道要花多久、做什么。',
        },
        {
          id: sampleId('content/hair-care/home-care'),
          title: '护理完在家怎么打理才不白做',
          platform: 'xiaohongshu',
          summary: '把到店服务延伸成回家可执行的三步，方便顾客收藏。',
        },
      ],
      handoffPreview: {
        id: sampleId('handoff/hair-care'),
        title: '头皮清洁项目发布包',
        platform: 'xiaohongshu',
      },
    },
    {
      id: sampleId('store/skin-management'),
      industry: 'skin_management',
      provenance: PLATFORM_SAMPLE_PROVENANCE,
      name: '素合皮肤管理（示例）',
      readOnly: true,
      hidden: true,
      assets: 4,
      contentCards: 3,
      packages: 1,
      profile: { city: '成都', project: '屏障修护护理', confirmedPrice: 398 },
      facts: [
        {
          id: sampleId('fact/skin-management/location'),
          label: '门店位置',
          value: '成都武侯区，写字楼内独立空间',
        },
        {
          id: sampleId('fact/skin-management/project'),
          label: '主推项目',
          value: '屏障修护护理 398 元，含皮肤检测与冷敷收尾，约 90 分钟',
        },
        {
          id: sampleId('fact/skin-management/audience'),
          label: '常见客群',
          value: '换季泛红、上妆卡粉的顾客，多在下班后到店',
        },
        {
          id: sampleId('fact/skin-management/tone'),
          label: '说话风格',
          value: '克制专业，先讲适合谁再讲效果，不做医疗承诺',
        },
      ],
      assetPreviews: [
        {
          id: sampleId('asset/skin-management/skin-test'),
          label: '皮肤检测记录',
          authorizationStatus: 'authorized',
        },
        {
          id: sampleId('asset/skin-management/room'),
          label: '护理间环境',
          authorizationStatus: 'authorized',
        },
        {
          id: sampleId('asset/skin-management/products'),
          label: '在用产品陈列',
          authorizationStatus: 'authorized',
        },
        {
          id: sampleId('asset/skin-management/after-care'),
          label: '护理后状态实拍',
          authorizationStatus: 'authorized',
        },
      ],
      contentPreviews: [
        {
          id: sampleId('content/skin-management/seasonal-red'),
          title: '换季一直泛红，是缺水还是屏障出问题',
          platform: 'xiaohongshu',
          summary: '先分清两种常见情况，再说明到店会怎么判断。',
        },
        {
          id: sampleId('content/skin-management/makeup-hold'),
          title: '上妆总卡粉，护理前后差在哪一步',
          platform: 'douyin',
          summary: '用顾客能看懂的对比讲清护理解决的是什么问题。',
        },
        {
          id: sampleId('content/skin-management/how-to-pick'),
          title: '第一次做皮肤管理，怎么挑不踩坑',
          platform: 'xiaohongshu',
          summary: '给三条挑店标准，顺带说明本店怎么做。',
        },
      ],
      handoffPreview: {
        id: sampleId('handoff/skin-management'),
        title: '屏障修护项目发布包',
        platform: 'xiaohongshu',
      },
    },
    {
      id: sampleId('store/hair-growth'),
      industry: 'hair_growth',
      provenance: PLATFORM_SAMPLE_PROVENANCE,
      name: '本源养发中心（示例）',
      readOnly: true,
      hidden: true,
      assets: 4,
      contentCards: 3,
      packages: 1,
      profile: { city: '西安', project: '发际线养护', confirmedPrice: 498 },
      facts: [
        {
          id: sampleId('fact/hair-growth/location'),
          label: '门店位置',
          value: '西安雁塔区，独立门店可停车',
        },
        {
          id: sampleId('fact/hair-growth/project'),
          label: '主推项目',
          value: '发际线养护 498 元，含头皮检测与阶段记录，约 80 分钟',
        },
        {
          id: sampleId('fact/hair-growth/audience'),
          label: '常见客群',
          value: '发际线后移、扎头发显稀疏的顾客，多为长期熬夜人群',
        },
        {
          id: sampleId('fact/hair-growth/tone'),
          label: '说话风格',
          value: '实事求是讲周期与配合方式，不承诺生发效果',
        },
      ],
      assetPreviews: [
        {
          id: sampleId('asset/hair-growth/scalp-scan'),
          label: '头皮检测对比图',
          authorizationStatus: 'authorized',
        },
        {
          id: sampleId('asset/hair-growth/store-front'),
          label: '门店门头与前台',
          authorizationStatus: 'authorized',
        },
        {
          id: sampleId('asset/hair-growth/care-process'),
          label: '养护操作过程',
          authorizationStatus: 'authorized',
        },
        {
          id: sampleId('asset/hair-growth/record-book'),
          label: '阶段记录本',
          authorizationStatus: 'authorized',
        },
      ],
      contentPreviews: [
        {
          id: sampleId('content/hair-growth/hairline'),
          title: '发际线后移，先分清是掉得多还是长得慢',
          platform: 'xiaohongshu',
          summary: '把顾客最焦虑的问题拆成两种情况，降低咨询门槛。',
        },
        {
          id: sampleId('content/hair-growth/cycle'),
          title: '养护要做多久才看得出来',
          platform: 'douyin',
          summary: '诚实讲周期与记录方式，替代夸大承诺。',
        },
        {
          id: sampleId('content/hair-growth/daily-habit'),
          title: '熬夜挡不住，日常这三件事先做到',
          platform: 'xiaohongshu',
          summary: '先给可执行建议再引到到店检测，适合长期发布。',
        },
      ],
      handoffPreview: {
        id: sampleId('handoff/hair-growth'),
        title: '发际线养护项目发布包',
        platform: 'xiaohongshu',
      },
    },
  ];
}

export function initialExampleStores(): ExampleStore[] {
  return seedExampleStores();
}

type LegacyExampleStoreState = {
  exampleStore?: unknown;
  exampleStores?: unknown;
};

function legacyHidden(stored: LegacyExampleStoreState) {
  const single = stored.exampleStore;
  if (single && typeof single === 'object' && 'hidden' in single) {
    return Boolean((single as { hidden?: unknown }).hidden);
  }
  return undefined;
}

/**
 * Hydrate persisted state into the three-industry shape.
 *
 * Development and pilot workspaces were persisted before D-126 landed, when
 * `exampleStore` held a single manicure sample. Those blobs must hydrate into
 * the seeded array while keeping whatever visibility the merchant chose.
 */
export function hydrateExampleStores(stored: unknown): ExampleStore[] {
  const seeds = seedExampleStores();
  const state = (stored ?? {}) as LegacyExampleStoreState;
  const persisted = Array.isArray(state.exampleStores)
    ? (state.exampleStores as Array<Partial<ExampleStore>>)
    : [];
  const byIndustry = new Map<ExampleStoreIndustry, Partial<ExampleStore>>();
  for (const entry of persisted) {
    if (entry?.industry && EXAMPLE_STORE_INDUSTRIES.includes(entry.industry)) {
      byIndustry.set(entry.industry, entry);
    }
  }
  const inheritedHidden = legacyHidden(state);
  return seeds.map((seed) => {
    const persistedStore = byIndustry.get(seed.industry);
    const hidden = persistedStore?.hidden ?? inheritedHidden ?? seed.hidden;
    return { ...seed, hidden };
  });
}

export function exampleStoreEntityIds(stores: ExampleStore[]) {
  const ids = new Set<string>();
  for (const store of stores) {
    ids.add(store.id);
    for (const fact of store.facts) ids.add(fact.id);
    for (const asset of store.assetPreviews) ids.add(asset.id);
    for (const content of store.contentPreviews) ids.add(content.id);
    ids.add(store.handoffPreview.id);
  }
  return ids;
}

/**
 * D-126 isolation: platform-sample material never reaches a tenant-facing
 * projection. The reserved id namespace is the enforcement point, so anything
 * carrying a sample id is dropped no matter which collection it landed in.
 */
export function withoutPlatformSamples(state: ProductState): ProductState {
  const assets = state.assets.filter((asset) => !isPlatformSampleId(asset.id));
  const contents = state.contents.filter(
    (content) => !isPlatformSampleId(content.id),
  );
  const handoffPackages = state.handoffPackages.filter(
    (handoff) => !isPlatformSampleId(handoff.id),
  );
  if (
    assets.length === state.assets.length &&
    contents.length === state.contents.length &&
    handoffPackages.length === state.handoffPackages.length
  ) {
    return state;
  }
  return { ...state, assets, contents, handoffPackages };
}
