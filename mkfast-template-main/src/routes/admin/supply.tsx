import { AdminRoutePage } from '@/components/admin/admin-route-page';
import {
  admin_supply_description,
  admin_supply_title,
} from '@/locale/paraglide/messages';
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
          typeof value === 'string' || typeof value === 'number'
            ? String(value)
            : null,
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
      title={admin_supply_title()}
      description={admin_supply_description()}
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
