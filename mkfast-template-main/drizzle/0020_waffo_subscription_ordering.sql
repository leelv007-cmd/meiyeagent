ALTER TABLE payment
  ADD COLUMN IF NOT EXISTS "waffo_provider_occurred_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "waffo_event_id" text,
  ADD COLUMN IF NOT EXISTS "waffo_event_rank" integer;
--> statement-breakpoint
ALTER TABLE plan_checkout_bindings
  ADD COLUMN IF NOT EXISTS "replaces_subscription_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_checkout_bindings_replaces_subscription_id_idx"
  ON plan_checkout_bindings (replaces_subscription_id);
--> statement-breakpoint
UPDATE plan_checkout_bindings SET status = 'failed', updated_at = now()
WHERE provider = 'waffo'
  AND status IN ('pending', 'checkout_created')
  AND id NOT IN (
    SELECT DISTINCT ON (owner_user_id, workspace_id) id
    FROM plan_checkout_bindings
    WHERE provider = 'waffo' AND status IN ('pending', 'checkout_created')
    ORDER BY owner_user_id, workspace_id, updated_at DESC
  );
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plan_checkout_bindings_waffo_inflight_uidx"
  ON plan_checkout_bindings (owner_user_id, workspace_id)
  WHERE provider = 'waffo' AND status IN ('pending', 'checkout_created');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "waffo_subscription_changes" (
  "subscription_id" text PRIMARY KEY,
  "workspace_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "target_price_id" text NOT NULL,
  "target_interval" text NOT NULL,
  "effective_at" timestamp with time zone NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "waffo_subscription_changes_status_check"
    CHECK ("status" IN ('pending', 'applied', 'canceled'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "waffo_subscription_changes_workspace_idx"
  ON waffo_subscription_changes (workspace_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "waffo_subscription_changes_status_idx"
  ON waffo_subscription_changes (status);
--> statement-breakpoint
ALTER TABLE "waffo_subscription_cancellation_receipts"
  ADD COLUMN IF NOT EXISTS "attempt_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "available_at" timestamp with time zone NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "claim_token" text,
  ADD COLUMN IF NOT EXISTS "last_error_code" text;
--> statement-breakpoint
ALTER TABLE "waffo_subscription_cancellation_receipts"
  DROP CONSTRAINT IF EXISTS "waffo_subscription_cancellation_receipts_status_check";
--> statement-breakpoint
ALTER TABLE "waffo_subscription_cancellation_receipts"
  ADD CONSTRAINT "waffo_subscription_cancellation_receipts_status_check"
  CHECK ("status" IN ('pending', 'processing', 'completed'));
