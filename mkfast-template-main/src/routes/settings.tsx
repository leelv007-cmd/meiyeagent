import { SidebarLayout } from '@/components/layout/sidebar-layout';
import { authRouteMiddleware } from '@/middlewares/auth-middleware';
import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/settings')({
  ssr: false,
  component: SettingsRouteLayout,
  server: {
    middleware: [authRouteMiddleware],
  },
});

function SettingsRouteLayout() {
  return (
    <SidebarLayout mode="settings">
      <div className="min-w-0 flex-1 [&_.lg\:gap-6]:lg:gap-5 [&_.lg\:px-6]:lg:px-5 [&_.lg\:py-6]:lg:py-5">
        <Outlet />
      </div>
    </SidebarLayout>
  );
}
