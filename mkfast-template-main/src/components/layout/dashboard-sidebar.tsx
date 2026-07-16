import { Logo } from '@/components/shared/logo';
import { SidebarMain } from '@/components/layout/sidebar-main';
import { SidebarUser } from '@/components/layout/sidebar-user';
import { ProductIcon } from '@/components/uiux/product-icon';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { SETTINGS_UTILITY_ITEM, type ShellMode } from '@/config/sidebar-config';
import {
  shell_admin_brand,
  shell_product_brand,
  shell_return_workbench,
  shell_settings,
} from '@/locale/paraglide/messages';
import { Link } from '@tanstack/react-router';
import { Routes } from '@/lib/routes';
import type { SessionUser } from '@/auth/types';
import { AsyncTaskCenter } from '@/product/async-task-center';
import type * as React from 'react';
import { cn } from '@/lib/utils';

type DashboardSidebarProps = React.ComponentProps<typeof Sidebar> & {
  mode: ShellMode;
  user: SessionUser;
};

/**
 * Dashboard sidebar
 */
export function DashboardSidebar({
  mode,
  user,
  ...props
}: DashboardSidebarProps) {
  const { isMobile, setOpenMobile } = useSidebar();

  const closeMobileSidebar = () => {
    if (isMobile) setOpenMobile(false);
  };

  const isAdmin = mode === 'admin';

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className={cn(isAdmin ? 'gap-0 px-2 py-2' : 'px-2 py-3')}>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size={isAdmin ? 'sm' : 'lg'}
              render={
                <Link
                  to={isAdmin ? Routes.AdminModels : Routes.Dashboard}
                  onClick={closeMobileSidebar}
                >
                  <Logo className={isAdmin ? 'size-4' : 'size-5'} />
                  <span
                    className={cn(
                      'truncate font-semibold',
                      isAdmin ? 'text-sm' : 'text-base'
                    )}
                  >
                    {isAdmin ? shell_admin_brand() : shell_product_brand()}
                  </span>
                </Link>
              }
              className={cn(
                isAdmin
                  ? 'data-[slot=sidebar-menu-button]:!p-1.5'
                  : 'data-[slot=sidebar-menu-button]:!px-2.5 data-[slot=sidebar-menu-button]:!py-2'
              )}
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className={cn(isAdmin && 'gap-1')}>
        <SidebarMain mode={mode} />
      </SidebarContent>

      <SidebarFooter
        className={cn('flex flex-col', isAdmin ? 'gap-1.5' : 'gap-2')}
      >
        {mode === 'product' && !isMobile ? (
          <SidebarMenu>
            <SidebarMenuItem>
              <AsyncTaskCenter isMobile={false} userId={user.id} />
            </SidebarMenuItem>
          </SidebarMenu>
        ) : null}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size={isAdmin ? 'sm' : 'default'}
              render={
                <Link
                  to={isAdmin ? Routes.Dashboard : SETTINGS_UTILITY_ITEM.href}
                  onClick={closeMobileSidebar}
                >
                  <ProductIcon icon={SETTINGS_UTILITY_ITEM.icon} />
                  <span className={cn(isAdmin && 'text-xs')}>
                    {isAdmin ? shell_return_workbench() : shell_settings()}
                  </span>
                </Link>
              }
            />
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarUser user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}
