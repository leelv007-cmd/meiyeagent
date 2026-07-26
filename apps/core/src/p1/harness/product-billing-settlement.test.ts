import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ProductQuoteSnapshot,
  ProductUsageRecord,
} from '@meiye/contracts';

import { HarnessProductBillingSettlementExecutor } from './product-billing-settlement.js';

const input = {
  workspaceId: 'workspace-settlement',
  taskId: 'task-settlement',
  quoteId: 'quote-settlement',
  quoteRevision: 'quote-revision-1',
  trustedUsage: {
    kind: 'media_duration' as const,
    actualSeconds: 6,
    evidenceRef: 'owned-asset:video-1',
  },
};

test('harness settlement rejects a changed quote revision before commit', async () => {
  let settleCalls = 0;
  const executor = new HarnessProductBillingSettlementExecutor(
    {
      async getQuote() {
        return quote({ revision: 'quote-revision-2' });
      },
      async settleTask() {
        settleCalls += 1;
      },
      async getUsage() {
        return null;
      },
    },
    {
      async refundUsageOperation() {
        return [];
      },
    },
  );

  await assert.rejects(
    executor.commit(input),
    /no longer matches the accepted execution contract/u,
  );
  assert.equal(settleCalls, 0);
});

test('harness video commit passes measured duration and reconciles the grant lot refund', async () => {
  let trustedUsage: unknown;
  let refundAmount: number | undefined;
  const executor = new HarnessProductBillingSettlementExecutor(
    {
      async getQuote() {
        return quote();
      },
      async settleTask(settlement) {
        trustedUsage = settlement.trustedUsage;
      },
      async getUsage() {
        return usage({
          status: 'partially_refunded',
          reservedQuantity: 15,
          settledQuantity: 6,
          refundedQuantity: 9,
        });
      },
    },
    {
      async refundUsageOperation(refund) {
        refundAmount = refund.amount;
        return [];
      },
    },
    () => new Date('2026-07-26T00:00:00.000Z'),
  );

  await executor.commit(input);

  assert.deepEqual(trustedUsage, input.trustedUsage);
  assert.equal(refundAmount, 9);
});

test('harness commit settles a dispatched quote without re-running the submission gate', async () => {
  let settleCalls = 0;
  const executor = new HarnessProductBillingSettlementExecutor(
    {
      async getQuote() {
        return quote({ lifecycleStatus: 'dispatched' });
      },
      async settleTask() {
        settleCalls += 1;
      },
      async getUsage() {
        return usage({
          status: 'committed',
          settledQuantity: 15,
        });
      },
    },
    {
      async refundUsageOperation() {
        return [];
      },
    },
  );

  await executor.commit(input);

  assert.equal(settleCalls, 1);
});

test('harness settlement rejects a quote before the settlement lifecycle', async () => {
  let settleCalls = 0;
  const executor = new HarnessProductBillingSettlementExecutor(
    {
      async getQuote() {
        return quote({ lifecycleStatus: 'confirmed' });
      },
      async settleTask() {
        settleCalls += 1;
      },
      async getUsage() {
        return null;
      },
    },
    {
      async refundUsageOperation() {
        return [];
      },
    },
  );

  await assert.rejects(
    executor.commit(input),
    /cannot settle from status confirmed/u,
  );
  assert.equal(settleCalls, 0);
});

test('harness settlement rejects task and workspace quote mismatches', async () => {
  for (const facts of [
    { taskId: 'task-other' },
    { workspaceId: 'workspace-other' },
  ]) {
    let settleCalls = 0;
    const executor = new HarnessProductBillingSettlementExecutor(
      {
        async getQuote() {
          return quote({
            lifecycleStatus: 'dispatched',
            ...facts,
          });
        },
        async settleTask() {
          settleCalls += 1;
        },
        async getUsage() {
          return null;
        },
      },
      {
        async refundUsageOperation() {
          return [];
        },
      },
    );

    await assert.rejects(
      executor.commit(input),
      /no longer matches the accepted execution contract/u,
    );
    assert.equal(settleCalls, 0);
  }
});

function quote(
  overrides: Partial<ProductQuoteSnapshot> = {},
): ProductQuoteSnapshot {
  return {
    quoteId: input.quoteId,
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    revision: input.quoteRevision,
    lifecycleStatus: 'reserved',
    ...overrides,
  } as ProductQuoteSnapshot;
}

function usage(
  overrides: Partial<ProductUsageRecord> = {},
): ProductUsageRecord {
  return {
    id: 'usage-settlement',
    quoteId: input.quoteId,
    taskId: input.taskId,
    workspaceId: input.workspaceId,
    status: 'reserved',
    reservedQuantity: 15,
    settledQuantity: 0,
    refundedQuantity: 0,
    billingMode: 'per_output_second',
    settlementStatus: 'estimated',
    resource: 'video',
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:00.000Z',
    ...overrides,
  };
}
