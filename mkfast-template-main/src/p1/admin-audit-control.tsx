import { Badge, type BadgeProps } from '@/components/reui/badge';
import {
  Frame,
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
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  admin_audit_actor_correlation,
  admin_audit_bucket_earlier,
  admin_audit_bucket_today,
  admin_audit_bucket_yesterday,
  admin_audit_catalog_lifecycle_reason,
  admin_audit_copied,
  admin_audit_copy_reference,
  admin_audit_empty,
  admin_audit_reason,
  admin_audit_refresh,
  admin_audit_scope_diff,
  admin_audit_template_lifecycle_reason,
  admin_audit_title,
  admin_audit_unknown,
} from '@/locale/paraglide/messages';
import { formatLocaleDateTime } from '@/lib/locale';
import {
  groupAuditIntoBuckets,
  initialOpenAuditIds,
  toggleOpenAuditId,
  type AuditBucketKey,
} from '@/p1/admin-audit-timeline-model';
import { operationsQuery, queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import { IconChevronRight, IconCopy, IconRefresh } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

interface TemplateAuditPayload {
  versions?: Array<{
    id?: string;
    templateId?: string;
    lifecycle?: Array<{
      action?: string;
      actorId?: string;
      correlationId?: string;
      occurredAt?: string;
      reason?: string;
    }>;
  }>;
}

interface RevisionAudit {
  id: string;
  kind: 'catalog' | 'prompt';
  actorId: string;
  correlationId: string;
  createdAt: string;
  fromRevisionId: string;
  toRevisionId: string;
  reason: string;
}

interface CatalogRevisionActivity {
  revisions: Array<{
    id: string;
    stage: string;
    createdAt: string | null;
    actorId?: string;
    correlationId?: string;
    previousRevisionId?: string;
    reason?: string;
  }>;
}

interface AuditEventView {
  id: string;
  action: string;
  actor: string;
  correlationId: string;
  createdAt: string;
  reason: string;
  scope: string;
}

const AUDIT_BUCKET_LABEL: Record<AuditBucketKey, () => string> = {
  today: admin_audit_bucket_today,
  yesterday: admin_audit_bucket_yesterday,
  earlier: admin_audit_bucket_earlier,
};

/**
 * Colour carries the action family: a rollback is a reversal (warning), a
 * catalog stage change is informational, a template lifecycle event is neutral
 * chrome. Anything the admin surface does not yet know about stays outlined
 * rather than being folded into one of the known colours.
 */
function auditActionVariant(action: string): BadgeProps['variant'] {
  if (action.endsWith('.rollback')) {
    return 'warning-light';
  }
  if (action.startsWith('catalog.')) {
    return 'info-light';
  }
  if (action.startsWith('template.')) {
    return 'secondary';
  }
  return 'outline';
}

function auditActionVerb(action: string) {
  const segments = action.split('.');
  return segments[segments.length - 1] || action;
}

/** Day heading for one bucket of the stream, shared by both audit surfaces. */
export function AuditBucketHeading({
  bucketKey,
  count,
}: {
  bucketKey: AuditBucketKey;
  count: number;
}) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {AUDIT_BUCKET_LABEL[bucketKey]()}
      </h3>
      <span aria-hidden="true" className="h-px grow bg-border" />
      <span className="text-xs text-muted-foreground tabular-nums">
        {count}
      </span>
    </div>
  );
}

/**
 * Copies a correlation id to the clipboard and says so on the button itself.
 *
 * The admin surface has no toaster mounted, and a clipboard write can be
 * refused outright (insecure context, denied permission). A refusal is
 * swallowed: the operator can still read and select the id, so a thrown error
 * would break the page for something they can work around.
 */
export function AuditCopyReferenceButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), 2_000);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = () => {
    try {
      void navigator.clipboard
        .writeText(value)
        .then(() => setCopied(true))
        .catch(() => undefined);
    } catch {
      // Clipboard unavailable — the id stays readable in the card.
    }
  };

  return (
    <Button
      aria-label={admin_audit_copy_reference()}
      onClick={handleCopy}
      size="xs"
      type="button"
      variant="outline"
    >
      <IconCopy aria-hidden="true" />
      <span className="font-mono">{copied ? admin_audit_copied() : value}</span>
    </Button>
  );
}

function AuditTimelineEntry({
  event,
  step,
  open,
  onOpenChange,
}: {
  event: AuditEventView;
  step: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <TimelineItem className="ms-0! pb-6" step={step}>
      <TimelineHeader>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <TimelineTitle className="font-mono text-sm font-semibold">
            {event.action}
          </TimelineTitle>
          <Badge size="sm" variant={auditActionVariant(event.action)}>
            {auditActionVerb(event.action)}
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
              aria-label={`${admin_audit_scope_diff()}: ${event.scope}`}
              className="flex w-full"
              type="button"
            >
              <FrameHeader className="flex grow flex-row items-center justify-between gap-2">
                <div className="flex min-w-0 flex-col items-start gap-0.5">
                  <span className="min-w-0 truncate font-mono text-xs text-foreground">
                    {event.scope}
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
                <div className="text-xs">
                  <p className="text-muted-foreground">
                    {admin_audit_reason()}
                  </p>
                  <p className="leading-5 break-words">{event.reason}</p>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2.5 border-t pt-2">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-xs text-muted-foreground">
                      {admin_audit_actor_correlation()}
                    </span>
                    <span className="truncate font-mono text-xs">
                      {event.actor}
                    </span>
                  </div>
                  <AuditCopyReferenceButton value={event.correlationId} />
                </div>
              </FramePanel>
            </CollapsibleContent>
          </Collapsible>
        </Frame>
      </TimelineContent>
    </TimelineItem>
  );
}

/**
 * The stream shared by the governance audit and the BYOK projection: day
 * buckets, one timeline each. `openIds` stays with the caller so the seeded
 * "first two open" is decided once per surface.
 */
function AuditTimelineStream({
  events,
  openIds,
  onToggle,
}: {
  events: readonly AuditEventView[];
  openIds: ReadonlySet<string>;
  onToggle: (id: string, open: boolean) => void;
}) {
  const buckets = useMemo(() => groupAuditIntoBuckets(events), [events]);

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
              <AuditTimelineEntry
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

/**
 * Open state for one audit stream.
 *
 * Held as "not touched yet" (null) rather than seeded in a `useState`
 * initialiser, because the entries arrive after the first render: seeding from
 * an empty array would leave every card collapsed. The first toggle takes over
 * and the set stops following the data, so a card the operator closed does not
 * reopen on the next refetch.
 */
export function useAuditOpenIds(entries: readonly { id: string }[]) {
  const [touched, setTouched] = useState<ReadonlySet<string> | null>(null);
  const openIds = useMemo(
    () => touched ?? initialOpenAuditIds(entries),
    [touched, entries]
  );
  const onToggle = (id: string, open: boolean) => {
    setTouched(toggleOpenAuditId(openIds, id, open));
  };
  return { openIds, onToggle };
}

export function AdminAuditControl() {
  const templateQuery = useQuery({
    queryKey: p1QueryKeys.request('operations', 'admin_template_catalog'),
    queryFn: ({ signal }) =>
      operationsQuery<TemplateAuditPayload>(
        'admin_template_catalog',
        {},
        signal
      ),
  });
  const rollbackQuery = useQuery({
    queryKey: p1QueryKeys.request('model-supply', 'revision_rollback_audits'),
    queryFn: ({ signal }) =>
      queryP1<RevisionAudit[]>(
        'model-supply',
        { action: 'revision_rollback_audits', payload: {} },
        signal
      ),
  });
  const catalogQuery = useQuery({
    queryKey: p1QueryKeys.request('model-supply', 'catalog_revisions'),
    queryFn: ({ signal }) =>
      queryP1<CatalogRevisionActivity>(
        'model-supply',
        { action: 'catalog_revisions', payload: {} },
        signal
      ),
  });
  const events = useMemo(() => {
    const templateEvents = (templateQuery.data?.versions ?? []).flatMap(
      (version) =>
        (version.lifecycle ?? [])
          .filter(
            (event) => event.actorId && event.correlationId && event.occurredAt
          )
          .map((event) => ({
            id: `${version.id}:${event.action}:${event.occurredAt}`,
            action: `template.${event.action ?? 'unknown'}`,
            actor: event.actorId!,
            correlationId: event.correlationId!,
            createdAt: event.occurredAt!,
            reason: event.reason ?? admin_audit_template_lifecycle_reason(),
            scope: version.templateId ?? 'official-template',
          }))
    );
    const rollbacks = (rollbackQuery.data ?? [])
      .filter(
        (event) => event.actorId && event.correlationId && event.createdAt
      )
      .map((event) => ({
        id: event.id,
        action: `${event.kind}.rollback`,
        actor: event.actorId,
        correlationId: event.correlationId,
        createdAt: event.createdAt,
        reason: event.reason,
        scope: `${event.fromRevisionId} → ${event.toRevisionId}`,
      }));
    const catalog = (catalogQuery.data?.revisions ?? [])
      .filter(
        (revision) =>
          revision.createdAt && revision.actorId && revision.correlationId
      )
      .map((revision) => ({
        id: revision.id,
        action: `catalog.${revision.stage}`,
        actor: revision.actorId!,
        correlationId: revision.correlationId!,
        createdAt: revision.createdAt ?? '',
        reason: revision.reason ?? admin_audit_catalog_lifecycle_reason(),
        scope: revision.previousRevisionId
          ? `${revision.previousRevisionId} → ${revision.id}`
          : revision.id,
      }));
    return [...templateEvents, ...rollbacks, ...catalog].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt)
    );
  }, [catalogQuery.data, rollbackQuery.data, templateQuery.data]);

  const { openIds, onToggle } = useAuditOpenIds(events);

  const refresh = () =>
    Promise.all([
      templateQuery.refetch(),
      rollbackQuery.refetch(),
      catalogQuery.refetch(),
    ]);

  return (
    <Frame dense>
      <FrameHeader className="flex-row items-center justify-between gap-3">
        <FrameTitle>{admin_audit_title()}</FrameTitle>
        <Button
          disabled={
            templateQuery.isFetching ||
            rollbackQuery.isFetching ||
            catalogQuery.isFetching
          }
          onClick={() => void refresh()}
          variant="outline"
        >
          <IconRefresh />
          {admin_audit_refresh()}
        </Button>
      </FrameHeader>
      <FramePanel>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">{admin_audit_empty()}</p>
        ) : (
          <AuditTimelineStream
            events={events}
            onToggle={onToggle}
            openIds={openIds}
          />
        )}
      </FramePanel>
    </Frame>
  );
}
