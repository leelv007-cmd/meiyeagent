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

const itemClassName =
  'flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-full text-[11px] text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50';

export function ProductMobileNav() {
  const navigate = useNavigate();

  const startCreation = async () => {
    await navigate({ to: Routes.Dashboard });
    window.dispatchEvent(new Event('meiye:new-content'));
  };

  return (
    <nav
      aria-label={common_mobile_navigation()}
      className="meiye-glass-piece fixed inset-x-3 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-50 grid h-[4.25rem] grid-cols-5 rounded-[28px] px-1.5 shadow-[var(--shadow-ambient)]"
    >
      {items.slice(0, 2).map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            to={item.href}
            activeProps={{ className: 'font-medium text-foreground' }}
            className={itemClassName}
          >
            <Icon className="size-5" aria-hidden="true" />
            <span className="truncate">{item.label()}</span>
          </Link>
        );
      })}
      <button
        type="button"
        onClick={() => void startCreation()}
        className="flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="meiye-porcelain grid size-11 place-items-center rounded-full text-foreground">
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
            activeProps={{ className: 'font-medium text-foreground' }}
            className={itemClassName}
          >
            <Icon className="size-5" aria-hidden="true" />
            <span className="truncate">{item.label()}</span>
          </Link>
        );
      })}
    </nav>
  );
}
