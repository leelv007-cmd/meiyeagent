import { CapabilityDrilldownBanner } from '@/components/admin/capability/capability-drilldown-banner';
import { AdminRoutePage } from '@/components/admin/admin-route-page';
import { SupplyAuditTable } from '@/components/admin/supply/supply-audit-table';
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
import {
  admin_audit_action,
  admin_audit_actor_correlation,
  admin_audit_description,
  admin_audit_time,
  admin_audit_title,
  admin_audit_unknown,
  admin_health_evidence_title,
  common_loading,
  integration_load_error,
  p1_admin_audit_byok_action_completed,
  p1_admin_audit_byok_action_failed,
  p1_admin_audit_byok_action_unknown,
  p1_admin_audit_byok_catalog_model_label,
  p1_admin_audit_byok_credential_version_label,
  p1_admin_audit_byok_description,
  p1_admin_audit_byok_empty,
  p1_admin_audit_byok_endpoint_profile_label,
  p1_admin_audit_byok_execution_details,
  p1_admin_audit_byok_title,
  p1_admin_audit_byok_usage_committed,
  p1_admin_audit_byok_usage_refunded,
  p1_admin_audit_byok_usage_reserved,
  p1_admin_audit_byok_usage_status_label,
} from '@/locale/paraglide/messages';
import { formatLocaleDateTime } from '@/lib/locale';
import { AdminAuditControl } from '@/p1/admin-audit-control';
import { AdminOperationsHealth } from '@/p1/admin-operations-health';
import { AdminMerchantSupport } from '@/p1/admin-merchant-support';
import type { SupplyControlSnapshot } from '@/p1/admin-supply-types';
import { ADMIN_SUPPLY_CONTROL_QUERY } from '@/p1/use-admin-supply-control';
import { queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import {
  normalizeIntegrationAudit,
  type IntegrationAuditView,
} from '@/p1/settings-view-model';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/admin/audit')({ component: AuditPage });

export function AuditPage() {
  return (
    <AdminRoutePage
      title={admin_audit_title()}
      description={admin_audit_description()}
    >
      <div className="space-y-8">
        <CapabilityDrilldownBanner pageId="audit" />
        <AdminMerchantSupport />
        <AdminSupplyAuditProjection />
        <AdminByokAuditProjection />
        <AdminAuditControl />
        <section
          className="space-y-4 border-t pt-6"
          data-testid="runtime-governance-health"
          data-domain="runtime_and_governance"
        >
          <h2 className="text-lg font-semibold">
            {admin_health_evidence_title()}
          </h2>
          <AdminOperationsHealth />
        </section>
      </div>
    </AdminRoutePage>
  );
}

function AdminSupplyAuditProjection() {
  const auditQuery = useQuery({
    queryKey: p1QueryKeys.request('model-supply', ADMIN_SUPPLY_CONTROL_QUERY),
    queryFn: ({ signal }) =>
      queryP1<SupplyControlSnapshot>(
        'model-supply',
        { action: ADMIN_SUPPLY_CONTROL_QUERY, payload: {} },
        signal
      ),
  });

  return (
    <Card data-testid="admin-supply-audit-projection">
      <CardHeader>
        <CardTitle>模型供应治理审计</CardTitle>
        <CardDescription>
          受治理动作的不可变原因、目标、操作者与关联证据。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {auditQuery.isPending ? (
          <p className="text-sm text-muted-foreground">{common_loading()}</p>
        ) : auditQuery.isError ? (
          <p className="text-sm text-destructive">{integration_load_error()}</p>
        ) : (
          <SupplyAuditTable changes={auditQuery.data?.recentChanges ?? []} />
        )}
      </CardContent>
    </Card>
  );
}

function byokActionLabel(action: string) {
  if (action === 'byok.completed') {
    return p1_admin_audit_byok_action_completed();
  }
  if (action === 'byok.failed') {
    return p1_admin_audit_byok_action_failed();
  }
  return p1_admin_audit_byok_action_unknown();
}

function byokUsageStatusLabel(status?: string) {
  if (status === 'committed') {
    return p1_admin_audit_byok_usage_committed();
  }
  if (status === 'refunded') {
    return p1_admin_audit_byok_usage_refunded();
  }
  if (status === 'reserved') {
    return p1_admin_audit_byok_usage_reserved();
  }
  return admin_audit_unknown();
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
        <CardTitle>{p1_admin_audit_byok_title()}</CardTitle>
        <CardDescription>{p1_admin_audit_byok_description()}</CardDescription>
      </CardHeader>
      <CardContent>
        {auditQuery.isPending ? (
          <p className="text-sm text-muted-foreground">{common_loading()}</p>
        ) : auditQuery.isError ? (
          <p className="text-sm text-destructive">{integration_load_error()}</p>
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
          <TableHead>{admin_audit_action()}</TableHead>
          <TableHead>{p1_admin_audit_byok_execution_details()}</TableHead>
          <TableHead>{admin_audit_actor_correlation()}</TableHead>
          <TableHead>{admin_audit_time()}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.length === 0 ? (
          <TableRow>
            <TableCell className="text-muted-foreground" colSpan={4}>
              {p1_admin_audit_byok_empty()}
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
                      {p1_admin_audit_byok_endpoint_profile_label()}
                    </dt>{' '}
                    <dd className="inline font-mono">
                      {event.details?.endpointProfileId ??
                        admin_audit_unknown()}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline text-muted-foreground">
                      {p1_admin_audit_byok_catalog_model_label()}
                    </dt>{' '}
                    <dd className="inline font-mono">
                      {event.details?.catalogModelId ?? admin_audit_unknown()}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline text-muted-foreground">
                      {p1_admin_audit_byok_usage_status_label()}
                    </dt>{' '}
                    <dd className="inline">
                      {byokUsageStatusLabel(event.details?.usageStatus)}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline text-muted-foreground">
                      {p1_admin_audit_byok_credential_version_label()}
                    </dt>{' '}
                    <dd className="inline font-mono">
                      {event.details?.credentialVersion ??
                        admin_audit_unknown()}
                    </dd>
                  </div>
                </dl>
              </TableCell>
              <TableCell className="font-mono text-xs">
                <p>{event.actorId ?? admin_audit_unknown()}</p>
                <p className="text-muted-foreground">
                  {event.correlationId ?? admin_audit_unknown()}
                </p>
                <p className="text-muted-foreground">{event.connectionId}</p>
              </TableCell>
              <TableCell className="text-xs">
                {event.createdAt
                  ? formatLocaleDateTime(event.createdAt)
                  : admin_audit_unknown()}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
