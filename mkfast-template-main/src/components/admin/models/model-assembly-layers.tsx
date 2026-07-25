/**
 * 模型装配的两层呈现（spec story 53 / 票面验收③）。
 *
 * 文本模型供给目录（CatalogModel）与图/视频执行通道（ExecutionChannel）在领域上
 * 是两层：换一个默认文本型号跟切一条执行通道是两件事，之前它们挤在同一张卡里
 * 按 operation 混排，运营看不出边界也没法分别下手。这里把两层拆开呈现，
 * 每层各自带自己的受控参数入口，因此可分别操作。
 *
 * 两层都只读 `model-supply` 快照（真投影，不是 fixture），写一律经
 * `AdminRuntimeConfigControl` 的 admin-config 受控端点（CAS + 审计 + 回滚），
 * 本组件不碰任何配置存储。
 */
import {
  AdminPanel,
  AdminPanelContent,
  AdminPanelDescription,
  AdminPanelHeader,
  AdminPanelTitle,
  AdminStatusChip,
} from '@/components/admin/shell/admin-panel';
import { ListView } from '@/components/heroui-pro';
import {
  admin_models_catalog_layer_description,
  admin_models_catalog_layer_title,
  admin_models_channel_layer_description,
  admin_models_channel_layer_title,
  admin_ops_empty,
  admin_ops_error,
  admin_ops_loading,
} from '@/locale/paraglide/messages';
import { AdminRuntimeConfigControl } from '@/p1/admin-runtime-config-control';
import { useAdminSupplyControlSnapshot } from '@/p1/use-admin-supply-control';
import type { ReactNode } from 'react';

/**
 * 目录层的受控参数＝平台默认型号（D-129：默认 DeepSeek，型号运营可换）。
 * 通道层的受控参数＝执行模式与适配装配，两组刻意不交叉。
 */
const CATALOG_LAYER_KEYS = [
  'platform.defaultModel.copy',
  'platform.defaultModel.image',
  'platform.defaultModel.video',
  'platform.defaultModel.audio',
] as const;

const CHANNEL_LAYER_KEYS = [
  'model.execution.mode',
  'model.media.execution.mode',
  'byok.adapter.assembly',
  'douyin.adapter.assembly',
] as const;

function LayerBody({
  children,
  isEmpty,
  isError,
  isLoading,
  testId,
}: {
  children: ReactNode;
  isEmpty: boolean;
  isError: boolean;
  isLoading: boolean;
  testId: string;
}) {
  if (isLoading) {
    return (
      <output className="text-muted text-sm" data-testid={`${testId}-loading`}>
        {admin_ops_loading()}
      </output>
    );
  }
  if (isError) {
    return (
      <p
        className="text-danger text-sm"
        data-testid={`${testId}-error`}
        role="alert"
      >
        {admin_ops_error()}
      </p>
    );
  }
  if (isEmpty) {
    return (
      <p className="text-muted text-sm" data-testid={`${testId}-empty`}>
        {admin_ops_empty()}
      </p>
    );
  }
  return <>{children}</>;
}

export function ModelAssemblyLayers() {
  const snapshotQuery = useAdminSupplyControlSnapshot();
  const snapshot = snapshotQuery.data;
  const models = snapshot?.models ?? [];
  const channels = snapshot?.executionChannels ?? [];
  const isLoading = snapshotQuery.isPending;
  const isError = Boolean(snapshotQuery.error);

  return (
    <div className="space-y-4" data-testid="admin-model-assembly-layers">
      <AdminPanel data-testid="admin-models-catalog-layer">
        <AdminPanelHeader>
          <AdminPanelTitle>
            {admin_models_catalog_layer_title()}
          </AdminPanelTitle>
          <AdminPanelDescription>
            {admin_models_catalog_layer_description()}
          </AdminPanelDescription>
        </AdminPanelHeader>
        <AdminPanelContent className="space-y-4">
          <LayerBody
            isEmpty={models.length === 0}
            isError={isError}
            isLoading={isLoading}
            testId="admin-models-catalog-layer"
          >
            <ListView aria-label={admin_models_catalog_layer_title()}>
              {models.map((model) => (
                <ListView.Item
                  data-testid="admin-models-catalog-row"
                  id={model.id}
                  key={model.id}
                >
                  <ListView.ItemContent>
                    <ListView.Title>{model.displayName}</ListView.Title>
                    <ListView.Description>
                      {[
                        model.manufacturer,
                        model.stableModelName,
                        model.version,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </ListView.Description>
                  </ListView.ItemContent>
                  <ListView.ItemAction>
                    <AdminStatusChip variant="outline">
                      {model.modality}
                    </AdminStatusChip>
                  </ListView.ItemAction>
                </ListView.Item>
              ))}
            </ListView>
          </LayerBody>
          <AdminRuntimeConfigControl keys={[...CATALOG_LAYER_KEYS]} />
        </AdminPanelContent>
      </AdminPanel>

      <AdminPanel data-testid="admin-models-channel-layer">
        <AdminPanelHeader>
          <AdminPanelTitle>
            {admin_models_channel_layer_title()}
          </AdminPanelTitle>
          <AdminPanelDescription>
            {admin_models_channel_layer_description()}
          </AdminPanelDescription>
        </AdminPanelHeader>
        <AdminPanelContent className="space-y-4">
          <LayerBody
            isEmpty={channels.length === 0}
            isError={isError}
            isLoading={isLoading}
            testId="admin-models-channel-layer"
          >
            <ListView aria-label={admin_models_channel_layer_title()}>
              {channels.map((channel) => (
                <ListView.Item
                  data-testid="admin-models-channel-row"
                  id={channel.id}
                  key={channel.id}
                >
                  <ListView.ItemContent>
                    <ListView.Title>{channel.id}</ListView.Title>
                    <ListView.Description>
                      {[
                        channel.region,
                        channel.accountOwnership,
                        channel.protocolFamily,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </ListView.Description>
                  </ListView.ItemContent>
                  <ListView.ItemAction>
                    <AdminStatusChip variant="outline">
                      {channel.kind}
                    </AdminStatusChip>
                  </ListView.ItemAction>
                </ListView.Item>
              ))}
            </ListView>
          </LayerBody>
          <AdminRuntimeConfigControl keys={[...CHANNEL_LAYER_KEYS]} />
        </AdminPanelContent>
      </AdminPanel>
    </div>
  );
}
