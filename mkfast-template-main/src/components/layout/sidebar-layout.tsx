import { DashboardSidebar } from '@/components/layout/dashboard-sidebar';
import { ProductMobileNav } from '@/components/product/mobile-nav';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { Spinner } from '@/components/ui/spinner';
import { authClient } from '@/auth/client';
import { Routes } from '@/lib/routes';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect, type ReactNode } from 'react';
import type { ShellMode } from '@/config/sidebar-config';
import { useIsMobile } from '@/hooks/use-mobile';
import { DesktopRelayPage } from '@/components/layout/desktop-relay-page';
import { AsyncTaskCenter } from '@/product/async-task-center';
import { GlobalCommandProvider } from '@/product/global-command-palette';
import { m } from '@/locale/paraglide/messages';

/**
 * Shared layout for /dashboard /settings and /admin routes
 * sidebar + auth guard (redirect to login if no session)
 * use with Outlet as children
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
        <span className="sr-only">{m.common_loading()}</span>
      </div>
    );
  }

  if (!session?.user) {
    return null;
  }

  if (isMobile && mode !== 'product') {
    return <DesktopRelayPage mode={mode} />;
  }

  const shell = (
    <SidebarProvider
      className="meiye-product-shell flex min-h-svh"
      style={
        {
          '--sidebar-width': 'calc(var(--spacing) * 72)',
          '--header-height': 'calc(var(--spacing) * 12)',
        } as React.CSSProperties
      }
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
        {m.sidebar_skip_to_content()}
      </a>
      {!isMobile ? (
        <DashboardSidebar mode={mode} user={session.user} variant="inset" />
      ) : null}
      <SidebarInset
        id="main-content"
        tabIndex={-1}
        className={
          isMobile
            ? 'min-w-0 bg-surface-0 pb-18 outline-none md:peer-data-[variant=inset]:rounded-none md:peer-data-[variant=inset]:shadow-none'
            : 'min-w-0 bg-surface-0 outline-none md:peer-data-[variant=inset]:rounded-none md:peer-data-[variant=inset]:shadow-none'
        }
      >
        {children}
      </SidebarInset>
      {mode === 'product' && isMobile ? (
        <AsyncTaskCenter isMobile={isMobile} userId={session.user.id} />
      ) : null}
      {mode === 'product' && isMobile ? <ProductMobileNav /> : null}
    </SidebarProvider>
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

export function SettingsShellPage() {
  return (
    <SidebarLayout mode="settings">
      <Outlet />
    </SidebarLayout>
  );
}

export function AdminShellPage() {
  return (
    <SidebarLayout mode="admin">
      <Outlet />
    </SidebarLayout>
  );
}
