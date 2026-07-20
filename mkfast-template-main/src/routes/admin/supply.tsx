import { AdminRoutePage } from '@/components/admin/admin-route-page';
import { AdminSupplyControl } from '@/p1/admin-supply-control';
import { createFileRoute } from '@tanstack/react-router';

/**
 * Model supply & gateway control center (J4 / D-070).
 *
 * Shared wiring (lib/routes.ts / sidebar / locales / routeTree.gen.ts) is
 * intentionally NOT modified here — see
 * `src/components/admin/supply/WIRING-DIFF.md` for Z2-WIRING batch B.
 */
export const Route = createFileRoute('/admin/supply')({
  component: SupplyControlCenterPage,
});

export function SupplyControlCenterPage() {
  return (
    <AdminRoutePage
      title="模型供应与网关控制中心"
      description="总览三模态 readiness / 双渠道覆盖 / 六实体关系 / 生效 revision / 运行表与任务下钻 / 五关联视图 / 权益池状态。外部网关 Console 仅作技术证据深链。"
    >
      <div className="space-y-4 text-sm [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm">
        <AdminSupplyControl />
      </div>
    </AdminRoutePage>
  );
}
