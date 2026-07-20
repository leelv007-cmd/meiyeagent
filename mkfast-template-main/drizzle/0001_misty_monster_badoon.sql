CREATE TABLE "payment_webhook_events" (
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "payment_webhook_events_provider_event_id_pk" PRIMARY KEY("provider","event_id")
);
--> statement-breakpoint
ALTER TABLE "workspace_memberships" ALTER COLUMN "workspace_id" SET DEFAULT '';--> statement-breakpoint
CREATE INDEX "payment_webhook_events_status_idx" ON "payment_webhook_events" USING btree ("status");