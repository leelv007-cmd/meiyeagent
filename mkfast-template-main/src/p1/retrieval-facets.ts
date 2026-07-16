import {
  p1_filter_content_abandoned,
  p1_filter_content_candidate,
  p1_filter_content_draft,
  p1_filter_content_published,
  p1_filter_platform_all,
  p1_filter_platform_douyin,
  p1_filter_platform_xiaohongshu,
  p1_filter_related_all,
  p1_filter_related_asset,
  p1_filter_related_content,
  p1_filter_related_integration,
  p1_filter_related_publication,
  p1_filter_related_review,
  p1_filter_related_template,
  p1_filter_related_work,
  p1_filter_source_all,
  p1_filter_status_all,
  p1_filter_status_blocked,
  p1_task_source_asset_gap,
  p1_task_source_manual,
  p1_task_source_publish_ready,
  p1_task_source_stale_draft,
  p1_task_source_weekly_batch,
  p1_task_source_weekly_review,
  p1_task_status_archived,
  p1_task_status_done,
  p1_task_status_in_progress,
  p1_task_status_needs_asset,
  p1_task_status_needs_review,
  p1_task_status_ready,
  p1_task_status_todo,
} from '@/locale/paraglide/messages';

import type { FilterOption, SearchScope } from './types';

export const TASK_STATUS_FILTER_OPTIONS = [
  { label: p1_filter_status_all(), value: 'all' },
  { label: p1_task_status_todo(), value: 'todo' },
  { label: p1_task_status_in_progress(), value: 'in_progress' },
  { label: p1_task_status_needs_review(), value: 'needs_review' },
  { label: p1_task_status_needs_asset(), value: 'needs_asset' },
  { label: p1_filter_status_blocked(), value: 'blocked' },
  { label: p1_task_status_ready(), value: 'ready' },
  { label: p1_task_status_done(), value: 'done' },
  { label: p1_task_status_archived(), value: 'archived' },
] satisfies FilterOption[];

export const TASK_SOURCE_FILTER_OPTIONS = [
  { label: p1_filter_source_all(), value: 'all' },
  { label: p1_task_source_weekly_batch(), value: 'weekly_batch' },
  { label: p1_task_source_asset_gap(), value: 'asset_gap' },
  { label: p1_task_source_stale_draft(), value: 'stale_draft' },
  { label: p1_task_source_weekly_review(), value: 'weekly_review' },
  { label: p1_task_source_publish_ready(), value: 'publish_ready' },
  { label: p1_task_source_manual(), value: 'manual' },
] satisfies FilterOption[];

export const TASK_RELATED_KIND_FILTER_OPTIONS = [
  { label: p1_filter_related_all(), value: 'all' },
  { label: p1_filter_related_asset(), value: 'asset' },
  { label: p1_filter_related_content(), value: 'content' },
  { label: p1_filter_related_integration(), value: 'integration' },
  { label: p1_filter_related_publication(), value: 'publication' },
  { label: p1_filter_related_review(), value: 'review' },
  { label: p1_filter_related_template(), value: 'template' },
  { label: p1_filter_related_work(), value: 'work' },
] satisfies FilterOption[];

export const CONTENT_PLATFORM_FILTER_OPTIONS = [
  { label: p1_filter_platform_all(), value: 'all' },
  { label: p1_filter_platform_xiaohongshu(), value: 'xiaohongshu' },
  { label: p1_filter_platform_douyin(), value: 'douyin' },
] satisfies FilterOption[];

export const CONTENT_STATUS_FILTER_OPTIONS = [
  { label: p1_filter_status_all(), value: 'all' },
  { label: p1_filter_content_candidate(), value: 'candidate' },
  { label: p1_filter_content_draft(), value: 'draft' },
  { label: p1_filter_content_abandoned(), value: 'abandoned' },
  { label: p1_filter_content_published(), value: 'published' },
] satisfies FilterOption[];

export function buildRetrievalQuery(input: {
  metadata: Record<string, string>;
  query: string;
  scope: SearchScope;
}) {
  const selected = Object.entries(input.metadata).filter(
    ([, value]) => value !== 'all'
  );
  const tags = selected
    .filter(([key]) => key === 'tag' || key === 'platform')
    .map(([, value]) => value);
  const metadata = Object.fromEntries(
    selected.filter(([key]) => key !== 'tag' && key !== 'platform')
  );
  return {
    kinds: input.scope === 'all' ? undefined : [input.scope],
    limit: 20,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    query: input.query,
    tags: tags.length > 0 ? tags : undefined,
  };
}
