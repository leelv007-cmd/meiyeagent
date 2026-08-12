import assert from 'node:assert/strict';
import test from 'node:test';

import { overwriteGetLocale } from '@/locale/paraglide/runtime';

import { formatCreditsSummary } from './use-shell-credits-summary';

test('formats the same available-credits sentence the workbench pill uses', () => {
  overwriteGetLocale(() => 'zh');
  assert.equal(
    formatCreditsSummary({
      availableCredits: 100,
      expiringLot: null,
      visible: true,
    }),
    '可用 100 分'
  );
  assert.match(
    formatCreditsSummary({
      availableCredits: 100,
      expiringLot: {
        remainingCredits: 20,
        expiresAt: '2026-08-20T00:00:00.000Z',
        daysUntilExpiry: 3,
      },
      visible: true,
    }) ?? '',
    /可用 100 分/
  );
  assert.equal(
    formatCreditsSummary({
      availableCredits: 0,
      expiringLot: null,
      visible: false,
    }),
    undefined
  );
});
