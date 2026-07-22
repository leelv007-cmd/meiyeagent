ALTER TABLE "user_files"
ADD COLUMN IF NOT EXISTS "storage_revision" text;
--> statement-breakpoint
ALTER TABLE "storage_object_outbox"
ADD COLUMN IF NOT EXISTS "receipt_storage_revision" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "storage_object_cleanup_claims" (
	"workspace_id" text NOT NULL,
	"object_key" text NOT NULL,
	"status" text NOT NULL CHECK (
		"status" IN ('deleting', 'delete_failed', 'deleted', 'referenced', 'registration_recovered')
	),
	"receipt_storage_revision" text,
	"delete_attempt_count" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	PRIMARY KEY ("workspace_id", "object_key")
);
