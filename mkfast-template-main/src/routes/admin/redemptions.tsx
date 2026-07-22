import { CapabilityDrilldownBanner } from '@/components/admin/capability/capability-drilldown-banner';
import { AdminRoutePage } from '@/components/admin/admin-route-page';
import {
  admin_redemption_description,
  admin_redemption_title,
} from '@/locale/paraglide/messages';
import { AdminRedemptionControl } from '@/p1/admin-redemption-control';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/admin/redemptions')({
  component: RedemptionsPage,
});

function RedemptionsPage() {
  return (
    <AdminRoutePage
      title={admin_redemption_title()}
      description={admin_redemption_description()}
    >
      <div className="space-y-4">
        <CapabilityDrilldownBanner pageId="redemptions" />
        <AdminRedemptionControl />
      </div>
    </AdminRoutePage>
  );
}
