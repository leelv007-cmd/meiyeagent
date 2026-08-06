import { CapabilityDrilldownBanner } from '@/components/admin/capability/capability-drilldown-banner';
import { AdminRoutePage } from '@/components/admin/admin-route-page';
import {
  admin_cloudflare_description,
  admin_cloudflare_title,
} from '@/locale/paraglide/messages';
import { AdminCloudflareControl } from '@/p1/admin-cloudflare-control';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/admin/cloudflare')({
  component: CloudflarePage,
});

function CloudflarePage() {
  return (
    <AdminRoutePage
      title={admin_cloudflare_title()}
      description={admin_cloudflare_description()}
    >
      <div className="space-y-4 text-sm [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm">
        <CapabilityDrilldownBanner pageId="cloudflare" />
        <AdminCloudflareControl />
      </div>
    </AdminRoutePage>
  );
}
