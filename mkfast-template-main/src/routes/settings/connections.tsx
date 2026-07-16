import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { IntegrationSettings } from '@/p1/integration-settings';
import { createFileRoute } from '@tanstack/react-router';
import {
  settings_connections_description,
  settings_navigation_connections,
  settings_title,
} from '@/locale/paraglide/messages';

export const Route = createFileRoute('/settings/connections')({
  component: ConnectionsPage,
});

function ConnectionsPage() {
  return (
    <DashboardLayout
      breadcrumbs={[
        { label: settings_title(), isCurrentPage: false },
        { label: settings_navigation_connections(), isCurrentPage: true },
      ]}
      title={settings_navigation_connections()}
      description={settings_connections_description()}
    >
      <IntegrationSettings />
    </DashboardLayout>
  );
}
