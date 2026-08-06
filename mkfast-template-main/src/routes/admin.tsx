import { AdminDashboardShell } from '@/components/admin/shell/admin-dashboard-shell';
import { adminRouteMiddleware } from '@/middlewares/admin-middleware';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/admin')({
  ssr: false,
  component: AdminDashboardShell,
  server: {
    middleware: [adminRouteMiddleware],
  },
});
