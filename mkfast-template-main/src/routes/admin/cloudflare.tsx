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

export function CloudflarePage() {
  return (
    <AdminRoutePage
      title={admin_cloudflare_title()}
      description={admin_cloudflare_description()}
    >
      <AdminCloudflareControl />
    </AdminRoutePage>
  );
}
