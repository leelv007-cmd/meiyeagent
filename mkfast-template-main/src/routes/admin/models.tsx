import { CapabilityDrilldownBanner } from '@/components/admin/capability/capability-drilldown-banner';
import { AdminRoutePage } from '@/components/admin/admin-route-page';
import { ModelAssemblyLayers } from '@/components/admin/models/model-assembly-layers';
import { AdminModelControl } from '@/p1/admin-model-control';
import { createFileRoute } from '@tanstack/react-router';
import {
  admin_models_description,
  admin_models_title,
} from '@/locale/paraglide/messages';

export const Route = createFileRoute('/admin/models')({
  component: ModelsPage,
});

/**
 * 模型装配面。两层（CatalogModel / ExecutionChannel）在 ModelAssemblyLayers 里
 * 分开呈现并各带自己的受控参数入口 —— 换壳前这八个键挤在一个平铺的配置表里，
 * 运营看不出哪个键属于哪一层（spec story 53）。
 */
function ModelsPage() {
  return (
    <AdminRoutePage
      title={admin_models_title()}
      description={admin_models_description()}
    >
      <div className="space-y-4 text-sm [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm">
        <CapabilityDrilldownBanner pageId="models" />
        <ModelAssemblyLayers />
        <AdminModelControl />
      </div>
    </AdminRoutePage>
  );
}
