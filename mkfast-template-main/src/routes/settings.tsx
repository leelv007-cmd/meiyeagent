import heroUiGlassCss from '@/components/heroui-pro/heroui-glass.css?url';
import { SidebarLayout } from '@/components/layout/sidebar-layout';
import { authRouteMiddleware } from '@/middlewares/auth-middleware';
import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/settings')({
  ssr: false,
  // S7 / U07：/settings 换壳前一条路由都没引 Glass 表（只有 /admin 与八条
  // /dashboard/*）。侧栏本体现在由这张表供给，缺它就是一副裸 Pro Sidebar。
  head: () => ({
    links: [{ rel: 'stylesheet', href: heroUiGlassCss }],
  }),
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
