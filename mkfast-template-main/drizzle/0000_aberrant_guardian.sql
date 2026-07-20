CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apikey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"start" text,
	"prefix" text,
	"key" text NOT NULL,
	"user_id" text NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp with time zone,
	"enabled" boolean DEFAULT true,
	"rate_limit_enabled" boolean DEFAULT true,
	"rate_limit_time_window" integer DEFAULT 86400000,
	"rate_limit_max" integer DEFAULT 10,
	"request_count" integer DEFAULT 0,
	"remaining" integer,
	"last_request" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"normalized_email" text,
	"customer_id" text,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_normalized_email_unique" UNIQUE("normalized_email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" text PRIMARY KEY NOT NULL,
	"price_id" text NOT NULL,
	"user_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"subscription_id" text,
	"session_id" text,
	"invoice_id" text,
	"type" text NOT NULL,
	"scene" text,
	"interval" text,
	"status" text NOT NULL,
	"paid" boolean DEFAULT false NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"cancel_at_period_end" boolean,
	"trial_start" timestamp with time zone,
	"trial_end" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "payment_invoice_id_unique" UNIQUE("invoice_id")
);
--> statement-breakpoint
CREATE TABLE "user_files" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text DEFAULT '' NOT NULL,
	"filename" text NOT NULL,
	"original_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"r2_key" text NOT NULL,
	"is_public" boolean,
	"description" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_memberships" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_memberships_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_files" ADD CONSTRAINT "user_files_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_files" ADD CONSTRAINT "user_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "apikey_key_idx" ON "apikey" USING btree ("key");--> statement-breakpoint
CREATE INDEX "apikey_userId_idx" ON "apikey" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "payment_user_id_idx" ON "payment" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payment_customer_id_idx" ON "payment" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "payment_subscription_id_idx" ON "payment" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "payment_session_id_idx" ON "payment" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "payment_invoice_id_idx" ON "payment" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payment_paid_idx" ON "payment" USING btree ("paid");--> statement-breakpoint
CREATE INDEX "payment_user_paid_idx" ON "payment" USING btree ("user_id","paid");--> statement-breakpoint
CREATE INDEX "user_files_user_id_idx" ON "user_files" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_files_workspace_id_idx" ON "user_files" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "user_files_r2_key_idx" ON "user_files" USING btree ("r2_key");--> statement-breakpoint
CREATE INDEX "workspace_memberships_user_id_idx" ON "workspace_memberships" USING btree ("user_id");
--> statement-breakpoint
CREATE FUNCTION "assign_user_file_workspace"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."workspace_id" = '' THEN
		SELECT "workspace_id"
		INTO NEW."workspace_id"
		FROM "workspace_memberships"
		WHERE "user_id" = NEW."user_id"
		ORDER BY "created_at", "workspace_id"
		LIMIT 1;
	END IF;

	IF NEW."workspace_id" IS NULL OR NEW."workspace_id" = '' THEN
		RAISE EXCEPTION 'No workspace membership found for user %', NEW."user_id";
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "user_file_workspace_default"
BEFORE INSERT ON "user_files"
FOR EACH ROW
EXECUTE FUNCTION "assign_user_file_workspace"();
--> statement-breakpoint
CREATE FUNCTION "bootstrap_verified_user_workspace"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	personal_workspace_id text := 'ws_' || NEW."id";
	personal_workspace_name text := COALESCE(
		NULLIF(BTRIM(NEW."name"), ''),
		NULLIF(SPLIT_PART(LOWER(NEW."email"), '@', 1), ''),
		NEW."id"
	);
BEGIN
	IF NEW."email_verified" IS NOT TRUE THEN
		RETURN NEW;
	END IF;

	IF TG_OP = 'UPDATE' AND OLD."email_verified" IS TRUE THEN
		RETURN NEW;
	END IF;

	INSERT INTO "workspaces" ("id", "name")
	VALUES (personal_workspace_id, personal_workspace_name)
	ON CONFLICT ("id") DO NOTHING;

	INSERT INTO "workspace_memberships" ("workspace_id", "user_id", "role")
	VALUES (personal_workspace_id, NEW."id", 'owner')
	ON CONFLICT ("workspace_id", "user_id") DO NOTHING;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "user_verified_workspace_bootstrap"
AFTER INSERT OR UPDATE OF "email_verified" ON "user"
FOR EACH ROW
EXECUTE FUNCTION "bootstrap_verified_user_workspace"();
