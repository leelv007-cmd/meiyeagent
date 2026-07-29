import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ProductionDueDeliveryEligibility,
  type RestDayFactReader,
} from './eligibility.js';
import type { DueDeliveryClaim } from './worker.js';

test('an owner-backed workspace with no rest-day fact is eligible', async () => {
  const eligibility = new ProductionDueDeliveryEligibility({
    async hasOwnerMembership(workspaceId) {
      return workspaceId === 'workspace-1';
    },
  });

  assert.deepEqual(await eligibility.evaluate(dailyClaim()), {
    isRestDay: false,
    workspaceActive: true,
  });
});

test('an explicitly injected rest-day fact suppresses a daily recommendation', async () => {
  const restDays: RestDayFactReader = {
    async isRestDay(workspaceId, businessDate) {
      return workspaceId === 'workspace-1' && businessDate === '2026-07-29';
    },
  };
  const eligibility = new ProductionDueDeliveryEligibility(
    {
      async hasOwnerMembership() {
        return true;
      },
    },
    restDays,
  );

  assert.deepEqual(await eligibility.evaluate(dailyClaim()), {
    isRestDay: true,
    workspaceActive: true,
  });
});

test('a workspace without an owner membership is inactive without inventing a status field', async () => {
  let restDayReads = 0;
  const eligibility = new ProductionDueDeliveryEligibility(
    {
      async hasOwnerMembership() {
        return false;
      },
    },
    {
      async isRestDay() {
        restDayReads += 1;
        return false;
      },
    },
  );

  assert.deepEqual(await eligibility.evaluate(dailyClaim()), {
    isRestDay: false,
    workspaceActive: false,
  });
  assert.equal(restDayReads, 0);
});

function dailyClaim(): DueDeliveryClaim {
  return {
    attemptCount: 1,
    businessDate: '2026-07-29',
    claimToken: 'claim-1',
    dueAt: '2026-07-29T00:00:00.000Z',
    id: 'due-1',
    payload: {
      businessDate: '2026-07-29',
      schemaVersion: 'daily-recommendation/v1',
    },
    taskId: 'daily-rec_workspace-1_2026-07-29',
    type: 'daily_recommendation',
    workspaceId: 'workspace-1',
  };
}
