import type { Pool } from 'pg';
import { P1DomainError } from './domain.js';

export type CoreWorkspaceBootstrapInput = {
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
export class PostgresWorkspaceBootstrapper {
  constructor(private readonly pool: Pool) {}

  async bootstrap(
    input: CoreWorkspaceBootstrapInput
  ): Promise<{ created: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
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
