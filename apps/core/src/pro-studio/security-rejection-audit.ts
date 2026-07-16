import { createHash } from 'node:crypto';

export const SECURITY_REJECTION_OBJECT_KINDS = [
  'project',
  'revision',
  'asset',
  'job',
  'package',
  'grant',
  'confirmation',
] as const;

export type SecurityRejectionObjectKind =
  (typeof SECURITY_REJECTION_OBJECT_KINDS)[number];

export interface SecurityRejectionAuditContext {
  correlationId: string;
  userId: string;
  workspaceId: string;
}

export interface SecurityRejectionAuditEvent {
  actorId: string;
  correlationId: string;
  createdAt: string;
  id: string;
  objectKind: SecurityRejectionObjectKind;
  outcome: 'opaque_not_found';
  requestAction: string;
  targetDigest: string;
  workspaceId: string;
}

export interface SecurityRejectionAuditRepository {
  append(event: SecurityRejectionAuditEvent): Promise<void>;
  list(input: {
    actorId: string;
    workspaceId: string;
  }): Promise<SecurityRejectionAuditEvent[]>;
}

export class MemorySecurityRejectionAuditRepository
  implements SecurityRejectionAuditRepository
{
  private readonly events: SecurityRejectionAuditEvent[] = [];

  async append(event: SecurityRejectionAuditEvent) {
    if (!this.events.some((candidate) => candidate.id === event.id)) {
      this.events.push(structuredClone(event));
    }
  }

  async list(input: { actorId: string; workspaceId: string }) {
    return structuredClone(
      this.events.filter(
        (event) =>
          event.workspaceId === input.workspaceId &&
          event.actorId === input.actorId
      )
    );
  }
}

export class SecurityRejectionAuditService {
  constructor(
    private readonly repository: SecurityRejectionAuditRepository,
    private readonly options: { clock?: () => Date } = {}
  ) {}

  async record(
    context: SecurityRejectionAuditContext,
    input: {
      objectKind: SecurityRejectionObjectKind;
      requestAction: string;
      targetId: string;
    }
  ) {
    requireText(context.correlationId, 'correlationId');
    requireText(context.userId, 'userId');
    requireText(context.workspaceId, 'workspaceId');
    requireText(input.requestAction, 'requestAction');
    requireText(input.targetId, 'targetId');
    if (!SECURITY_REJECTION_OBJECT_KINDS.includes(input.objectKind)) {
      throw new Error('objectKind is not part of the Ticket 25 matrix.');
    }
    const targetDigest = digest(input.targetId);
    const createdAt = (this.options.clock?.() ?? new Date()).toISOString();
    const event: SecurityRejectionAuditEvent = {
      actorId: context.userId,
      correlationId: context.correlationId,
      createdAt,
      id: `security-rejection-${digest(
        JSON.stringify({
          actorId: context.userId,
          correlationId: context.correlationId,
          objectKind: input.objectKind,
          requestAction: input.requestAction,
          targetDigest,
          workspaceId: context.workspaceId,
        })
      ).slice(0, 24)}`,
      objectKind: input.objectKind,
      outcome: 'opaque_not_found',
      requestAction: input.requestAction,
      targetDigest,
      workspaceId: context.workspaceId,
    };
    await this.repository.append(event);
    return structuredClone(event);
  }

  list(context: SecurityRejectionAuditContext) {
    return this.repository.list({
      actorId: context.userId,
      workspaceId: context.workspaceId,
    });
  }
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function requireText(value: string, field: string) {
  if (!value.trim()) throw new Error(`${field} is required.`);
}
