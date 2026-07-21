import type { Pool, PoolClient } from 'pg';
import {
  migratePostgresSchema,
  type PostgresSchemaMigrator,
} from '../postgres-schema-migration.js';

export class PostgresProStudioMigration implements PostgresSchemaMigrator {
  async migrate(client: PoolClient) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS pro_studio_launch_codes (
        code_hash text NOT NULL UNIQUE,
        browser_nonce_hash text NOT NULL,
        main_session_id text NOT NULL REFERENCES session(id) ON DELETE CASCADE,
        user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        audience jsonb NOT NULL,
        bootstrap jsonb,
        issued_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz,
        CHECK (expires_at > issued_at)
      );
      CREATE INDEX IF NOT EXISTS pro_studio_launch_expiry_idx
        ON pro_studio_launch_codes (expires_at)
        WHERE consumed_at IS NULL;

      CREATE TABLE IF NOT EXISTS pro_studio_canvas_sessions (
        session_token_hash text PRIMARY KEY,
        main_session_id text NOT NULL REFERENCES session(id) ON DELETE CASCADE,
        user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        audience jsonb NOT NULL,
        bootstrap jsonb,
        created_at timestamptz NOT NULL,
        last_seen_at timestamptz NOT NULL,
        idle_expires_at timestamptz NOT NULL,
        absolute_expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        CHECK (idle_expires_at > created_at),
        CHECK (absolute_expires_at > created_at)
      );
      CREATE INDEX IF NOT EXISTS pro_studio_canvas_session_expiry_idx
        ON pro_studio_canvas_sessions (idle_expires_at, absolute_expires_at)
        WHERE revoked_at IS NULL;

      CREATE TABLE IF NOT EXISTS advanced_canvas_projects (
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        id text NOT NULL,
        name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
        graph jsonb NOT NULL,
        draft_version bigint NOT NULL CHECK (draft_version > 0),
        created_by text NOT NULL REFERENCES "user"(id),
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        deleted_at timestamptz,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE INDEX IF NOT EXISTS advanced_canvas_projects_active_idx
        ON advanced_canvas_projects (workspace_id, updated_at DESC, id)
        WHERE deleted_at IS NULL;

      CREATE TABLE IF NOT EXISTS advanced_canvas_revisions (
        workspace_id text NOT NULL,
        project_id text NOT NULL,
        id text NOT NULL,
        graph jsonb NOT NULL,
        draft_version bigint NOT NULL CHECK (draft_version > 0),
        reason text NOT NULL CHECK (reason IN ('checkpoint', 'adoption', 'agent')),
        label text,
        created_by text NOT NULL REFERENCES "user"(id),
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id),
        FOREIGN KEY (workspace_id, project_id)
          REFERENCES advanced_canvas_projects(workspace_id, id)
          ON DELETE RESTRICT
      );
      CREATE INDEX IF NOT EXISTS advanced_canvas_revision_history_idx
        ON advanced_canvas_revisions (workspace_id, project_id, created_at, id);

      CREATE TABLE IF NOT EXISTS pro_studio_owned_assets (
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        id text NOT NULL,
        object_key text NOT NULL,
        legacy_storage_key text,
        sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
        size_bytes bigint NOT NULL CHECK (size_bytes > 0),
        content_type text NOT NULL,
        file_name text NOT NULL,
        source jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id),
        UNIQUE (workspace_id, object_key),
        UNIQUE (workspace_id, legacy_storage_key)
      );
      CREATE INDEX IF NOT EXISTS pro_studio_owned_assets_created_idx
        ON pro_studio_owned_assets (workspace_id, created_at, id);
      ALTER TABLE pro_studio_owned_assets
        ADD COLUMN IF NOT EXISTS tombstoned_at timestamptz;
      CREATE TABLE IF NOT EXISTS pro_studio_asset_deletion_outbox (
        id text PRIMARY KEY,
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        asset_id text NOT NULL,
        object_key text NOT NULL,
        reason text NOT NULL DEFAULT 'asset_delete'
          CHECK (reason IN ('asset_delete', 'orphan_compensation')),
        status text NOT NULL CHECK (status IN ('pending', 'claimed', 'completed')),
        claim_token text,
        lease_expires_at timestamptz,
        created_at timestamptz NOT NULL,
        completed_at timestamptz,
        UNIQUE (workspace_id, asset_id)
      );
      CREATE INDEX IF NOT EXISTS pro_studio_asset_deletion_pending_idx
        ON pro_studio_asset_deletion_outbox (status, created_at, id);
      ALTER TABLE pro_studio_asset_deletion_outbox
        ADD COLUMN IF NOT EXISTS reason text NOT NULL DEFAULT 'asset_delete';
      ALTER TABLE pro_studio_asset_deletion_outbox
        DROP CONSTRAINT IF EXISTS pro_studio_asset_deletion_outbox_reason_check;
      ALTER TABLE pro_studio_asset_deletion_outbox
        ADD CONSTRAINT pro_studio_asset_deletion_outbox_reason_check
          CHECK (reason IN ('asset_delete', 'orphan_compensation'));

      CREATE TABLE IF NOT EXISTS pro_studio_audit_events (
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        id bigserial PRIMARY KEY,
        action text NOT NULL,
        project_id text,
        actor_id text NOT NULL,
        detail jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS pro_studio_audit_workspace_idx
        ON pro_studio_audit_events (workspace_id, created_at, id);
    `);
  }
}

export function migrateProStudioSchema(pool: Pool) {
  return migratePostgresSchema(pool, [new PostgresProStudioMigration()]);
}
