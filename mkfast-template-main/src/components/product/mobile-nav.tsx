import { Routes } from '@/lib/routes';
import { common_mobile_navigation } from '@/locale/paraglide/messages';
import { BUSINESS_SIDEBAR_ITEMS } from '@/config/sidebar-config';
import { ProductIcon } from '@/components/uiux/product-icon';
import { cn } from '@/lib/utils';
import { Link, useRouterState } from '@tanstack/react-router';

const itemClassName =
  'flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-full text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50';

const activeClassName = 'font-medium text-foreground';

/**
 * The sidebar and the bottom bar are one navigation seen from two viewports, so
 * U07 gives them one list: destinations, order and icons all come from
 * `BUSINESS_SIDEBAR_ITEMS` (which is `BUSINESS_NAVIGATION` plus the icon map).
 * A route added to the shell now reaches the phone by itself instead of waiting
 * for someone to notice this file.
 *
 * Mobile and desktop share the same 素材 / Materials label for the assets slot
 * (`product_navigation_assets`). Identity (口吻 / Voices) stays reachable inside
 * the assets surface and dedicated routes — not via a different nav word.
 * `TEST_IDS.assets` still marks the mobile entry for journey tests.
 */
const TEST_IDS: Partial<
  Record<(typeof BUSINESS_SIDEBAR_ITEMS)[number]['id'], string>
> = {
  assets: 'mobile-identity-assets-entry',
};

function isDashboardPath(pathname: string) {
  return pathname === Routes.Dashboard || pathname === `${Routes.Dashboard}/`;
}

export function ProductMobileNav() {
  const location = useRouterState({
    select: (state) => state.location,
  });

  const onDashboard = isDashboardPath(location.pathname);

  return (
    <nav
      aria-label={common_mobile_navigation()}
      className="meiye-glass-piece fixed inset-x-3 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-50 grid h-[4.25rem] grid-cols-5 rounded-[28px] px-1.5 shadow-[var(--shadow-ambient)]"
    >
      {BUSINESS_SIDEBAR_ITEMS.map((item) => {
        // The workbench entry is active on the workbench itself only; the
        // router's own match would also light it up on every nested route.
        const isWorkbench = item.href === Routes.Dashboard;

        return (
          <Link
            activeProps={
              isWorkbench ? undefined : { className: activeClassName }
            }
            className={cn(
              itemClassName,
              isWorkbench && onDashboard && activeClassName
            )}
            data-testid={TEST_IDS[item.id]}
            key={item.id}
            search={isWorkbench ? {} : undefined}
            to={item.href}
          >
            <ProductIcon className="size-5" icon={item.icon} />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
