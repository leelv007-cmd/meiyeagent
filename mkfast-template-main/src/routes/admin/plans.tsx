import { AdminRoutePage } from '@/components/admin/admin-route-page';
import { AdminPlanControl } from '@/p1/admin-plan-control';
import { createFileRoute } from '@tanstack/react-router';
import { m } from '@/locale/paraglide/messages';

export const Route = createFileRoute('/admin/plans')({ component: PlansPage });

function PlansPage() {
  return (
    <AdminRoutePage
      title={m.admin_plans_title()}
      description={m.admin_plans_description()}
    >
      <AdminPlanControl />
    </AdminRoutePage>
  );
}
