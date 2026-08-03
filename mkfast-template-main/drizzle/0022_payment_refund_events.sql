CREATE TABLE IF NOT EXISTS "payment_refund_events" (
  "provider" text NOT NULL,
  "provider_event_id" text NOT NULL,
  "provider_delivery_id" text NOT NULL,
  "order_id" text NOT NULL,
  "order_merchant_external_id" text NOT NULL,
  "owner_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "scene" text NOT NULL,
  "amount" text NOT NULL,
  "currency" text NOT NULL,
  "event_status" text NOT NULL,
  "raw_payload" text NOT NULL,
  "provider_occurred_at" timestamp with time zone NOT NULL,
  "received_at" timestamp with time zone NOT NULL DEFAULT now(),
  "disposition_status" text NOT NULL DEFAULT 'pending_review',
  "disposition_actor_user_id" text REFERENCES "user"("id") ON DELETE RESTRICT,
  "disposition_note" text,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "payment_refund_events_provider_event_id_pk"
    PRIMARY KEY ("provider", "provider_event_id"),
  CONSTRAINT "payment_refund_events_scene_check"
    CHECK ("scene" = 'refund'),
  CONSTRAINT "payment_refund_events_status_check"
    CHECK ("event_status" IN ('succeeded', 'failed')),
  CONSTRAINT "payment_refund_events_disposition_check"
    CHECK ("disposition_status" IN ('pending_review', 'resolved'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_refund_events_pending_review_idx"
  ON "payment_refund_events" ("disposition_status", "received_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_refund_review_alert_outbox" (
  "provider" text NOT NULL,
  "provider_event_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "attempt_count" integer NOT NULL DEFAULT 0,
  "available_at" timestamp with time zone NOT NULL DEFAULT now(),
  "lease_expires_at" timestamp with time zone,
  "claim_token" text,
  "last_error_code" text,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "payment_refund_review_alert_outbox_pk"
    PRIMARY KEY ("provider", "provider_event_id"),
  CONSTRAINT "payment_refund_review_alert_outbox_status_check"
    CHECK ("status" IN ('pending', 'processing', 'completed')),
  CONSTRAINT "payment_refund_review_alert_outbox_refund_fk"
    FOREIGN KEY ("provider", "provider_event_id")
    REFERENCES "payment_refund_events" ("provider", "provider_event_id")
    ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_refund_review_alert_outbox_ready_idx"
  ON "payment_refund_review_alert_outbox" ("status", "available_at");
