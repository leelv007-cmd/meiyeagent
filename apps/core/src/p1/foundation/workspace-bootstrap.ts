import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { P1DomainError } from './domain.js';
import { insertNewAccountWriteOwnership } from './write-ownership.js';

export type CoreWorkspaceBootstrapInput = {
  idempotencyKey: string;
  ownerEmail: string;
  ownerUserId: string;
  ownerName: string;
  workspaceId: string;
  workspaceName: string;
};

/**
 * Mirrors the authenticated Web workspace identity into the isolated Core DB.
 * Only the private worker endpoint may call this adapter.
 */
type BootstrapReceipt = {
  payload_hash: string;
  created: boolean;
};

export class PostgresWorkspaceBootstrapper {
  constructor(private readonly pool: Pool) {}

  /**
   * Core's schema migrator owns the durable bootstrap receipt table. The write
   * path deliberately never creates schema as a side effect of a request.
   */
  async migrate(client?: PoolClient) {
    const connection = client ?? (await this.pool.connect());
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS p1_workspace_bootstrap_receipts (
          idempotency_key text PRIMARY KEY,
          payload_hash text NOT NULL,
          workspace_id text NOT NULL,
          owner_user_id text NOT NULL,
          created boolean NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS p1_workspace_bootstrap_receipts_workspace_idx
          ON p1_workspace_bootstrap_receipts (workspace_id, created_at);
      `);
    } finally {
      if (!client) connection.release();
    }
  }

  async bootstrap(
    input: CoreWorkspaceBootstrapInput
  ): Promise<{ created: boolean }> {
    const payloadHash = workspaceBootstrapPayloadHash(input);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [input.idempotencyKey]
      );
      const existingReceipt = await client.query<BootstrapReceipt>(
        `SELECT payload_hash, created
           FROM p1_workspace_bootstrap_receipts
          WHERE idempotency_key = $1
          FOR UPDATE`,
        [input.idempotencyKey]
      );
      if (existingReceipt.rows[0]) {
        if (existingReceipt.rows[0].payload_hash !== payloadHash) {
          throw new P1DomainError(
            'IDEMPOTENCY_CONFLICT',
            'The workspace bootstrap idempotency key was already used for different facts.'
          );
        }
        await client.query('COMMIT');
        return { created: existingReceipt.rows[0].created };
      }

      await client.query(
        `INSERT INTO "user" (id, name, email, email_verified)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (id) DO NOTHING`,
        [input.ownerUserId, input.ownerName, input.ownerEmail]
      );
      const owner = await client.query<{
        email: string;
        email_verified: boolean;
      }>(
        `SELECT email, email_verified
           FROM "user"
          WHERE id = $1
          FOR UPDATE`,
        [input.ownerUserId]
      );
      if (
        owner.rows[0]?.email !== input.ownerEmail ||
        owner.rows[0]?.email_verified !== true
      ) {
        throw new P1DomainError(
          'INVALID_STATE',
          'The Core user does not match the verified Web user.'
        );
      }
      const inserted = await client.query(
        `INSERT INTO workspaces (id, name)
         VALUES ($1, $2)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [input.workspaceId, input.workspaceName]
      );
      const created = inserted.rowCount === 1;
      if (created) {
        await client.query(
          `INSERT INTO workspace_memberships (workspace_id, user_id, role)
           VALUES ($1, $2, 'owner')`,
          [input.workspaceId, input.ownerUserId]
        );
      } else {
        const membership = await client.query<{ role: string }>(
          `SELECT role
             FROM workspace_memberships
            WHERE workspace_id = $1 AND user_id = $2
            FOR UPDATE`,
          [input.workspaceId, input.ownerUserId]
        );
        if (membership.rows[0]?.role !== 'owner') {
          throw new P1DomainError(
            'INVALID_STATE',
            'The Core workspace is not owned by the verified Web user.'
          );
        }
      }
      // Seed even when Web already inserted the workspace in a shared DB.
      // ON CONFLICT DO NOTHING: never overwrite legacy/frozen rows.
      await insertNewAccountWriteOwnership(client, input.workspaceId);
      await client.query(
        `INSERT INTO p1_workspace_bootstrap_receipts (
           idempotency_key,
           payload_hash,
           workspace_id,
           owner_user_id,
           created
         ) VALUES ($1, $2, $3, $4, $5)`,
        [
          input.idempotencyKey,
          payloadHash,
          input.workspaceId,
          input.ownerUserId,
          created,
        ]
      );
      await client.query('COMMIT');
      return { created };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

function workspaceBootstrapPayloadHash(input: CoreWorkspaceBootstrapInput) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        ownerEmail: input.ownerEmail,
        ownerName: input.ownerName,
        ownerUserId: input.ownerUserId,
        workspaceId: input.workspaceId,
        workspaceName: input.workspaceName,
      })
    )
    .digest('hex');
}
