ALTER TABLE "workspace_provisioning_outbox"
  DROP CONSTRAINT IF EXISTS "workspace_provisioning_status_check";
--> statement-breakpoint
ALTER TABLE "workspace_provisioning_outbox"
  ADD CONSTRAINT "workspace_provisioning_status_check"
  CHECK ("status" IN ('pending', 'processing', 'retry', 'completed', 'dead_letter'));
