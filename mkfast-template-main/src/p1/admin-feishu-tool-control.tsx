import { IconCloudUpload, IconRefresh } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  p1_admin_feishu_column_compatibility,
  p1_admin_feishu_column_risk,
  p1_admin_feishu_column_status,
  p1_admin_feishu_column_time,
  p1_admin_feishu_column_tool,
  p1_admin_feishu_connection,
  p1_admin_feishu_connection_empty,
  p1_admin_feishu_discovered_at,
  p1_admin_feishu_empty,
  p1_admin_feishu_load_error_description,
  p1_admin_feishu_load_error_title,
  p1_admin_feishu_loading,
  p1_admin_feishu_manual_description,
  p1_admin_feishu_manual_title,
  p1_admin_feishu_notice_description,
  p1_admin_feishu_notice_title,
  p1_admin_feishu_published_at,
  p1_admin_feishu_refresh,
  p1_admin_feishu_revisions_description,
  p1_admin_feishu_revisions_title,
  p1_admin_feishu_sync_error,
  p1_admin_feishu_sync_publish,
  p1_admin_feishu_sync_success,
  p1_admin_feishu_syncing,
} from '@/locale/paraglide/messages';
import { formatLocaleDateTime } from '@/lib/locale';
import {
  normalizeAdminFeishuToolRevisions,
  type AdminFeishuToolRevisionView,
} from '@/p1/admin-feishu-view-model';
import { commandP1, queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import {
  normalizeConnections,
  type IntegrationConnectionView,
} from '@/p1/settings-view-model';

interface SyncResult {
  incompatibleToolCount: number;
  publishedRevisionCount: number;
}

function statusVariant(status: AdminFeishuToolRevisionView['status']) {
  if (status === 'published') return 'secondary' as const;
  if (status === 'retired') return 'destructive' as const;
  return 'outline' as const;
}

function compatibilityVariant(
  status: AdminFeishuToolRevisionView['compatibility']['status']
) {
  if (status === 'compatible') return 'secondary' as const;
  if (status === 'incompatible') return 'destructive' as const;
  return 'outline' as const;
}

function timestamp(value: string | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : formatLocaleDateTime(date);
}

export function AdminFeishuToolControl() {
  const [connectionId, setConnectionId] = useState('');
  const queryClient = useQueryClient();
  const connectionsQuery = useQuery({
    queryKey: p1QueryKeys.request('integrations', 'connections'),
    queryFn: ({ signal }) =>
      queryP1<unknown>(
        'integrations',
        { action: 'connections', payload: {} },
        signal
      ),
    select: normalizeConnections,
  });
  const catalogQuery = useQuery({
    queryKey: p1QueryKeys.request('integrations', 'admin_feishu_tool_catalog'),
    queryFn: ({ signal }) =>
      queryP1<unknown>(
        'integrations',
        { action: 'admin_feishu_tool_catalog', payload: {} },
        signal
      ),
    select: normalizeAdminFeishuToolRevisions,
  });
  const feishuConnections = useMemo(
    () =>
      (connectionsQuery.data ?? []).filter(
        (connection: IntegrationConnectionView) =>
          connection.provider === 'feishu' && connection.status !== 'revoked'
      ),
    [connectionsQuery.data]
  );
  useEffect(() => {
    if (
      !feishuConnections.some((connection) => connection.id === connectionId)
    ) {
      setConnectionId(feishuConnections[0]?.id ?? '');
    }
  }, [connectionId, feishuConnections]);
  const syncMutation = useMutation({
    mutationFn: () =>
      commandP1<SyncResult>('integrations', {
        action: 'sync_publish_feishu_tools',
        payload: { connectionId },
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({
        queryKey: p1QueryKeys.module('integrations'),
      });
      toast.success(
        p1_admin_feishu_sync_success({
          incompatible: result.incompatibleToolCount,
          published: result.publishedRevisionCount,
        })
      );
    },
    onError: () => toast.error(p1_admin_feishu_sync_error()),
  });
  const error = connectionsQuery.error ?? catalogQuery.error;
  const revisions = catalogQuery.data ?? [];

  return (
    <div className="space-y-6">
      <Alert>
        <IconCloudUpload />
        <AlertTitle>{p1_admin_feishu_notice_title()}</AlertTitle>
        <AlertDescription>
          {p1_admin_feishu_notice_description()}
        </AlertDescription>
      </Alert>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{p1_admin_feishu_load_error_title()}</AlertTitle>
          <AlertDescription>
            {p1_admin_feishu_load_error_description()}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{p1_admin_feishu_manual_title()}</CardTitle>
          <CardDescription>
            {p1_admin_feishu_manual_description()}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-64 space-y-2">
            <Label htmlFor="admin-feishu-connection">
              {p1_admin_feishu_connection()}
            </Label>
            <select
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              id="admin-feishu-connection"
              onChange={(event) => setConnectionId(event.target.value)}
              value={connectionId}
            >
              {feishuConnections.length === 0 ? (
                <option value="">{p1_admin_feishu_connection_empty()}</option>
              ) : null}
              {feishuConnections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.id} · {connection.status}
                </option>
              ))}
            </select>
          </div>
          <Button
            disabled={!connectionId || syncMutation.isPending}
            onClick={() => syncMutation.mutate()}
            type="button"
          >
            <IconCloudUpload />
            {syncMutation.isPending
              ? p1_admin_feishu_syncing()
              : p1_admin_feishu_sync_publish()}
          </Button>
          <Button
            disabled={catalogQuery.isFetching}
            onClick={() => catalogQuery.refetch()}
            type="button"
            variant="outline"
          >
            <IconRefresh />
            {p1_admin_feishu_refresh()}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{p1_admin_feishu_revisions_title()}</CardTitle>
          <CardDescription>
            {p1_admin_feishu_revisions_description({
              count: revisions.length,
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{p1_admin_feishu_column_tool()}</TableHead>
                <TableHead>{p1_admin_feishu_column_risk()}</TableHead>
                <TableHead>{p1_admin_feishu_column_compatibility()}</TableHead>
                <TableHead>{p1_admin_feishu_column_status()}</TableHead>
                <TableHead>Schema hash</TableHead>
                <TableHead>{p1_admin_feishu_column_time()}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {revisions.length === 0 ? (
                <TableRow>
                  <TableCell className="text-muted-foreground" colSpan={6}>
                    {catalogQuery.isPending
                      ? p1_admin_feishu_loading()
                      : p1_admin_feishu_empty()}
                  </TableCell>
                </TableRow>
              ) : (
                revisions.map((revision) => (
                  <TableRow key={`${revision.id}:${revision.revision}`}>
                    <TableCell>
                      <p className="font-medium">{revision.id}</p>
                      <p className="text-xs text-muted-foreground">
                        {revision.remoteRevision} · {revision.revision}
                      </p>
                    </TableCell>
                    <TableCell>{revision.risk}</TableCell>
                    <TableCell>
                      <Badge
                        variant={compatibilityVariant(
                          revision.compatibility.status
                        )}
                      >
                        {revision.compatibility.status}
                      </Badge>
                      {revision.compatibility.reason ? (
                        <p className="mt-1 text-xs text-destructive">
                          {revision.compatibility.reason}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(revision.status)}>
                        {revision.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {revision.schemaHash.slice(0, 16)}
                    </TableCell>
                    <TableCell className="text-xs">
                      <p>
                        {p1_admin_feishu_discovered_at({
                          time: timestamp(revision.discoveredAt),
                        })}
                      </p>
                      <p>
                        {p1_admin_feishu_published_at({
                          time: timestamp(revision.publishedAt),
                        })}
                      </p>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
