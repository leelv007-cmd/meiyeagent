export const STRIPE_RETIREMENT_AUDIT_SQL = `
SELECT
  binding.id AS "bindingId",
  binding.owner_user_id AS "ownerUserId",
  binding.status AS "bindingStatus",
  binding.price_id AS "bindingPriceId",
  binding.payment_type AS "paymentType",
  binding.provider_checkout_id AS "providerCheckoutId",
  binding.subscription_id AS "bindingSubscriptionId",
  local_user.customer_id AS "customerId",
  CASE
    WHEN local_user.customer_id IS NULL THEN 0
    ELSE (
      SELECT COUNT(*)::int
      FROM "user" AS same_customer
      WHERE same_customer.customer_id = local_user.customer_id
    )
  END AS "customerIdUseCount",
  local_payment.id AS "paymentId",
  local_payment.customer_id AS "paymentCustomerId",
  local_payment.session_id AS "paymentSessionId",
  local_payment.subscription_id AS "paymentSubscriptionId",
  local_payment.invoice_id AS "paymentInvoiceId",
  local_payment.price_id AS "paymentPriceId",
  local_payment.status AS "paymentStatus",
  local_payment.paid AS "paymentPaid"
FROM plan_checkout_bindings AS binding
INNER JOIN "user" AS local_user
  ON local_user.id = binding.owner_user_id
LEFT JOIN LATERAL (
  SELECT payment.*
  FROM payment
  WHERE payment.user_id = binding.owner_user_id
    AND (
      payment.session_id = binding.provider_checkout_id
      OR (
        binding.subscription_id IS NOT NULL
        AND payment.subscription_id = binding.subscription_id
      )
    )
  ORDER BY payment.updated_at DESC
  LIMIT 1
) AS local_payment ON TRUE
WHERE binding.provider = 'stripe'
ORDER BY binding.created_at ASC, binding.id ASC
`;

export interface StripeRetirementAuditRow {
  bindingId: string;
  bindingPriceId: string;
  bindingStatus: string;
  bindingSubscriptionId: string | null;
  customerId: string | null;
  customerIdUseCount: number | string;
  ownerUserId: string;
  paymentCustomerId: string | null;
  paymentId: string | null;
  paymentInvoiceId: string | null;
  paymentPaid: boolean | null;
  paymentPriceId: string | null;
  paymentSessionId: string | null;
  paymentStatus: string | null;
  paymentSubscriptionId: string | null;
  paymentType: string;
  providerCheckoutId: string | null;
}

export type StripeRetirementAuditAnomaly =
  | 'duplicate_customer_id'
  | 'missing_customer_id'
  | 'missing_payment_mapping'
  | 'missing_provider_checkout_id'
  | 'missing_subscription_id'
  | 'paid_payment_missing_invoice'
  | 'payment_customer_mismatch'
  | 'payment_price_mismatch';

export function buildStripeRetirementAuditReport(
  rows: StripeRetirementAuditRow[]
) {
  const records = rows.map((row) => {
    const anomalies: StripeRetirementAuditAnomaly[] = [];
    if (!row.customerId) anomalies.push('missing_customer_id');
    if (Number(row.customerIdUseCount) > 1) {
      anomalies.push('duplicate_customer_id');
    }
    if (
      row.bindingStatus !== 'pending' &&
      row.bindingStatus !== 'failed' &&
      !row.providerCheckoutId
    ) {
      anomalies.push('missing_provider_checkout_id');
    }
    if (
      (row.bindingStatus === 'active' || row.bindingStatus === 'canceled') &&
      !row.paymentId
    ) {
      anomalies.push('missing_payment_mapping');
    }
    if (
      row.paymentType === 'subscription' &&
      (row.bindingStatus === 'active' || row.bindingStatus === 'canceled') &&
      !row.bindingSubscriptionId &&
      !row.paymentSubscriptionId
    ) {
      anomalies.push('missing_subscription_id');
    }
    if (row.paymentPaid === true && !row.paymentInvoiceId) {
      anomalies.push('paid_payment_missing_invoice');
    }
    if (
      row.customerId &&
      row.paymentCustomerId &&
      row.customerId !== row.paymentCustomerId
    ) {
      anomalies.push('payment_customer_mismatch');
    }
    if (row.paymentPriceId && row.paymentPriceId !== row.bindingPriceId) {
      anomalies.push('payment_price_mismatch');
    }

    return {
      ...row,
      customerIdUseCount: Number(row.customerIdUseCount),
      anomalies,
      entitlementAudit: { status: 'not_recorded_locally' as const },
      refundAudit: { status: 'not_recorded_locally' as const },
    };
  });
  const anomalyCount = records.reduce(
    (count, record) => count + record.anomalies.length,
    0
  );

  return {
    generatedAt: new Date().toISOString(),
    remoteStripeApiCalled: false as const,
    summary: {
      anomalyCount,
      bindingCount: records.length,
      cleanBindingCount: records.filter(
        (record) => record.anomalies.length === 0
      ).length,
    },
    records,
    limitations: {
      customerOwnership: {
        status: 'provider_not_recorded_locally' as const,
        detail:
          'user.customer_id has no provider column; this report scopes users through Stripe checkout bindings only.',
      },
      unboundPayments: {
        status: 'provider_not_recorded_locally' as const,
        detail:
          'payment rows have no provider column, so payments without a Stripe binding cannot be attributed safely.',
      },
      refunds: {
        status: 'not_recorded_locally' as const,
        detail:
          'The local payment schema has no refund ID, amount, status, or refund ledger.',
      },
      entitlements: {
        status: 'not_recorded_locally' as const,
        detail:
          'The Web database has no durable Core entitlement receipt to prove grant or revocation state.',
      },
      remoteObjects: {
        status: 'not_queried' as const,
        detail:
          'Customer metadata, remote invoices, refunds, disputes, and active obligations require a separately authorized read-only Stripe audit.',
      },
    },
  };
}
