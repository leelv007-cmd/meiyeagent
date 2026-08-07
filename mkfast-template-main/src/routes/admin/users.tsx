import { CapabilityDrilldownBanner } from '@/components/admin/capability/capability-drilldown-banner';
import { AdminRoutePage } from '@/components/admin/admin-route-page';
import {
  admin_users_description,
  admin_users_title,
} from '@/locale/paraglide/messages';
import { createFileRoute, Outlet } from '@tanstack/react-router';
import { AdminUsersContent } from '@/components/admin/users/admin-users-content';

export const Route = createFileRoute('/admin/users')({
  component: AdminUsersPage,
});

/**
 * List layout keeps the grid mounted while the detail sheet (child route)
 * overlays via Outlet — filters, scroll, and selection survive open/close.
 * Title and description are unchanged, and so is the h1 the shell-route E2E
 * looks for.
 */
function AdminUsersPage() {
  return (
    <AdminRoutePage
      title={admin_users_title()}
      description={admin_users_description()}
    >
      <div className="space-y-4">
        <CapabilityDrilldownBanner pageId="users" />
        <AdminUsersContent />
        <Outlet />
      </div>
    </AdminRoutePage>
  );
}
