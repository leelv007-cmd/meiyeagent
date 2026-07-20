import { AdminRoutePage } from '@/components/admin/admin-route-page';
import { AdminCapabilityCatalog } from '@/p1/admin-capability-catalog';
import { AdminCapabilityRegistry } from '@/p1/admin-capability-registry';
import { createFileRoute } from '@tanstack/react-router';

/**
 * Capability catalog + registry admin route (J1 skeleton + J3 two-level IA).
 *
 * Shared wiring (lib/routes.ts / sidebar / locales / routeTree.gen.ts) is
 * intentionally NOT modified here — see
 * `src/components/admin/capability/WIRING-DIFF.md` for Z2-WIRING batch B.
 */
// Path not yet registered in routeTree.gen.ts (Z2-WIRING batch B).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = (createFileRoute as any)('/admin/capabilities')({
  component: CapabilitiesPage,
});

export function CapabilitiesPage() {
  return (
    <AdminRoutePage
      title="能力目录"
      description="两层信息架构：一级=能力域（功能/用户影响）；二级=技术依赖与证据下钻。现有七个管理页按能力域编组，不再是孤岛。"
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
