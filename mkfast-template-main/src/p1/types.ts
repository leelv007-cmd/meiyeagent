import type { ReactNode } from 'react';

export type ContentTaskStatus =
  | 'todo'
  | 'in_progress'
  | 'needs_review'
  | 'needs_asset'
  | 'blocked'
  | 'ready'
  | 'done'
  | 'archived';

export type ContentTaskAction =
  | 'start'
  | 'complete'
  | 'archive'
  | 'add_asset'
  | 'retry_notification';

export type TaskRisk = 'none' | 'attention' | 'blocked';

export interface TaskSourceLinkView {
  id: string;
  kind:
    | 'content'
    | 'asset'
    | 'integration'
    | 'publish'
    | 'review'
    | 'template'
    | 'work';
  label: string;
  href?: string;
}

export interface ContentTaskView {
  id: string;
  title: string;
  summary?: string;
  status: ContentTaskStatus;
  source: string;
  sourceLabel: string;
  risk: TaskRisk;
  dueLabel?: string;
  createdLabel?: string;
  blockedReason?: string;
  nextStep?: string;
  sourceLink?: TaskSourceLinkView;
  notificationFailed?: boolean;
  availableActions: ContentTaskAction[];
}

export interface TaskInboxFiltersValue {
  status: string;
  source: string;
  date: string;
  relatedKind: string;
  risk: string;
}

interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

export interface TaskInboxFilterOptions {
  statuses: FilterOption[];
  sources: FilterOption[];
  dates: FilterOption[];
  relatedKinds: FilterOption[];
  risks: FilterOption[];
}

export type WeekPointStatus =
  | 'planned'
  | 'draft'
  | 'review'
  | 'ready'
  | 'published'
  | 'gap'
  | 'unknown';

export interface WeekPointView {
  id: string;
  weekday: string;
  dateLabel: string;
  status: WeekPointStatus;
  statusLabel: string;
  contentCount?: number;
  gapLabel?: string;
}

export interface InlineTaskRenderContext {
  task: ContentTaskView;
  placement: 'after_summary' | 'before_actions';
}

export type InlineTaskRenderer = (
  context: InlineTaskRenderContext
) => ReactNode;

export interface WeeklyBatchItemView {
  task: ContentTaskView;
  selected: boolean;
  executable: boolean;
  exclusionReason?: string;
  publishConfirmationRequired?: boolean;
}

export type WeeklyBatchAction =
  | 'create'
  | 'revise'
  | 'apply_template'
  | 'prepare_draft';

export type TemplateOwnerKind = 'official' | 'user';

export interface TemplateCatalogItemView {
  id: string;
  name: string;
  family: string;
  familyLabel: string;
  description?: string;
  thumbnailUrl?: string;
  tags?: string[];
  inputGuide?: string;
  availableContentModules?: Array<
    | 'social_cover'
    | 'before_after'
    | 'price_card'
    | 'package_explainer'
    | 'review_card'
    | 'store_intro'
    | 'shooting_checklist'
  >;
  defaultContentModules?: Array<
    | 'social_cover'
    | 'before_after'
    | 'price_card'
    | 'package_explainer'
    | 'review_card'
    | 'store_intro'
    | 'shooting_checklist'
  >;
  previewDocument?: Record<string, unknown>;
  previewVersionId?: string;
  ownerKind: TemplateOwnerKind;
  versionLabel: string;
  published: boolean;
  retired: boolean;
  isShortcut: boolean;
  shortcutPosition?: number;
  updateAvailable?: boolean;
  canCreate: boolean;
}

export type TemplateAction =
  | 'create'
  | 'preview'
  | 'pin'
  | 'hide'
  | 'move_up'
  | 'move_down'
  | 'upgrade'
  | 'copy'
  | 'rename'
  | 'delete';

export type ImageModelId =
  | 'gpt-image-2'
  | 'nano-banana-2'
  | 'nano-banana-pro'
  | 'seedream-4-5'
  | 'seedream-5-pro';

export interface ImageModelOptionView {
  id: ImageModelId;
  label: string;
  manufacturer: string;
  capabilityLabel: string;
  estimatedUsageLabel: string;
  available: boolean;
  unavailableReason?: string;
}

export interface ImageGenerationJobView {
  id: string;
  status:
    | 'queued'
    | 'running'
    | 'waiting'
    | 'completed'
    | 'failed'
    | 'cancel_requested'
    | 'cancelled'
    | 'unknown';
  statusLabel: string;
  assetUrl?: string;
  actualModelLabel?: string;
  errorMessage?: string;
}

export type SearchScope = 'all' | 'task' | 'asset' | 'content' | 'template';

export interface RetrievalFilterView {
  id: string;
  label: string;
  value: string;
  control?: 'select' | 'text' | 'date';
  options?: FilterOption[];
}

export interface RetrievalResultView {
  id: string;
  scope: Exclude<SearchScope, 'all'>;
  title: string;
  excerpt?: string;
  tags: string[];
  href?: string;
  matchedBy: string[];
}

export interface RetrievalMetricsView {
  revision: string;
  recallAtK: number | null;
  noResultRate: number | null;
  reformulationRate: number | null;
  indexDocumentCount: number;
  indexSizeBytes: number;
  indexMode: string;
  querySetHash: string;
}
