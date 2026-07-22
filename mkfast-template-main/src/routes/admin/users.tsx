import { CapabilityDrilldownBanner } from '@/components/admin/capability/capability-drilldown-banner';
import {
  admin_title,
  admin_users_description,
  admin_users_title,
} from '@/locale/paraglide/messages';
import { createFileRoute } from '@tanstack/react-router';
import { DashboardHeader } from '@/components/layout/dashboard-header';
import { AdminUsersContent } from '@/components/admin/users/admin-users-content';

export const Route = createFileRoute('/admin/users')({
  component: AdminUsersPage,
});

function AdminUsersPage() {
  const breadcrumbs = [
    { label: admin_title(), isCurrentPage: false },
    { label: admin_users_title(), isCurrentPage: true },
  ];
  return (
    <>
      <DashboardHeader breadcrumbs={breadcrumbs} />
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-4 py-4 lg:gap-6 lg:py-6">
            <div className="px-4 lg:px-6">
              <div className="mb-6">
                <h1 className="text-2xl font-semibold tracking-tight">
                  {admin_users_title()}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {admin_users_description()}
                </p>
              </div>
              <div className="space-y-4">
                <CapabilityDrilldownBanner pageId="users" />
                <AdminUsersContent />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
