CREATE TABLE IF NOT EXISTS "credit_package_checkout_bindings" (
  "id" text PRIMARY KEY NOT NULL,
  "provider" text NOT NULL,
  "product_id" text NOT NULL,
  "offer_id" text NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "owner_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "provider_checkout_id" text,
  "provider_order_id" text,
  "provider_payment_event_id" text,
  "status" text NOT NULL DEFAULT 'pending',
  "settlement_status" text NOT NULL DEFAULT 'pending',
  "settlement_claim_token" text,
  "settlement_lease_expires_at" timestamp with time zone,
  "settlement_completed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "credit_package_checkout_bindings_status_check"
    CHECK ("status" IN ('pending', 'checkout_created', 'settled', 'failed')),
  CONSTRAINT "credit_package_checkout_bindings_settlement_status_check"
    CHECK ("settlement_status" IN ('pending', 'processing', 'settled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_package_checkout_bindings_provider_checkout_uidx"
  ON "credit_package_checkout_bindings" ("provider", "provider_checkout_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_package_checkout_bindings_workspace_idx"
  ON "credit_package_checkout_bindings" ("workspace_id", "owner_user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_package_checkout_bindings_waffo_inflight_uidx"
  ON "credit_package_checkout_bindings"
    ("provider", "workspace_id", "owner_user_id", "offer_id")
  WHERE "status" IN ('pending', 'checkout_created');
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_package_checkout_bindings_provider_order_uidx"
  ON "credit_package_checkout_bindings" ("provider", "provider_order_id")
  WHERE "provider_order_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_package_checkout_bindings_provider_payment_event_uidx"
  ON "credit_package_checkout_bindings"
    ("provider", "provider_payment_event_id")
  WHERE "provider_payment_event_id" IS NOT NULL;
