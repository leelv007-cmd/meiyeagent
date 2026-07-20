ALTER TABLE "workspace_provisioning_outbox"
ADD COLUMN IF NOT EXISTS "claim_token" text;
