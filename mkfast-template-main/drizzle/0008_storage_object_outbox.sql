ALTER TABLE "user_files"
ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "user_files"
ADD COLUMN IF NOT EXISTS "purpose" text DEFAULT 'private_file' NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "storage_object_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"operation" text DEFAULT 'delete_object' NOT NULL,
	"reason" text NOT NULL,
	"object_key" text NOT NULL,
	"user_file_id" text,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"claim_token" text,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "storage_object_outbox_ready_idx"
ON "storage_object_outbox" USING btree ("status", "available_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "storage_object_outbox_user_file_idx"
ON "storage_object_outbox" USING btree ("user_file_id");
