-- Deployment gate for legacy Waffo rows created before commerce_credits.
-- Operators must record historical checkout evidence after 0027 and before
-- retrying this migration. Current plan/payment mappings are not evidence.

WITH matched_proofs AS (
  SELECT proof.*
  FROM plan_checkout_binding_credit_proofs AS proof
  JOIN plan_checkout_bindings AS binding ON binding.id = proof.binding_id
  WHERE proof.authority_snapshot = jsonb_build_object(
    'provider', binding.provider,
    'priceId', binding.price_id,
    'interval', binding.interval,
    'planRevision', binding.commerce_plan_revision,
    'paymentMappingRevision', binding.commerce_payment_mapping_revision,
    'amountMicros', binding.commerce_amount_micros,
    'currency', binding.commerce_currency,
    'tier', binding.commerce_tier,
    'period', binding.commerce_period,
    'billingPeriod', binding.commerce_billing_period
  )
), backfilled AS (
  UPDATE plan_checkout_bindings AS binding
  SET commerce_credits = proof.credits,
      updated_at = now()
  FROM matched_proofs AS proof
  WHERE binding.id = proof.binding_id
    AND proof.disposition = 'backfill_frozen_credits'
    AND binding.provider = 'waffo'
    AND binding.commerce_credits IS NULL
  RETURNING binding.id
)
INSERT INTO plan_checkout_binding_credit_migration_audit
  (binding_id, migration, disposition, credits, authority_snapshot,
   evidence_ref, recorded_by, migrated_at)
SELECT proof.binding_id, '0028_plan_checkout_credit_migration_gate',
       proof.disposition, proof.credits, proof.authority_snapshot,
       proof.evidence_ref, proof.recorded_by, now()
FROM matched_proofs AS proof
JOIN backfilled ON backfilled.id = proof.binding_id
ON CONFLICT (binding_id, migration) DO NOTHING;

WITH matched_proofs AS (
  SELECT proof.*
  FROM plan_checkout_binding_credit_proofs AS proof
  JOIN plan_checkout_bindings AS binding ON binding.id = proof.binding_id
  WHERE proof.authority_snapshot = jsonb_build_object(
    'provider', binding.provider,
    'priceId', binding.price_id,
    'interval', binding.interval,
    'planRevision', binding.commerce_plan_revision,
    'paymentMappingRevision', binding.commerce_payment_mapping_revision,
    'amountMicros', binding.commerce_amount_micros,
    'currency', binding.commerce_currency,
    'tier', binding.commerce_tier,
    'period', binding.commerce_period,
    'billingPeriod', binding.commerce_billing_period
  )
), rebuildable AS (
  UPDATE plan_checkout_bindings AS binding
  SET status = 'failed',
      updated_at = now()
  FROM matched_proofs AS proof
  WHERE binding.id = proof.binding_id
    AND proof.disposition = 'rebuild_confirmed_no_provider_effect'
    AND binding.provider = 'waffo'
    AND binding.status = 'pending'
    AND binding.provider_checkout_id IS NULL
    AND binding.subscription_id IS NULL
    AND binding.commerce_credits IS NULL
  RETURNING binding.id
)
INSERT INTO plan_checkout_binding_credit_migration_audit
  (binding_id, migration, disposition, credits, authority_snapshot,
   evidence_ref, recorded_by, migrated_at)
SELECT proof.binding_id, '0028_plan_checkout_credit_migration_gate',
       proof.disposition, NULL, proof.authority_snapshot,
       proof.evidence_ref, proof.recorded_by, now()
FROM matched_proofs AS proof
JOIN rebuildable ON rebuildable.id = proof.binding_id
ON CONFLICT (binding_id, migration) DO NOTHING;

DO $$
DECLARE
  blocked_count integer;
  blocked_ids text;
BEGIN
  SELECT count(*)::integer
  INTO blocked_count
  FROM plan_checkout_bindings
  WHERE provider = 'waffo'
    AND interval IN ('single_month', 'monthly', 'yearly')
    AND status <> 'failed'
    AND commerce_credits IS NULL;

  IF blocked_count > 0 THEN
    SELECT string_agg(id, ', ' ORDER BY id)
    INTO blocked_ids
    FROM (
      SELECT id
      FROM plan_checkout_bindings
      WHERE provider = 'waffo'
        AND interval IN ('single_month', 'monthly', 'yearly')
        AND status <> 'failed'
        AND commerce_credits IS NULL
      ORDER BY id
      LIMIT 10
    ) AS blocked;
    RAISE EXCEPTION
      'Legacy Waffo checkout credit migration blocked: % unproven binding(s), sample ids: %. Record audited historical proof in plan_checkout_binding_credit_proofs; never use current mapping.',
      blocked_count, blocked_ids;
  END IF;
END $$;

ALTER TABLE plan_checkout_bindings
  ADD CONSTRAINT plan_checkout_bindings_waffo_credits_ck CHECK (
    provider <> 'waffo'
    OR interval NOT IN ('single_month', 'monthly', 'yearly')
    OR status = 'failed'
    OR commerce_credits > 0
  );
