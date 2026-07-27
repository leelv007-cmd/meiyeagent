CREATE TABLE IF NOT EXISTS "admin_assisted_account_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"subject_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "admin_assisted_account_audit_subject_uidx"
ON "admin_assisted_account_audit" USING btree ("subject_user_id");
--> statement-breakpoint
INSERT INTO "admin_assisted_account_audit" (
	"id",
	"action",
	"actor_user_id",
	"subject_user_id",
	"created_at"
)
SELECT
	'admin-assisted-account:' || "id",
	'admin.assisted_account_created',
	"provisioned_by_user_id",
	"id",
	"created_at"
FROM "user"
WHERE "provisioned_by_user_id" IS NOT NULL
ON CONFLICT ("subject_user_id") DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "record_admin_assisted_account_audit"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."provisioned_by_user_id" IS NOT NULL THEN
		INSERT INTO "admin_assisted_account_audit" (
			"id",
			"action",
			"actor_user_id",
			"subject_user_id",
			"created_at"
		)
		VALUES (
			'admin-assisted-account:' || NEW."id",
			'admin.assisted_account_created',
			NEW."provisioned_by_user_id",
			NEW."id",
			NEW."created_at"
		);
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "admin_assisted_account_audit_insert" ON "user";
--> statement-breakpoint
CREATE TRIGGER "admin_assisted_account_audit_insert"
AFTER INSERT ON "user"
FOR EACH ROW
EXECUTE FUNCTION "record_admin_assisted_account_audit"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "reject_admin_assisted_account_audit_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'ADMIN_ASSISTED_ACCOUNT_AUDIT_IMMUTABLE'
		USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "admin_assisted_account_audit_immutable"
ON "admin_assisted_account_audit";
--> statement-breakpoint
CREATE TRIGGER "admin_assisted_account_audit_immutable"
BEFORE UPDATE OR DELETE ON "admin_assisted_account_audit"
FOR EACH ROW
EXECUTE FUNCTION "reject_admin_assisted_account_audit_mutation"();
