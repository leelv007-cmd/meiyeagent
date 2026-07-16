import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMerchantSupportDiagnostic } from './merchant-support-diagnostic';

test('explains estimate, actual cost, failure reason, and refunded quota without database access', () => {
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
    entitlement: {
      usage: {
        copy: {
          allowance: 20,
          available: 20,
          committed: 0,
          released: 1,
          reserved: 0,
        },
        image: {
          allowance: 10,
          available: 10,
          committed: 0,
          released: 0,
          reserved: 0,
        },
        video: {
          allowance: 5,
          available: 5,
          committed: 0,
          released: 0,
          reserved: 0,
        },
      },
    },
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
  assert.equal(diagnostic.ledgerConsistent, true);
  assert.equal(diagnostic.quota.copy.available, 20);
});

test('marks quota projection mismatches instead of presenting them as healthy', () => {
  const diagnostic = buildMerchantSupportDiagnostic({
    contentPackages: [],
    entitlement: {
      usage: {
        copy: {
          allowance: 10,
          available: 3,
          committed: 2,
          released: 0,
          reserved: 1,
        },
      },
    },
    jobs: [],
  });

  assert.equal(diagnostic.ledgerConsistent, false);
});
