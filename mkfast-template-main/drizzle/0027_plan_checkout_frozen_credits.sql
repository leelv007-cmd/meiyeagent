ALTER TABLE "plan_checkout_bindings"
  ADD COLUMN IF NOT EXISTS "commerce_credits" integer;
