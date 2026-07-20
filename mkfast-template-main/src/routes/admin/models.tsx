import { CapabilityDrilldownBanner } from '@/components/admin/capability/capability-drilldown-banner';
import { AdminRoutePage } from '@/components/admin/admin-route-page';
import { AdminModelControl } from '@/p1/admin-model-control';
import { AdminRuntimeConfigControl } from '@/p1/admin-runtime-config-control';
import { createFileRoute } from '@tanstack/react-router';
import {
  admin_models_description,
  admin_models_title,
} from '@/locale/paraglide/messages';

export const Route = createFileRoute('/admin/models')({
  component: ModelsPage,
});

export function ModelsPage() {
  return (
    <AdminRoutePage
      title={admin_models_title()}
      description={admin_models_description()}
    >
      <div className="space-y-4 text-sm [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm">
        <CapabilityDrilldownBanner pageId="models" />
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
