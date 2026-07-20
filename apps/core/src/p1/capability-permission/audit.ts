import type { ProductCapability } from '@meiye/contracts';

/**
 * High-impact permission audit projection (D-057 story 10).
 * Domain tickets own command CAS/idempotency; this package ships the shared shape + assert helper.
 */
export interface PermissionAuditActor {
  userId: string;
  role?: string | null;
}

export interface PermissionAuditTarget {
  kind: 'command' | 'query' | string;
  module: string;
  action: string;
  /** Optional resource identifier (deployment id, config key, task id, …). */
  resourceId?: string | null;
  resourceType?: string | null;
}

export interface PermissionAuditProjection {
  actor: PermissionAuditActor;
  permission: ProductCapability | null;
  target: PermissionAuditTarget;
  reason: string;
  before: unknown | null;
  after: unknown | null;
  correlationId: string;
  /** ISO-8601 timestamp. */
  occurredAt: string;
}

export interface ProjectPermissionAuditInput {
  actor: PermissionAuditActor;
  permission: ProductCapability | null;
  target: PermissionAuditTarget;
  reason: string;
  before?: unknown | null;
  after?: unknown | null;
  correlationId: string;
  occurredAt?: string;
}

export function projectPermissionAudit(
  input: ProjectPermissionAuditInput
): PermissionAuditProjection {
  return {
    actor: {
      userId: input.actor.userId,
      role: input.actor.role ?? null,
    },
    permission: input.permission,
    target: {
      kind: input.target.kind,
      module: input.target.module,
      action: input.target.action,
      resourceId: input.target.resourceId ?? null,
      resourceType: input.target.resourceType ?? null,
    },
    reason: input.reason,
    before: input.before ?? null,
    after: input.after ?? null,
    correlationId: input.correlationId,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  };
}

const REQUIRED_AUDIT_KEYS = [
  'actor',
  'permission',
  'target',
  'reason',
  'before',
  'after',
  'correlationId',
  'occurredAt',
] as const;

/**
 * Assert a projection carries the D-057 audit field set.
 * Throws AssertionError-style Error when incomplete (for unit/contract tests).
 */
export function assertPermissionAuditFields(
  projection: PermissionAuditProjection
): void {
  for (const key of REQUIRED_AUDIT_KEYS) {
    if (!(key in projection)) {
      throw new Error(`Permission audit missing field: ${key}`);
    }
  }
  if (!projection.actor || typeof projection.actor.userId !== 'string') {
    throw new Error('Permission audit actor.userId is required.');
  }
  if (!projection.target || typeof projection.target.module !== 'string') {
    throw new Error('Permission audit target.module is required.');
  }
  if (typeof projection.target.action !== 'string') {
    throw new Error('Permission audit target.action is required.');
  }
  if (typeof projection.reason !== 'string' || projection.reason.length === 0) {
    throw new Error('Permission audit reason is required.');
  }
  if (
    typeof projection.correlationId !== 'string' ||
    projection.correlationId.length === 0
  ) {
    throw new Error('Permission audit correlationId is required.');
  }
  if (
    typeof projection.occurredAt !== 'string' ||
    Number.isNaN(Date.parse(projection.occurredAt))
  ) {
    throw new Error('Permission audit occurredAt must be a valid ISO timestamp.');
  }
}
