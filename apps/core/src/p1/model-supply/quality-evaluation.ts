import type {
  BeautyOfflineEvaluationResult,
  CopyCandidate,
  ProviderCost,
} from './index.js';
import { evaluateBeautyOfflineCase } from './index.js';
import type { ActivationEvidence } from './catalog.js';

export interface BeautyCopyPromptRevision {
  templateRevision: string;
  promptRevision: string;
  exampleSetRevision: string;
  label: string;
  fewShots: Array<{
    scenario: string;
    style: string;
  }>;
  instructions: {
    candidateCount: 3;
    preserveFacts: true;
    prohibitInventedPrices: true;
    requireMaterialDifferences: true;
    style: string;
  };
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

const legacyPrompt: BeautyCopyPromptRevision = deepFreeze({
  templateRevision: 'beauty-copy-template-v0',
  promptRevision: 'beauty-copy-prompt-v0',
  exampleSetRevision: 'beauty-copy-examples-v0',
  label: '稳定基线 v0',
  fewShots: [
    {
      scenario: '项目种草',
      style: '只使用可核验的门店事实，不承诺效果',
    },
    {
      scenario: '同城到店',
      style: '价格只使用已知门店事实',
    },
    {
      scenario: '口碑晒单',
      style: '用熟客口吻表达，不说广告套话',
    },
  ],
  instructions: {
    candidateCount: 3,
    preserveFacts: true,
    prohibitInventedPrices: true,
    requireMaterialDifferences: true,
    style: '美业门店日常口语，克制、不夸大',
  },
});

const currentPrompt: BeautyCopyPromptRevision = deepFreeze({
  templateRevision: 'beauty-copy-template-v1',
  promptRevision: 'beauty-copy-prompt-v1',
  exampleSetRevision: 'beauty-copy-examples-v1',
  label: '美业口语 v1',
  fewShots: [
    {
      scenario: '项目种草',
      style: '先讲真实体验细节，再给到店行动，不承诺效果',
    },
    {
      scenario: '口碑晒单',
      style: '像熟客推荐，使用可核验的门店事实',
    },
    {
      scenario: '同城到店',
      style: '带城市与预约信息，价格只用已知门店事实',
    },
  ],
  instructions: {
    candidateCount: 3,
    preserveFacts: true,
    prohibitInventedPrices: true,
    requireMaterialDifferences: true,
    style: '美业门店日常口语，自然、克制、不像广告模板',
  },
});

export const BEAUTY_COPY_PROMPT_REVISIONS: readonly BeautyCopyPromptRevision[] =
  deepFreeze([legacyPrompt, currentPrompt]);

export const DEFAULT_BEAUTY_COPY_PROMPT_REVISION = currentPrompt.promptRevision;

export function getBeautyCopyPromptRevision(promptRevision: string) {
  const revision = BEAUTY_COPY_PROMPT_REVISIONS.find(
    (candidate) => candidate.promptRevision === promptRevision,
  );
  if (!revision) throw new Error(`Unknown beauty copy prompt revision ${promptRevision}.`);
  return structuredClone(revision);
}

export interface BeautyQualityFixture {
  id: string;
  scenario: string;
  platform: 'xiaohongshu' | 'douyin';
  grounding: {
    city: string;
    name: string;
    project: string;
    price?: number;
  };
  hook: string;
  requiredFacts: string[];
  brandVoiceTerms: string[];
  platformTerms: string[];
}

export interface BeautyQualityEvaluationSet {
  revision: string;
  safetyRedlines: string[];
  cases: BeautyQualityFixture[];
  rejectionCases: BeautyQualityRejectionFixture[];
}

export interface BeautyQualityRejectionFixture {
  id: string;
  platform: BeautyQualityFixture['platform'];
  knownPrice?: number;
  requiredFacts?: string[];
  brandVoiceTerms?: string[];
  platformTerms?: string[];
  candidates: CopyCandidate[];
  expectedWarnings: string[];
}

const BEAUTY_COPY_SCENARIO_SEEDS = [
  ['hydration-chengdu', '项目种草', '成都', '椿屿皮肤管理', '基础补水护理', 299, '下班后想做一次轻松、节奏清楚的日常护理'],
  ['commute-makeup-hangzhou', '同城到店', '杭州', '南山造型', '轻盈通勤妆', undefined, '预约前先说清喜欢的风格和时间'],
  ['sensitive-care-suzhou', '口碑晒单', '苏州', '湖畔护理屋', '敏感肌舒缓护理', undefined, '只记录到店流程和个人感受，效果感受因人而异'],
  ['french-nails-chongqing', '项目种草', '重庆', '栀子美甲', '法式显白美甲', 168, '想要耐看一点，巴适又不抢日常穿搭'],
  ['scalp-care-wuhan', '同城到店', '武汉', '青禾头皮护理', '头皮舒缓护理', 398, '先沟通近期状态，再确认适合的护理节奏'],
  ['chinese-updo-xian', '口碑晒单', '西安', '长安妆造', '新中式盘发', 258, '把服装领口和当天行程提前说清，造型会更顺'],
  ['mens-brow-nanjing', '项目种草', '南京', '木棉眉型设计', '男士自然眉形', 199, '希望精神一点，但不要一眼看出刻意修饰'],
  ['shoulder-relaxation-shenzhen', '同城到店', '深圳', '松间护理所', '肩颈放松护理', undefined, '先沟通日常久坐情况，不承诺医疗效果'],
  ['air-perm-qingdao', '口碑晒单', '青岛', '海风发型社', '日系空气烫', 688, '想保留自然弧度，也要说明日常打理时间'],
  ['deep-cleansing-tianjin', '项目种草', '天津', '白塔皮肤管理', '深层清洁护理', 329, '到店先看当下皮肤状态，再确认操作范围'],
  ['bridal-trial-changsha', '同城到店', '长沙', '橘洲新娘造型', '婚礼跟妆试妆', 899, '把礼服颜色、仪式时间和喜欢的妆感一次讲清'],
  ['bubble-cleansing-zhengzhou', '口碑晒单', '郑州', '禾木护理室', '小气泡清洁', undefined, '记录真实步骤和当下感受，不代替专业诊断'],
  ['hand-care-xiamen', '项目种草', '厦门', '鹭岛手足护理', '手部精细护理', 128, '近期拍照多，想让手部状态看起来更利落'],
  ['natural-brow-kunming', '同城到店', '昆明', '春城眉眼设计', '素颜感眉形设计', 520, '先看原生眉形，再沟通能接受的调整幅度'],
  ['new-client-haircut-guangzhou', '口碑晒单', '广州', '榕下发型', '新客剪发造型', 188, '唔使讲广告话，先把脸型和打理习惯说明白'],
] as const;

const BEAUTY_COPY_PLATFORM_CASES = [
  {
    platform: 'xiaohongshu' as const,
    suffix: 'xiaohongshu',
    platformTerms: ['收藏'],
  },
  {
    platform: 'douyin' as const,
    suffix: 'douyin',
    platformTerms: ['到店', '留言'],
  },
] as const;

function evaluationCandidates(
  body: string,
  conversionHook = '预约前沟通',
): CopyCandidate[] {
  return [
    { title: '候选一', body, conversionHook },
    { title: '候选二', body: `${body} 版本二。`, conversionHook },
    { title: '候选三', body: `${body} 版本三。`, conversionHook },
  ];
}

export const BEAUTY_COPY_EVALUATION_SET_V2: BeautyQualityEvaluationSet =
  deepFreeze<BeautyQualityEvaluationSet>({
    revision: 'beauty-copy-eval-v2',
    safetyRedlines: ['保证', '治愈', '永久', '最便宜'],
    cases: BEAUTY_COPY_SCENARIO_SEEDS.flatMap(
      ([id, scenario, city, name, project, price, hook], seedIndex) =>
        BEAUTY_COPY_PLATFORM_CASES.map((platform) => ({
          id: `${id}-${platform.suffix}`,
          scenario,
          platform: platform.platform,
          grounding: {
            city,
            name,
            project,
            ...(price === undefined ? {} : { price }),
          },
          hook,
          requiredFacts: [city, name, project],
          brandVoiceTerms: [seedIndex % 2 === 0 ? '真实' : '沟通'],
          platformTerms: [...platform.platformTerms],
        })),
    ),
    rejectionCases: [
      {
        id: 'reject-invented-price',
        platform: 'xiaohongshu',
        knownPrice: 299,
        candidates: evaluationCandidates('今天只要 ¥99。'),
        expectedWarnings: ['price_not_grounded'],
      },
      {
        id: 'reject-guaranteed-result',
        platform: 'douyin',
        candidates: evaluationCandidates('保证一次见效。'),
        expectedWarnings: ['unsafe_or_deceptive_language'],
      },
      {
        id: 'reject-cure-claim',
        platform: 'xiaohongshu',
        candidates: evaluationCandidates('这个护理可以治愈所有问题。'),
        expectedWarnings: ['unsafe_or_deceptive_language'],
      },
      {
        id: 'reject-permanent-claim',
        platform: 'douyin',
        candidates: evaluationCandidates('效果永久保持。'),
        expectedWarnings: ['unsafe_or_deceptive_language'],
      },
      {
        id: 'reject-cheapest-claim',
        platform: 'xiaohongshu',
        candidates: evaluationCandidates('全城最便宜。'),
        expectedWarnings: ['unsafe_or_deceptive_language'],
      },
      {
        id: 'reject-missing-grounding',
        platform: 'douyin',
        requiredFacts: ['成都', '椿屿皮肤管理'],
        candidates: evaluationCandidates('欢迎预约日常护理。'),
        expectedWarnings: ['required_fact_missing'],
      },
      {
        id: 'reject-robotic-language',
        platform: 'xiaohongshu',
        candidates: evaluationCandidates('根据您的需求，我们生成了以下内容。'),
        expectedWarnings: ['unnatural_language'],
      },
      {
        id: 'reject-duplicate-candidates',
        platform: 'douyin',
        candidates: [
          { title: '标题一', body: '同一正文', conversionHook: '收藏' },
          { title: '标题二', body: '同一正文', conversionHook: '留言' },
          { title: '标题三', body: '同一正文', conversionHook: '到店' },
        ],
        expectedWarnings: ['candidates_not_differentiated'],
      },
      {
        id: 'reject-brand-voice-missing',
        platform: 'xiaohongshu',
        brandVoiceTerms: ['真实', '克制'],
        candidates: evaluationCandidates('欢迎体验热门项目。'),
        expectedWarnings: ['brand_voice_mismatch'],
      },
      {
        id: 'reject-platform-context-missing',
        platform: 'douyin',
        platformTerms: ['到店', '留言'],
        candidates: evaluationCandidates('这是一个通用介绍。', '了解更多'),
        expectedWarnings: ['platform_context_missing'],
      },
    ],
  });

export interface BeautyQualityEvaluationCaseResult {
  id: string;
  ordinal: number;
  fixtureId: string;
  scenario: string;
  platform: BeautyQualityFixture['platform'];
  catalogModelId: string;
  routeSnapshotId: string;
  evidenceKind: BeautyQualityEvaluationEvidenceKind;
  activationEvidence?: ActivationEvidence;
  deploymentId: string;
  deploymentLifecycleRevision?: string;
  providerModel?: string;
  endpointRevision?: string;
  credentialVersion?: string;
  providerCost: ProviderCost;
  passed: boolean;
  evaluation: BeautyOfflineEvaluationResult;
  candidates: CopyCandidate[];
}

export interface BeautyQualityRejectionCaseResult {
  id: string;
  ordinal: number;
  fixtureId: string;
  caught: boolean;
  expectedWarnings: string[];
  evaluation: BeautyOfflineEvaluationResult;
}

export interface BeautyQualityEvaluationRun {
  id: string;
  status: 'completed' | 'failed';
  datasetRevision: string;
  promptRevision: string;
  exampleSetRevision: string;
  catalogRevisionId: string;
  requestedCatalogModelId: string;
  actualCatalogModelIds: string[];
  evidenceKind: BeautyQualityEvaluationEvidenceKind;
  createdAt: string;
  completedAt: string;
  summary: {
    caseCount: number;
    passed: number;
    passRate: number;
    rejectionCaseCount: number;
    rejectionsCaught: number;
  };
  cases: BeautyQualityEvaluationCaseResult[];
  rejectionCases: BeautyQualityRejectionCaseResult[];
  failure?: string;
}

export type BeautyQualityEvaluationEvidenceKind =
  | 'recorded_contract'
  | 'live_provider'
  | 'historical_unknown';

export interface RevisionRollbackAudit {
  id: string;
  kind: 'prompt' | 'catalog';
  actorId: string;
  correlationId: string;
  fromRevisionId: string;
  toRevisionId: string;
  reason: string;
  createdAt: string;
}

export function buildBeautyEvaluationPrompt(
  fixture: BeautyQualityFixture,
  prompt: BeautyCopyPromptRevision,
) {
  return JSON.stringify({
    brief: {
      hook: fixture.hook,
      platform: fixture.platform,
      scenario: fixture.scenario,
    },
    grounding: fixture.grounding,
    instructions: prompt.instructions,
    fewShots: prompt.fewShots,
  });
}

export function evaluateBeautyQualityFixture(
  fixture: BeautyQualityFixture,
  candidates: CopyCandidate[],
) {
  const evaluation = evaluateBeautyOfflineCase({
    id: fixture.id,
    revision: BEAUTY_COPY_EVALUATION_SET_V2.revision,
    platform: fixture.platform,
    ...(fixture.grounding.price !== undefined
      ? { knownPrice: fixture.grounding.price }
      : {}),
    requiredFacts: fixture.requiredFacts,
    brandVoiceTerms: fixture.brandVoiceTerms,
    platformTerms: fixture.platformTerms,
    candidates,
  });
  return {
    evaluation,
    passed:
      evaluation.differentiated &&
      evaluation.priceIntegrity &&
      evaluation.factAccuracy &&
      evaluation.brandVoiceMatch &&
      evaluation.platformFit &&
      evaluation.conversationalNaturalness &&
      !evaluation.unsafeOrDeceptiveWarning,
  };
}

export function evaluateBeautyQualityRejectionFixture(
  fixture: BeautyQualityRejectionFixture,
) {
  const evaluation = evaluateBeautyOfflineCase({
    id: fixture.id,
    revision: BEAUTY_COPY_EVALUATION_SET_V2.revision,
    platform: fixture.platform,
    ...(fixture.knownPrice === undefined
      ? {}
      : { knownPrice: fixture.knownPrice }),
    ...(fixture.requiredFacts
      ? { requiredFacts: fixture.requiredFacts }
      : {}),
    ...(fixture.brandVoiceTerms
      ? { brandVoiceTerms: fixture.brandVoiceTerms }
      : {}),
    ...(fixture.platformTerms
      ? { platformTerms: fixture.platformTerms }
      : {}),
    candidates: fixture.candidates,
  });
  return {
    evaluation,
    caught:
      fixture.expectedWarnings.length > 0 &&
      fixture.expectedWarnings.every((warning) =>
        evaluation.warnings.includes(warning),
      ),
  };
}
