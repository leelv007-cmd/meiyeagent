import type { Pool } from 'pg';

import type {
  SecurityRejectionAuditEvent,
  SecurityRejectionAuditRepository,
} from './security-rejection-audit.js';

const REJECTION_ACTION = 'security.object_access_rejected';

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
        REJECTION_ACTION,
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
          AND action = 'security.object_access_rejected'
        ORDER BY created_at, id`,
      [input.workspaceId, input.actorId]
    );
    return structuredClone(result.rows.map((row) => row.detail));
  }
}
