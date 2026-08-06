CREATE TABLE IF NOT EXISTS "admin_role_change_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text NOT NULL,
	"subject_user_id" text NOT NULL,
	"from_role" text NOT NULL,
	"to_role" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_role_change_audit_subject_idx"
ON "admin_role_change_audit" USING btree ("subject_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_role_change_audit_actor_idx"
ON "admin_role_change_audit" USING btree ("actor_user_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "reject_admin_role_change_audit_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'ADMIN_ROLE_CHANGE_AUDIT_IMMUTABLE'
		USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "admin_role_change_audit_immutable"
ON "admin_role_change_audit";
--> statement-breakpoint
CREATE TRIGGER "admin_role_change_audit_immutable"
BEFORE UPDATE OR DELETE ON "admin_role_change_audit"
FOR EACH ROW
EXECUTE FUNCTION "reject_admin_role_change_audit_mutation"();
