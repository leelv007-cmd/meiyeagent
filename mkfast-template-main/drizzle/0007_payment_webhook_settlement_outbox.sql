ALTER TABLE "payment_webhook_events"
ADD COLUMN IF NOT EXISTS "verified_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE "payment_webhook_settlement_outbox" (
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"payload" text NOT NULL,
	"signature" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"claim_token" text,
	"last_error_code" text,
	"provider_applied_at" timestamp with time zone,
	"normalized_event" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "payment_webhook_settlement_outbox_provider_event_id_pk"
		PRIMARY KEY("provider","event_id"),
	CONSTRAINT "payment_webhook_settlement_outbox_status_check"
		CHECK ("status" IN ('pending', 'processing', 'retry', 'completed')),
	CONSTRAINT "payment_webhook_settlement_outbox_event_fk"
		FOREIGN KEY ("provider","event_id")
		REFERENCES "payment_webhook_events"("provider","event_id")
		ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX "payment_webhook_settlement_outbox_ready_idx"
ON "payment_webhook_settlement_outbox" USING btree ("status","available_at");
