import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  admin_audit_action,
  admin_audit_actor_correlation,
  admin_audit_catalog_lifecycle_reason,
  admin_audit_empty,
  admin_audit_reason,
  admin_audit_refresh,
  admin_audit_scope_diff,
  admin_audit_template_lifecycle_reason,
  admin_audit_time,
  admin_audit_title,
  admin_audit_unknown,
} from '@/locale/paraglide/messages';
import { formatLocaleDateTime } from '@/lib/locale';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { operationsQuery, queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import { IconRefresh } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

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

  const refresh = () =>
    Promise.all([
      templateQuery.refetch(),
      rollbackQuery.refetch(),
      catalogQuery.refetch(),
    ]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>{admin_audit_title()}</CardTitle>
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
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{admin_audit_action()}</TableHead>
              <TableHead>{admin_audit_scope_diff()}</TableHead>
              <TableHead>{admin_audit_reason()}</TableHead>
              <TableHead>{admin_audit_actor_correlation()}</TableHead>
              <TableHead>{admin_audit_time()}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.length === 0 ? (
              <TableRow>
                <TableCell className="text-muted-foreground" colSpan={5}>
                  {admin_audit_empty()}
                </TableCell>
              </TableRow>
            ) : (
              events.map((event) => (
                <TableRow key={event.id}>
                  <TableCell>
                    <Badge variant="outline">{event.action}</Badge>
                  </TableCell>
                  <TableCell className="max-w-64 break-words">
                    {event.scope}
                  </TableCell>
                  <TableCell className="max-w-64 break-words">
                    {event.reason}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    <p>{event.actor}</p>
                    <p className="text-muted-foreground">
                      {event.correlationId}
                    </p>
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
      </CardContent>
    </Card>
  );
}
