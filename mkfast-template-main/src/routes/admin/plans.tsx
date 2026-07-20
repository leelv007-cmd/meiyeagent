import { CapabilityDrilldownBanner } from '@/components/admin/capability/capability-drilldown-banner';
import { AdminRoutePage } from '@/components/admin/admin-route-page';
import { AdminPlanControl } from '@/p1/admin-plan-control';
import { createFileRoute } from '@tanstack/react-router';
import {
  admin_plans_description,
  admin_plans_title,
} from '@/locale/paraglide/messages';

export const Route = createFileRoute('/admin/plans')({ component: PlansPage });

export function PlansPage() {
  return (
    <AdminRoutePage
      title={admin_plans_title()}
      description={admin_plans_description()}
    >
      <div className="space-y-4">
        <CapabilityDrilldownBanner pageId="plans" />
        <AdminPlanControl />
      </div>
    </AdminRoutePage>
  );
}
