import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { integration_load_error } from '@/locale/paraglide/messages';
import { commandP1, queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import {
  normalizeConnections,
  normalizeFeishuActivity,
  normalizeFeishuPendingIntents,
  normalizeFeishuRecoveryIntents,
  normalizeFeishuShortcuts,
  normalizeFeishuTools,
  normalizeIntegrationAudit,
  type FeishuActivityView,
  type FeishuPendingIntentView,
  type FeishuRecoveryIntentView,
  type FeishuShortcutView,
  type FeishuToolView,
  type IntegrationConnectionView,
} from '@/p1/settings-view-model';
import { useWorkspaceAccess } from '@/p1/use-workspace-access';

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
export function useIntegrationSettings(enabled = true) {
  const queryClient = useQueryClient();
  // `integrations/audit` is registered against `audit.view`, which belongs to
  // the platform-admin batch — a shop owner never holds it. Firing it anyway
  // spent three requests per visit on a guaranteed 403, printed them in the
  // merchant's console, and pushed the whole page into its load-error state.
  const canReadAudit = useWorkspaceAccess().can('audit.view');
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
    enabled: enabled && canReadAudit,
    queryKey: p1QueryKeys.request('integrations', 'audit'),
    queryFn: ({ signal }) =>
      queryP1<unknown>(
        'integrations',
        { action: 'audit', payload: {} },
        signal
      ),
    select: normalizeIntegrationAudit,
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
  const feishuProductsQuery = useQuery({
    enabled: feishuConnections.length > 0,
    queryKey: p1QueryKeys.request('integrations', 'feishu_products', {
      connectionIds: feishuConnections.map((connection) => connection.id),
    }),
    queryFn: ({ signal }) => loadFeishuProducts(feishuConnections, signal),
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
  const errorCause = [
    connectionsQuery.error,
    auditQuery.error,
    feishuProductsQuery.error,
  ].find(Boolean);

  return {
    audit: auditQuery.data ?? [],
    busy: commandMutation.isPending,
    connections,
    error: errorCause ? integration_load_error() : undefined,
    executeCommand: <T>(request: IntegrationCommandRequest) =>
      commandMutation.mutateAsync(request) as Promise<T>,
    feishuProducts: feishuProductsQuery.data ?? {},
    loading:
      connectionsQuery.isPending ||
      (canReadAudit && auditQuery.isPending) ||
      (feishuConnections.length > 0 && feishuProductsQuery.isPending),
    refresh: () =>
      queryClient.refetchQueries({
        queryKey: p1QueryKeys.module('integrations'),
      }),
    refreshing:
      connectionsQuery.isFetching ||
      auditQuery.isFetching ||
      feishuProductsQuery.isFetching,
  };
}
