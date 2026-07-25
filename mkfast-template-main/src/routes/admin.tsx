import { AdminDashboardShell } from '@/components/admin/shell/admin-dashboard-shell';
import heroUiGlassCss from '@/components/heroui-pro/heroui-glass.css?url';
import { adminRouteMiddleware } from '@/middlewares/admin-middleware';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/admin')({
  ssr: false,
  // Glass 样式表按路由引入（heroui-pro/README.md）：src/styles.css 与初始 CSS 包
  // 都不动，前台页面因此完全不受后台换壳影响。
  head: () => ({
    links: [{ rel: 'stylesheet', href: heroUiGlassCss }],
  }),
  component: AdminDashboardShell,
  server: {
    middleware: [adminRouteMiddleware],
  },
});
