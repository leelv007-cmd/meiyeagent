import { AdminRoutePage } from '@/components/admin/admin-route-page';
import { AdminSkillsControl } from '@/p1/admin-skills-control';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/admin/skills')({
  component: SkillsPage,
});

function SkillsPage() {
  return (
    <AdminRoutePage
      title="Skills"
      description="定义、受理冻结、绑定与回滚产品 Skill 版本。"
    >
      <AdminSkillsControl />
    </AdminRoutePage>
  );
}
