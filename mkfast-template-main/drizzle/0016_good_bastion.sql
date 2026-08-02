ALTER TABLE "payment" ADD COLUMN "provider" text;--> statement-breakpoint
CREATE INDEX "payment_provider_idx" ON "payment" USING btree ("provider");