import { Routes } from '@/lib/routes';
import {
  common_mobile_navigation,
  product_navigation_content,
  product_navigation_identity_assets,
  product_navigation_store,
  product_navigation_workbench,
} from '@/locale/paraglide/messages';
import { cn } from '@/lib/utils';
import {
  IconBuildingStore,
  IconFileText,
  IconPhoto,
  IconSparkles,
} from '@tabler/icons-react';
import { Link, useRouterState } from '@tanstack/react-router';

const itemClassName =
  'flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-full text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50';

const activeClassName = 'font-medium text-foreground';

function isDashboardPath(pathname: string) {
  return pathname === Routes.Dashboard || pathname === `${Routes.Dashboard}/`;
}

export function ProductMobileNav() {
  const location = useRouterState({
    select: (state) => state.location,
  });

  const onDashboard = isDashboardPath(location.pathname);
  const createActive = onDashboard;

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
      <Link
        to={Routes.AssetLibrary}
        activeProps={{ className: activeClassName }}
        className={itemClassName}
        data-testid="mobile-identity-assets-entry"
      >
        <IconPhoto className="size-5" aria-hidden="true" />
        <span className="truncate">{product_navigation_identity_assets()}</span>
      </Link>
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
