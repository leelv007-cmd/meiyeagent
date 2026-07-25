ALTER TABLE "user"
ADD COLUMN IF NOT EXISTS "provisioned_by_user_id" text;
