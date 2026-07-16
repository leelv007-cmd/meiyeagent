import { m } from '@/locale/paraglide/messages';
import { formatLocaleDateTime } from '@/lib/locale';
import { directSourceHref } from '@/p1/source-object-navigation';
import { canvasName, officialTemplateFamilyName } from '@/p1/canvas-name';

import type {
  ContentTaskAction,
  ContentTaskView,
  ImageGenerationJobView,
  RetrievalResultView,
  TemplateCatalogItemView,
  WeekPointView,
} from './types';

export interface RawTask {
  id: string;
  title: string;
  source: string;
  risk: 'normal' | 'attention' | 'external_permission';
  status: ContentTaskView['status'];
  dueAt: string;
  executable: boolean;
  blockedReason?: string;
  nextStep?: string;
  relatedObject?: {
    id: string;
    kind:
      | 'asset'
      | 'content'
      | 'integration'
      | 'publication'
      | 'publish'
      | 'review'
      | 'template'
      | 'work';
  };
  createdAt: string;
}

export interface RawInbox {
  tasks: RawTask[];
  weekStrip: Array<{
    date: string;
    taskCount: number;
    contentGapCount: number;
    statuses: RawTask['status'][];
  }>;
  counts: Partial<Record<RawTask['status'], number>>;
}

export interface RawTemplate {
  id: string;
  family: string;
  name: string;
  tags: string[];
  publicationStatus: 'draft' | 'enabled' | 'published' | 'retired';
  enabledVersionId?: string;
  publishedVersionId?: string;
  previewDocument?: Record<string, unknown>;
  previewVersionId?: string;
  thumbnailUrl?: string;
}

export interface RawUserTemplate {
  id: string;
  name: string;
  canvasRevisionId: string;
  sourceWorkId: string;
}

export interface RawTemplateShortcut {
  templateId?: string;
  userTemplateId?: string;
  rank: number;
  hidden: boolean;
}

export interface RawCanvasWork {
  id: string;
  name: string;
  templateId?: string;
  templateVersionId?: string;
  currentRevisionId: string;
  brandWatermarkEnabled: boolean;
  aigcLabelEnabled: boolean;
  revisions: Array<{
    id: string;
    revision: number;
    document: Record<string, unknown>;
  }>;
}

export function officialTemplateCopyTarget(
  template: RawTemplate,
  work?: RawCanvasWork
): { templateVersionId: string; sourceWorkId?: string } | undefined {
  if (
    work?.templateId === template.id &&
    typeof work.templateVersionId === 'string'
  ) {
    return {
      sourceWorkId: work.id,
      templateVersionId: work.templateVersionId,
    };
  }
  return template.publishedVersionId
    ? { templateVersionId: template.publishedVersionId }
    : undefined;
}

export interface RawImageJob {
  id: string;
  status: ImageGenerationJobView['status'];
  requestedModelId: string;
  actualModelId: string;
  outputAssetId?: string;
  outputAssetUrl?: string;
}

export interface RawSearchResult {
  id: string;
  kind: 'task' | 'asset' | 'content' | 'template';
  title: string;
  text: string;
  tags: string[];
  metadata: Record<string, string>;
  matchMode: 'exact' | 'fts' | 'bigram' | 'trigram' | 'structured';
}

const SOURCE_LABEL: Record<string, () => string> = {
  asset_gap: m.p1_task_source_asset_gap,
  manual: m.p1_task_source_manual,
  publish_ready: m.p1_task_source_publish_ready,
  stale_draft: m.p1_task_source_stale_draft,
  weekly_batch: m.p1_task_source_weekly_batch,
  weekly_review: m.p1_task_source_weekly_review,
};

function officialTemplateName(template: RawTemplate) {
  return template.id === `official-${template.family}`
    ? (officialTemplateFamilyName(template.family) ?? template.name)
    : template.name;
}

const SYSTEM_SEARCH_TAG_LABEL: Record<string, () => string> = {
  abandoned: m.p1_filter_content_abandoned,
  asset_gap: m.p1_task_source_asset_gap,
  attention: m.p1_retrieval_tag_risk_attention,
  authorized: m.p1_canvas_authorization_authorized,
  before_after: m.p1_canvas_category_before_after,
  blocked: m.p1_canvas_authorization_blocked,
  candidate: m.p1_filter_content_candidate,
  customer_case: m.p1_canvas_category_customer_case,
  douyin: m.p1_filter_platform_douyin,
  draft: m.p1_filter_content_draft,
  external_permission: m.p1_retrieval_tag_risk_external_permission,
  manual: m.p1_task_source_manual,
  normal: m.p1_retrieval_tag_risk_normal,
  other: m.p1_canvas_category_other,
  pending: m.p1_canvas_authorization_pending,
  price_list: m.p1_canvas_category_price_list,
  publish_ready: m.p1_task_source_publish_ready,
  published: m.p1_filter_content_published,
  stale_draft: m.p1_task_source_stale_draft,
  store: m.p1_canvas_category_store,
  uncategorized: m.p1_canvas_category_other,
  weekly_batch: m.p1_task_source_weekly_batch,
  weekly_review: m.p1_task_source_weekly_review,
  withdrawn: m.p1_canvas_authorization_withdrawn,
  xiaohongshu: m.p1_filter_platform_xiaohongshu,
  '\u81ea\u5efa\u6a21\u677f': m.p1_retrieval_tag_user_template,
};

function searchTagLabel(tag: string) {
  return SYSTEM_SEARCH_TAG_LABEL[tag]?.() ?? tag;
}

function officialSearchFamily(result: RawSearchResult) {
  if (
    result.kind !== 'template' ||
    result.metadata.official !== 'true' ||
    result.id !== `official-${result.metadata.family}`
  ) {
    return undefined;
  }
  return officialTemplateFamilyName(result.metadata.family);
}

function searchTitle(result: RawSearchResult) {
  if (result.kind === 'asset' && result.title === '\u7d20\u6750') {
    return m.p1_retrieval_scope_asset();
  }
  if (result.kind === 'content' && result.title === '\u5185\u5bb9') {
    return m.p1_retrieval_scope_content();
  }
  const family = officialSearchFamily(result);
  if (family) return family;
  if (result.kind === 'template') return canvasName(result.title);
  return result.title;
}

function searchExcerpt(result: RawSearchResult) {
  const family = officialSearchFamily(result);
  if (family) return family;
  if (result.kind === 'template' && result.metadata.official === 'true') {
    return canvasName(result.title);
  }
  return result.kind === 'template' ? canvasName(result.text) : result.text;
}

function integrationTaskTitle(value: string) {
  if (value.startsWith('\u786e\u8ba4\u98de\u4e66\u64cd\u4f5c\uff1a')) {
    return m.operations_task_system_confirm_feishu_action();
  }
  if (
    value.startsWith('\u5904\u7406 ') &&
    value.endsWith(' \u8fde\u63a5\u5f02\u5e38')
  ) {
    return m.operations_task_system_connection_anomaly();
  }
  return taskSystemText(value) ?? value;
}

const WEEKDAY_LABEL = [
  m.p1_week_weekday_sunday,
  m.p1_week_weekday_monday,
  m.p1_week_weekday_tuesday,
  m.p1_week_weekday_wednesday,
  m.p1_week_weekday_thursday,
  m.p1_week_weekday_friday,
  m.p1_week_weekday_saturday,
] as const;

function safeTemplateThumbnailUrl(value: string | undefined) {
  if (!value) return undefined;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

const NAMED_PRESET_CONTRACTS: Partial<
  Record<
    string,
    Pick<
      TemplateCatalogItemView,
      | 'availableContentModules'
      | 'defaultContentModules'
      | 'inputGuide'
      | 'internalIntent'
    >
  >
> = {
  before_after: {
    availableContentModules: ['before_after', 'social_cover', 'review_card'],
    defaultContentModules: ['before_after', 'social_cover'],
    inputGuide: m.p1_named_preset_before_after_input(),
    internalIntent: m.p1_named_preset_before_after_intent(),
  },
  package_explainer: {
    availableContentModules: [
      'package_explainer',
      'price_card',
      'social_cover',
    ],
    defaultContentModules: ['package_explainer', 'price_card'],
    inputGuide: m.p1_named_preset_package_input(),
    internalIntent: m.p1_named_preset_package_intent(),
  },
  price_card: {
    availableContentModules: ['price_card', 'social_cover'],
    defaultContentModules: ['price_card'],
    inputGuide: m.p1_named_preset_price_input(),
    internalIntent: m.p1_named_preset_price_intent(),
  },
  review_card: {
    availableContentModules: ['review_card', 'social_cover'],
    defaultContentModules: ['review_card'],
    inputGuide: m.p1_named_preset_review_input(),
    internalIntent: m.p1_named_preset_review_intent(),
  },
  shooting_checklist: {
    availableContentModules: ['shooting_checklist', 'social_cover'],
    defaultContentModules: ['shooting_checklist'],
    inputGuide: m.p1_named_preset_shooting_input(),
    internalIntent: m.p1_named_preset_shooting_intent(),
  },
  social_cover: {
    availableContentModules: ['social_cover', 'store_intro'],
    defaultContentModules: ['social_cover'],
    inputGuide: m.p1_named_preset_social_cover_input(),
    internalIntent: m.p1_named_preset_social_cover_intent(),
  },
  store_intro: {
    availableContentModules: [
      'store_intro',
      'social_cover',
      'shooting_checklist',
    ],
    defaultContentModules: ['store_intro', 'social_cover'],
    inputGuide: m.p1_named_preset_store_intro_input(),
    internalIntent: m.p1_named_preset_store_intro_intent(),
  },
};

function taskActions(task: RawTask): ContentTaskAction[] {
  if (task.status === 'archived' || task.status === 'done') {
    return task.status === 'done' ? ['archive'] : [];
  }
  if (!task.executable || task.status === 'needs_asset') {
    return ['add_asset', 'archive'];
  }
  if (task.status === 'in_progress') return ['complete', 'archive'];
  return ['start', 'complete', 'archive'];
}

export function taskSystemText(value: string | undefined) {
  if (!value) return value;

  // Match legacy Core-owned task values exactly; user-authored copy passes through.
  const systemCopy: Record<string, () => string> = {
    '\u672c\u5468\u5185\u5bb9\u6279\u6b21\u5df2\u5c31\u7eea':
      m.operations_task_system_batch_ready,
    '\u7f3a\u5c11\u5b8c\u6210\u672c\u5468\u5185\u5bb9\u6240\u9700\u7684\u7d20\u6750':
      m.operations_task_system_missing_assets,
    '\u6253\u5f00\u7d20\u6750\u5e93\u8865\u5145\u7d20\u6750':
      m.operations_task_system_open_assets,
    '\u8865\u9f50\u672c\u5468\u7d20\u6750\u7f3a\u53e3':
      m.operations_task_system_fill_asset_gap,
    '\u786e\u8ba4\u4e45\u672a\u5904\u7406\u7684\u5185\u5bb9\u8349\u7a3f':
      m.operations_task_system_review_stale_draft,
    '\u67e5\u770b\u672c\u5468\u8fd0\u8425\u56de\u987e':
      m.operations_task_system_review_week,
    '\u516c\u5f00\u53d1\u5e03\u9700\u6309\u76ee\u6807\u5e73\u53f0\u5408\u540c\u5355\u72ec\u786e\u8ba4':
      m.operations_task_system_platform_publish_confirmation,
    '\u5f53\u524d\u7f3a\u5c11\u6267\u884c\u6761\u4ef6':
      m.p1_task_blocked_fallback,
    '\u516c\u5f00\u53d1\u5e03\u9700\u5355\u72ec\u786e\u8ba4':
      m.operations_task_system_publish_confirmation,
    '\u786e\u8ba4\u4e0b\u5468\u4e09\u4e2a\u5185\u5bb9\u65b9\u5411':
      m.operations_task_system_confirm_next_week_directions,
    '\u4efb\u52a1\u4e0d\u5b58\u5728': m.operations_task_system_missing,
    '\u4efb\u52a1\u5df2\u7ec8\u7ed3': m.operations_task_system_finished,
    '\u4efb\u52a1\u6b63\u5728\u6267\u884c': m.operations_task_system_running,
    '\u9700\u8981 Owner \u786e\u8ba4\u540e\u624d\u80fd\u6267\u884c\u5916\u90e8\u9ad8\u98ce\u9669\u64cd\u4f5c':
      m.operations_task_system_owner_confirmation,
    '\u6253\u5f00\u4efb\u52a1\u5e76\u786e\u8ba4\u4e0d\u53ef\u53d8\u7684\u98de\u4e66\u64cd\u4f5c\u610f\u56fe':
      m.operations_task_system_open_feishu_intent,
    '\u7a0d\u540e\u91cd\u8bd5\u5e76\u786e\u8ba4\u8fde\u63a5\u6062\u590d':
      m.operations_task_system_retry_connection,
    '\u6253\u5f00\u96c6\u6210\u8bbe\u7f6e\u91cd\u65b0\u6388\u6743\u6216\u68c0\u67e5\u6743\u9650':
      m.operations_task_system_reauthorize_connection,
  };

  return systemCopy[value]?.() ?? value;
}

export function taskView(task: RawTask): ContentTaskView {
  const relatedKind =
    task.relatedObject?.kind === 'publication'
      ? 'publish'
      : task.relatedObject?.kind;
  const sourceHref =
    task.relatedObject &&
    (relatedKind === 'asset' ||
      relatedKind === 'content' ||
      relatedKind === 'publish')
      ? directSourceHref(relatedKind, task.relatedObject.id)
      : undefined;
  return {
    availableActions: taskActions(task),
    blockedReason: taskSystemText(task.blockedReason),
    createdLabel: formatLocaleDateTime(task.createdAt),
    dueLabel: formatLocaleDateTime(task.dueAt),
    id: task.id,
    nextStep: taskSystemText(task.nextStep),
    risk:
      task.risk === 'normal'
        ? 'none'
        : task.risk === 'attention'
          ? 'attention'
          : 'blocked',
    source: task.source,
    sourceLabel: SOURCE_LABEL[task.source]?.() ?? task.source,
    status: task.status,
    summary: taskSystemText(task.blockedReason),
    title:
      relatedKind === 'integration'
        ? integrationTaskTitle(task.title)
        : (taskSystemText(task.title) ?? task.title),
    ...(task.relatedObject && relatedKind
      ? {
          sourceLink: {
            id: task.relatedObject.id,
            kind: relatedKind,
            label: m.p1_task_source_open(),
            ...(sourceHref ? { href: sourceHref } : {}),
          },
        }
      : {}),
  };
}

export function weekPointView(
  point: RawInbox['weekStrip'][number]
): WeekPointView {
  const date = new Date(`${point.date}T00:00:00`);
  const status =
    point.contentGapCount > 0
      ? 'gap'
      : point.statuses.includes('done')
        ? 'published'
        : point.statuses.includes('needs_review')
          ? 'review'
          : point.statuses.includes('ready')
            ? 'ready'
            : point.taskCount > 0
              ? 'planned'
              : 'unknown';
  const statusLabel = {
    gap: m.p1_week_status_gap,
    planned: m.p1_week_status_planned,
    published: m.p1_week_status_published,
    ready: m.p1_week_status_ready,
    review: m.p1_week_status_review,
    unknown: m.p1_week_status_unknown,
  }[status];
  return {
    contentCount: point.taskCount,
    dateLabel: `${date.getMonth() + 1}/${date.getDate()}`,
    gapLabel:
      point.contentGapCount > 0
        ? m.p1_week_gap_count({ count: point.contentGapCount })
        : undefined,
    id: point.date,
    status,
    statusLabel: statusLabel(),
    weekday: WEEKDAY_LABEL[date.getDay()](),
  };
}

export function templateViews(
  templates: RawTemplate[],
  userTemplates: RawUserTemplate[],
  shortcuts: RawTemplateShortcut[],
  currentWork?: RawCanvasWork
): TemplateCatalogItemView[] {
  const shortcutById = new Map(
    shortcuts.map((shortcut) => [
      shortcut.templateId ?? shortcut.userTemplateId ?? '',
      shortcut,
    ])
  );
  return [
    ...templates.map((template): TemplateCatalogItemView => {
      const shortcut = shortcutById.get(template.id);
      const preset = NAMED_PRESET_CONTRACTS[template.family];
      const thumbnailUrl = safeTemplateThumbnailUrl(template.thumbnailUrl);
      return {
        canCreate:
          template.publicationStatus === 'published' ||
          template.publicationStatus === 'enabled',
        family: template.family,
        familyLabel:
          officialTemplateFamilyName(template.family) ?? template.family,
        id: template.id,
        isShortcut: Boolean(shortcut && !shortcut.hidden),
        name: officialTemplateName(template),
        tags: [...template.tags],
        ...(thumbnailUrl ? { thumbnailUrl } : {}),
        ...(template.previewDocument
          ? { previewDocument: template.previewDocument }
          : {}),
        ...(template.previewVersionId
          ? { previewVersionId: template.previewVersionId }
          : {}),
        ...(preset ?? {}),
        ownerKind: 'official',
        published:
          template.publicationStatus === 'published' ||
          template.publicationStatus === 'enabled',
        retired: template.publicationStatus === 'retired',
        shortcutPosition: shortcut?.rank,
        updateAvailable:
          template.publicationStatus === 'published' &&
          currentWork?.templateId === template.id &&
          Boolean(currentWork.templateVersionId) &&
          Boolean(template.publishedVersionId) &&
          currentWork.templateVersionId !== template.publishedVersionId,
        versionLabel:
          template.publicationStatus === 'enabled'
            ? m.p1_template_version_rollout({
                baseline:
                  template.publishedVersionId ?? m.p1_common_none_short(),
                revision:
                  template.enabledVersionId ?? m.p1_common_not_specified(),
              })
            : (template.publishedVersionId ??
              m.p1_template_version_unpublished()),
      };
    }),
    ...userTemplates.map((template): TemplateCatalogItemView => {
      const shortcut = shortcutById.get(template.id);
      return {
        canCreate: true,
        family: 'user',
        familyLabel: m.p1_template_family_user(),
        id: template.id,
        isShortcut: Boolean(shortcut && !shortcut.hidden),
        name: canvasName(template.name),
        ownerKind: 'user',
        published: true,
        retired: false,
        shortcutPosition: shortcut?.rank,
        updateAvailable: false,
        versionLabel: m.p1_template_version_fixed({
          revision: template.canvasRevisionId.slice(0, 8),
        }),
      };
    }),
  ];
}

export function imageJobView(
  job?: RawImageJob
): ImageGenerationJobView | undefined {
  if (!job) return undefined;
  return {
    actualModelLabel: job.actualModelId,
    assetUrl: job.outputAssetUrl,
    id: job.id,
    status: job.status,
    statusLabel: {
      cancel_requested: m.p1_image_job_cancel_requested,
      cancelled: m.p1_image_job_cancelled,
      completed: m.p1_image_job_completed,
      failed: m.p1_image_job_failed,
      queued: m.p1_image_job_queued,
      running: m.p1_image_job_running,
      unknown: m.p1_image_job_unknown,
      waiting: m.p1_image_job_waiting,
    }[job.status](),
  };
}

export function searchResultView(result: RawSearchResult): RetrievalResultView {
  const matchedBy = {
    bigram: m.p1_retrieval_match_bigram,
    exact: m.p1_retrieval_match_full_text,
    fts: m.p1_retrieval_match_full_text,
    structured: m.p1_retrieval_match_structured,
    trigram: m.p1_retrieval_match_trigram,
  }[result.matchMode];
  const officialFamily = officialSearchFamily(result);
  return {
    excerpt: searchExcerpt(result),
    id: result.id,
    matchedBy: [matchedBy()],
    tags: officialFamily
      ? [officialFamily]
      : [...new Set(result.tags.map(searchTagLabel))].slice(0, 5),
    scope: result.kind,
    title: searchTitle(result),
  };
}
