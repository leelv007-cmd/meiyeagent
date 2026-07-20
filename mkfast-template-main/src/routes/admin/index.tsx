import { AdminRoutePage } from '@/components/admin/admin-route-page';
import { AdminExceptionHome } from '@/p1/admin-exception-home';
import { createFileRoute } from '@tanstack/react-router';

/**
 * /admin default home = read-only exception-first list (J2 / D-055).
 * Admin domain exclusive — no longer redirects to models.
 * Shared sidebar default link remains models until Z2-WIRING batch B.
 */
export const Route = createFileRoute('/admin/')({
  component: AdminHomePage,
});

export function AdminHomePage() {
  return (
    <AdminRoutePage
      title="异常优先首页"
      description="只读聚合 blocked / degraded / attention / not_verified / 长时间 stale；同源去重；无确认/指派工作流。无异常时展示全景摘要与能力目录入口。"
    >
      <div className="space-y-4 text-sm [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm">
        <AdminExceptionHome />
      </div>
    </AdminRoutePage>
  );
}
