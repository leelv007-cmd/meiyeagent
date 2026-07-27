import { Logo } from '@/components/shared/logo';
import { SidebarMain } from '@/components/layout/sidebar-main';
import { SidebarUser } from '@/components/layout/sidebar-user';
import { ProductIcon } from '@/components/uiux/product-icon';
import { Sidebar, useSidebar } from '@/components/heroui-pro';
import { SETTINGS_UTILITY_ITEM, type ShellMode } from '@/config/sidebar-config';
import {
  shell_product_brand,
  shell_settings,
} from '@/locale/paraglide/messages';
import { Link } from '@tanstack/react-router';
import { Routes } from '@/lib/routes';
import type { SessionUser } from '@/auth/types';
import { AsyncTaskCenter } from '@/product/async-task-center';
import type * as React from 'react';

type DashboardSidebarProps = Omit<
  React.ComponentProps<typeof Sidebar>,
  'children'
> & {
  mode: ShellMode;
  user: SessionUser;
};

/**
 * Dashboard sidebar — HeroUI Pro V3 Sidebar（S7 / U07 换壳）。
 *
 * 壳（Provider / aside / Header / Content / Footer / Rail / Trigger）整套换成 Pro
 * 的件；**行**没有换。Pro 的 `Sidebar.MenuItem` 底下是 React Aria `Tree`，一行渲染成
 * `role="row"`，链接语义会一起没有——cmd-click 新开、读屏播报「链接」、
 * `getByRole('link')` 三样同时消失。商家一级导航是这个产品的主路，所以这四项与
 * 「设置」仍然是真的 `<Link>`（见 sidebar-main.tsx 与本文件页脚），药丸外观由
 * `.meiye-sidebar-nav-item` 供给。后台壳（admin-dashboard-shell）用的是 Pro 的行，
 * 那面是运营内部面，没有这条约束。
 *
 * `group` 这个 class 是给 `async-task-center.tsx` 的 `group-data-[collapsible=icon]:`
 * 一族工具类用的：shadcn 的侧栏容器自带 group，Pro 的不带，收起态的尺寸收缩靠它。
 *
 * admin 分支已撤：/admin 自 D-130 起走 admin-dashboard-shell，这层壳只服务
 * /dashboard 与 /settings。
 */
export function DashboardSidebar({
  mode,
  user,
  ...props
}: DashboardSidebarProps) {
  const { isMobile, setMobileOpen } = useSidebar();

  const closeMobileSidebar = () => {
    if (isMobile) setMobileOpen(false);
  };

  return (
    <Sidebar className="group" {...props}>
      <Sidebar.Header>
        <Link
          className="meiye-sidebar-brand"
          onClick={closeMobileSidebar}
          to={Routes.Dashboard}
        >
          <Logo className="size-5 shrink-0" />
          <span
            className="truncate text-base font-semibold"
            data-sidebar="label"
          >
            {shell_product_brand()}
          </span>
        </Link>
      </Sidebar.Header>

      <Sidebar.Content>
        <SidebarMain mode={mode} />
      </Sidebar.Content>

      <Sidebar.Footer>
        {mode === 'product' && !isMobile ? (
          <AsyncTaskCenter isMobile={false} userId={user.id} />
        ) : null}
        <Link
          className="meiye-sidebar-nav-item"
          onClick={closeMobileSidebar}
          to={SETTINGS_UTILITY_ITEM.href}
        >
          <ProductIcon icon={SETTINGS_UTILITY_ITEM.icon} />
          <span className="truncate" data-sidebar="label">
            {shell_settings()}
          </span>
        </Link>
        <SidebarUser user={user} />
      </Sidebar.Footer>
      <Sidebar.Rail />
    </Sidebar>
  );
}
