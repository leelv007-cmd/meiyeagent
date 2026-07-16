CREATE FUNCTION "prevent_last_platform_admin"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD."role" = 'admin'
		AND (TG_OP = 'DELETE' OR NEW."role" IS DISTINCT FROM 'admin') THEN
		PERFORM pg_advisory_xact_lock(hashtext('meiye:last-platform-admin'));
		IF NOT EXISTS (
			SELECT 1
			FROM "user"
			WHERE "role" = 'admin' AND "id" <> OLD."id"
		) THEN
			RAISE EXCEPTION 'LAST_ADMIN_REQUIRED'
				USING ERRCODE = '23514';
		END IF;
	END IF;
	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "last_platform_admin_guard"
BEFORE DELETE OR UPDATE OF "role" ON "user"
FOR EACH ROW
EXECUTE FUNCTION "prevent_last_platform_admin"();
