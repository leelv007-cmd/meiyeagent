CREATE TABLE IF NOT EXISTS "plan_checkout_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"price_id" text NOT NULL,
	"payment_type" text NOT NULL,
	"interval" text,
	"workspace_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"provider_checkout_id" text,
	"subscription_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_checkout_bindings" ADD CONSTRAINT "plan_checkout_bindings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "plan_checkout_bindings" ADD CONSTRAINT "plan_checkout_bindings_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plan_checkout_bindings_provider_checkout_uidx" ON "plan_checkout_bindings" USING btree ("provider","provider_checkout_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_checkout_bindings_workspace_id_idx" ON "plan_checkout_bindings" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_checkout_bindings_owner_user_id_idx" ON "plan_checkout_bindings" USING btree ("owner_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_checkout_bindings_subscription_id_idx" ON "plan_checkout_bindings" USING btree ("subscription_id");
