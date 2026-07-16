import { AdminRoutePage } from '@/components/admin/admin-route-page';
import { AdminTemplateControl } from '@/p1/admin-template-control';
import { createFileRoute } from '@tanstack/react-router';
import { m } from '@/locale/paraglide/messages';

export const Route = createFileRoute('/admin/templates')({
  component: TemplatesPage,
});

function TemplatesPage() {
  return (
    <AdminRoutePage
      title={m.admin_templates_title()}
      description={m.admin_templates_description()}
    >
      <AdminTemplateControl />
    </AdminRoutePage>
  );
}
