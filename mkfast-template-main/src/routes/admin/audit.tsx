import { CapabilityDrilldownBanner } from '@/components/admin/capability/capability-drilldown-banner';
import { AdminRoutePage } from '@/components/admin/admin-route-page';
import { SupplyAuditTable } from '@/components/admin/supply/supply-audit-table';
import { Badge, type BadgeProps } from '@/components/reui/badge';
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import {
  Timeline,
  TimelineContent,
  TimelineHeader,
  TimelineItem,
  TimelineTitle,
} from '@/components/reui/timeline';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  admin_audit_actor_correlation,
  admin_audit_description,
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
import {
  AdminAuditControl,
  AuditBucketHeading,
  AuditCopyReferenceButton,
  useAuditOpenIds,
} from '@/p1/admin-audit-control';
import { groupAuditIntoBuckets } from '@/p1/admin-audit-timeline-model';
import { AdminOperationsHealth } from '@/p1/admin-operations-health';
import { AdminMerchantSupport } from '@/p1/admin-merchant-support';
import { AdminPaymentRefundReview } from '@/p1/admin-payment-refund-review';
import type { SupplyControlSnapshot } from '@/p1/admin-supply-types';
import { ADMIN_SUPPLY_CONTROL_QUERY } from '@/p1/use-admin-supply-control';
import { queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import {
  normalizeIntegrationAudit,
  type IntegrationAuditView,
} from '@/p1/settings-view-model';
import { IconChevronRight } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useMemo } from 'react';

export const Route = createFileRoute('/admin/audit')({ component: AuditPage });

function AuditPage() {
  return (
    <AdminRoutePage
      title={admin_audit_title()}
      description={admin_audit_description()}
    >
      <div className="space-y-8">
        <CapabilityDrilldownBanner pageId="audit" />
        <AdminPaymentRefundReview />
        <AdminMerchantSupport />
        <AdminSupplyAuditProjection />
        <AdminByokAuditProjection />
        <AdminAuditControl />
        {/* Ghost frame: AdminOperationsHealth 自带五个 Frame，这里再套一层
            FramePanel 就是框中框，只留分区标题。 */}
        <Frame
          className="border-t pt-6"
          data-domain="runtime_and_governance"
          data-testid="runtime-governance-health"
          variant="ghost"
        >
          <FrameHeader className="px-0">
            <FrameTitle className="text-lg">
              {admin_health_evidence_title()}
            </FrameTitle>
          </FrameHeader>
          <AdminOperationsHealth />
        </Frame>
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
    <Frame data-testid="admin-supply-audit-projection" dense>
      <FrameHeader>
        <FrameTitle>模型供应治理审计</FrameTitle>
        <FrameDescription>
          受治理动作的不可变原因、目标、操作者与关联证据。
        </FrameDescription>
      </FrameHeader>
      <FramePanel>
        {auditQuery.isPending ? (
          <p className="text-sm text-muted-foreground">{common_loading()}</p>
        ) : auditQuery.isError ? (
          <p className="text-sm text-destructive">{integration_load_error()}</p>
        ) : (
          <SupplyAuditTable changes={auditQuery.data?.recentChanges ?? []} />
        )}
      </FramePanel>
    </Frame>
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

function byokActionVariant(action: string): BadgeProps['variant'] {
  if (action === 'byok.completed') {
    return 'success-light';
  }
  if (action === 'byok.failed') {
    return 'destructive-light';
  }
  return 'outline';
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
    <Frame dense>
      <FrameHeader>
        <FrameTitle>{p1_admin_audit_byok_title()}</FrameTitle>
        <FrameDescription>{p1_admin_audit_byok_description()}</FrameDescription>
      </FrameHeader>
      <FramePanel>
        {auditQuery.isPending ? (
          <p className="text-sm text-muted-foreground">{common_loading()}</p>
        ) : auditQuery.isError ? (
          <p className="text-sm text-destructive">{integration_load_error()}</p>
        ) : (
          <ByokAuditTable events={auditQuery.data ?? []} />
        )}
      </FramePanel>
    </Frame>
  );
}

function ByokAuditEntry({
  event,
  step,
  open,
  onOpenChange,
}: {
  event: IntegrationAuditView;
  step: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <TimelineItem className="ms-0! pb-6" step={step}>
      <TimelineHeader>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <TimelineTitle className="font-mono text-sm font-semibold">
            {event.connectionId}
          </TimelineTitle>
          <Badge size="sm" variant={byokActionVariant(event.action)}>
            {byokActionLabel(event.action)}
          </Badge>
        </div>
      </TimelineHeader>
      <TimelineContent className="mt-1.5">
        <Frame dense spacing="sm" stacked>
          <Collapsible
            className="group/collapsible"
            onOpenChange={onOpenChange}
            open={open}
          >
            <CollapsibleTrigger
              aria-label={p1_admin_audit_byok_execution_details()}
              className="flex w-full"
              type="button"
            >
              <FrameHeader className="flex grow flex-row items-center justify-between gap-2">
                <div className="flex min-w-0 flex-col items-start gap-0.5">
                  <span className="min-w-0 truncate font-mono text-xs text-foreground">
                    {event.details?.catalogModelId ?? admin_audit_unknown()}
                  </span>
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    {event.createdAt
                      ? formatLocaleDateTime(event.createdAt)
                      : admin_audit_unknown()}
                  </span>
                </div>
                <IconChevronRight
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-open/collapsible:rotate-90"
                />
              </FrameHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <FramePanel className="space-y-2.5">
                <dl className="grid gap-1 text-xs">
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
                <div className="flex flex-wrap items-center justify-between gap-2.5 border-t pt-2">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-xs text-muted-foreground">
                      {admin_audit_actor_correlation()}
                    </span>
                    <span className="truncate font-mono text-xs">
                      {event.actorId ?? admin_audit_unknown()}
                    </span>
                  </div>
                  <AuditCopyReferenceButton
                    value={event.correlationId ?? admin_audit_unknown()}
                  />
                </div>
              </FramePanel>
            </CollapsibleContent>
          </Collapsible>
        </Frame>
      </TimelineContent>
    </TimelineItem>
  );
}

function ByokAuditTable({ events }: { events: IntegrationAuditView[] }) {
  const buckets = useMemo(() => groupAuditIntoBuckets(events), [events]);
  const { openIds, onToggle } = useAuditOpenIds(events);

  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {p1_admin_audit_byok_empty()}
      </p>
    );
  }

  return (
    <div className="space-y-8">
      {buckets.map((bucket) => (
        <div key={bucket.key}>
          <AuditBucketHeading
            bucketKey={bucket.key}
            count={bucket.entries.length}
          />
          <Timeline defaultValue={bucket.entries.length}>
            {bucket.entries.map((event, index) => (
              <ByokAuditEntry
                event={event}
                key={event.id}
                onOpenChange={(next) => onToggle(event.id, next)}
                open={openIds.has(event.id)}
                step={index + 1}
              />
            ))}
          </Timeline>
        </div>
      ))}
    </div>
  );
}
