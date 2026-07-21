CREATE TABLE IF NOT EXISTS "legacy_avatar_access_claims" (
	"object_key" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"image_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "legacy_avatar_access_claims_user_idx"
ON "legacy_avatar_access_claims" USING btree ("user_id");
--> statement-breakpoint
WITH candidates AS (
	SELECT
		u."id" AS user_id,
		u."image" AS image_url,
		replace(
			replace(
				regexp_replace(
					u."image",
					'^https?://[^/?#]+/api/storage/file\?key=(avatars(?:%2f|/)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(?:[A-Za-z0-9._-]{0,250}\.jpeg|[A-Za-z0-9._-]{0,251}\.(?:jpg|png|webp)))$',
					'\1',
					'i'
				),
				'%2F',
				'/'
			),
			'%2f',
			'/'
		) AS object_key
	FROM "user" u
	WHERE u."image" ~* '^https?://[^/?#]+/api/storage/file\?key=avatars(?:%2f|/)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(?:[A-Za-z0-9._-]{0,250}\.jpeg|[A-Za-z0-9._-]{0,251}\.(?:jpg|png|webp))$'
),
unique_candidates AS (
	SELECT object_key
	FROM candidates
	GROUP BY object_key
	HAVING count(*) = 1
)
INSERT INTO "legacy_avatar_access_claims" ("object_key", "user_id", "image_url")
SELECT candidates.object_key, candidates.user_id, candidates.image_url
FROM candidates
INNER JOIN unique_candidates
	ON unique_candidates.object_key = candidates.object_key
ON CONFLICT ("object_key") DO NOTHING;
--> statement-breakpoint
UPDATE "user_files" AS file
SET "purpose" = 'avatar', "is_public" = true
FROM "legacy_avatar_access_claims" AS claim
WHERE file."r2_key" = claim."object_key"
	AND file."user_id" = claim."user_id"
	AND file."deleted_at" IS NULL
	AND file."is_public" IS TRUE;
--> statement-breakpoint
ALTER TABLE IF EXISTS "pro_studio_asset_deletion_outbox"
	ADD COLUMN IF NOT EXISTS "reason" text NOT NULL DEFAULT 'asset_delete';
--> statement-breakpoint
DO $$
BEGIN
	IF to_regclass('public.pro_studio_asset_deletion_outbox') IS NOT NULL THEN
		BEGIN
			ALTER TABLE "pro_studio_asset_deletion_outbox"
				ADD CONSTRAINT "pro_studio_asset_deletion_outbox_reason_check"
				CHECK ("reason" IN ('asset_delete', 'orphan_compensation'));
		EXCEPTION WHEN duplicate_object THEN
			NULL;
		END;
	END IF;
END $$;
