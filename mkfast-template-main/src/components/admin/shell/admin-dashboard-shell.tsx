/**
 * 运营后台外壳 — HeroUI Pro V3 `template-dashboard` 起点（D-130 / dev spec §56）。
 *
 * 后台是运营内部面，视觉与商家前台分离：它不再走 `components/layout/sidebar-layout`
 * 的商家壳，而是自己组装 HeroUI Sidebar + Glass token 桥。共享壳（sidebar-layout /
 * dashboard-sidebar / sidebar-config）属于 /dashboard 与 /settings，本票一个字节不动，
 * 只以只读方式复用 `ADMIN_SIDEBAR_ITEMS` 的导航词表，导航文案与语言包保持单一来源。
 *
 * Glass 样式表由 `routes/admin.tsx` 以路由级 <link> 引入；token 桥的选择器是
 * `html:has(.meiye-heroui-glass)`，所以壳根必须带这个 class（见 heroui-pro/README.md）。
 */
import { authClient } from '@/auth/client';
import { Sidebar } from '@/components/heroui-pro';
import { DesktopRelayPage } from '@/components/layout/desktop-relay-page';
import { Spinner } from '@/components/ui/spinner';
import { ProductIcon } from '@/components/uiux/product-icon';
import {
  ADMIN_SIDEBAR_ITEMS,
  ADMIN_UTILITY_ITEM,
} from '@/config/sidebar-config';
import { useIsMobile } from '@/hooks/use-mobile';
import { Routes } from '@/lib/routes';
import {
  admin_shell_navigation_group,
  common_loading,
  shell_admin_brand,
  shell_admin_navigation_aria,
  shell_return_workbench,
  sidebar_skip_to_content,
} from '@/locale/paraglide/messages';
import { AdminShellUser } from './admin-shell-user';
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';

/** `/admin` 与 `/admin/` 视作同一项，避免尾斜杠让当前项落空。 */
function canonicalPath(value: string) {
  return value.replace(/\/$/, '') || '/';
}

/**
 * 异常收口首页不在 ADMIN_SIDEBAR_ITEMS 里，它由 ADMIN_UTILITY_ITEM 描述
 * （sidebar-config 已注明「Exception home (J2) is the admin shell entry」）。
 * 两个常量都只读复用，导航词表保持单一真相。
 */
const NAV_ITEMS = [ADMIN_UTILITY_ITEM, ...ADMIN_SIDEBAR_ITEMS] as const;

export function AdminDashboardShell() {
  const { data: session, isPending } = authClient.useSession();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  useEffect(() => {
    if (isPending) return;
    if (!session?.user) {
      navigate({ to: Routes.Login });
    }
  }, [session, isPending, navigate]);

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

  // 后台是桌面面：窄屏深链走既有的桌面接力页，与换壳前一致。
  if (isMobile) {
    return <DesktopRelayPage mode="admin" />;
  }

  const currentPath = canonicalPath(pathname);

  return (
    <div className="meiye-heroui-glass bg-background text-foreground min-h-svh">
      <a
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          const target = document.getElementById('main-content');
          target?.focus();
          target?.scrollIntoView({ block: 'start' });
          window.history.replaceState(null, '', '#main-content');
        }}
        className="bg-accent text-accent-foreground fixed top-2 left-2 z-[100] -translate-y-20 rounded-md px-3 py-2 text-sm font-semibold shadow focus:translate-y-0"
      >
        {sidebar_skip_to_content()}
      </a>

      <Sidebar.Provider
        className="min-h-svh"
        collapsible="icon"
        navigate={(href) => {
          void navigate({ to: href });
        }}
      >
        <Sidebar>
          <Sidebar.Header>
            <span className="text-foreground px-1 py-1 text-sm font-semibold">
              {shell_admin_brand()}
            </span>
          </Sidebar.Header>

          <Sidebar.Content>
            <Sidebar.Group aria-label={shell_admin_navigation_aria()}>
              <Sidebar.GroupLabel>
                {admin_shell_navigation_group()}
              </Sidebar.GroupLabel>
              <Sidebar.Menu>
                {NAV_ITEMS.map((item) => (
                  <Sidebar.MenuItem
                    href={item.href}
                    id={item.id}
                    isCurrent={canonicalPath(item.href) === currentPath}
                    key={item.id}
                  >
                    <Sidebar.MenuIcon>
                      <ProductIcon icon={item.icon} />
                    </Sidebar.MenuIcon>
                    <Sidebar.MenuLabel>{item.label}</Sidebar.MenuLabel>
                  </Sidebar.MenuItem>
                ))}
              </Sidebar.Menu>
            </Sidebar.Group>
          </Sidebar.Content>

          <Sidebar.Footer>
            <Sidebar.Menu>
              <Sidebar.MenuItem href={Routes.Dashboard} id="return-workbench">
                <Sidebar.MenuLabel>
                  {shell_return_workbench()}
                </Sidebar.MenuLabel>
              </Sidebar.MenuItem>
            </Sidebar.Menu>
            <AdminShellUser user={session.user} />
          </Sidebar.Footer>
          <Sidebar.Rail />
        </Sidebar>

        <Sidebar.Main className="min-w-0">
          <div className="border-border flex h-12 items-center gap-2 border-b px-4">
            <Sidebar.Trigger />
            <span className="text-muted text-xs">{shell_admin_brand()}</span>
          </div>
          <div className="outline-none" id="main-content" tabIndex={-1}>
            <Outlet />
          </div>
        </Sidebar.Main>
      </Sidebar.Provider>
    </div>
  );
}
