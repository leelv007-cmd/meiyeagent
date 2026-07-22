import { AdminRoutePage } from '@/components/admin/admin-route-page';
import {
  admin_capabilities_description,
  admin_capabilities_title,
} from '@/locale/paraglide/messages';
import { AdminCapabilityCatalog } from '@/p1/admin-capability-catalog';
import { AdminCapabilityRegistry } from '@/p1/admin-capability-registry';
import { createFileRoute } from '@tanstack/react-router';

/**
 * Capability catalog + registry admin route (J1 skeleton + J3 two-level IA).
 * Shared wiring (routes/sidebar/locales/routeTree) landed in Z2-WIRING batch B.
 */
export const Route = createFileRoute('/admin/capabilities')({
  component: CapabilitiesPage,
});

function CapabilitiesPage() {
  return (
    <AdminRoutePage
      title={admin_capabilities_title()}
      description={admin_capabilities_description()}
    >
      <div className="space-y-8 text-sm [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm">
        <AdminCapabilityCatalog />
        <section
          className="space-y-4 border-t pt-6"
          data-testid="capability-registry-section"
        >
          <h2 className="text-base font-semibold">能力注册表 · 六问详情</h2>
          <AdminCapabilityRegistry />
        </section>
      </div>
    </AdminRoutePage>
  );
}
