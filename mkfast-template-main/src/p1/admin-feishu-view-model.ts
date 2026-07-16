export interface AdminFeishuToolRevisionView {
  compatibility: {
    reason?: string;
    status: 'pending' | 'compatible' | 'incompatible';
  };
  discoveredAt: string;
  id: string;
  publishedAt?: string;
  remoteRevision: string;
  revision: string;
  risk: 'read' | 'write' | 'destructive' | 'open_world';
  schemaHash: string;
  status: 'draft' | 'published' | 'retired';
}

const risks = new Set<AdminFeishuToolRevisionView['risk']>([
  'read',
  'write',
  'destructive',
  'open_world',
]);
const statuses = new Set<AdminFeishuToolRevisionView['status']>([
  'draft',
  'published',
  'retired',
]);
const compatibilityStatuses = new Set<
  AdminFeishuToolRevisionView['compatibility']['status']
>(['pending', 'compatible', 'incompatible']);

export function normalizeAdminFeishuToolRevisions(
  value: unknown
): AdminFeishuToolRevisionView[] {
  const input = Array.isArray(value) ? value : [];
  return input
    .map(record)
    .flatMap((revision): AdminFeishuToolRevisionView[] => {
      const compatibility = record(revision.compatibility);
      const compatibilityStatus = compatibilityStatuses.has(
        compatibility.status as AdminFeishuToolRevisionView['compatibility']['status']
      )
        ? (compatibility.status as AdminFeishuToolRevisionView['compatibility']['status'])
        : 'pending';
      const id = string(revision.id);
      const remoteRevision = string(revision.remoteRevision);
      const revisionId = string(revision.revision);
      const risk = revision.risk as AdminFeishuToolRevisionView['risk'];
      const status = revision.status as AdminFeishuToolRevisionView['status'];
      if (
        !id ||
        !remoteRevision ||
        !revisionId ||
        !risks.has(risk) ||
        !statuses.has(status)
      ) {
        return [];
      }
      const reason = string(compatibility.reason);
      const publishedAt = string(revision.publishedAt);
      return [
        {
          compatibility: {
            ...(reason ? { reason } : {}),
            status: compatibilityStatus,
          },
          discoveredAt: string(revision.discoveredAt),
          id,
          ...(publishedAt ? { publishedAt } : {}),
          remoteRevision,
          revision: revisionId,
          risk,
          schemaHash: string(revision.schemaHash),
          status,
        },
      ];
    })
    .sort((left, right) =>
      left.id === right.id
        ? right.discoveredAt.localeCompare(left.discoveredAt)
        : left.id.localeCompare(right.id)
    );
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function string(value: unknown) {
  return typeof value === 'string' ? value : '';
}
