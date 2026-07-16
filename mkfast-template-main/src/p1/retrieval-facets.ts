import { m } from '@/locale/paraglide/messages';

import type { FilterOption, SearchScope } from './types';

export const TASK_STATUS_FILTER_OPTIONS = [
  { label: m.p1_filter_status_all(), value: 'all' },
  { label: m.p1_task_status_todo(), value: 'todo' },
  { label: m.p1_task_status_in_progress(), value: 'in_progress' },
  { label: m.p1_task_status_needs_review(), value: 'needs_review' },
  { label: m.p1_task_status_needs_asset(), value: 'needs_asset' },
  { label: m.p1_filter_status_blocked(), value: 'blocked' },
  { label: m.p1_task_status_ready(), value: 'ready' },
  { label: m.p1_task_status_done(), value: 'done' },
  { label: m.p1_task_status_archived(), value: 'archived' },
] satisfies FilterOption[];

export const TASK_SOURCE_FILTER_OPTIONS = [
  { label: m.p1_filter_source_all(), value: 'all' },
  { label: m.p1_task_source_weekly_batch(), value: 'weekly_batch' },
  { label: m.p1_task_source_asset_gap(), value: 'asset_gap' },
  { label: m.p1_task_source_stale_draft(), value: 'stale_draft' },
  { label: m.p1_task_source_weekly_review(), value: 'weekly_review' },
  { label: m.p1_task_source_publish_ready(), value: 'publish_ready' },
  { label: m.p1_task_source_manual(), value: 'manual' },
] satisfies FilterOption[];

export const TASK_RELATED_KIND_FILTER_OPTIONS = [
  { label: m.p1_filter_related_all(), value: 'all' },
  { label: m.p1_filter_related_asset(), value: 'asset' },
  { label: m.p1_filter_related_content(), value: 'content' },
  { label: m.p1_filter_related_integration(), value: 'integration' },
  { label: m.p1_filter_related_publication(), value: 'publication' },
  { label: m.p1_filter_related_review(), value: 'review' },
  { label: m.p1_filter_related_template(), value: 'template' },
  { label: m.p1_filter_related_work(), value: 'work' },
] satisfies FilterOption[];

export const CONTENT_PLATFORM_FILTER_OPTIONS = [
  { label: m.p1_filter_platform_all(), value: 'all' },
  { label: m.p1_filter_platform_xiaohongshu(), value: 'xiaohongshu' },
  { label: m.p1_filter_platform_douyin(), value: 'douyin' },
] satisfies FilterOption[];

export const CONTENT_STATUS_FILTER_OPTIONS = [
  { label: m.p1_filter_status_all(), value: 'all' },
  { label: m.p1_filter_content_candidate(), value: 'candidate' },
  { label: m.p1_filter_content_draft(), value: 'draft' },
  { label: m.p1_filter_content_abandoned(), value: 'abandoned' },
  { label: m.p1_filter_content_published(), value: 'published' },
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
