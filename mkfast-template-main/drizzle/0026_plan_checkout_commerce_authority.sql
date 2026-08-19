ALTER TABLE "plan_checkout_bindings"
  ADD COLUMN IF NOT EXISTS "commerce_plan_revision" text,
  ADD COLUMN IF NOT EXISTS "commerce_payment_mapping_revision" integer,
  ADD COLUMN IF NOT EXISTS "commerce_amount_micros" bigint,
  ADD COLUMN IF NOT EXISTS "commerce_currency" text,
  ADD COLUMN IF NOT EXISTS "commerce_tier" text,
  ADD COLUMN IF NOT EXISTS "commerce_period" text,
  ADD COLUMN IF NOT EXISTS "commerce_billing_period" text;
