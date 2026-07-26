import { AdminRoutePage } from '@/components/admin/admin-route-page';
import { AdminOperationsPanels } from '@/components/admin/ops/admin-operations-panels';
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
 *
 * T35 lands the 运营可视化 band (用量 / 任务 / 租户, dev spec §56) above it;
 * the exception-first list stays this page's spine.
 */
export const Route = createFileRoute('/admin/')({
  component: AdminHomePage,
});

function AdminHomePage() {
  return (
    <AdminRoutePage
      title={admin_exception_home_title()}
      description={admin_exception_home_description()}
    >
      <AdminOperationsPanels />
      <div className="space-y-4 text-sm [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm">
        <AdminExceptionHome />
      </div>
    </AdminRoutePage>
  );
}
