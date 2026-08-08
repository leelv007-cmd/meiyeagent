import { AdminRoutePage } from '@/components/admin/admin-route-page';
import {
  admin_ops_console_description,
  admin_ops_console_title,
} from '@/locale/paraglide/messages';
import { AdminOpsConsoleControl } from '@/p1/admin-ops-console-control';
import { createFileRoute } from '@tanstack/react-router';

/**
 * V31-22 / V3.1-H: platform ops control plane inside existing admin shell.
 * Release desk + Tool Policy + Kill Switch + audit. No second backoffice.
 */
export const Route = createFileRoute('/admin/ops-console')({
  component: OpsConsolePage,
});

function OpsConsolePage() {
  return (
    <AdminRoutePage
      title={admin_ops_console_title()}
      description={admin_ops_console_description()}
    >
      <AdminOpsConsoleControl />
    </AdminRoutePage>
  );
}
