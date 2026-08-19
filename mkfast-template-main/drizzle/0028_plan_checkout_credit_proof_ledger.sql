-- Forward-only schema step for databases that already recorded migration 0027.
CREATE TABLE IF NOT EXISTS "plan_checkout_binding_credit_proofs" (
  "binding_id" text PRIMARY KEY REFERENCES "plan_checkout_bindings"("id") ON DELETE RESTRICT,
  "disposition" text NOT NULL CHECK (
    "disposition" IN ('backfill_frozen_credits', 'rebuild_confirmed_no_provider_effect')
  ),
  "credits" integer,
  "authority_snapshot" jsonb NOT NULL,
  "evidence_ref" text NOT NULL CHECK (length(trim("evidence_ref")) > 0),
  "recorded_by" text NOT NULL CHECK (length(trim("recorded_by")) > 0),
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  CHECK (
    ("disposition" = 'backfill_frozen_credits' AND "credits" IS NOT NULL AND "credits" > 0)
    OR
    ("disposition" = 'rebuild_confirmed_no_provider_effect' AND "credits" IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS "plan_checkout_binding_credit_migration_audit" (
  "binding_id" text NOT NULL REFERENCES "plan_checkout_bindings"("id") ON DELETE RESTRICT,
  "migration" text NOT NULL,
  "disposition" text NOT NULL,
  "credits" integer,
  "authority_snapshot" jsonb NOT NULL,
  "evidence_ref" text NOT NULL,
  "recorded_by" text NOT NULL,
  "migrated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("binding_id", "migration")
);

COMMENT ON TABLE "plan_checkout_binding_credit_proofs" IS
  'Operator evidence for legacy Waffo checkout credits. Never populate from current plan mapping.';
