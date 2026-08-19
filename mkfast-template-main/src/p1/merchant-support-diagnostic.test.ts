import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMerchantSupportDiagnostic } from './merchant-support-diagnostic';

test('explains estimate, actual cost, failure reason, and refunded credits without database access', () => {
  const diagnostic = buildMerchantSupportDiagnostic({
    contentPackages: [
      {
        generated: {
          childRuns: [
            {
              failureCode: 'provider_timeout',
              productUsage: { quantity: 1, status: 'refunded' },
              providerCost: {
                amount: 0.18,
                currency: 'CNY',
                status: 'observed',
              },
              runId: 'job-a',
              status: 'failed',
            },
          ],
        },
        id: 'package-a',
      },
    ],
    creditDetail: { billing: null, batches: [], transactions: [] },
    jobs: [
      {
        contract: {
          currency: 'CNY',
          estimatedAmount: 0.2,
          operation: 'copy.generate',
        },
        failureCode: 'provider_timeout',
        id: 'job-a',
        productUsageQuantity: 1,
        status: 'failed',
      },
    ],
  });

  assert.deepEqual(diagnostic.jobs[0], {
    actual: { amount: 0.18, currency: 'CNY' },
    estimated: { amount: 0.2, currency: 'CNY' },
    id: 'job-a',
    operation: 'copy.generate',
    reason: 'provider_timeout',
    refunded: { quantity: 1, status: 'refunded' },
    status: 'failed',
  });
  assert.deepEqual(diagnostic.creditEvidence, {
    activeBatchCount: 0,
    availableCredits: 0,
    recentTransactions: [],
  });
});

test('reports canonical available credits without inferring legacy quota mismatch', () => {
  const diagnostic = buildMerchantSupportDiagnostic({
    contentPackages: [],
    creditDetail: {
      billing: null,
      batches: [
        {
          batchNumber: 3,
          expiresAt: null,
          remainingCredits: 3,
          source: 'trial',
          status: 'active',
        },
      ],
      transactions: [],
    },
    jobs: [],
  });

  assert.equal(diagnostic.creditEvidence.availableCredits, 3);
  assert.equal('ledgerConsistent' in diagnostic, false);
});

test('projects canonical credit batches and transactions without synthesizing quota health', () => {
  const diagnostic = buildMerchantSupportDiagnostic({
    contentPackages: [],
    creditDetail: {
      billing: null,
      batches: [
        {
          batchNumber: 7,
          expiresAt: null,
          remainingCredits: 93,
          source: 'redemption',
          status: 'active',
        },
      ],
      transactions: [
        {
          batchNumber: 7,
          creditedAmount: 100,
          credits: 100,
          occurredAt: '2026-08-19T00:00:00.000Z',
          operation: 'account_credit',
          refundDisposition: 'not_applicable',
          status: 'not_applicable',
          type: 'grant',
        },
      ],
    },
    jobs: [],
  });

  assert.deepEqual(diagnostic.creditEvidence, {
    activeBatchCount: 1,
    availableCredits: 93,
    recentTransactions: [
      {
        batchNumber: 7,
        creditedAmount: 100,
        credits: 100,
        occurredAt: '2026-08-19T00:00:00.000Z',
        operation: 'account_credit',
        refundDisposition: 'not_applicable',
        status: 'not_applicable',
        type: 'grant',
      },
    ],
  });
  assert.equal('ledgerConsistent' in diagnostic, false);
  assert.equal('quota' in diagnostic, false);
});
