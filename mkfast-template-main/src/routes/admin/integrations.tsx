import { AdminRoutePage } from '@/components/admin/admin-route-page';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { m } from '@/locale/paraglide/messages';
import { AdminFeishuToolControl } from '@/p1/admin-feishu-tool-control';
import { AdminProviderCredentialControl } from '@/p1/admin-provider-credential-control';
import { queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import { normalizeDouyinIntegrationStatus } from '@/p1/settings-view-model';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/admin/integrations')({
  component: IntegrationsPage,
});

function IntegrationsPage() {
  return (
    <AdminRoutePage
      title={m.admin_integrations_title()}
      description={m.admin_integrations_description()}
    >
      <div className="space-y-6">
        <DouyinIntegrationEvidence />
        <AdminProviderCredentialControl />
        <AdminFeishuToolControl />
      </div>
    </AdminRoutePage>
  );
}

function DouyinIntegrationEvidence() {
  const status = useQuery({
    queryKey: p1QueryKeys.request('integrations', 'douyin_integration_status'),
    queryFn: ({ signal }) =>
      queryP1<unknown>(
        'integrations',
        { action: 'douyin_integration_status', payload: {} },
        signal
      ),
    select: normalizeDouyinIntegrationStatus,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {m.admin_douyin_status_title()}
          {status.data ? (
            <Badge variant={status.data.integrated ? 'secondary' : 'outline'}>
              {status.data.integrated
                ? m.admin_douyin_status_integrated()
                : m.admin_douyin_status_not_integrated()}
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          {status.data?.integrated
            ? m.admin_douyin_status_live_description()
            : status.data
              ? m.admin_douyin_status_recorded_description()
              : m.admin_douyin_status_unavailable()}
        </CardDescription>
      </CardHeader>
      {status.data ? (
        <CardContent className="text-sm text-muted-foreground">
          {m.admin_douyin_status_mode({ mode: status.data.executionMode })}
        </CardContent>
      ) : null}
    </Card>
  );
}
