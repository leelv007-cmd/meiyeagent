import { ProductIcon } from '@/components/uiux/product-icon';
import {
  ADMIN_SIDEBAR_ITEMS,
  BUSINESS_SIDEBAR_ITEMS,
  SETTINGS_SIDEBAR_ITEMS,
  type ShellMode,
  type ShellNavigationItem,
} from '@/config/sidebar-config';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { Link, useRouterState } from '@tanstack/react-router';
import {
  shell_admin_navigation_aria,
  shell_business_navigation_aria,
  shell_settings,
  shell_settings_navigation_aria,
} from '@/locale/paraglide/messages';
import { cn } from '@/lib/utils';

interface SidebarMainProps {
  mode: ShellMode;
}

function canonicalPath(value: string) {
  return value.replace(/\/$/, '') || '/';
}

export function SidebarMain({ mode }: SidebarMainProps) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const { isMobile, setOpenMobile } = useSidebar();

  const closeMobileSidebar = () => {
    if (isMobile) setOpenMobile(false);
  };

  const isAdmin = mode === 'admin';

  const renderNavigation = (
    items: readonly ShellNavigationItem[],
    label: string,
    groupLabel?: string
  ) => (
    <SidebarGroup className={cn(isAdmin && 'py-1')}>
      {groupLabel ? (
        <SidebarGroupLabel className={cn(isAdmin && 'h-7 text-xs')}>
          {groupLabel}
        </SidebarGroupLabel>
      ) : null}
      <SidebarGroupContent>
        <nav aria-label={label}>
          <SidebarMenu className={cn(isAdmin ? 'gap-0.5' : 'gap-1')}>
            {items.map((item) => {
              const current = canonicalPath(pathname);
              const target = canonicalPath(item.href);
              const isActive =
                current === target ||
                (target !== '/dashboard' && current.startsWith(`${target}/`));
              return (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    isActive={isActive}
                    size={isAdmin ? 'sm' : 'default'}
                    render={
                      <Link to={item.href} onClick={closeMobileSidebar}>
                        <ProductIcon icon={item.icon} />
                        <span
                          className={cn(
                            'truncate font-medium',
                            isAdmin ? 'text-xs' : 'text-sm'
                          )}
                        >
                          {item.label}
                        </span>
                      </Link>
                    }
                  />
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </nav>
      </SidebarGroupContent>
    </SidebarGroup>
  );

  if (mode === 'admin') {
    return renderNavigation(ADMIN_SIDEBAR_ITEMS, shell_admin_navigation_aria());
  }

  return (
    <>
      {renderNavigation(
        BUSINESS_SIDEBAR_ITEMS,
        shell_business_navigation_aria()
      )}
      {mode === 'settings'
        ? renderNavigation(
            SETTINGS_SIDEBAR_ITEMS,
            shell_settings_navigation_aria(),
            shell_settings()
          )
        : null}
    </>
  );
}
