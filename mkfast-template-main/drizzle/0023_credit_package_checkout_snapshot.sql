ALTER TABLE "credit_package_checkout_bindings"
  ADD COLUMN IF NOT EXISTS "sku_amount_micros" bigint,
  ADD COLUMN IF NOT EXISTS "sku_currency" text,
  ADD COLUMN IF NOT EXISTS "sku_credits" integer,
  ADD COLUMN IF NOT EXISTS "sku_expire_days" integer,
  ADD COLUMN IF NOT EXISTS "sku_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "payment_refund_events"
  DROP CONSTRAINT IF EXISTS "payment_refund_events_owner_user_id_fkey",
  DROP CONSTRAINT IF EXISTS "payment_refund_events_disposition_actor_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "payment_refund_events"
  ADD CONSTRAINT "payment_refund_events_disposition_actor_user_id_fkey"
  FOREIGN KEY ("disposition_actor_user_id") REFERENCES "user"("id") ON DELETE SET NULL;
