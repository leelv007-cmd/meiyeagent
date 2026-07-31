import { CapabilityDrilldownBanner } from '@/components/admin/capability/capability-drilldown-banner';
import { AdminRoutePage } from '@/components/admin/admin-route-page';
import {
  admin_integrations_description,
  admin_integrations_title,
} from '@/locale/paraglide/messages';
import { AdminFeishuToolControl } from '@/p1/admin-feishu-tool-control';
import { AdminProviderCredentialControl } from '@/p1/admin-provider-credential-control';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/admin/integrations')({
  component: IntegrationsPage,
});

function IntegrationsPage() {
  return (
    <AdminRoutePage
      title={admin_integrations_title()}
      description={admin_integrations_description()}
    >
      <div className="space-y-6">
        <CapabilityDrilldownBanner pageId="integrations" />
        <AdminProviderCredentialControl />
        <AdminFeishuToolControl />
      </div>
    </AdminRoutePage>
  );
}
