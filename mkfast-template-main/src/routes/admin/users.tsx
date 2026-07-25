import { CapabilityDrilldownBanner } from '@/components/admin/capability/capability-drilldown-banner';
import { AdminRoutePage } from '@/components/admin/admin-route-page';
import {
  admin_users_description,
  admin_users_title,
} from '@/locale/paraglide/messages';
import { createFileRoute } from '@tanstack/react-router';
import { AdminUsersContent } from '@/components/admin/users/admin-users-content';

export const Route = createFileRoute('/admin/users')({
  component: AdminUsersPage,
});

/**
 * The one admin page that hand-rolled its own header instead of going through
 * AdminRoutePage: it mounted the merchant shell's DashboardHeader, whose
 * sidebar trigger reads the shadcn sidebar context. The template-dashboard
 * shell does not provide that context, so this page now goes through
 * AdminRoutePage like every other admin surface. Title and description are
 * unchanged, and so is the h1 the shell-route E2E looks for.
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
      </div>
    </AdminRoutePage>
  );
}
