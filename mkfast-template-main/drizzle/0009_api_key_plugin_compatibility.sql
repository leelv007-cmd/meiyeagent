ALTER TABLE "apikey"
ADD COLUMN IF NOT EXISTS "config_id" text;
--> statement-breakpoint
UPDATE "apikey"
SET "config_id" = 'default'
WHERE "config_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "apikey"
ALTER COLUMN "config_id" SET DEFAULT 'default';
--> statement-breakpoint
ALTER TABLE "apikey"
ALTER COLUMN "config_id" SET NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "apikey_configId_idx"
ON "apikey" USING btree ("config_id");
