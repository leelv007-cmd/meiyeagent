/**
 * 运营后台外壳 — ReUI 模板壳（surge-commerce 骨架），取代 HeroUI Pro 壳。
 *
 * 选型记录见 docs/design/admin-reui-restyle-plan-2026-08-06.md：admin 面退役
 * HeroUI Pro（D-130 在 admin 面由该方案覆盖），商家壳与 heroui-pro 目录不动。
 * 结构 = Header 全宽在上（sticky, --header-height）+ Sidebar 在下
 * （collapsible=icon, 按 D2 六域分组）+ SidebarInset。导航词表仍以
 * `sidebar-config` 为单一来源，分组由 ADMIN_NAV_GROUPS 排布。
 */
import { authClient } from '@/auth/client';
import { DesktopRelayPage } from '@/components/layout/desktop-relay-page';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Spinner } from '@/components/ui/spinner';
import { ADMIN_NAV_GROUPS, ADMIN_UTILITY_ITEM } from '@/config/sidebar-config';
import { useIsMobile } from '@/hooks/use-mobile';
import { Routes } from '@/lib/routes';
import { parseExceptionHomeUrlState } from '@/p1/admin-exception-home-model';
import {
  common_loading,
  shell_admin_brand,
  shell_admin_navigation_aria,
  shell_return_workbench,
  sidebar_skip_to_content,
} from '@/locale/paraglide/messages';
import { IconArrowBackUp } from '@tabler/icons-react';
import {
  Link,
  Outlet,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router';
import { useEffect } from 'react';
import { AdminBreadcrumbs } from './admin-breadcrumbs';
import { AdminCommandPalette } from './admin-command-palette';
import { AdminNotificationsPopover } from './admin-notifications-popover';
import { AdminOperationsTodoPopover } from './admin-operations-todo-popover';
import { AdminShellUser } from './admin-shell-user';
import { activeAdminNavHref, canonicalPath } from './nav-active';
import { RecordCrumbProvider } from './page-crumb';

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

  const activeHref = activeAdminNavHref(canonicalPath(pathname));

  return (
    <RecordCrumbProvider>
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

      <SidebarProvider
        className="flex flex-col [--sidebar:var(--color-background)] [--sidebar-accent:color-mix(in_oklab,var(--color-primary)_5%,transparent)] [--sidebar-accent-foreground:var(--color-primary)]"
        style={
          {
            '--sidebar-width': '260px',
            '--sidebar-width-icon': '62px',
            '--header-height': '50px',
          } as React.CSSProperties
        }
      >
        <header className="border-border bg-background sticky top-0 z-50 flex h-(--header-height) shrink-0 items-center gap-3 border-b px-4">
          <SidebarTrigger />
          <span className="text-foreground text-sm font-semibold whitespace-nowrap">
            {shell_admin_brand()}
          </span>
          <div className="bg-border h-4 w-px shrink-0" />
          <AdminBreadcrumbs />
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <AdminOperationsTodoPopover />
            <AdminNotificationsPopover />
          </div>
          <AdminCommandPalette />
        </header>

        <div className="flex flex-1">
          <Sidebar
            collapsible="icon"
            className="top-(--header-height) h-[calc(100svh-var(--header-height))]!"
          >
            <SidebarContent aria-label={shell_admin_navigation_aria()}>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        isActive={ADMIN_UTILITY_ITEM.href === activeHref}
                        tooltip={ADMIN_UTILITY_ITEM.label}
                        render={
                          <Link
                            to={ADMIN_UTILITY_ITEM.href}
                            search={parseExceptionHomeUrlState({})}
                          />
                        }
                      >
                        <ADMIN_UTILITY_ITEM.icon />
                        <span>{ADMIN_UTILITY_ITEM.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>

              {ADMIN_NAV_GROUPS.map((group) => (
                <SidebarGroup key={group.id}>
                  <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {group.items.map((item) => (
                        <SidebarMenuItem key={item.id}>
                          <SidebarMenuButton
                            isActive={item.href === activeHref}
                            tooltip={item.label}
                            render={<Link to={item.href} />}
                          >
                            <item.icon />
                            <span>{item.label}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              ))}
            </SidebarContent>

            <SidebarFooter>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip={shell_return_workbench()}
                    render={<Link to={Routes.Dashboard} />}
                  >
                    <IconArrowBackUp />
                    <span>{shell_return_workbench()}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
              <AdminShellUser user={session.user} />
            </SidebarFooter>
          </Sidebar>

          <SidebarInset className="min-w-0">
            <div className="outline-none" id="main-content" tabIndex={-1}>
              <div className="mx-auto w-full max-w-7xl p-4 md:p-6">
                <Outlet />
              </div>
            </div>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </RecordCrumbProvider>
  );
}
