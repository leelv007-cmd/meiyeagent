import { AdminRoutePage } from '@/components/admin/admin-route-page';
import {
  admin_exception_home_description,
  admin_exception_home_title,
} from '@/locale/paraglide/messages';
import { AdminExceptionHome } from '@/p1/admin-exception-home';
import { createFileRoute } from '@tanstack/react-router';

/**
 * /admin default home = read-only exception-first list (J2 / D-055).
 * Admin domain exclusive — no longer redirects to models.
 * Shared sidebar default link remains models until Z2-WIRING batch B.
 */
export const Route = createFileRoute('/admin/')({
  component: AdminHomePage,
});

export function AdminHomePage() {
  return (
    <AdminRoutePage
      title={admin_exception_home_title()}
      description={admin_exception_home_description()}
    >
      <div className="space-y-4 text-sm [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm">
        <AdminExceptionHome />
      </div>
    </AdminRoutePage>
  );
}
