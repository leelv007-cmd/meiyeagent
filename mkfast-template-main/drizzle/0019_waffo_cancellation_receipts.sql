CREATE TABLE IF NOT EXISTS "waffo_subscription_cancellation_receipts" (
  "subscription_id" text NOT NULL,
  "period_starts_at" timestamp with time zone NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "requested_at" timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at" timestamp with time zone,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "waffo_subscription_cancellation_receipts_pk"
    PRIMARY KEY ("subscription_id", "period_starts_at"),
  CONSTRAINT "waffo_subscription_cancellation_receipts_status_check"
    CHECK ("status" IN ('pending', 'completed'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "waffo_subscription_cancellation_receipts_status_idx"
  ON "waffo_subscription_cancellation_receipts" ("status");
