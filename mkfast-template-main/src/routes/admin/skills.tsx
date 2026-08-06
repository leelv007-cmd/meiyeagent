import { CapabilityDrilldownBanner } from '@/components/admin/capability/capability-drilldown-banner';
import { AdminRoutePage } from '@/components/admin/admin-route-page';
import {
  admin_skills_description,
  admin_skills_title,
} from '@/locale/paraglide/messages';
import { AdminSkillsControl } from '@/p1/admin-skills-control';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/admin/skills')({
  component: SkillsPage,
});

function SkillsPage() {
  return (
    <AdminRoutePage
      title={admin_skills_title()}
      description={admin_skills_description()}
    >
      <div className="space-y-4">
        <CapabilityDrilldownBanner pageId="skills" />
        <AdminSkillsControl />
      </div>
    </AdminRoutePage>
  );
}
