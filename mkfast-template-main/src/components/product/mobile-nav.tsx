import { Routes } from '@/lib/routes';
import {
  common_mobile_navigation,
  product_mobile_nav_create,
  product_navigation_assets,
  product_navigation_content,
  product_navigation_store,
  product_navigation_workbench,
} from '@/locale/paraglide/messages';
import {
  IconBuildingStore,
  IconFileText,
  IconFolders,
  IconPlus,
  IconSparkles,
} from '@tabler/icons-react';
import { Link, useNavigate } from '@tanstack/react-router';

const items = [
  {
    href: Routes.Dashboard,
    label: product_navigation_workbench,
    icon: IconSparkles,
  },
  {
    href: Routes.ContentLibrary,
    label: product_navigation_content,
    icon: IconFileText,
  },
  {
    href: Routes.AssetLibrary,
    label: product_navigation_assets,
    icon: IconFolders,
  },
  {
    href: Routes.StoreProfile,
    label: product_navigation_store,
    icon: IconBuildingStore,
  },
] as const;

export function ProductMobileNav() {
  const navigate = useNavigate();

  const startCreation = async () => {
    await navigate({ to: Routes.Dashboard });
    window.dispatchEvent(new Event('meiye:new-content'));
  };

  return (
    <nav
      aria-label={common_mobile_navigation()}
      className="fixed inset-x-0 bottom-0 z-50 grid h-[calc(4.5rem+env(safe-area-inset-bottom))] grid-cols-5 border-t border-divider bg-surface-2/96 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      {items.slice(0, 2).map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            to={item.href}
            activeProps={{ className: 'text-primary' }}
            className="flex min-h-touch-target min-w-0 flex-col items-center justify-center gap-1 text-xs text-muted-foreground"
          >
            <Icon className="size-5" aria-hidden="true" />
            <span>{item.label()}</span>
          </Link>
        );
      })}
      <button
        type="button"
        onClick={() => void startCreation()}
        className="flex min-h-touch-target min-w-0 flex-col items-center justify-center gap-0.5 text-xs font-medium text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="grid size-11 place-items-center rounded-full bg-surface-1 text-foreground">
          <IconPlus className="size-5" aria-hidden="true" />
        </span>
        <span>{product_mobile_nav_create()}</span>
      </button>
      {items.slice(2).map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            to={item.href}
            activeProps={{ className: 'text-primary' }}
            className="flex min-h-touch-target min-w-0 flex-col items-center justify-center gap-1 text-xs text-muted-foreground"
          >
            <Icon className="size-5" aria-hidden="true" />
            <span>{item.label()}</span>
          </Link>
        );
      })}
    </nav>
  );
}
