import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { merchantCreditDetailSchema } from '@meiye/contracts';
import {
  creditDetailBilling,
  expiredUncreditedRefund,
} from './merchant-credit-detail';

test('keeps the backend billing contract and makes an expired refund explicit', () => {
  const detail = merchantCreditDetailSchema.parse({
    billing: {
      creditsThisPeriod: 1_300,
      interval: 'monthly',
      periodEndsAt: '2026-09-01T00:00:00.000Z',
      tier: 'growth',
    },
    batches: [],
    transactions: [
      {
        batchNumber: 2,
        credits: 20,
        creditedAmount: 0,
        operation: 'creation',
        occurredAt: '2026-08-03T00:00:00.000Z',
        refundDisposition: 'expired_uncredited',
        status: 'refunded',
        type: 'refund',
      },
    ],
  });

  assert.deepEqual(creditDetailBilling(detail), detail.billing);
  assert.deepEqual(expiredUncreditedRefund(detail.transactions[0]!), {
    credits: 20,
  });
});

test('does not claim a normal refund was lost after a batch expired', () => {
  const detail = merchantCreditDetailSchema.parse({
    billing: null,
    batches: [],
    transactions: [
      {
        batchNumber: 1,
        credits: 20,
        creditedAmount: 20,
        operation: 'creation',
        occurredAt: '2026-08-03T00:00:00.000Z',
        refundDisposition: 'credited',
        status: 'refunded',
        type: 'refund',
      },
    ],
  });

  assert.equal(expiredUncreditedRefund(detail.transactions[0]!), null);
});

test('settings exposes details and billing through the merchant credit contract', () => {
  const panel = readFileSync(
    new URL('./merchant-credit-detail-panel.tsx', import.meta.url),
    'utf8'
  );
  const billingCard = readFileSync(
    new URL('../components/settings/billing/billing-card.tsx', import.meta.url),
    'utf8'
  );
  const accountRoute = readFileSync(
    new URL('../routes/settings/account.tsx', import.meta.url),
    'utf8'
  );
  const messages = JSON.parse(
    readFileSync(
      new URL('../../project.inlang/messages/zh.json', import.meta.url),
      'utf8'
    )
  ) as Record<string, string>;
  const catalog = readFileSync(
    new URL('../../tests/e2e/TEST-CATALOG.md', import.meta.url),
    'utf8'
  );

  for (const source of [panel, billingCard]) {
    assert.match(source, /queryP1<MerchantCreditDetail>/u);
    assert.match(source, /action: 'credit_detail'/u);
  }
  assert.doesNotMatch(billingCard, /useCurrentPlan|authClient|CustomerPortal/u);
  assert.match(accountRoute, /id="credits"/u);
  assert.match(accountRoute, /MerchantCreditDetailPanel/u);
  assert.doesNotMatch(accountRoute, /AccountUsagePanel|id="usage"/u);
  assert.equal(
    messages.credit_detail_refund_expired_uncredited,
    '已退回 {count} 分（批次已过期，未入账）'
  );
  assert.equal(
    messages.credit_billing_no_active_subscription,
    '当前周期积分暂不可用；你仍可查看积分批次和流水。'
  );
  assert.match(
    catalog,
    /Merchant credit billing and details stay merchant-safe/u
  );
});
