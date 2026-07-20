import { AdminRoutePage } from '@/components/admin/admin-route-page';
import { AdminSupplyControl } from '@/p1/admin-supply-control';
import {
  parseRunTableUrlState,
  type SupplyRunTableUrlState,
} from '@/p1/admin-supply-run-table-model';
import { createFileRoute } from '@tanstack/react-router';

/** Model supply & gateway control center (J4 / D-070). */
export const Route = createFileRoute('/admin/supply')({
  validateSearch: (search: Record<string, unknown>) =>
    parseRunTableUrlState(
      Object.fromEntries(
        Object.entries(search).map(([key, value]) => [
          key,
          typeof value === 'string' ? value : null,
        ])
      )
    ),
  component: RoutedSupplyControlCenterPage,
});

function RoutedSupplyControlCenterPage() {
  const navigate = Route.useNavigate();
  return (
    <SupplyControlCenterPage
      runTableState={Route.useSearch()}
      onRunTableStateChange={(search) => {
        void navigate({ search });
      }}
    />
  );
}

export function SupplyControlCenterPage({
  runTableState,
  onRunTableStateChange,
}: {
  runTableState?: SupplyRunTableUrlState;
  onRunTableStateChange?: (state: SupplyRunTableUrlState) => void;
} = {}) {
  return (
    <AdminRoutePage
      title="模型供应与网关控制中心"
      description="总览三模态 readiness / 双渠道覆盖 / 六实体关系 / 生效 revision / 运行表与任务下钻 / 五关联视图 / 权益池状态。外部网关 Console 仅作技术证据深链。"
    >
      <div className="space-y-4 text-sm [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm">
        <AdminSupplyControl
          runTableState={runTableState}
          onRunTableStateChange={onRunTableStateChange}
        />
      </div>
    </AdminRoutePage>
  );
}
