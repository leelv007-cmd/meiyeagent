import { CapabilityDrilldownBanner } from '@/components/admin/capability/capability-drilldown-banner';
import { AdminRoutePage } from '@/components/admin/admin-route-page';
import { AdminTemplateControl } from '@/p1/admin-template-control';
import { AdminCreationExperienceControl } from '@/p1/admin-creation-experience-control';
import { createFileRoute } from '@tanstack/react-router';
import {
  admin_templates_description,
  admin_templates_title,
} from '@/locale/paraglide/messages';

export const Route = createFileRoute('/admin/templates')({
  component: TemplatesPage,
});

function TemplatesPage() {
  return (
    <AdminRoutePage
      title={admin_templates_title()}
      description={admin_templates_description()}
    >
      <div className="space-y-4">
        <CapabilityDrilldownBanner pageId="templates" />
        <AdminCreationExperienceControl />
        <AdminTemplateControl />
      </div>
    </AdminRoutePage>
  );
}
