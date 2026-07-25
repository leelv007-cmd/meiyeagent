import assert from 'node:assert/strict';
import test from 'node:test';

import { findD123CostBoundaryFindings } from './d123-cost-boundary.mjs';

test('D-123 cost boundary rejects real currency, cost, margin, and identifier leaks', () => {
  const findings = findD123CostBoundaryFindings([
    {
      path: 'apps/example.ts',
      text: [
        'const usd = "US$0.06";',
        'const cost = "成本价 0.06 元";',
        'const margin = "毛利率 0.72";',
        'const internalCostPerCopy = 0.1;',
        'const providerCostMicros = 60000;',
        'const grossMarginPct = 72;',
      ].join('\n'),
    },
  ]);
  assert.deepEqual(
    findings,
    Array.from({ length: 6 }, (_, index) => ({
      path: 'apps/example.ts',
      line: index + 1,
    })),
  );
});

test('D-123 cost boundary permits merchant prices and allowance quantities', () => {
  assert.deepEqual(
    findD123CostBoundaryFindings([
      {
        path: 'apps/example.ts',
        text: [
          'const trial = { copy: 5, image: 5, video: 1, price: 99 };',
          'const merchantPrice = "¥399";',
          'const groupBuyPrice = "CNY 239";',
        ].join('\n'),
      },
    ]),
    [],
  );
});
