-- Add identity columns without constraints before the existing rows are
-- backfilled by the following migration.
ALTER TABLE "workspace_provisioning_outbox"
  ADD COLUMN IF NOT EXISTS "owner_email" text;
--> statement-breakpoint
ALTER TABLE "workspace_provisioning_outbox"
  ADD COLUMN IF NOT EXISTS "owner_name" text;
--> statement-breakpoint
ALTER TABLE "workspace_provisioning_outbox"
  ADD COLUMN IF NOT EXISTS "workspace_name" text;
