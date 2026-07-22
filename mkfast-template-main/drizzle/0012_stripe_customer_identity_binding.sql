CREATE TABLE IF NOT EXISTS "stripe_customer_binding_audit" (
	"customer_id" text NOT NULL,
	"user_id" text NOT NULL,
	"reason" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_customer_binding_audit_pkey" PRIMARY KEY("customer_id","user_id")
);
--> statement-breakpoint
INSERT INTO "stripe_customer_binding_audit" ("customer_id", "user_id", "reason")
SELECT "customer_id", "id", 'duplicate_customer_id'
FROM "user"
WHERE "customer_id" IS NOT NULL
	AND "customer_id" IN (
		SELECT "customer_id"
		FROM "user"
		WHERE "customer_id" IS NOT NULL
		GROUP BY "customer_id"
		HAVING count(*) > 1
	)
ON CONFLICT ("customer_id", "user_id") DO NOTHING;
--> statement-breakpoint
UPDATE "user"
SET "customer_id" = NULL, "updated_at" = now()
WHERE "customer_id" IS NOT NULL
	AND "customer_id" IN (
		SELECT "customer_id"
		FROM "user"
		WHERE "customer_id" IS NOT NULL
		GROUP BY "customer_id"
		HAVING count(*) > 1
	);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_customer_id_uidx"
ON "user" USING btree ("customer_id")
WHERE "customer_id" IS NOT NULL;
