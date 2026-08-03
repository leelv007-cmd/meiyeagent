import assert from 'node:assert/strict';
import test from 'node:test';
import { schema } from '@/db/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { PostgresWorkspaceProvisioningOutbox } from './workspace-provisioning';

const databaseUrl = process.env.TEST_DATABASE_URL;

test(
  'verified-user trigger creates a pending outbox and lease reclaim fences stale workers',
  { skip: !databaseUrl },
  async () => {
    const client = postgres(databaseUrl as string, { max: 1, prepare: false });
    const database = drizzle(client, { schema });
    const suffix = crypto.randomUUID();
    const userId = `provision-owner-${suffix}`;
    const workspaceId = `ws_${userId}`;
    const legacyWorkspaceId = `legacy-provision-workspace-${suffix}`;

    try {
      await installProvisioningOutboxContract(client);
      await client`
        INSERT INTO "user"
          (id, name, email, email_verified, created_at, updated_at)
        VALUES
          (${userId}, 'Provision Owner', ${`${userId}@example.test`}, TRUE, now(), now())
      `;
      const [triggered] = await client<
        Array<{
          owner_user_id: string;
          owner_email: string;
          owner_name: string;
          workspace_name: string;
          status: string;
          trial_status: string;
          model_default_status: string;
        }>
      >`
        SELECT
          owner_user_id,
          owner_email,
          owner_name,
          workspace_name,
          status,
          trial_status,
          model_default_status
        FROM workspace_provisioning_outbox
        WHERE workspace_id = ${workspaceId}
      `;
      assert.deepEqual(triggered, {
        owner_user_id: userId,
        owner_email: `${userId}@example.test`,
        owner_name: 'Provision Owner',
        workspace_name: 'Provision Owner',
        status: 'pending',
        trial_status: 'pending',
        model_default_status: 'pending',
      });
      await client`
        INSERT INTO workspaces (id, name)
        VALUES (${legacyWorkspaceId}, 'Legacy Provision Workspace')
      `;
      await client`
        INSERT INTO workspace_memberships (workspace_id, user_id, role)
        VALUES (${legacyWorkspaceId}, ${userId}, 'owner')
      `;
      await backfillLegacyProvisioningAsCompleted(client);
      const [legacy] = await client<
        Array<{
          status: string;
          trial_status: string;
          model_default_status: string;
        }>
      >`
        SELECT status, trial_status, model_default_status
        FROM workspace_provisioning_outbox
        WHERE workspace_id = ${legacyWorkspaceId}
      `;
      assert.deepEqual(legacy, {
        status: 'completed',
        trial_status: 'completed',
        model_default_status: 'completed',
      });

      const outbox = new PostgresWorkspaceProvisioningOutbox(database);
      const first = await outbox.claim({ ownerUserId: userId, workspaceId });
      assert.ok(first?.claimToken);
      await client`
        UPDATE workspace_provisioning_outbox
        SET lease_expires_at = now() - interval '1 second'
        WHERE workspace_id = ${workspaceId}
      `;
      const second = await outbox.claim({ ownerUserId: userId, workspaceId });
      assert.ok(second?.claimToken);
      assert.notEqual(first.claimToken, second.claimToken);

      await assert.rejects(
        outbox.completeStep(workspaceId, first.claimToken, 'trial'),
        /claim was lost/iu
      );
      await outbox.completeStep(workspaceId, second.claimToken, 'trial');
      await outbox.completeStep(
        workspaceId,
        second.claimToken,
        'model_default'
      );
      await outbox.complete(workspaceId, second.claimToken);
      assert.deepEqual(await outbox.get(workspaceId, userId), {
        claimToken: null,
        lastErrorCode: null,
        modelDefaultStatus: 'completed',
        ownerEmail: `${userId}@example.test`,
        ownerName: 'Provision Owner',
        ownerUserId: userId,
        status: 'completed',
        trialStatus: 'completed',
        workspaceName: 'Provision Owner',
        workspaceId,
      });
    } finally {
      await client`DELETE FROM "user" WHERE id = ${userId}`;
      await client`DELETE FROM workspaces WHERE id = ${workspaceId}`;
      await client`DELETE FROM workspaces WHERE id = ${legacyWorkspaceId}`;
      await client.end();
    }
  }
);

async function installProvisioningOutboxContract(
  client: ReturnType<typeof postgres>
) {
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS workspace_provisioning_outbox (
      workspace_id text PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
      owner_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      owner_email text,
      owner_name text,
      workspace_name text,
      status text NOT NULL DEFAULT 'pending',
      trial_status text NOT NULL DEFAULT 'pending',
      model_default_status text NOT NULL DEFAULT 'pending',
      attempt_count integer NOT NULL DEFAULT 0,
      available_at timestamptz NOT NULL DEFAULT now(),
      lease_expires_at timestamptz,
      claim_token text,
      last_error_code text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz
    );
    ALTER TABLE workspace_provisioning_outbox
      ADD COLUMN IF NOT EXISTS claim_token text;
    ALTER TABLE workspace_provisioning_outbox
      ADD COLUMN IF NOT EXISTS owner_email text;
    ALTER TABLE workspace_provisioning_outbox
      ADD COLUMN IF NOT EXISTS owner_name text;
    ALTER TABLE workspace_provisioning_outbox
      ADD COLUMN IF NOT EXISTS workspace_name text;
    CREATE OR REPLACE FUNCTION bootstrap_verified_user_workspace()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      personal_workspace_id text := 'ws_' || NEW.id;
      personal_workspace_name text := COALESCE(
        NULLIF(BTRIM(NEW.name), ''),
        NULLIF(SPLIT_PART(LOWER(NEW.email), '@', 1), ''),
        NEW.id
      );
    BEGIN
      IF NEW.email_verified IS NOT TRUE THEN RETURN NEW; END IF;
      IF TG_OP = 'UPDATE' AND OLD.email_verified IS TRUE THEN RETURN NEW; END IF;
      INSERT INTO workspaces (id, name)
      VALUES (personal_workspace_id, personal_workspace_name)
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO workspace_memberships (workspace_id, user_id, role)
      VALUES (personal_workspace_id, NEW.id, 'owner')
      ON CONFLICT (workspace_id, user_id) DO NOTHING;
      INSERT INTO workspace_provisioning_outbox (
        workspace_id,
        owner_user_id,
        owner_email,
        owner_name,
        workspace_name
      )
      VALUES (
        personal_workspace_id,
        NEW.id,
        NEW.email,
        COALESCE(NULLIF(BTRIM(NEW.name), ''), personal_workspace_name),
        personal_workspace_name
      )
      ON CONFLICT (workspace_id) DO NOTHING;
      RETURN NEW;
    END;
    $$;
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'user_verified_workspace_bootstrap'
      ) THEN
        CREATE TRIGGER user_verified_workspace_bootstrap
        AFTER INSERT OR UPDATE OF email_verified ON "user"
        FOR EACH ROW EXECUTE FUNCTION bootstrap_verified_user_workspace();
      END IF;
    END;
    $$;
  `);
}

async function backfillLegacyProvisioningAsCompleted(
  client: ReturnType<typeof postgres>
) {
  await client.unsafe(`
    INSERT INTO workspace_provisioning_outbox (
      workspace_id,
      owner_user_id,
      owner_email,
      owner_name,
      workspace_name,
      status,
      trial_status,
      model_default_status,
      completed_at
    )
    SELECT
      membership.workspace_id,
      membership.user_id,
      verified_user.email,
      COALESCE(NULLIF(BTRIM(verified_user.name), ''), workspace.name),
      workspace.name,
      'completed',
      'completed',
      'completed',
      now()
    FROM workspace_memberships AS membership
    INNER JOIN "user" AS verified_user
      ON verified_user.id = membership.user_id
      AND verified_user.email_verified IS TRUE
    INNER JOIN workspaces AS workspace
      ON workspace.id = membership.workspace_id
    WHERE membership.role = 'owner'
    ON CONFLICT (workspace_id) DO NOTHING
  `);
}
