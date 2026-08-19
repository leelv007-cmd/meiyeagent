import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { MerchantSupportDiagnosticTable } from './admin-merchant-support';
import { buildMerchantSupportDiagnostic } from './merchant-support-diagnostic';

test('support renders canonical credit transactions instead of a synthetic quota verdict', () => {
  const diagnostic = buildMerchantSupportDiagnostic({
    contentPackages: [],
    creditDetail: {
      billing: null,
      batches: [
        {
          batchNumber: 9,
          expiresAt: null,
          remainingCredits: 75,
          source: 'redemption',
          status: 'active',
        },
      ],
      transactions: [
        {
          batchNumber: 9,
          creditedAmount: 25,
          credits: 25,
          occurredAt: '2026-08-19T12:00:00.000Z',
          operation: 'creation',
          refundDisposition: 'credited',
          status: 'refunded',
          type: 'refund',
        },
      ],
    },
    jobs: [],
  });

  const html = renderToStaticMarkup(
    <MerchantSupportDiagnosticTable diagnostic={diagnostic} />
  );
  assert.match(html, /使用记录/);
  assert.match(html, /退回/);
  assert.match(html, />25</);
  assert.match(html, /2026-08-19T12:00:00.000Z/);
  assert.doesNotMatch(html, /账本与额度投影|三桶/u);
});
