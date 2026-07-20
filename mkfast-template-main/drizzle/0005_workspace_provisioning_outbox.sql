CREATE TABLE IF NOT EXISTS "workspace_provisioning_outbox" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"trial_status" text DEFAULT 'pending' NOT NULL,
	"model_default_status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"claim_token" text,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "workspace_provisioning_status_check"
		CHECK ("status" IN ('pending', 'processing', 'retry', 'completed')),
	CONSTRAINT "workspace_provisioning_trial_status_check"
		CHECK ("trial_status" IN ('pending', 'completed')),
	CONSTRAINT "workspace_provisioning_model_status_check"
		CHECK ("model_default_status" IN ('pending', 'completed'))
);
--> statement-breakpoint
ALTER TABLE "workspace_provisioning_outbox" ADD CONSTRAINT "workspace_provisioning_outbox_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_provisioning_outbox" ADD CONSTRAINT "workspace_provisioning_outbox_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "workspace_provisioning_outbox_ready_idx" ON "workspace_provisioning_outbox" USING btree ("status","available_at");
--> statement-breakpoint
CREATE INDEX "workspace_provisioning_outbox_owner_idx" ON "workspace_provisioning_outbox" USING btree ("owner_user_id");
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

	INSERT INTO "workspace_provisioning_outbox" ("workspace_id", "owner_user_id")
	VALUES (personal_workspace_id, NEW."id")
	ON CONFLICT ("workspace_id") DO NOTHING;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
-- Existing verified workspaces are already provisioned under the legacy path.
-- Mark them completed so deployment cannot replace a paid plan with trial.
INSERT INTO "workspace_provisioning_outbox" (
	"workspace_id",
	"owner_user_id",
	"status",
	"trial_status",
	"model_default_status",
	"completed_at"
)
SELECT
	membership."workspace_id",
	membership."user_id",
	'completed',
	'completed',
	'completed',
	now()
FROM "workspace_memberships" AS membership
INNER JOIN "user" AS verified_user
	ON verified_user."id" = membership."user_id"
	AND verified_user."email_verified" IS TRUE
WHERE membership."role" = 'owner'
ON CONFLICT ("workspace_id") DO NOTHING;
