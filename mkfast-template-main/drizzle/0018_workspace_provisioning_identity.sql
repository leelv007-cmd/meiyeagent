ALTER TABLE "workspace_provisioning_outbox"
  ADD COLUMN IF NOT EXISTS "owner_email" text;
--> statement-breakpoint
ALTER TABLE "workspace_provisioning_outbox"
  ADD COLUMN IF NOT EXISTS "owner_name" text;
--> statement-breakpoint
ALTER TABLE "workspace_provisioning_outbox"
  ADD COLUMN IF NOT EXISTS "workspace_name" text;
--> statement-breakpoint
UPDATE "workspace_provisioning_outbox" AS outbox
SET
  "owner_email" = verified_user."email",
  "owner_name" = COALESCE(
    NULLIF(BTRIM(verified_user."name"), ''),
    workspace."name"
  ),
  "workspace_name" = workspace."name"
FROM "user" AS verified_user, "workspaces" AS workspace
WHERE verified_user."id" = outbox."owner_user_id"
  AND workspace."id" = outbox."workspace_id"
  AND (
    outbox."owner_email" IS NULL
    OR outbox."owner_name" IS NULL
    OR outbox."workspace_name" IS NULL
  );
--> statement-breakpoint
ALTER TABLE "workspace_provisioning_outbox"
  ALTER COLUMN "owner_email" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspace_provisioning_outbox"
  ALTER COLUMN "owner_name" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspace_provisioning_outbox"
  ALTER COLUMN "workspace_name" SET NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "bootstrap_verified_user_workspace"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  personal_workspace_id text := 'ws_' || NEW."id";
  personal_workspace_name text := COALESCE(
    NULLIF(BTRIM(NEW."name"), ''),
    NULLIF(SPLIT_PART(LOWER(NEW."email"), '@', 1), ''),
    NEW."id"
  );
  owner_name text := COALESCE(
    NULLIF(BTRIM(NEW."name"), ''),
    personal_workspace_name
  );
BEGIN
  IF NEW."email_verified" IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."email_verified" IS TRUE THEN
    RETURN NEW;
  END IF;

  INSERT INTO "workspaces" ("id", "name")
  VALUES (personal_workspace_id, personal_workspace_name)
  ON CONFLICT ("id") DO NOTHING;

  INSERT INTO "workspace_memberships" ("workspace_id", "user_id", "role")
  VALUES (personal_workspace_id, NEW."id", 'owner')
  ON CONFLICT ("workspace_id", "user_id") DO NOTHING;

  INSERT INTO "workspace_provisioning_outbox" (
    "workspace_id",
    "owner_user_id",
    "owner_email",
    "owner_name",
    "workspace_name"
  )
  VALUES (
    personal_workspace_id,
    NEW."id",
    NEW."email",
    owner_name,
    personal_workspace_name
  )
  ON CONFLICT ("workspace_id") DO NOTHING;

  RETURN NEW;
END;
$$;
