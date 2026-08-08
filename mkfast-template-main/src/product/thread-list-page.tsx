/**
 * /dashboard/recent — Thread list projection (V31-05, supersede D-088).
 *
 * Sole session entry: rows open `/dashboard?threadId=…`. No second history
 * truth alongside Work-centric sessions.
 */

import { useQuery } from '@tanstack/react-query';
import { IconMessages } from '@tabler/icons-react';

import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { StatePanel } from '@/components/uiux/state-panel';
import { WarmEmptyState } from '@/components/uiux/warm-empty-state';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
  canonical_history_empty_description,
  canonical_history_empty_title,
  canonical_history_error_description,
  canonical_history_error_title,
  canonical_history_loading_description,
  canonical_history_loading_title,
  canonical_history_navigation_recent,
  canonical_history_recent_title,
  canonical_history_retry,
  product_navigation_workbench,
} from '@/locale/paraglide/messages';
import { cn } from '@/lib/utils';
import { getPathWithLocale } from '@/lib/urls';
import { queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import {
  threadDashboardHref,
  type ThreadListItem,
  type ThreadListResponse,
} from '@/product/agent-workbench/thread-session';

function formatWhen(value?: string) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function ThreadListPage() {
  const threadsQuery = useQuery({
    queryKey: p1QueryKeys.request('agent-session', 'list_threads'),
    queryFn: ({ signal }) =>
      queryP1<ThreadListResponse>(
        'agent-session',
        { action: 'list_threads', payload: {} },
        signal
      ),
  });

  const threads = threadsQuery.data?.threads ?? [];

  return (
    <DashboardLayout
      breadcrumbs={[
        {
          href: getPathWithLocale('/dashboard'),
          label: product_navigation_workbench(),
        },
        {
          isCurrentPage: true,
          label: canonical_history_recent_title(),
        },
      ]}
      description="会话入口唯一：这里列出的是 Agent Thread，打开后回到同一条工作台。"
      title={canonical_history_recent_title()}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <p
            className="text-muted text-sm"
            data-testid="thread-list-nav-label"
          >
            {canonical_history_navigation_recent()}
          </p>
          <a
            className={cn(buttonVariants({ size: 'sm', variant: 'outline' }))}
            data-testid="thread-list-new"
            href={getPathWithLocale('/dashboard')}
          >
            {product_navigation_workbench()}
          </a>
        </div>

        {threadsQuery.isLoading ? (
          <StatePanel
            description={canonical_history_loading_description()}
            kind="loading"
            title={canonical_history_loading_title()}
          />
        ) : null}

        {threadsQuery.isError ? (
          <StatePanel
            actionLabel={canonical_history_retry()}
            description={canonical_history_error_description()}
            kind="error"
            onAction={() => void threadsQuery.refetch()}
            title={canonical_history_error_title()}
          />
        ) : null}

        {!threadsQuery.isLoading &&
        !threadsQuery.isError &&
        threads.length === 0 ? (
          <WarmEmptyState
            action={
              <a
                className={cn(buttonVariants())}
                href={getPathWithLocale('/dashboard')}
              >
                {product_navigation_workbench()}
              </a>
            }
            description={canonical_history_empty_description()}
            media={<IconMessages />}
            title={canonical_history_empty_title()}
          />
        ) : null}

        <ul className="flex flex-col gap-2" data-testid="thread-list">
          {threads.map((thread) => (
            <ThreadListRow key={thread.threadId} thread={thread} />
          ))}
        </ul>
      </div>
    </DashboardLayout>
  );
}

function ThreadListRow({ thread }: { thread: ThreadListItem }) {
  const href = getPathWithLocale(threadDashboardHref(thread.threadId));
  const when = formatWhen(thread.lastRunAt ?? thread.updatedAt);

  return (
    <li>
      <a
        className="border-border bg-card hover:bg-muted/40 flex flex-col gap-1 rounded-xl border px-4 py-3 transition-colors"
        data-testid="thread-list-item"
        data-thread-id={thread.threadId}
        href={href}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-foreground text-sm font-medium leading-snug">
            {thread.title}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {thread.activeRunId ? (
              <Badge data-testid="thread-list-active" variant="secondary">
                进行中
              </Badge>
            ) : null}
            <Badge variant="outline">
              {thread.status === 'archived' ? '已归档' : '活跃'}
            </Badge>
          </div>
        </div>
        {thread.summary ? (
          <p className="text-muted line-clamp-2 text-xs leading-relaxed">
            {thread.summary}
          </p>
        ) : null}
        <p className="text-muted text-xs">{when}</p>
      </a>
    </li>
  );
}
