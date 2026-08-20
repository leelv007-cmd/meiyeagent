import assert from 'node:assert/strict';
import test from 'node:test';
import { contentPackageSchema } from '@meiye/contracts';

import {
  DEFAULT_HARNESS_TODAY_RECOMMENDATION_CONFIG,
  normalizeHarnessTodayRecommendationConfig,
  resolveTodayRecommendationIndustrySlug,
} from '../admin-config/foundation-module.js';
import { compileCopyGenerationRequest } from './output-compiler.js';
import {
  industryLabelFromStoreFactValue,
  projectTodayRecommendation,
} from './today-recommendation.js';

const NOW = '2026-07-18T12:00:00.000Z';
const PRIMARY_COPY_SELECTION_REASON =
  '这版先按你这次的要求整理，已经准备好直接使用。';

test('keeps zero facts cold even when an old delivery exists', () => {
  assert.deepEqual(projectTodayRecommendation('workspace-1', 0, record(0)), {
    workspaceId: 'workspace-1',
    currentFactsRevision: 0,
    recommendation: null,
    stale: false,
  });
});

test('exposes one persisted recommendation only at its exact fact revision', () => {
  const state = projectTodayRecommendation('workspace-1', 1, record(1), NOW);

  assert.equal(state.recommendation?.factsRevision, 1);
  assert.equal(state.recommendation?.packageId, 'package-1');
  assert.equal(state.recommendation?.versionId, 'version-1');
  assert.equal(state.recommendation?.whyNow, PRIMARY_COPY_SELECTION_REASON);
  assert.deepEqual(state.recommendation?.factReferences, [
    'store_fact:offer-price:1',
  ]);
  assert.equal(state.stale, false);
});

test('today fixture uses the production primary copy candidate contract', () => {
  const compiled = compileCopyGenerationRequest({
    brief: {
      assetRefs: [],
      constraints: [],
      cta: '私信预约',
      factRefs: ['store_fact:offer-price:1'],
      identityRefs: [],
      instructions: 'Generate one grounded copy result.',
      platform: 'xiaohongshu',
    },
    context: {},
  });
  const selection = record(1).selectionTrace;

  assert.equal(compiled.candidateId, 'c01');
  assert.deepEqual(selection, {
    winnerCandidateId: compiled.candidateId,
    candidateScores: [
      {
        candidateId: compiled.candidateId,
        reason: PRIMARY_COPY_SELECTION_REASON,
      },
    ],
  });
});

test('uses configured industry and platform rules before the persisted winner reason', () => {
  const configured = {
    ...record(1),
    // Production writes industry_category (Chinese label or slug), not industry.
    intent: { context: { industry_category: '皮肤管理' } },
    briefTrace: {
      ...record(1).briefTrace,
      platforms: ['xiaohongshu'],
    },
    recommendationRules: {
      weekdayWhyNow: { '6': '周六规则' },
      industryWhyNow: {
        skin_management: '皮肤管理行业先验',
      },
      platformWhyNow: { xiaohongshu: '小红书平台规则' },
    },
  };

  assert.equal(
    projectTodayRecommendation('workspace-1', 1, configured, NOW)
      .recommendation?.whyNow,
    '皮肤管理行业先验',
  );
});

// D-174: the industry layer describes the store, not one task. The profile is
// its source of truth; the intent-context chain stays only as a fallback for
// deliveries that predate the profile field.
test('the store profile industry outranks the intent context chain', () => {
  const rules = {
    weekdayWhyNow: { '6': '周六规则' },
    industryWhyNow: {
      hair_care: '护发行业先验',
      skin_management: '皮肤管理行业先验',
    },
    platformWhyNow: { xiaohongshu: '小红书平台规则' },
  };

  assert.equal(
    projectTodayRecommendation(
      'workspace-1',
      1,
      {
        ...record(1),
        storeIndustry: '美发',
        // Disagreeing on purpose: if the intent context could still win, this
        // would read 皮肤管理行业先验 and the profile would be decorative.
        intent: { context: { industry_category: '皮肤管理' } },
        recommendationRules: rules,
      },
      NOW,
    ).recommendation?.whyNow,
    '护发行业先验',
  );
});

test('the intent context chain still answers when the profile has no industry', () => {
  const rules = {
    weekdayWhyNow: { '6': '周六规则' },
    industryWhyNow: { skin_management: '皮肤管理行业先验' },
    platformWhyNow: { xiaohongshu: '小红书平台规则' },
  };

  for (const storeIndustry of [undefined, '', '   ']) {
    assert.equal(
      projectTodayRecommendation(
        'workspace-1',
        1,
        {
          ...record(1),
          ...(storeIndustry === undefined ? {} : { storeIndustry }),
          intent: { context: { industry_category: '皮肤管理' } },
          recommendationRules: rules,
        },
        NOW,
      ).recommendation?.whyNow,
      '皮肤管理行业先验',
      `blank profile industry ${JSON.stringify(storeIndustry)} must fall back`,
    );
  }
});

test('an unmapped profile industry falls through instead of throwing', () => {
  const rules = {
    weekdayWhyNow: { '6': '周六规则' },
    industryWhyNow: { hair_care: '护发行业先验' },
    platformWhyNow: { xiaohongshu: '小红书平台规则' },
  };

  // 美甲 is published-supply-less by design, and free text is whatever the
  // merchant typed. Neither may hit the industry layer, and neither may take
  // the whole card down with it — platform then weekday still answer.
  for (const storeIndustry of ['美甲', '自由文本随便写']) {
    assert.equal(
      projectTodayRecommendation(
        'workspace-1',
        1,
        {
          ...record(1),
          storeIndustry,
          briefTrace: { ...record(1).briefTrace, platforms: ['xiaohongshu'] },
          recommendationRules: rules,
        },
        NOW,
      ).recommendation?.whyNow,
      '小红书平台规则',
      `unmapped profile industry ${storeIndustry} must fall through`,
    );
  }
});

test('industryLabelFromStoreFactValue reads only a stated industry string', () => {
  assert.equal(
    industryLabelFromStoreFactValue({ industry: '美发' }),
    '美发',
  );
  assert.equal(industryLabelFromStoreFactValue({ industry: '  ' }), undefined);
  assert.equal(industryLabelFromStoreFactValue({ name: '美发' }), undefined);
  assert.equal(industryLabelFromStoreFactValue(null), undefined);
});

test('empty profile industry with production defaults falls through to platform then weekday', () => {
  assert.equal(
    projectTodayRecommendation(
      'workspace-1',
      1,
      {
        ...record(1),
        briefTrace: { ...record(1).briefTrace, platforms: ['xiaohongshu'] },
        recommendationRules: DEFAULT_HARNESS_TODAY_RECOMMENDATION_CONFIG,
      },
      NOW,
    ).recommendation?.whyNow,
    DEFAULT_HARNESS_TODAY_RECOMMENDATION_CONFIG.platformWhyNow.xiaohongshu,
  );

  assert.equal(
    projectTodayRecommendation(
      'workspace-1',
      1,
      {
        ...record(1),
        storeIndustry: '美甲',
        briefTrace: { ...record(1).briefTrace, platforms: [] },
        recommendationRules: DEFAULT_HARNESS_TODAY_RECOMMENDATION_CONFIG,
      },
      NOW,
    ).recommendation?.whyNow,
    PRIMARY_COPY_SELECTION_REASON,
  );
});

test('three published industry slugs each hit the industry whyNow layer', () => {
  for (const [slug, label, reason] of [
    ['hair_care', '美发', '护发行业先验'],
    ['skin_management', '皮肤管理', '皮肤管理行业先验'],
    ['hair_growth', '生发', '养发行业先验'],
  ] as const) {
    const bySlug = projectTodayRecommendation(
      'workspace-1',
      1,
      {
        ...record(1),
        intent: { context: { industry_category: slug } },
        briefTrace: {
          ...record(1).briefTrace,
          platforms: ['xiaohongshu'],
        },
        recommendationRules: {
          weekdayWhyNow: { '6': '周六规则' },
          industryWhyNow: {
            hair_care: '护发行业先验',
            skin_management: '皮肤管理行业先验',
            hair_growth: '养发行业先验',
          },
          platformWhyNow: { xiaohongshu: '小红书平台规则' },
        },
      },
      NOW,
    );
    assert.equal(bySlug.recommendation?.whyNow, reason, `slug ${slug}`);

    const byLabel = projectTodayRecommendation(
      'workspace-1',
      1,
      {
        ...record(1),
        intent: { context: { industry_category: label } },
        briefTrace: {
          ...record(1).briefTrace,
          platforms: ['xiaohongshu'],
        },
        recommendationRules: {
          weekdayWhyNow: { '6': '周六规则' },
          industryWhyNow: {
            hair_care: '护发行业先验',
            skin_management: '皮肤管理行业先验',
            hair_growth: '养发行业先验',
          },
          platformWhyNow: { xiaohongshu: '小红书平台规则' },
        },
      },
      NOW,
    );
    assert.equal(byLabel.recommendation?.whyNow, reason, `label ${label}`);
  }
});

test('orphan 美甲 and free-text industry values fall through to platform then weekday', () => {
  const rules = {
    weekdayWhyNow: { '6': '周六规则' },
    industryWhyNow: {
      hair_care: '护发行业先验',
      // Legacy orphan key still present on a stored revision must not win.
      美甲: '美甲孤儿条目',
    },
    platformWhyNow: { xiaohongshu: '小红书平台规则' },
  };

  assert.equal(
    projectTodayRecommendation(
      'workspace-1',
      1,
      {
        ...record(1),
        intent: { context: { industry_category: '美甲' } },
        briefTrace: {
          ...record(1).briefTrace,
          platforms: ['xiaohongshu'],
        },
        recommendationRules: rules,
      },
      NOW,
    ).recommendation?.whyNow,
    '小红书平台规则',
  );

  assert.equal(
    projectTodayRecommendation(
      'workspace-1',
      1,
      {
        ...record(1),
        intent: { context: { industry_category: '自由文本随便写' } },
        briefTrace: {
          ...record(1).briefTrace,
          platforms: ['xiaohongshu'],
        },
        recommendationRules: rules,
      },
      NOW,
    ).recommendation?.whyNow,
    '小红书平台规则',
  );

  assert.equal(
    projectTodayRecommendation(
      'workspace-1',
      1,
      {
        ...record(1),
        intent: { context: { industry_category: '美甲' } },
        briefTrace: {
          ...record(1).briefTrace,
          platforms: [],
        },
        recommendationRules: rules,
      },
      NOW,
    ).recommendation?.whyNow,
    '周六规则',
  );
});

test('persisted Chinese industryWhyNow keys migrate at read time and stay idempotent', () => {
  const chineseRevision = {
    weekdayWhyNow: { '6': '周六规则' },
    industryWhyNow: {
      美发: '旧键·护发',
      皮肤管理: '旧键·皮肤管理',
      美甲: '旧键·美甲孤儿',
      生发: '旧键·养发',
    },
    platformWhyNow: { xiaohongshu: '小红书平台规则' },
  };

  const once = normalizeHarnessTodayRecommendationConfig(chineseRevision);
  const twice = normalizeHarnessTodayRecommendationConfig(once);
  assert.deepEqual(once, twice);
  assert.deepEqual(once.industryWhyNow, {
    hair_care: '旧键·护发',
    skin_management: '旧键·皮肤管理',
    hair_growth: '旧键·养发',
    美甲: '旧键·美甲孤儿',
  });

  // Already-slug defaults are an identity transform.
  assert.deepEqual(
    normalizeHarnessTodayRecommendationConfig(
      DEFAULT_HARNESS_TODAY_RECOMMENDATION_CONFIG,
    ),
    DEFAULT_HARNESS_TODAY_RECOMMENDATION_CONFIG,
  );

  assert.equal(
    projectTodayRecommendation(
      'workspace-1',
      1,
      {
        ...record(1),
        intent: { context: { industry_category: '美发' } },
        briefTrace: {
          ...record(1).briefTrace,
          platforms: ['xiaohongshu'],
        },
        recommendationRules: chineseRevision,
      },
      NOW,
    ).recommendation?.whyNow,
    '旧键·护发',
  );
  assert.equal(
    projectTodayRecommendation(
      'workspace-1',
      1,
      {
        ...record(1),
        intent: { context: { industry_category: 'hair_growth' } },
        briefTrace: {
          ...record(1).briefTrace,
          platforms: ['xiaohongshu'],
        },
        recommendationRules: chineseRevision,
      },
      NOW,
    ).recommendation?.whyNow,
    '旧键·养发',
  );

  assert.equal(resolveTodayRecommendationIndustrySlug('护发'), 'hair_care');
  assert.equal(resolveTodayRecommendationIndustrySlug('养发'), 'hair_growth');
  assert.equal(resolveTodayRecommendationIndustrySlug('美甲'), undefined);
});

test('replays a delivered image or video when media selection has no scores', () => {
  for (const [kind, expectedWhyNow] of [
    ['image_text', '这份图文成品今天已经完成，可以从这份成品继续编辑。'],
    ['video', '这份视频成品今天已经完成，可以从这份成品继续编辑。'],
  ] as const) {
    const state = projectTodayRecommendation(
      'workspace-1',
      1,
      mediaRecord(kind),
      NOW,
    );

    assert.equal(state.recommendation?.whyNow, expectedWhyNow);
    assert.equal(state.recommendation?.packageId, 'package-1');
    assert.equal(state.stale, false);
  }
});

test('does not treat a delivery before the 08:00 Shanghai business boundary as today', () => {
  // Intentional equivalence: this Shanghai 08:00 boundary is the UTC calendar
  // boundary after the fixed offset and day-start constants are applied.
  const justBeforeMidnight = {
    ...record(1),
    deliveredAt: '2026-07-18T07:59:00+08:00',
  };

  assert.deepEqual(
    projectTodayRecommendation(
      'workspace-1',
      1,
      justBeforeMidnight,
      '2026-07-18T08:01:00+08:00',
    ),
    {
      workspaceId: 'workspace-1',
      currentFactsRevision: 1,
      recommendation: null,
      stale: false,
    },
  );
});

test('treats a delivery after the 08:00 Shanghai business boundary as today', () => {
  // Keep this UTC-looking timestamp: Asia/Shanghai 08:00 is intentionally equal
  // to the UTC calendar-day boundary in the current fixed-offset model.
  const atMidnight = {
    ...record(1),
    deliveredAt: '2026-07-18T00:01:00.000Z',
  };

  const state = projectTodayRecommendation(
    'workspace-1',
    1,
    atMidnight,
    '2026-07-18T08:01:00+08:00',
  );

  assert.equal(state.recommendation?.createdAt, atMidnight.deliveredAt);
  assert.equal(state.stale, false);
});

test('whyNow weekday follows the same Shanghai 08:00 business boundary', () => {
  const rules = {
    weekdayWhyNow: { '5': '周五规则', '6': '周六规则' },
    industryWhyNow: {},
    platformWhyNow: {},
  };

  assert.equal(
    projectTodayRecommendation(
      'workspace-1',
      1,
      {
        ...record(1),
        deliveredAt: '2026-07-17T23:59:00.000Z',
        recommendationRules: rules,
      },
      '2026-07-18T07:59:00+08:00',
    ).recommendation?.whyNow,
    '周五规则',
  );
  assert.equal(
    projectTodayRecommendation(
      'workspace-1',
      1,
      {
        ...record(1),
        deliveredAt: '2026-07-18T00:01:00.000Z',
        recommendationRules: rules,
      },
      '2026-07-18T08:01:00+08:00',
    ).recommendation?.whyNow,
    '周六规则',
  );
});

test('withholds the previous recommendation after the fact revision changes', () => {
  assert.deepEqual(projectTodayRecommendation('workspace-1', 2, record(1)), {
    workspaceId: 'workspace-1',
    currentFactsRevision: 2,
    recommendation: null,
    stale: true,
  });
});

test('a composer delivery receipt is a usable candidate when stage traces miss the join', () => {
  const composerShaped = {
    ...record(1),
    contextTrace: undefined,
    briefTrace: { platform: 'xiaohongshu' },
    selectionTrace: undefined,
    delivery: {
      packageId: 'package-1',
      versionId: 'version-1',
      revision: 1,
      factsRevision: 1,
      factRefs: ['store_fact:offer-price:1'],
    },
    storeIndustry: '美发',
    recommendationRules: DEFAULT_HARNESS_TODAY_RECOMMENDATION_CONFIG,
  };

  const state = projectTodayRecommendation(
    'workspace-1',
    1,
    composerShaped,
    NOW,
  );
  assert.equal(
    state.recommendation?.whyNow,
    DEFAULT_HARNESS_TODAY_RECOMMENDATION_CONFIG.industryWhyNow.hair_care,
  );
  assert.deepEqual(state.recommendation?.factReferences, [
    'store_fact:offer-price:1',
  ]);
  assert.equal(state.stale, false);
});

test('composer brief.platform singular still hits the platform whyNow layer', () => {
  assert.equal(
    projectTodayRecommendation(
      'workspace-1',
      1,
      {
        ...record(1),
        storeIndustry: '美甲',
        briefTrace: {
          factRefs: ['store_fact:offer-price:1'],
          platform: 'xiaohongshu',
        },
        recommendationRules: DEFAULT_HARNESS_TODAY_RECOMMENDATION_CONFIG,
      },
      NOW,
    ).recommendation?.whyNow,
    DEFAULT_HARNESS_TODAY_RECOMMENDATION_CONFIG.platformWhyNow.xiaohongshu,
  );
});

test('marketing factRefs on the delivered package fill an empty brief trace', () => {
  const packaged = record(1);
  const contentPackage = contentPackageSchema.parse({
    ...packaged.contentPackage,
    marketing: {
      scene: 'daily_service_exposure',
      contextBundle: {
        bundleId: 'bundle-1',
        revision: 1,
        hash: 'a'.repeat(64),
      },
      factRefs: ['store_fact:service-1:1'],
      rightsRefs: [],
      identityRefs: [],
    },
  });
  const state = projectTodayRecommendation(
    'workspace-1',
    1,
    {
      ...packaged,
      briefTrace: { platform: 'xiaohongshu' },
      contentPackage,
      storeIndustry: '美发',
      recommendationRules: DEFAULT_HARNESS_TODAY_RECOMMENDATION_CONFIG,
    },
    NOW,
  );
  assert.deepEqual(state.recommendation?.factReferences, [
    'store_fact:service-1:1',
  ]);
  assert.equal(
    state.recommendation?.whyNow,
    DEFAULT_HARNESS_TODAY_RECOMMENDATION_CONFIG.industryWhyNow.hair_care,
  );
});

function record(factsRevision: number) {
  const createdAt = '2026-07-18T08:00:00.000Z';
  return {
    taskId: 'task-1',
    rawInput: '把新团购做一套能发的',
    deliveredAt: createdAt,
    delivery: { packageId: 'package-1', versionId: 'version-1', revision: 1 },
    contentPackage: contentPackageSchema.parse({
      workspaceId: 'workspace-1',
      id: 'package-1',
      kind: 'image_text',
      status: 'review_ready',
      revision: 1,
      currentVersionId: 'version-1',
      createdAt,
      updatedAt: createdAt,
      source: { assetIds: [] },
      rights: { state: 'authorized' },
      compliance: { aigcLabelEnabled: true, watermarkEnabled: false },
      lineage: {},
      generated: { childRuns: [] },
      exportReceipts: [],
      variants: [],
      versions: [
        {
          id: 'version-1',
          title: '本周猫眼项目推荐',
          body: '使用本店已确认的猫眼项目和价格制作的完整内容。',
          conversionHook: '私信预约',
          orderedAssetIds: [],
          topics: [],
          createdAt,
          createdBy: 'harness-task-1',
          source: 'ai_generated',
        },
      ],
    }),
    contextTrace: {
      sourceRevisions: {
        facts: factsRevision,
      },
    },
    briefTrace: {
      factRefs: [
        ' store_fact:offer-price:1 ',
        'store_fact:offer-price:1',
      ],
    },
    selectionTrace: {
      winnerCandidateId: 'c01',
      candidateScores: [
        { candidateId: 'c01', reason: PRIMARY_COPY_SELECTION_REASON },
      ],
    },
  };
}

function mediaRecord(kind: 'image_text' | 'video') {
  const base = record(1);
  return {
    ...base,
    contentPackage: contentPackageSchema.parse({
      ...base.contentPackage,
      kind,
    }),
    selectionTrace: {
      winnerCandidateId: 'media-asset-1',
      candidateScores: [],
    },
  };
}
