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
import {
  resultReturnSearch,
  taskInboxReturnState,
} from '@/product/results/result-return-navigation';
import type { CreativeWorkbenchProjection } from '@meiye/contracts';
import {
  IconBuildingStore,
  IconFileText,
  IconPlayerPlay,
  IconSparkles,
} from '@tabler/icons-react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

import { mobileProgressTarget } from './mobile-progress-target';

const itemClassName =
  'flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-full text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50';

const activeClassName = 'font-medium text-foreground';

function isDashboardPath(pathname: string) {
  return pathname === Routes.Dashboard || pathname === `${Routes.Dashboard}/`;
}

function progressReturnSearch(input: {
  pathname: string;
  search: Record<string, unknown>;
  scrollY: number;
}) {
  if (input.pathname === Routes.TaskInbox) {
    return resultReturnSearch(
      taskInboxReturnState({
        search: input.search,
        scrollY: input.scrollY,
        focusKey: 'mobile-progress-entry',
      })
    );
  }
  return isDashboardPath(input.pathname)
    ? resultReturnSearch({ kind: 'dashboard' })
    : {};
}

export function ProductMobileNav() {
  const location = useRouterState({
    select: (state) => state.location,
  });
  const navigate = useNavigate();
  const workbenchQuery = useQuery({
    queryKey: p1QueryKeys.request('operations', 'creative_workbench'),
    queryFn: ({ signal }) =>
      operationsQuery<CreativeWorkbenchProjection>(
        'creative_workbench',
        {},
        signal
      ),
    refetchOnWindowFocus: true,
  });

  const onDashboard = isDashboardPath(location.pathname);
  const createActive = onDashboard;
  const progressActive =
    location.pathname.startsWith('/dashboard/results/') ||
    location.pathname === Routes.TaskInbox ||
    location.pathname.startsWith(`${Routes.TaskInbox}/`);
  const progress = mobileProgressTarget(workbenchQuery.data);
  const stableProgressSearch = progressReturnSearch({
    pathname: location.pathname,
    search: location.search,
    scrollY: typeof window === 'undefined' ? 0 : window.scrollY,
  });

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
      {progress.kind === 'loading' ? (
        <button
          aria-busy={workbenchQuery.isPending}
          aria-disabled="true"
          className={itemClassName}
          data-testid="mobile-progress-entry"
          disabled
          type="button"
        >
          <IconPlayerPlay className="size-5" aria-hidden="true" />
          <span className="truncate">{mobile_action_stage_progress()}</span>
        </button>
      ) : progress.kind === 'result' ? (
        <Link
          to="/dashboard/results/$workId"
          params={{ workId: progress.workId }}
          search={stableProgressSearch}
          className={cn(itemClassName, progressActive && activeClassName)}
          data-testid="mobile-progress-entry"
          data-return-focus-key="mobile-progress-entry"
          onClick={(event) => {
            if (
              event.defaultPrevented ||
              event.button !== 0 ||
              event.metaKey ||
              event.altKey ||
              event.ctrlKey ||
              event.shiftKey
            ) {
              return;
            }
            event.preventDefault();
            void navigate({
              to: '/dashboard/results/$workId',
              params: { workId: progress.workId },
              search: progressReturnSearch({
                pathname: location.pathname,
                search: location.search,
                scrollY: window.scrollY,
              }),
            });
          }}
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
          data-return-focus-key="mobile-progress-entry"
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
