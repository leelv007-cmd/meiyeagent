CREATE TABLE IF NOT EXISTS "pro_studio_checkout_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"offer_id" text NOT NULL,
	"price_id" text NOT NULL,
	"payment_type" text NOT NULL,
	"interval" text,
	"workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
	"owner_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
	"owner_session_id" text REFERENCES "session"("id") ON DELETE set null,
	"provider_checkout_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pro_studio_checkout_bindings"
	ADD COLUMN IF NOT EXISTS "payment_type" text,
	ADD COLUMN IF NOT EXISTS "interval" text;
--> statement-breakpoint
DELETE FROM "pro_studio_checkout_bindings" WHERE "payment_type" IS NULL;
--> statement-breakpoint
ALTER TABLE "pro_studio_checkout_bindings"
	ALTER COLUMN "payment_type" SET NOT NULL,
	ALTER COLUMN "owner_session_id" DROP NOT NULL,
	DROP COLUMN IF EXISTS "plan_id";
--> statement-breakpoint
ALTER TABLE "pro_studio_checkout_bindings"
	DROP CONSTRAINT IF EXISTS "pro_studio_checkout_bindings_owner_session_id_session_id_fk",
	DROP CONSTRAINT IF EXISTS "pro_studio_checkout_bindings_owner_session_id_fkey";
--> statement-breakpoint
ALTER TABLE "pro_studio_checkout_bindings"
	ADD CONSTRAINT "pro_studio_checkout_bindings_owner_session_id_session_id_fk"
	FOREIGN KEY ("owner_session_id") REFERENCES "session"("id") ON DELETE set null;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pro_studio_payment_claims" (
	"payment_id" text PRIMARY KEY NOT NULL REFERENCES "payment"("id") ON DELETE cascade,
	"payment_event_id" text NOT NULL UNIQUE,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"provider_checkout_id" text NOT NULL,
	"offer_id" text NOT NULL,
	"workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
	"owner_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
	"price_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"activation_attempts" integer DEFAULT 0 NOT NULL,
	"activation_available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activation_lease_until" timestamp with time zone,
	"last_activation_error" text,
	"activated_at" timestamp with time zone,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pro_studio_payment_claims"
	ADD COLUMN IF NOT EXISTS "provider" text,
	ADD COLUMN IF NOT EXISTS "provider_event_id" text,
	ADD COLUMN IF NOT EXISTS "provider_checkout_id" text,
	ADD COLUMN IF NOT EXISTS "offer_id" text,
	ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'pending',
	ADD COLUMN IF NOT EXISTS "activation_attempts" integer DEFAULT 0,
	ADD COLUMN IF NOT EXISTS "activation_available_at" timestamp with time zone DEFAULT now(),
	ADD COLUMN IF NOT EXISTS "activation_lease_until" timestamp with time zone,
	ADD COLUMN IF NOT EXISTS "last_activation_error" text,
	ADD COLUMN IF NOT EXISTS "activated_at" timestamp with time zone;
--> statement-breakpoint
DELETE FROM "pro_studio_payment_claims"
WHERE "provider" IS NULL OR "provider_event_id" IS NULL
	OR "provider_checkout_id" IS NULL OR "offer_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "pro_studio_payment_claims"
	ALTER COLUMN "provider" SET NOT NULL,
	ALTER COLUMN "provider_event_id" SET NOT NULL,
	ALTER COLUMN "provider_checkout_id" SET NOT NULL,
	ALTER COLUMN "offer_id" SET NOT NULL,
	ALTER COLUMN "status" SET NOT NULL,
	ALTER COLUMN "activation_attempts" SET NOT NULL,
	ALTER COLUMN "activation_available_at" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pro_studio_checkout_bindings_provider_checkout_uidx" ON "pro_studio_checkout_bindings" USING btree ("provider","provider_checkout_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pro_studio_checkout_bindings_workspace_id_idx" ON "pro_studio_checkout_bindings" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pro_studio_checkout_bindings_owner_user_id_idx" ON "pro_studio_checkout_bindings" USING btree ("owner_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pro_studio_payment_claims_workspace_id_idx" ON "pro_studio_payment_claims" USING btree ("workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pro_studio_payment_claims_provider_event_uidx" ON "pro_studio_payment_claims" USING btree ("provider","provider_event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pro_studio_payment_claims_activation_due_idx" ON "pro_studio_payment_claims" USING btree ("status","activation_available_at");
