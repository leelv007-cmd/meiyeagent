-- Do not repair historical payment rows in this migration. Duplicate
-- non-null session/subscription keys must be audited and cleaned explicitly
-- before this schema contract can be installed.
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "payment"
		WHERE "session_id" IS NOT NULL
		GROUP BY "session_id"
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'Cannot add payment_session_id_unique: clean duplicate non-null payment.session_id rows first';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "payment"
		WHERE "subscription_id" IS NOT NULL
		GROUP BY "subscription_id"
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'Cannot add payment_subscription_id_unique: clean duplicate non-null payment.subscription_id rows first';
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "payment_webhook_settlement_outbox"
DROP CONSTRAINT IF EXISTS "payment_webhook_settlement_outbox_event_fk";
--> statement-breakpoint
ALTER TABLE "payment_webhook_settlement_outbox"
ADD CONSTRAINT "payment_webhook_settlement_outbox_event_fk"
FOREIGN KEY ("provider", "event_id")
REFERENCES "payment_webhook_events"("provider", "event_id")
ON DELETE RESTRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_session_id_unique"
ON "payment" USING btree ("session_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_subscription_id_unique"
ON "payment" USING btree ("subscription_id");
