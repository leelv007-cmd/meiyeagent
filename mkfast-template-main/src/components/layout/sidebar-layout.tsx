import { DashboardSidebar } from '@/components/layout/dashboard-sidebar';
import { ProductMobileNav } from '@/components/product/mobile-nav';
import { Sidebar } from '@/components/heroui-pro';
import { Spinner } from '@/components/ui/spinner';
import { authClient } from '@/auth/client';
import { Routes } from '@/lib/routes';
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { isMobileReachableSettingsSurface } from '@/lib/uiux/navigation';
import { useEffect, type ReactNode } from 'react';
import type { ShellMode } from '@/config/sidebar-config';
import { useIsMobile } from '@/hooks/use-mobile';
import { DesktopRelayPage } from '@/components/layout/desktop-relay-page';
import { AsyncTaskCenter } from '@/product/async-task-center';
import { GlobalCommandProvider } from '@/product/global-command-palette';
import {
  common_loading,
  sidebar_skip_to_content,
} from '@/locale/paraglide/messages';

/**
 * Shared layout for /dashboard and /settings routes
 * sidebar + auth guard (redirect to login if no session)
 * use with Outlet as children
 *
 * S7 / U07 换壳：这层壳是 HeroUI Pro V3 Sidebar（`components/heroui-pro`），
 * 不再是 shadcn `components/ui/sidebar`。三件事随之改口径：
 *
 *  1. 槽位少了一层。shadcn 的 wrapper→gap→container→inner 四层在 Pro 里塌成
 *     provider→aside 两层，商家壳的门店橱窗 CSS 因此重锚（见 src/styles.css
 *     与 heroui-pro/heroui-glass.css 的侧栏段）。
 *  2. 壳根挂 `meiye-heroui-glass`。token 桥的选择器是
 *     `html:has(.meiye-heroui-glass)`，没有它 Pro 侧栏读的是 HeroUI 自带的
 *     默认主题，而不是 DESIGN.md 的门店橱窗值（heroui-pro/README.md）。
 *  3. `meiye-product-shell` 三种 mode 都往 body 上挂。桥声明在 <html>，
 *     React Aria 的浮层 portal 到 document.body：body 上没有这层商家 token
 *     的话，/settings 的下拉与弹窗会掉到桥的 HeroUI 语义上（--muted 在桥里是
 *     前景色，在 shadcn 里是底色）。换壳前 /settings 不载 Glass 表所以碰不到，
 *     现在载了，就得由这层挡住。
 */
export function SidebarLayout({
  children,
  mode,
}: {
  children: ReactNode;
  mode: ShellMode;
}) {
  const { data: session, isPending } = authClient.useSession();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const location = useRouterState({ select: (state) => state.location });

  useEffect(() => {
    if (isPending) return;
    if (!session?.user) {
      navigate({ to: Routes.Login });
    }
  }, [session, isPending, navigate]);

  useEffect(() => {
    document.body.classList.add('meiye-product-shell');
    return () => document.body.classList.remove('meiye-product-shell');
  }, []);

  if (isPending) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner className="size-6" />
        <span className="sr-only">{common_loading()}</span>
      </div>
    );
  }

  if (!session?.user) {
    return null;
  }

  // 加油包购买是当场动作，不是桌面杂务：积分见底的店主正卡在创作里，工作台的
  // 可用积分胶囊与顶栏积分入口都指向这里。墙只为它开一条缝，其余设置照旧接力。
  const relayOnMobile =
    isMobile &&
    mode !== 'product' &&
    !isMobileReachableSettingsSurface(location.pathname, location.search);

  if (relayOnMobile) {
    return <DesktopRelayPage mode={mode} />;
  }

  const shell = (
    <Sidebar.Provider
      className="meiye-heroui-glass meiye-product-shell"
      collapsible="icon"
      data-shell-mode={mode}
      style={
        {
          '--header-height': 'calc(var(--spacing) * 12)',
        } as React.CSSProperties
      }
      variant="floating"
    >
      <a
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          const target = document.getElementById('main-content');
          target?.focus();
          target?.scrollIntoView({ block: 'start' });
          window.history.replaceState(null, '', '#main-content');
        }}
        className="fixed top-2 left-2 z-[100] -translate-y-20 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow focus:translate-y-0"
      >
        {sidebar_skip_to_content()}
      </a>
      {!isMobile ? <DashboardSidebar mode={mode} user={session.user} /> : null}
      <Sidebar.Main
        id="main-content"
        tabIndex={-1}
        className={
          isMobile
            ? 'min-w-0 bg-surface-0 pb-[calc(5.25rem+env(safe-area-inset-bottom))] outline-none'
            : 'min-w-0 bg-surface-0 outline-none'
        }
      >
        {children}
      </Sidebar.Main>
      {mode === 'product' && isMobile ? (
        <AsyncTaskCenter isMobile={isMobile} userId={session.user.id} />
      ) : null}
      {mode === 'product' && isMobile ? <ProductMobileNav /> : null}
    </Sidebar.Provider>
  );
  return mode === 'product' ? (
    <GlobalCommandProvider>{shell}</GlobalCommandProvider>
  ) : (
    shell
  );
}

/**
 * Pre-composed layout for route files: SidebarLayout + Outlet.
 * Use as `component: SidebarLayoutPage` in route definitions.
 */
export function ProductShellPage() {
  return (
    <SidebarLayout mode="product">
      <Outlet />
    </SidebarLayout>
  );
}

/*
 * `SettingsShellPage` / `AdminShellPage` 曾是这里的另外两个导出，没有任何路由
 * 引用它们：/settings 直接组合 `SidebarLayout`（它要在 Outlet 外面再包一层
 * 密度调整），/admin 自 D-130 起走 `components/admin/shell/admin-dashboard-shell`。
 * S7 换壳一并撤掉，壳的入口只留 ProductShellPage 一个。
 */
