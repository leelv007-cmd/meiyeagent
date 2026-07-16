export const PRO_STUDIO_OBJECT_KINDS = [
  'project',
  'revision',
  'asset',
  'job',
  'package',
  'grant',
  'confirmation',
] as const;

export type ProStudioObjectKind = (typeof PRO_STUDIO_OBJECT_KINDS)[number];

export type ProStudioAccessDeniedAction =
  `${ProStudioObjectKind}_access_denied`;

export interface ProStudioAccessDeniedEvent {
  action: ProStudioAccessDeniedAction;
  actorId: string;
  createdAt: string;
  objectId: string;
  objectKind: ProStudioObjectKind;
  projectId?: string;
  workspaceId: string;
}

export interface ProStudioAccessAuditPort {
  recordAccessDenied(
    event: Omit<ProStudioAccessDeniedEvent, 'action' | 'createdAt'> & {
      createdAt?: string;
    }
  ): Promise<void>;
}

export function accessDeniedAction(
  objectKind: ProStudioObjectKind
): ProStudioAccessDeniedAction {
  return `${objectKind}_access_denied`;
}

export function buildAccessDeniedEvent(
  event: Omit<ProStudioAccessDeniedEvent, 'action' | 'createdAt'> & {
    createdAt?: string;
  },
  clock: () => Date = () => new Date()
): ProStudioAccessDeniedEvent {
  return {
    action: accessDeniedAction(event.objectKind),
    actorId: event.actorId,
    createdAt: event.createdAt ?? clock().toISOString(),
    objectId: event.objectId,
    objectKind: event.objectKind,
    ...(event.projectId ? { projectId: event.projectId } : {}),
    workspaceId: event.workspaceId,
  };
}

export class MemoryProStudioAccessAudit implements ProStudioAccessAuditPort {
  readonly events: ProStudioAccessDeniedEvent[] = [];

  constructor(private readonly clock: () => Date = () => new Date()) {}

  async recordAccessDenied(
    event: Omit<ProStudioAccessDeniedEvent, 'action' | 'createdAt'> & {
      createdAt?: string;
    }
  ) {
    this.events.push(buildAccessDeniedEvent(event, this.clock));
  }

  byKind(objectKind: ProStudioObjectKind) {
    return this.events.filter((event) => event.objectKind === objectKind);
  }
}

export class PostgresProStudioAccessAudit implements ProStudioAccessAuditPort {
  constructor(
    private readonly pool: {
      query: (text: string, values?: unknown[]) => Promise<unknown>;
    },
    private readonly clock: () => Date = () => new Date()
  ) {}

  async recordAccessDenied(
    event: Omit<ProStudioAccessDeniedEvent, 'action' | 'createdAt'> & {
      createdAt?: string;
    }
  ) {
    const recorded = buildAccessDeniedEvent(event, this.clock);
    await this.pool.query(
      `INSERT INTO pro_studio_audit_events
       (workspace_id, action, project_id, actor_id, detail, created_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::timestamptz)`,
      [
        recorded.workspaceId,
        recorded.action,
        recorded.projectId ?? null,
        recorded.actorId,
        JSON.stringify({
          objectId: recorded.objectId,
          objectKind: recorded.objectKind,
        }),
        recorded.createdAt,
      ]
    );
  }
}
