import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { integration_load_error } from '@/locale/paraglide/messages';
import { commandP1, queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import {
  normalizeConnections,
  normalizeDouyinContentSnapshots,
  normalizeDouyinIntegrationStatus,
  normalizeDouyinOperationsSnapshot,
  normalizeFeishuActivity,
  normalizeFeishuPendingIntents,
  normalizeFeishuRecoveryIntents,
  normalizeFeishuShortcuts,
  normalizeFeishuTools,
  normalizeIntegrationAudit,
  type DouyinOperationsSnapshotView,
  type FeishuActivityView,
  type FeishuPendingIntentView,
  type FeishuRecoveryIntentView,
  type FeishuShortcutView,
  type FeishuToolView,
  type IntegrationConnectionView,
} from '@/p1/settings-view-model';

export interface FeishuProductState {
  activities: FeishuActivityView[];
  pendingIntents: FeishuPendingIntentView[];
  recoveryIntents: FeishuRecoveryIntentView[];
  shortcuts: FeishuShortcutView[];
  tools: FeishuToolView[];
}

interface IntegrationCommandRequest {
  action: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
}

async function loadFeishuProducts(
  connections: IntegrationConnectionView[],
  signal: AbortSignal
) {
  const entries = await Promise.all(
    connections.map(async (connection) => {
      const [tools, shortcuts, activities, pendingIntents, recoveryIntents] =
        await Promise.all([
          queryP1<unknown>(
            'integrations',
            {
              action: 'feishu_tool_catalog',
              payload: { connectionId: connection.id },
            },
            signal
          ),
          queryP1<unknown>(
            'integrations',
            {
              action: 'feishu_shortcuts',
              payload: { connectionId: connection.id },
            },
            signal
          ),
          queryP1<unknown>(
            'integrations',
            {
              action: 'feishu_activity',
              payload: { connectionId: connection.id },
            },
            signal
          ),
          queryP1<unknown>(
            'integrations',
            {
              action: 'feishu_pending_intents',
              payload: { connectionId: connection.id },
            },
            signal
          ),
          queryP1<unknown>(
            'integrations',
            {
              action: 'feishu_intent_recovery',
              payload: { connectionId: connection.id },
            },
            signal
          ),
        ]);
      return [
        connection.id,
        {
          activities: normalizeFeishuActivity(activities),
          pendingIntents: normalizeFeishuPendingIntents(pendingIntents),
          recoveryIntents: normalizeFeishuRecoveryIntents(recoveryIntents),
          shortcuts: normalizeFeishuShortcuts(shortcuts),
          tools: normalizeFeishuTools(tools),
        },
      ] as const;
    })
  );
  return Object.fromEntries(entries) as Record<string, FeishuProductState>;
}

async function loadDouyinProducts(
  connections: IntegrationConnectionView[],
  signal: AbortSignal
) {
  const entries = await Promise.all(
    connections.map(async (connection) => {
      const snapshot = await queryP1<unknown>(
        'integrations',
        {
          action: 'douyin_operations_snapshot',
          payload: { connectionId: connection.id },
        },
        signal
      );
      return [
        connection.id,
        normalizeDouyinOperationsSnapshot(snapshot),
      ] as const;
    })
  );
  return Object.fromEntries(entries) as Record<
    string,
    DouyinOperationsSnapshotView
  >;
}

export function useIntegrationSettings(enabled = true) {
  const queryClient = useQueryClient();
  const connectionsQuery = useQuery({
    enabled,
    queryKey: p1QueryKeys.request('integrations', 'connections'),
    queryFn: ({ signal }) =>
      queryP1<unknown>(
        'integrations',
        { action: 'connections', payload: {} },
        signal
      ),
    select: normalizeConnections,
  });
  const auditQuery = useQuery({
    enabled,
    queryKey: p1QueryKeys.request('integrations', 'audit'),
    queryFn: ({ signal }) =>
      queryP1<unknown>(
        'integrations',
        { action: 'audit', payload: {} },
        signal
      ),
    select: normalizeIntegrationAudit,
  });
  const douyinIntegrationStatusQuery = useQuery({
    enabled,
    queryKey: p1QueryKeys.request('integrations', 'douyin_integration_status'),
    queryFn: ({ signal }) =>
      queryP1<unknown>(
        'integrations',
        { action: 'douyin_integration_status', payload: {} },
        signal
      ),
    select: normalizeDouyinIntegrationStatus,
  });
  const connections = connectionsQuery.data ?? [];
  const feishuConnections = useMemo(
    () =>
      connections.filter(
        (connection) =>
          connection.provider === 'feishu' && connection.status !== 'revoked'
      ),
    [connections]
  );
  const douyinConnections = useMemo(
    () =>
      connections.filter(
        (connection) =>
          connection.provider === 'douyin' && connection.status !== 'revoked'
      ),
    [connections]
  );
  const feishuProductsQuery = useQuery({
    enabled: feishuConnections.length > 0,
    queryKey: p1QueryKeys.request('integrations', 'feishu_products', {
      connectionIds: feishuConnections.map((connection) => connection.id),
    }),
    queryFn: ({ signal }) => loadFeishuProducts(feishuConnections, signal),
  });
  const douyinProductsQuery = useQuery({
    enabled: douyinConnections.length > 0,
    queryKey: p1QueryKeys.request('integrations', 'douyin_products', {
      connectionIds: douyinConnections.map((connection) => connection.id),
    }),
    queryFn: ({ signal }) => loadDouyinProducts(douyinConnections, signal),
  });
  const douyinContentSnapshotsQuery = useQuery({
    enabled: douyinConnections.length > 0,
    queryKey: p1QueryKeys.request('integrations', 'douyin_content_snapshots'),
    queryFn: ({ signal }) =>
      queryP1<unknown>(
        'integrations',
        { action: 'douyin_content_snapshots', payload: {} },
        signal
      ),
    select: normalizeDouyinContentSnapshots,
  });
  const commandMutation = useMutation({
    mutationFn: (request: IntegrationCommandRequest) =>
      commandP1<unknown>(
        'integrations',
        { action: request.action, payload: request.payload },
        request.idempotencyKey
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: p1QueryKeys.module('integrations'),
      }),
  });
  const douyinProducts = useMemo(() => {
    const contentSnapshots = douyinContentSnapshotsQuery.data ?? [];
    return Object.fromEntries(
      Object.entries(douyinProductsQuery.data ?? {}).map(([id, product]) => [
        id,
        { ...product, contentSnapshots },
      ])
    ) as Record<string, DouyinOperationsSnapshotView>;
  }, [douyinContentSnapshotsQuery.data, douyinProductsQuery.data]);
  const errorCause = [
    connectionsQuery.error,
    auditQuery.error,
    douyinIntegrationStatusQuery.error,
    feishuProductsQuery.error,
    douyinProductsQuery.error,
    douyinContentSnapshotsQuery.error,
  ].find(Boolean);

  return {
    audit: auditQuery.data ?? [],
    busy: commandMutation.isPending,
    connections,
    douyinProducts,
    douyinIntegrationStatus: douyinIntegrationStatusQuery.data,
    error: errorCause ? integration_load_error() : undefined,
    executeCommand: <T>(request: IntegrationCommandRequest) =>
      commandMutation.mutateAsync(request) as Promise<T>,
    feishuProducts: feishuProductsQuery.data ?? {},
    loading:
      connectionsQuery.isPending ||
      auditQuery.isPending ||
      douyinIntegrationStatusQuery.isPending ||
      (feishuConnections.length > 0 && feishuProductsQuery.isPending) ||
      (douyinConnections.length > 0 &&
        (douyinProductsQuery.isPending ||
          douyinContentSnapshotsQuery.isPending)),
    refresh: () =>
      queryClient.refetchQueries({
        queryKey: p1QueryKeys.module('integrations'),
      }),
    refreshing:
      connectionsQuery.isFetching ||
      auditQuery.isFetching ||
      douyinIntegrationStatusQuery.isFetching ||
      feishuProductsQuery.isFetching ||
      douyinProductsQuery.isFetching ||
      douyinContentSnapshotsQuery.isFetching,
  };
}
