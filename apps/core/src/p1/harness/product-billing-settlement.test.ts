import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ProductQuoteSnapshot,
  ProductUsageRecord,
} from '@meiye/contracts';

import { MemoryObservabilityEventAudit } from '../creation-experience/observability-events.js';
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

test('harness settlement emits final ActionUsage once with frozen server axes', async () => {
  const events = new MemoryObservabilityEventAudit();
  const executor = new HarnessProductBillingSettlementExecutor(
    {
      async getQuote() {
        return quote({ lifecycleStatus: 'dispatched' });
      },
      async settleTask() {},
      async getUsage() {
        return usage({
          status: 'committed',
          settlementStatus: 'reconciled',
          settledQuantity: 15,
        });
      },
    },
    {
      async refundUsageOperation() {
        return [];
      },
    },
    undefined,
    {
      events,
      context: {
        async readTaskRootAxes() {
          return {
            axisScope: 'task_root',
            skillRevision: { kind: 'absent' },
            promptVersion: { kind: 'bound', value: 'copy@v4' },
            catalogRevision: { kind: 'bound', value: 'catalog-r7' },
            scene: { kind: 'bound', value: 'opening-campaign' },
          };
        },
      },
    },
  );

  await executor.commit(input);
  await executor.commit(input);

  assert.deepEqual(events.list(input.workspaceId), [
    {
      eventType: 'action_usage.recorded',
      taskId: input.taskId,
      axisScope: 'execution_child',
      skillRevision: null,
      promptVersion: 'copy@v4',
      catalogRevision: 'catalog-r7',
      scene: 'opening-campaign',
      payload: {
        actionId: 'usage-settlement',
        taskId: input.taskId,
        status: 'completed',
        settlementStatus: 'reconciled',
        settledUnits: 15,
        refundedUnits: 0,
      },
    },
  ]);
});

test('harness commit rejects a refunded terminal usage instead of recording it as completed', async () => {
  const executor = new HarnessProductBillingSettlementExecutor(
    {
      async getQuote() {
        return quote({ lifecycleStatus: 'refunded' });
      },
      async settleTask() {},
      async getUsage() {
        return usage({
          status: 'refunded',
          settlementStatus: 'reconciled',
          settledQuantity: 0,
          refundedQuantity: 15,
        });
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
    /terminal usage refunded cannot satisfy completed settlement/u,
  );
});

test('harness refund rejects a committed terminal usage instead of recording it as rejected', async () => {
  const executor = new HarnessProductBillingSettlementExecutor(
    {
      async getQuote() {
        return quote({ lifecycleStatus: 'settled' });
      },
      async settleTask() {},
      async getUsage() {
        return usage({
          status: 'committed',
          settlementStatus: 'reconciled',
          settledQuantity: 15,
          refundedQuantity: 0,
        });
      },
    },
    {
      async refundUsageOperation() {
        return [];
      },
    },
  );

  await assert.rejects(
    executor.refund(input),
    /terminal usage committed cannot satisfy rejected settlement/u,
  );
});

test('harness credit refund settles the persisted repriced usage operation', async () => {
  let refundedUsageOperationId: string | undefined;
  const executor = new HarnessProductBillingSettlementExecutor(
    {
      async getQuote() {
        return quote({ creditCost: 4 });
      },
      async settleTask() {},
      async getUsage() {
        return usage({
          status: 'refunded',
          refundedCredits: 4,
          refundedQuantity: 1,
        });
      },
    },
    undefined,
    undefined,
    undefined,
    {
      async refundUsageOperation(refund) {
        refundedUsageOperationId = refund.usageOperationId;
        return [];
      },
    },
    {
      async readByTask() {
        return {
          usageReservation: {
            creditUsageOperationId: 'credit-usage:task-settlement:plan-r3',
          },
        };
      },
    },
  );

  await executor.refund(input);

  assert.equal(refundedUsageOperationId, 'credit-usage:task-settlement:plan-r3');
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

test('harness refunds the exact successor confirmation reservation', async () => {
  let refundedOperationId: string | undefined;
  const successorOperationId = 'consume:confirmation:successor-authority';
  const executor = new HarnessProductBillingSettlementExecutor(
    {
      async getQuote() {
        return quote({ creditCost: 7, lifecycleStatus: 'refunded' });
      },
      async settleTask() {},
      async getUsage() {
        return usage({
          billingMode: 'per_request',
          status: 'refunded',
          reservedCredits: 7,
          refundedCredits: 7,
        });
      },
    },
    undefined,
    undefined,
    undefined,
    {
      async refundUsageOperation(refund) {
        refundedOperationId = refund.usageOperationId;
        return [];
      },
    },
  );

  await executor.refund({
    ...input,
    creditUsageOperationId: successorOperationId,
  });

  assert.equal(refundedOperationId, successorOperationId);
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
