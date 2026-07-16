import { AdminRoutePage } from '@/components/admin/admin-route-page';
import { AdminModelControl } from '@/p1/admin-model-control';
import { AdminRuntimeConfigControl } from '@/p1/admin-runtime-config-control';
import { createFileRoute } from '@tanstack/react-router';
import { m } from '@/locale/paraglide/messages';

export const Route = createFileRoute('/admin/models')({
  component: ModelsPage,
});

export function ModelsPage() {
  return (
    <AdminRoutePage
      title={m.admin_models_title()}
      description={m.admin_models_description()}
    >
      <div className="space-y-8">
        <AdminRuntimeConfigControl
          keys={[
            'model.execution.mode',
            'model.media.execution.mode',
            'byok.adapter.assembly',
            'douyin.adapter.assembly',
          ]}
        />
        <AdminModelControl />
      </div>
    </AdminRoutePage>
  );
}
