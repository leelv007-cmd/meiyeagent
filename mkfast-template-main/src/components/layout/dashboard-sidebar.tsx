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

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={
                <Link
                  to={mode === 'admin' ? Routes.AdminModels : Routes.Dashboard}
                  onClick={closeMobileSidebar}
                >
                  <Logo className="size-5" />
                  <span className="truncate font-semibold text-base">
                    {mode === 'admin'
                      ? shell_admin_brand()
                      : shell_product_brand()}
                  </span>
                </Link>
              }
              className="data-[slot=sidebar-menu-button]:!p-1.5"
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarMain mode={mode} />
      </SidebarContent>

      <SidebarFooter className="flex flex-col gap-2">
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
              render={
                <Link
                  to={
                    mode === 'admin'
                      ? Routes.Dashboard
                      : SETTINGS_UTILITY_ITEM.href
                  }
                  onClick={closeMobileSidebar}
                >
                  <ProductIcon icon={SETTINGS_UTILITY_ITEM.icon} />
                  <span>
                    {mode === 'admin'
                      ? shell_return_workbench()
                      : shell_settings()}
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
