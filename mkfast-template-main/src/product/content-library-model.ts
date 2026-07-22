/**
 * Merchant Content library projection (P1-C1 / #154).
 *
 * Pure read-model helpers over public ContentPackage fields. No second content
 * command set, no model calls on empty search, no internal prompt/AIDA/provider
 * leakage in the merchant card projection.
 */

import {
  contentPackageActions,
  contentPackageStatusGroup,
  contentPackageStatusLabel,
  type ContentPackage,
  type ContentPackageAction,
  type ContentPackageStatusGroup,
} from '@meiye/contracts';

export type ContentLibraryPlatform = 'xiaohongshu' | 'douyin' | 'video_account';

export type ContentLibraryFilter = {
  dateFrom?: string;
  dateTo?: string;
  ip?: string;
  media?: ContentPackage['kind'];
  platform?: ContentLibraryPlatform;
  project?: string;
  query?: string;
  series?: string;
  statusGroup?: ContentPackageStatusGroup;
};

export type ContentLibraryMatchReason =
  | 'body'
  | 'date'
  | 'ip'
  | 'media'
  | 'platform'
  | 'project'
  | 'series'
  | 'status'
  | 'title';

export type ContentLibraryNextAction = {
  action: ContentPackageAction;
  /** True when the merchant action must open Result / Command Adapter. */
  opensResult: boolean;
  label: string;
};

export type ContentLibraryCard = {
  body: string;
  ipLabels: string[];
  kind: ContentPackage['kind'];
  legacyReadOnly: boolean;
  nextAction: ContentLibraryNextAction;
  packageId: string;
  platforms: ContentLibraryPlatform[];
  projectLabels: string[];
  resultHref?: string;
  seriesLabels: string[];
  statusGroup: ContentPackageStatusGroup;
  statusLabel: string;
  title: string;
  updatedAt: string;
  workId?: string;
};

export type ContentLibrarySearchHit = {
  card: ContentLibraryCard;
  matchReasons: ContentLibraryMatchReason[];
  matchReasonLabels: string[];
};

/** Tokens that must never appear in merchant Content library serialization. */
export const CONTENT_LIBRARY_FORBIDDEN_FIELD_TOKENS = [
  'AIDA',
  'aida-',
  'apiCounterparty',
  'deploymentId',
  'endpointRevision',
  'harnessCandidateId',
  'harnessScore',
  'prompt',
  'providerAttempts',
  'providerCost',
  'providerCosts',
  'providerModel',
  'providerTaskRef',
  'routeSnapshot',
  'routeSnapshotId',
] as const;

const NEXT_ACTION_LABELS: Record<ContentPackageAction, string> = {
  adopt: '采用成品',
  cancel: '取消任务',
  edit_text: '调整文案',
  export: '导出交付',
  recreate: '基于此再创作',
  retry_export: '重试导出',
  reuse: '复用结构',
  view: '查看详情',
};

const MATCH_REASON_LABELS: Record<ContentLibraryMatchReason, string> = {
  body: '正文匹配',
  date: '日期匹配',
  ip: 'IP 匹配',
  media: '媒介匹配',
  platform: '平台匹配',
  project: '项目匹配',
  series: '系列匹配',
  status: '状态匹配',
  title: '标题匹配',
};

const RESULT_ACTIONS = new Set<ContentPackageAction>([
  'adopt',
  'edit_text',
  'export',
  'recreate',
  'retry_export',
  'reuse',
]);

export function contentLibraryNextAction(
  contentPackage: Pick<ContentPackage, 'status' | 'source' | 'id'>
): ContentLibraryNextAction {
  const actions = contentPackageActions(contentPackage.status);
  const primary =
    actions.find((action) => action !== 'view') ?? actions[0] ?? 'view';
  return {
    action: primary,
    label: NEXT_ACTION_LABELS[primary],
    opensResult: RESULT_ACTIONS.has(primary),
  };
}

function currentVersion(contentPackage: ContentPackage) {
  return (
    contentPackage.versions.find(
      (version) => version.id === contentPackage.currentVersionId
    ) ?? contentPackage.versions[0]
  );
}

function projectLabels(contentPackage: ContentPackage): string[] {
  const topics = currentVersion(contentPackage)?.topics ?? [];
  const scene = contentPackage.marketing?.scene;
  const labels = [...topics];
  if (scene === 'daily_service_exposure') labels.push('日常项目曝光');
  if (scene === 'promotion_groupbuy_conversion') labels.push('促销转化');
  if (scene === 'routine_marketing_materials') labels.push('宣传物料');
  return unique(labels);
}

function ipLabels(contentPackage: ContentPackage): string[] {
  const labels: string[] = [];
  if (contentPackage.marketing?.scene === 'brand_personal_ip') {
    labels.push('品牌/个人 IP');
  }
  for (const ref of contentPackage.marketing?.identityRefs ?? []) {
    if (!looksLikeInternalId(ref)) labels.push(ref);
  }
  return unique(labels);
}

function seriesLabels(contentPackage: ContentPackage): string[] {
  const topics = currentVersion(contentPackage)?.topics ?? [];
  return topics.filter(
    (topic) => topic.includes('系列') || topic.includes('#')
  );
}

function looksLikeInternalId(value: string) {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    ) ||
    /^[a-z]+[-_][a-z0-9_-]{8,}$/i.test(value) ||
    /prompt|route|provider|aida/i.test(value)
  );
}

function unique(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function projectContentLibraryCard(
  contentPackage: ContentPackage & {
    statusGroup?: ContentPackageStatusGroup;
    statusLabel?: string;
  }
): ContentLibraryCard {
  const version = currentVersion(contentPackage);
  const statusGroup =
    contentPackage.statusGroup ??
    contentPackageStatusGroup(contentPackage.status);
  const statusLabel =
    contentPackage.statusLabel ??
    contentPackageStatusLabel(contentPackage.status);
  const workId = contentPackage.source.workId;
  const nextAction = contentLibraryNextAction(contentPackage);
  const legacyReadOnly = Boolean(
    contentPackage.legacySource && !contentPackage.source.workId
  );

  return {
    body: version?.body ?? '',
    ipLabels: ipLabels(contentPackage),
    kind: contentPackage.kind,
    legacyReadOnly,
    nextAction,
    packageId: contentPackage.id,
    platforms: contentPackage.variants.map(
      (variant) => variant.platform as ContentLibraryPlatform
    ),
    projectLabels: projectLabels(contentPackage),
    ...(workId
      ? {
          resultHref: `/dashboard/results/${encodeURIComponent(workId)}?contentId=${encodeURIComponent(contentPackage.id)}`,
          workId,
        }
      : {}),
    seriesLabels: seriesLabels(contentPackage),
    statusGroup,
    statusLabel,
    title: version?.title?.trim() || '未命名成品',
    updatedAt: contentPackage.updatedAt,
  };
}

export function contentLibraryMatchReasonLabel(
  reason: ContentLibraryMatchReason
) {
  return MATCH_REASON_LABELS[reason];
}

function includesNormalized(haystack: string, needle: string) {
  return haystack.toLocaleLowerCase().includes(needle);
}

/**
 * Structured Content library search/filter. Empty results never invent content
 * and never imply a model call — pure local projection over public cards.
 */
export function filterContentLibrary(
  cards: readonly ContentLibraryCard[],
  filter: ContentLibraryFilter = {}
): ContentLibrarySearchHit[] {
  const query = filter.query?.trim().toLocaleLowerCase() ?? '';
  const hits: ContentLibrarySearchHit[] = [];

  for (const card of cards) {
    const reasons = new Set<ContentLibraryMatchReason>();

    if (filter.platform && !card.platforms.includes(filter.platform)) continue;
    if (filter.platform) reasons.add('platform');

    if (filter.media && card.kind !== filter.media) continue;
    if (filter.media) reasons.add('media');

    if (filter.statusGroup && card.statusGroup !== filter.statusGroup) continue;
    if (filter.statusGroup) reasons.add('status');

    if (filter.project) {
      const needle = filter.project.trim().toLocaleLowerCase();
      if (
        !card.projectLabels.some((label) => includesNormalized(label, needle))
      )
        continue;
      reasons.add('project');
    }

    if (filter.ip) {
      const needle = filter.ip.trim().toLocaleLowerCase();
      if (!card.ipLabels.some((label) => includesNormalized(label, needle)))
        continue;
      reasons.add('ip');
    }

    if (filter.series) {
      const needle = filter.series.trim().toLocaleLowerCase();
      if (!card.seriesLabels.some((label) => includesNormalized(label, needle)))
        continue;
      reasons.add('series');
    }

    if (filter.dateFrom && card.updatedAt.slice(0, 10) < filter.dateFrom)
      continue;
    if (filter.dateTo && card.updatedAt.slice(0, 10) > filter.dateTo) continue;
    if (filter.dateFrom || filter.dateTo) reasons.add('date');

    if (query) {
      const titleHit = includesNormalized(card.title, query);
      const bodyHit = includesNormalized(card.body, query);
      const platformHit = card.platforms.some((platform) =>
        includesNormalized(platform, query)
      );
      const projectHit = card.projectLabels.some((label) =>
        includesNormalized(label, query)
      );
      const ipHit = card.ipLabels.some((label) =>
        includesNormalized(label, query)
      );
      const seriesHit = card.seriesLabels.some((label) =>
        includesNormalized(label, query)
      );
      const statusHit = includesNormalized(card.statusLabel, query);
      if (
        !titleHit &&
        !bodyHit &&
        !platformHit &&
        !projectHit &&
        !ipHit &&
        !seriesHit &&
        !statusHit
      ) {
        continue;
      }
      if (titleHit) reasons.add('title');
      if (bodyHit) reasons.add('body');
      if (platformHit) reasons.add('platform');
      if (projectHit) reasons.add('project');
      if (ipHit) reasons.add('ip');
      if (seriesHit) reasons.add('series');
      if (statusHit) reasons.add('status');
    }

    const matchReasons = [...reasons];
    hits.push({
      card,
      matchReasons,
      matchReasonLabels: matchReasons.map(contentLibraryMatchReasonLabel),
    });
  }

  return hits;
}

/**
 * Legacy content stays read-only until an explicit adjust/deliver intent.
 * Anchor creation is presentation-side intent only — never auto on read.
 */
export function legacyContentInteraction(intent: {
  kind: 'read' | 'adjust' | 'deliver' | 'search';
}): {
  createsLegacyAnchor: boolean;
  mayCallModel: boolean;
  mayCharge: boolean;
  mayCreateRevision: boolean;
  readOnly: boolean;
} {
  if (intent.kind === 'adjust' || intent.kind === 'deliver') {
    return {
      createsLegacyAnchor: true,
      mayCallModel: false,
      mayCharge: false,
      mayCreateRevision: false,
      readOnly: false,
    };
  }
  return {
    createsLegacyAnchor: false,
    mayCallModel: false,
    mayCharge: false,
    mayCreateRevision: false,
    readOnly: true,
  };
}

/** Action path for library cards: Result adapter when work exists, else view-only. */
export function contentLibraryActionTarget(card: ContentLibraryCard): {
  kind: 'result_adapter' | 'package_detail' | 'legacy_read_only';
  href?: string;
} {
  if (card.legacyReadOnly && !card.workId) {
    return { kind: 'legacy_read_only' };
  }
  if (card.nextAction.opensResult && card.resultHref) {
    return { kind: 'result_adapter', href: card.resultHref };
  }
  return {
    kind: 'package_detail',
    href: `/dashboard/content?packageId=${encodeURIComponent(card.packageId)}`,
  };
}

export function contentLibraryProjectionIsMerchantSafe(
  value: unknown
): boolean {
  const serialized = JSON.stringify(value);
  return !CONTENT_LIBRARY_FORBIDDEN_FIELD_TOKENS.some((token) =>
    serialized.includes(token)
  );
}
