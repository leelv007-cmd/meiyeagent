import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { IntegrationSettings } from '@/p1/integration-settings';
import { createFileRoute } from '@tanstack/react-router';
import { m } from '@/locale/paraglide/messages';

export const Route = createFileRoute('/settings/connections')({
  component: ConnectionsPage,
});

function ConnectionsPage() {
  return (
    <DashboardLayout
      breadcrumbs={[
        { label: m.settings_title(), isCurrentPage: false },
        { label: m.settings_navigation_connections(), isCurrentPage: true },
      ]}
      title={m.settings_navigation_connections()}
      description={m.settings_connections_description()}
    >
      <IntegrationSettings />
    </DashboardLayout>
  );
}
