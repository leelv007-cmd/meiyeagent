import { Routes } from '@/lib/routes';
import {
  common_mobile_navigation,
  mobile_action_stage_progress,
  product_navigation_content,
  product_navigation_store,
  product_navigation_workbench,
} from '@/locale/paraglide/messages';
import { cn } from '@/lib/utils';
import { operationsQuery } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import type { RawCanonicalHistory } from '@/product/canonical-history-model';
import {
  canonicalAsyncTaskSummaries,
  composedVideoAsyncTaskSummaries,
} from '@/product/async-task-center-model';
import { useVideoWorkflowListObserver } from '@/product/creative-job-observer';
import {
  IconBuildingStore,
  IconFileText,
  IconPlayerPlay,
  IconSparkles,
} from '@tabler/icons-react';
import { Link, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { mobileProgressTarget } from './mobile-progress-target';

const itemClassName =
  'flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-full text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50';

const activeClassName = 'font-medium text-foreground';

function isDashboardPath(pathname: string) {
  return pathname === Routes.Dashboard || pathname === `${Routes.Dashboard}/`;
}

export function ProductMobileNav() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const historyQuery = useQuery({
    queryKey: p1QueryKeys.request('operations', 'canonical_history'),
    queryFn: ({ signal }) =>
      operationsQuery<RawCanonicalHistory>('canonical_history', {}, signal),
    refetchOnWindowFocus: true,
  });
  const videoWorkflowQuery = useVideoWorkflowListObserver();
  const tasks = useMemo(
    () =>
      [
        ...(historyQuery.data
          ? canonicalAsyncTaskSummaries(historyQuery.data)
          : []),
        ...(videoWorkflowQuery.data
          ? composedVideoAsyncTaskSummaries(videoWorkflowQuery.data)
          : []),
      ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [historyQuery.data, videoWorkflowQuery.data]
  );

  const onDashboard = isDashboardPath(pathname);
  const createActive = onDashboard;
  const progressActive =
    pathname.startsWith('/dashboard/results/') ||
    pathname === Routes.TaskInbox ||
    pathname.startsWith(`${Routes.TaskInbox}/`);
  const progress = mobileProgressTarget(tasks);

  return (
    <nav
      aria-label={common_mobile_navigation()}
      className="meiye-glass-piece fixed inset-x-3 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-50 grid h-[4.25rem] grid-cols-4 rounded-[28px] px-1.5 shadow-[var(--shadow-ambient)]"
    >
      <Link
        to={Routes.Dashboard}
        search={{}}
        className={cn(itemClassName, createActive && activeClassName)}
      >
        <IconSparkles className="size-5" aria-hidden="true" />
        <span className="truncate">{product_navigation_workbench()}</span>
      </Link>
      {progress.kind === 'result' ? (
        <Link
          to="/dashboard/results/$workId"
          params={{ workId: progress.workId }}
          className={cn(itemClassName, progressActive && activeClassName)}
          data-testid="mobile-progress-entry"
        >
          <IconPlayerPlay className="size-5" aria-hidden="true" />
          <span className="truncate">{mobile_action_stage_progress()}</span>
        </Link>
      ) : (
        <Link
          to={Routes.TaskInbox}
          search={{
            date: 'all',
            mode: 'inbox',
            relatedKind: 'all',
            risk: 'all',
            source: 'all',
            status: 'all',
          }}
          className={cn(itemClassName, progressActive && activeClassName)}
          data-testid="mobile-progress-entry"
        >
          <IconPlayerPlay className="size-5" aria-hidden="true" />
          <span className="truncate">{mobile_action_stage_progress()}</span>
        </Link>
      )}
      <Link
        to={Routes.ContentLibrary}
        activeProps={{ className: activeClassName }}
        className={itemClassName}
      >
        <IconFileText className="size-5" aria-hidden="true" />
        <span className="truncate">{product_navigation_content()}</span>
      </Link>
      <Link
        to={Routes.StoreProfile}
        activeProps={{ className: activeClassName }}
        className={itemClassName}
      >
        <IconBuildingStore className="size-5" aria-hidden="true" />
        <span className="truncate">{product_navigation_store()}</span>
      </Link>
    </nav>
  );
}
