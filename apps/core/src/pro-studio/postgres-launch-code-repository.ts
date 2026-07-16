import type { Pool, QueryResultRow } from 'pg';
import type {
  LaunchCodeRepository,
  StoredCanvasSession,
  StoredLaunchCode,
} from './launch-code.js';

interface LaunchRow extends QueryResultRow {
  absoluteExpiresAt: string;
  audience: StoredCanvasSession['audience'];
  bootstrap: StoredCanvasSession['bootstrap'] | null;
  createdAt: string;
  idleExpiresAt: string;
  lastSeenAt: string;
  mainSessionId: string;
  revokedAt: string | null;
  sessionTokenHash: string;
  userId: string;
  workspaceId: string;
}

export class PostgresLaunchCodeRepository implements LaunchCodeRepository {
  constructor(private readonly pool: Pool) {}

  async insertLaunchCode(record: StoredLaunchCode) {
    await this.pool.query(
      `INSERT INTO pro_studio_launch_codes
       (code_hash, browser_nonce_hash, main_session_id, user_id, workspace_id,
        audience, bootstrap, issued_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::timestamptz,$9::timestamptz)`,
      [
        record.codeHash,
        record.browserNonceHash,
        record.mainSessionId,
        record.userId,
        record.workspaceId,
        JSON.stringify(record.audience),
        record.bootstrap ? JSON.stringify(record.bootstrap) : null,
        record.issuedAt,
        record.expiresAt,
      ]
    );
  }

  async consumeAndCreateSession(input: {
    browserNonceHash: string;
    codeHash: string;
    now: string;
    session: Omit<
      StoredCanvasSession,
      'audience' | 'mainSessionId' | 'userId' | 'workspaceId'
    >;
  }) {
    const result = await this.pool.query<LaunchRow>(
      `WITH consumed AS (
         UPDATE pro_studio_launch_codes
            SET consumed_at = $3::timestamptz
          WHERE code_hash = $1
            AND browser_nonce_hash = $2
            AND consumed_at IS NULL
            AND expires_at > $3::timestamptz
          RETURNING main_session_id, user_id, workspace_id, audience, bootstrap
       ), inserted AS (
         INSERT INTO pro_studio_canvas_sessions
           (session_token_hash, main_session_id, user_id, workspace_id, audience, bootstrap,
            created_at, last_seen_at, idle_expires_at, absolute_expires_at)
         SELECT $4, main_session_id, user_id, workspace_id, audience, bootstrap,
                $5::timestamptz, $6::timestamptz, $7::timestamptz, $8::timestamptz
           FROM consumed
         RETURNING session_token_hash AS "sessionTokenHash",
                   main_session_id AS "mainSessionId", user_id AS "userId",
                   workspace_id AS "workspaceId", audience,
                   bootstrap,
                   created_at::text AS "createdAt",
                   last_seen_at::text AS "lastSeenAt",
                   idle_expires_at::text AS "idleExpiresAt",
                   absolute_expires_at::text AS "absoluteExpiresAt",
                   revoked_at::text AS "revokedAt"
       )
       SELECT * FROM inserted`,
      [
        input.codeHash,
        input.browserNonceHash,
        input.now,
        input.session.sessionTokenHash,
        input.session.createdAt,
        input.session.lastSeenAt,
        input.session.idleExpiresAt,
        input.session.absoluteExpiresAt,
      ]
    );
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async getAndTouchSession(input: {
    idleExpiresAt: string;
    now: string;
    sessionTokenHash: string;
  }) {
    const result = await this.pool.query<LaunchRow>(
      `UPDATE pro_studio_canvas_sessions
          SET last_seen_at = $2::timestamptz,
              idle_expires_at = LEAST($3::timestamptz, absolute_expires_at)
        WHERE session_token_hash = $1
          AND revoked_at IS NULL
          AND idle_expires_at > $2::timestamptz
          AND absolute_expires_at > $2::timestamptz
        RETURNING session_token_hash AS "sessionTokenHash",
                  main_session_id AS "mainSessionId", user_id AS "userId",
                  workspace_id AS "workspaceId", audience,
                  bootstrap,
                  created_at::text AS "createdAt",
                  last_seen_at::text AS "lastSeenAt",
                  idle_expires_at::text AS "idleExpiresAt",
                  absolute_expires_at::text AS "absoluteExpiresAt",
                  revoked_at::text AS "revokedAt"`,
      [input.sessionTokenHash, input.now, input.idleExpiresAt]
    );
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async revokeSession(sessionTokenHash: string, revokedAt: string) {
    await this.pool.query(
      `UPDATE pro_studio_canvas_sessions
          SET revoked_at = COALESCE(revoked_at, $2::timestamptz)
        WHERE session_token_hash = $1`,
      [sessionTokenHash, revokedAt]
    );
  }
}

function mapSession(row: LaunchRow): StoredCanvasSession {
  return {
    absoluteExpiresAt: row.absoluteExpiresAt,
    audience: row.audience,
    ...(row.bootstrap ? { bootstrap: row.bootstrap } : {}),
    createdAt: row.createdAt,
    idleExpiresAt: row.idleExpiresAt,
    lastSeenAt: row.lastSeenAt,
    mainSessionId: row.mainSessionId,
    ...(row.revokedAt ? { revokedAt: row.revokedAt } : {}),
    sessionTokenHash: row.sessionTokenHash,
    userId: row.userId,
    workspaceId: row.workspaceId,
  };
}
