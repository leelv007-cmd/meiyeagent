import { AdminRoutePage } from '@/components/admin/admin-route-page';
import { AdminPlanControl } from '@/p1/admin-plan-control';
import { createFileRoute } from '@tanstack/react-router';
import {
  admin_plans_description,
  admin_plans_title,
} from '@/locale/paraglide/messages';

export const Route = createFileRoute('/admin/plans')({ component: PlansPage });

function PlansPage() {
  return (
    <AdminRoutePage
      title={admin_plans_title()}
      description={admin_plans_description()}
    >
      <AdminPlanControl />
    </AdminRoutePage>
  );
}
