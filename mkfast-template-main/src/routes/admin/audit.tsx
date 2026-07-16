import { AdminRoutePage } from '@/components/admin/admin-route-page';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { m } from '@/locale/paraglide/messages';
import { formatLocaleDateTime } from '@/lib/locale';
import { AdminAuditControl } from '@/p1/admin-audit-control';
import { AdminOperationsHealth } from '@/p1/admin-operations-health';
import { AdminMerchantSupport } from '@/p1/admin-merchant-support';
import { queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import {
  normalizeIntegrationAudit,
  type IntegrationAuditView,
} from '@/p1/settings-view-model';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/admin/audit')({ component: AuditPage });

function AuditPage() {
  return (
    <AdminRoutePage
      title={m.admin_audit_title()}
      description={m.admin_audit_description()}
    >
      <div className="space-y-8">
        <AdminMerchantSupport />
        <AdminByokAuditProjection />
        <AdminAuditControl />
        <section className="space-y-4 border-t pt-6">
          <h2 className="text-lg font-semibold">
            {m.admin_health_evidence_title()}
          </h2>
          <AdminOperationsHealth />
        </section>
      </div>
    </AdminRoutePage>
  );
}

function byokActionLabel(action: string) {
  if (action === 'byok.completed') {
    return m.p1_admin_audit_byok_action_completed();
  }
  if (action === 'byok.failed') {
    return m.p1_admin_audit_byok_action_failed();
  }
  return m.p1_admin_audit_byok_action_unknown();
}

function byokUsageStatusLabel(status?: string) {
  if (status === 'committed') {
    return m.p1_admin_audit_byok_usage_committed();
  }
  if (status === 'refunded') {
    return m.p1_admin_audit_byok_usage_refunded();
  }
  if (status === 'reserved') {
    return m.p1_admin_audit_byok_usage_reserved();
  }
  return m.admin_audit_unknown();
}

function AdminByokAuditProjection() {
  const auditQuery = useQuery({
    queryKey: p1QueryKeys.request('integrations', 'audit'),
    queryFn: ({ signal }) =>
      queryP1<unknown>(
        'integrations',
        { action: 'audit', payload: {} },
        signal
      ),
    select: (value) =>
      normalizeIntegrationAudit(value)
        .filter((event) => event.action.startsWith('byok.'))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{m.p1_admin_audit_byok_title()}</CardTitle>
        <CardDescription>{m.p1_admin_audit_byok_description()}</CardDescription>
      </CardHeader>
      <CardContent>
        {auditQuery.isPending ? (
          <p className="text-sm text-muted-foreground">{m.common_loading()}</p>
        ) : auditQuery.isError ? (
          <p className="text-sm text-destructive">
            {m.integration_load_error()}
          </p>
        ) : (
          <ByokAuditTable events={auditQuery.data ?? []} />
        )}
      </CardContent>
    </Card>
  );
}

export function ByokAuditTable({ events }: { events: IntegrationAuditView[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{m.admin_audit_action()}</TableHead>
          <TableHead>{m.p1_admin_audit_byok_execution_details()}</TableHead>
          <TableHead>{m.admin_audit_actor_correlation()}</TableHead>
          <TableHead>{m.admin_audit_time()}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.length === 0 ? (
          <TableRow>
            <TableCell className="text-muted-foreground" colSpan={4}>
              {m.p1_admin_audit_byok_empty()}
            </TableCell>
          </TableRow>
        ) : (
          events.map((event) => (
            <TableRow key={event.id}>
              <TableCell>
                <Badge
                  variant={
                    event.action === 'byok.completed'
                      ? 'secondary'
                      : event.action === 'byok.failed'
                        ? 'destructive'
                        : 'outline'
                  }
                >
                  {byokActionLabel(event.action)}
                </Badge>
              </TableCell>
              <TableCell className="max-w-96 text-xs">
                <dl className="grid gap-1">
                  <div>
                    <dt className="inline text-muted-foreground">
                      {m.p1_admin_audit_byok_endpoint_profile_label()}
                    </dt>{' '}
                    <dd className="inline font-mono">
                      {event.details?.endpointProfileId ??
                        m.admin_audit_unknown()}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline text-muted-foreground">
                      {m.p1_admin_audit_byok_catalog_model_label()}
                    </dt>{' '}
                    <dd className="inline font-mono">
                      {event.details?.catalogModelId ?? m.admin_audit_unknown()}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline text-muted-foreground">
                      {m.p1_admin_audit_byok_usage_status_label()}
                    </dt>{' '}
                    <dd className="inline">
                      {byokUsageStatusLabel(event.details?.usageStatus)}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline text-muted-foreground">
                      {m.p1_admin_audit_byok_credential_version_label()}
                    </dt>{' '}
                    <dd className="inline font-mono">
                      {event.details?.credentialVersion ??
                        m.admin_audit_unknown()}
                    </dd>
                  </div>
                </dl>
              </TableCell>
              <TableCell className="font-mono text-xs">
                <p>{event.actorId ?? m.admin_audit_unknown()}</p>
                <p className="text-muted-foreground">
                  {event.correlationId ?? m.admin_audit_unknown()}
                </p>
                <p className="text-muted-foreground">{event.connectionId}</p>
              </TableCell>
              <TableCell className="text-xs">
                {event.createdAt
                  ? formatLocaleDateTime(event.createdAt)
                  : m.admin_audit_unknown()}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
