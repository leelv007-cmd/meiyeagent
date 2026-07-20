import type { Pool } from 'pg';

import {
  SECURITY_REJECTION_OBJECT_KINDS,
  type SecurityRejectionAuditEvent,
  type SecurityRejectionAuditRepository,
  type SecurityRejectionObjectKind,
} from './security-rejection-audit.js';

export function securityRejectionAccessDeniedAction(
  objectKind: SecurityRejectionObjectKind
) {
  return `${objectKind}_access_denied` as const;
}

const REJECTION_ACTIONS = SECURITY_REJECTION_OBJECT_KINDS.map(
  securityRejectionAccessDeniedAction
);

export class PostgresSecurityRejectionAuditRepository
  implements SecurityRejectionAuditRepository
{
  constructor(private readonly pool: Pool) {}

  async append(event: SecurityRejectionAuditEvent) {
    await this.pool.query(
      `INSERT INTO pro_studio_audit_events
       (workspace_id, action, actor_id, detail, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)`,
      [
        event.workspaceId,
        securityRejectionAccessDeniedAction(event.objectKind),
        event.actorId,
        JSON.stringify(event),
        event.createdAt,
      ]
    );
  }

  async list(input: { actorId: string; workspaceId: string }) {
    const result = await this.pool.query<{
      detail: SecurityRejectionAuditEvent;
    }>(
      `SELECT detail
         FROM pro_studio_audit_events
        WHERE workspace_id = $1
          AND actor_id = $2
          AND action = ANY($3::text[])
          AND detail->>'outcome' = 'opaque_not_found'
          AND detail ? 'targetDigest'
        ORDER BY created_at, id`,
      [input.workspaceId, input.actorId, REJECTION_ACTIONS]
    );
    return structuredClone(result.rows.map((row) => row.detail));
  }
}
