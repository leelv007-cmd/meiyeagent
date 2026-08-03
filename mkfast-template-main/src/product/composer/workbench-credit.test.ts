import assert from 'node:assert/strict';
import test from 'node:test';

import {
  admitFreshCreditRun,
  projectWorkbenchCreditBalance,
  projectWorkbenchCreditQuote,
  projectWorkbenchCreditShortfall,
} from './workbench-credit';

test('projects only the public credit balance and nearest expiry for the workbench', () => {
  const view = projectWorkbenchCreditBalance(
    {
      grantedCredits: 200,
      usedCredits: 80,
      refundedCredits: 0,
      expiredCredits: 0,
      availableCredits: 120,
      soonestExpiringLot: {
        remainingCredits: 45,
        expiresAt: '2026-08-04T00:00:00.000Z',
      },
    },
    new Date('2026-08-01T12:00:00.000Z')
  );

  assert.deepEqual(view, {
    availableCredits: 120,
    expiringLot: {
      remainingCredits: 45,
      expiresAt: '2026-08-04T00:00:00.000Z',
      daysUntilExpiry: 3,
    },
    visible: true,
  });
});

test('does not manufacture an expiry summary when the backend contract says none', () => {
  assert.deepEqual(
    projectWorkbenchCreditBalance(
      {
        grantedCredits: 100,
        usedCredits: 0,
        refundedCredits: 0,
        expiredCredits: 0,
        availableCredits: 100,
        soonestExpiringLot: null,
      },
      new Date('2026-08-01T00:00:00.000Z')
    ),
    {
      availableCredits: 100,
      expiringLot: null,
      visible: true,
    }
  );
});

test('uses only the backend credit quote for the cost, refund label, and shortfall', () => {
  const quote = projectWorkbenchCreditQuote({
    creditCost: 75,
    failureRefundsCredits: true,
  });

  assert.deepEqual(quote, {
    creditCost: 75,
    failureRefundsCredits: true,
    visible: true,
  });
  assert.deepEqual(
    projectWorkbenchCreditShortfall({ availableCredits: 32 }, quote),
    {
      missingCredits: 43,
      visible: true,
    }
  );
});

test('leaves legacy amounts and incomplete credit quotes out of the credit surfaces', () => {
  assert.deepEqual(projectWorkbenchCreditQuote({}), {
    creditCost: null,
    failureRefundsCredits: null,
    visible: false,
  });
  assert.deepEqual(
    projectWorkbenchCreditShortfall(
      { availableCredits: 32 },
      {
        creditCost: null,
        failureRefundsCredits: null,
        visible: false,
      }
    ),
    { missingCredits: 0, visible: false }
  );
});

test('admits a run only when the fresh credit projection covers the exact quote', async () => {
  let projectionReads = 0;

  const result = await admitFreshCreditRun({
    loadProjection: async () => {
      projectionReads += 1;
      return {
        credits: {
          grantedCredits: 100,
          usedCredits: 100,
          refundedCredits: 0,
          expiredCredits: 0,
          availableCredits: 0,
          soonestExpiringLot: null,
        },
      };
    },
    quote: {
      creditCost: 20,
      failureRefundsCredits: true,
    },
  });

  assert.equal(projectionReads, 1);
  assert.deepEqual(result, {
    kind: 'shortfall',
    missingCredits: 20,
  });
});

test('fails closed when the fresh projection cannot provide a valid credit balance', async () => {
  const quote = { creditCost: 20, failureRefundsCredits: true };
  const reads = [
    async () => {
      throw new Error('projection unavailable');
    },
    async () => ({}),
    async () => ({
      credits: {
        availableCredits: -1,
      },
    }),
    async () => ({
      credits: {
        availableCredits: 1.5,
      },
    }),
  ];

  for (const loadProjection of reads) {
    assert.deepEqual(await admitFreshCreditRun({ loadProjection, quote }), {
      kind: 'unavailable',
    });
  }
});

test('fails closed before reading when the current quote lacks credit facts', async () => {
  let projectionReads = 0;
  const loadProjection = async () => {
    projectionReads += 1;
    return {};
  };

  for (const quote of [
    {},
    { creditCost: 20 },
    { creditCost: 0, failureRefundsCredits: true },
  ]) {
    assert.deepEqual(await admitFreshCreditRun({ loadProjection, quote }), {
      kind: 'unavailable',
    });
  }

  assert.equal(projectionReads, 0);
});
