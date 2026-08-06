import { CapabilityDrilldownBanner } from '@/components/admin/capability/capability-drilldown-banner';
import { AdminRoutePage } from '@/components/admin/admin-route-page';
import { AdminOperationsPanels } from '@/components/admin/ops/admin-operations-panels';
import {
  admin_exception_home_description,
  admin_exception_home_title,
} from '@/locale/paraglide/messages';
import { AdminExceptionHome } from '@/p1/admin-exception-home';
import {
  exceptionHomeUrlStateFromSeverities,
  exceptionSeveritiesFromUrlState,
  parseExceptionHomeUrlState,
  type ExceptionHomeUrlState,
  type ExceptionSeverity,
} from '@/p1/admin-exception-home-model';
import { createFileRoute } from '@tanstack/react-router';

/**
 * /admin default home = read-only exception-first list (J2 / D-055).
 * Admin domain exclusive — no longer redirects to models.
 * Shared sidebar default link remains models until Z2-WIRING batch B.
 *
 * T35 lands the 运营可视化 band (用量 / 任务 / 租户, dev spec §56) above it;
 * the exception-first list stays this page's spine.
 *
 * #385: shareable `?exceptions=` is client-side projection only.
 */
export const Route = createFileRoute('/admin/')({
  validateSearch: (search: Record<string, unknown>): ExceptionHomeUrlState =>
    parseExceptionHomeUrlState(
      Object.fromEntries(
        Object.entries(search).map(([key, value]) => [
          key,
          typeof value === 'string' || typeof value === 'number'
            ? String(value)
            : null,
        ])
      )
    ),
  component: RoutedAdminHomePage,
});

function RoutedAdminHomePage() {
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  return (
    <AdminHomePage
      severityFilter={exceptionSeveritiesFromUrlState(search)}
      onSeverityFilterChange={(next) => {
        void navigate({
          search: exceptionHomeUrlStateFromSeverities(next),
          replace: true,
        });
      }}
    />
  );
}

function AdminHomePage({
  severityFilter,
  onSeverityFilterChange,
}: {
  severityFilter?: readonly ExceptionSeverity[];
  onSeverityFilterChange?: (next: readonly ExceptionSeverity[]) => void;
} = {}) {
  return (
    <AdminRoutePage
      title={admin_exception_home_title()}
      description={admin_exception_home_description()}
    >
      <div className="space-y-4 text-sm [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm">
        <CapabilityDrilldownBanner pageId="index" />
        <AdminOperationsPanels />
        <AdminExceptionHome
          severityFilter={severityFilter}
          onSeverityFilterChange={onSeverityFilterChange}
        />
      </div>
    </AdminRoutePage>
  );
}
