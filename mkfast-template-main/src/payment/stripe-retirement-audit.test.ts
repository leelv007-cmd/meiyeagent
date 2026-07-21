import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  buildStripeRetirementAuditReport,
  STRIPE_RETIREMENT_AUDIT_SQL,
} from './stripe-retirement-audit';

describe('Stripe retirement local audit', () => {
  it('reports local identity gaps without claiming remote refund or entitlement truth', () => {
    const report = buildStripeRetirementAuditReport([
      {
        bindingId: 'pcb_1',
        bindingPriceId: 'price_growth',
        bindingStatus: 'active',
        bindingSubscriptionId: null,
        customerId: 'cus_shared',
        customerIdUseCount: 2,
        ownerUserId: 'user_1',
        paymentCustomerId: null,
        paymentId: null,
        paymentInvoiceId: null,
        paymentPaid: null,
        paymentPriceId: null,
        paymentSessionId: null,
        paymentStatus: null,
        paymentSubscriptionId: null,
        paymentType: 'subscription',
        providerCheckoutId: null,
      },
      {
        bindingId: 'pcb_2',
        bindingPriceId: 'price_growth',
        bindingStatus: 'active',
        bindingSubscriptionId: 'sub_2',
        customerId: 'cus_owner',
        customerIdUseCount: 1,
        ownerUserId: 'user_2',
        paymentCustomerId: 'cus_other',
        paymentId: 'pay_2',
        paymentInvoiceId: null,
        paymentPaid: true,
        paymentPriceId: 'price_growth',
        paymentSessionId: 'ch_2',
        paymentStatus: 'active',
        paymentSubscriptionId: 'sub_2',
        paymentType: 'subscription',
        providerCheckoutId: 'ch_2',
      },
    ]);

    assert.deepEqual(report.summary, {
      anomalyCount: 6,
      bindingCount: 2,
      cleanBindingCount: 0,
    });
    assert.deepEqual(report.records[0]?.anomalies, [
      'duplicate_customer_id',
      'missing_provider_checkout_id',
      'missing_payment_mapping',
      'missing_subscription_id',
    ]);
    assert.deepEqual(report.records[1]?.anomalies, [
      'paid_payment_missing_invoice',
      'payment_customer_mismatch',
    ]);
    assert.equal(report.limitations.refunds.status, 'not_recorded_locally');
    assert.equal(
      report.limitations.entitlements.status,
      'not_recorded_locally'
    );
    assert.equal(report.remoteStripeApiCalled, false);
  });

  it('uses a read-only Stripe-binding query and exposes an executable CLI entry', async () => {
    assert.match(STRIPE_RETIREMENT_AUDIT_SQL, /provider = 'stripe'/u);
    assert.doesNotMatch(
      STRIPE_RETIREMENT_AUDIT_SQL,
      /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/iu
    );

    const packageJson = JSON.parse(
      await readFile(resolve(process.cwd(), 'package.json'), 'utf8')
    ) as { scripts?: Record<string, string> };
    assert.equal(
      packageJson.scripts?.['payment:audit-stripe-retirement'],
      'tsx scripts/audit-stripe-retirement.ts'
    );
    const cli = await readFile(
      resolve(process.cwd(), 'scripts/audit-stripe-retirement.ts'),
      'utf8'
    );
    assert.match(cli, /SET TRANSACTION READ ONLY/u);
    assert.doesNotMatch(cli, /stripe(?:\.com|\/api|from 'stripe')/iu);
  });
});
