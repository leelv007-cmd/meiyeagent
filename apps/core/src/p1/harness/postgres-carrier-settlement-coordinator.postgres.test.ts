import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import { DurableProductBillingService } from '../product-billing/durable-service.js';
import { PostgresProductBillingRepository } from '../product-billing/postgres-repository.js';
import { HarnessCarrierSettlementWorker } from './carrier-settlement-worker.js';
import { PostgresHarnessCarrierSettlementCoordinator } from './postgres-carrier-settlement-coordinator.js';
import { HarnessProductBillingSettlementExecutor } from './product-billing-settlement.js';
import { HarnessReservationSweeper } from './reservation-sweeper.js';

const connectionString = process.env.TEST_DATABASE_URL;

function frozenPackageBilling(
  suffix: string,
  units: { copy: number; note: number },
) {
  return {
    contractHash: `package-contract-${suffix}`,
    allocations: [
      {
        allocationId: 'copy-output',
        carrierUnitId: 'copy',
        carrier: 'copy' as const,
        deliveryUnits: units.copy,
        creditCost: units.copy,
        failureRefundsCredits: true,
        operation: 'copy.generate',
        catalogModel: { id: 'copy-model', revision: 'copy-r1' },
        routeSnapshotRef: 'route-copy-r1',
        rightsRevisionRefs: ['rights-copy-r1'],
      },
      {
        allocationId: 'note-pages',
        carrierUnitId: 'note',
        carrier: 'note' as const,
        deliveryUnits: units.note,
        creditCost: units.note,
        failureRefundsCredits: true,
        operation: 'note.generate',
        catalogModel: { id: 'note-model', revision: 'note-r1' },
        routeSnapshotRef: 'route-note-r1',
        rightsRevisionRefs: ['rights-note-r1'],
      },
    ],
  };
}

function packageQuoteContract(
  packageBilling: ReturnType<typeof frozenPackageBilling>,
) {
  return {
    contractHash: packageBilling.contractHash,
    allocations: packageBilling.allocations.map((allocation) => ({
      allocationId: allocation.allocationId,
      carrier: allocation.carrier,
      deliveryUnits: allocation.deliveryUnits,
      creditCost: allocation.creditCost,
      failureRefundsCredits: allocation.failureRefundsCredits,
      operation: allocation.operation,
      catalogModel: allocation.catalogModel,
      routeSnapshotRef: allocation.routeSnapshotRef,
      rightsRevisionRefs: allocation.rightsRevisionRefs,
    })),
  };
}

test(
  'ready carrier aggregate atomically persists an outbox and recovers exactly once after a lease retry',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const coordinator = new PostgresHarnessCarrierSettlementCoordinator(pool);
    const suffix = randomUUID();
    const workspaceId = `carrier-ready-outbox-${suffix}`;
    const billingTaskId = `task-${suffix}`;
    const base = {
      workspaceId,
      taskId: billingTaskId,
      workId: `work-${suffix}`,
      quoteRef: { id: `quote-${suffix}`, revision: 'quote-r1' },
      reservationId: `consume:task:${billingTaskId}`,
      carrierUnitIds: ['copy', 'note'],
    };
    const packageBilling = frozenPackageBilling(suffix, { copy: 1, note: 2 });
    const note = {
      workspaceId,
      taskId: `${billingTaskId}:carrier-note`,
      billingTaskId,
      billingIdentity: {
        ...base,
        workflowId: `${billingTaskId}:carrier-note`,
        carrierUnitId: 'note',
        carrierBillableUnits: 2,
        packageBilling,
      },
      quoteId: base.quoteRef.id,
      quoteRevision: base.quoteRef.revision,
      partialDelivery: { totalUnits: 2, deliveredUnits: 1 },
    };
    const copy = {
      ...note,
      taskId: `${billingTaskId}:carrier-copy`,
      billingIdentity: {
        ...base,
        workflowId: `${billingTaskId}:carrier-copy`,
        carrierUnitId: 'copy',
        carrierBillableUnits: 1,
        packageBilling,
      },
      partialDelivery: undefined,
    };

    try {
      await pool.query('CREATE SCHEMA IF NOT EXISTS harness_runtime');
      await coordinator.migrate();
      await assert.rejects(
        () =>
          coordinator.recordCarrierTerminal({
            action: 'commit',
            settlement: { ...note, taskId: 'caller-task-bypass' },
          }),
        /frozen identity/u,
      );
      await assert.rejects(
        () =>
          coordinator.recordCarrierTerminal({
            action: 'commit',
            settlement: { ...note, creditUsageOperationId: 'caller-op-bypass' },
          }),
        /credit usage operation/u,
      );
      assert.equal(
        await coordinator.recordCarrierTerminal({ action: 'commit', settlement: note }),
        null,
      );
      const ready = await coordinator.recordCarrierTerminal({
        action: 'refund',
        settlement: copy,
      });
      assert.equal(ready?.action, 'commit');

      const outbox = await pool.query<{
        action: string;
        aggregate_key: string;
        status: string;
      }>(
        `SELECT payload->>'aggregateKey' AS aggregate_key,
                payload->>'action' AS action,
                status
           FROM harness_runtime.billing_work_settlement_outbox
          WHERE workspace_id=$1 AND aggregate_key=$2`,
        [workspaceId, ready!.aggregateKey],
      );
      assert.deepEqual(outbox.rows, [
        {
          status: 'pending',
          aggregate_key: ready!.aggregateKey,
          action: 'commit',
        },
      ]);

      const [firstClaim] = await coordinator.claimReadyWorkSettlements({
        limit: 1,
        leaseMs: 60_000,
      });
      assert.equal(firstClaim?.aggregateKey, ready!.aggregateKey);
      await pool.query(
        `UPDATE harness_runtime.billing_work_settlement_outbox
            SET lease_expires_at=now() - interval '1 second'
          WHERE workspace_id=$1 AND aggregate_key=$2`,
        [workspaceId, ready!.aggregateKey],
      );
      const [reclaimed] = await coordinator.claimReadyWorkSettlements({
        limit: 1,
        leaseMs: 60_000,
      });
      assert.equal(reclaimed?.aggregateKey, ready!.aggregateKey);
      assert.notEqual(reclaimed?.claimToken, firstClaim?.claimToken);

      await coordinator.markWorkSettlementFailed({
        workspaceId,
        aggregateKey: ready!.aggregateKey,
        claimToken: reclaimed!.claimToken,
        error: 'aggregate settlement retry',
        retryAt: new Date('2000-01-01T00:00:00.000Z'),
      });
      const executions: Array<{ action: string; aggregateKey: string }> = [];
      const worker = new HarnessCarrierSettlementWorker(coordinator, {
        async settleReadyWork(input) {
          executions.push({ action: input.action, aggregateKey: input.aggregateKey });
        },
      });
      assert.deepEqual(await worker.runOnce(), {
        claimed: 1,
        completed: 1,
        failed: 0,
      });
      assert.deepEqual(await worker.runOnce(), {
        claimed: 0,
        completed: 0,
        failed: 0,
      });
      assert.deepEqual(executions, [
        { action: 'commit', aggregateKey: ready!.aggregateKey },
      ]);
      const settled = await pool.query<{
        outbox_status: string;
        settlement_status: string;
      }>(
        `SELECT settlements.status AS settlement_status, outbox.status AS outbox_status
           FROM harness_runtime.billing_work_settlements settlements
           JOIN harness_runtime.billing_work_settlement_outbox outbox
             ON outbox.workspace_id=settlements.workspace_id
            AND outbox.aggregate_key=settlements.aggregate_key
          WHERE settlements.workspace_id=$1 AND settlements.aggregate_key=$2`,
        [workspaceId, ready!.aggregateKey],
      );
      assert.deepEqual(settled.rows, [
        { settlement_status: 'settled', outbox_status: 'completed' },
      ]);
    } finally {
      await pool.query(
        'DELETE FROM harness_runtime.billing_work_settlement_outbox WHERE workspace_id=$1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM harness_runtime.billing_carrier_receipts WHERE workspace_id=$1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM harness_runtime.billing_work_settlements WHERE workspace_id=$1',
        [workspaceId],
      );
      await pool.end();
    }
  },
);

test(
  'ready outbox settles one real ProductUsage exactly once after a process-loss boundary',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const coordinator = new PostgresHarnessCarrierSettlementCoordinator(pool);
    const repository = new PostgresProductBillingRepository(pool);
    const suffix = randomUUID();
    const workspaceId = `carrier-real-worker-${suffix}`;
    const billingTaskId = `task-${suffix}`;
    const quoteId = `quote-${suffix}`;
    let settleCalls = 0;
    const packageBilling = frozenPackageBilling(suffix, { copy: 1, note: 1 });

    try {
      await pool.query('CREATE SCHEMA IF NOT EXISTS harness_runtime');
      await coordinator.migrate();
      await repository.migrate();
      const service = new DurableProductBillingService(repository);
      const quote = await service.buildQuote({
        workspaceId,
        quoteId,
        catalogModelId: 'carrier-outbox-model',
        operation: 'copy.generate',
        billingMode: 'per_request',
        creditCost: 2,
        unitRate: 1,
        outputCount: 2,
        frozenCandidateDeploymentIds: ['carrier-outbox-deployment'],
        quotePolicyRevision: 'carrier-outbox-policy',
        submissionContractHash: `carrier-outbox-contract:${suffix}`,
        submissionInputAssetsHash: `carrier-outbox-input:${suffix}`,
        submissionPromptHash: `carrier-outbox-prompt:${suffix}`,
        submissionReferenceAssetsHash: `carrier-outbox-reference:${suffix}`,
        packageContract: packageQuoteContract(packageBilling),
      });
      await service.confirm({ quoteId, taskId: billingTaskId, workspaceId });
      await service.beforeSubmit({
        quoteId,
        quoteRevision: quote.revision,
        resource: 'image',
        taskId: billingTaskId,
        workspaceId,
      });
      const base = {
        workspaceId,
        taskId: billingTaskId,
        workId: `work-${suffix}`,
        quoteRef: { id: quoteId, revision: quote.revision },
        reservationId: `consume:task:${billingTaskId}`,
        carrierUnitIds: ['copy', 'note'],
      };
      const copy = {
        workspaceId,
        taskId: `${billingTaskId}:carrier-copy`,
        billingTaskId,
        billingIdentity: {
          ...base,
          workflowId: `${billingTaskId}:carrier-copy`,
          carrierUnitId: 'copy',
          carrierBillableUnits: 1,
          packageBilling,
        },
        quoteId,
        quoteRevision: quote.revision,
      };
      const note = {
        ...copy,
        taskId: `${billingTaskId}:carrier-note`,
        billingIdentity: {
          ...base,
          workflowId: `${billingTaskId}:carrier-note`,
          carrierUnitId: 'note',
          carrierBillableUnits: 1,
          packageBilling,
        },
      };
      assert.equal(
        await coordinator.recordCarrierTerminal({ action: 'commit', settlement: copy }),
        null,
      );
      assert.equal(
        (
          await coordinator.recordCarrierTerminal({
            action: 'commit',
            settlement: note,
          })
        )?.action,
        'commit',
      );

      const executor = new HarnessProductBillingSettlementExecutor(
        {
          getQuote: (...args) => service.getQuote(...args),
          getUsage: (...args) => service.getUsage(...args),
          async settleTask(input) {
            settleCalls += 1;
            await service.settleTask(input);
          },
        },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        coordinator,
      );
      const worker = new HarnessCarrierSettlementWorker(coordinator, executor);
      assert.deepEqual(await worker.runOnce(), {
        claimed: 1,
        completed: 1,
        failed: 0,
      });
      assert.deepEqual(await worker.runOnce(), {
        claimed: 0,
        completed: 0,
        failed: 0,
      });
      assert.equal(settleCalls, 1);
      assert.equal(
        (await service.getUsage(billingTaskId, workspaceId))?.status,
        'committed',
      );
    } finally {
      await pool.query(
        'DELETE FROM harness_runtime.billing_work_settlement_outbox WHERE workspace_id=$1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM harness_runtime.billing_carrier_receipts WHERE workspace_id=$1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM harness_runtime.billing_work_settlements WHERE workspace_id=$1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM p1_product_billing_provider_costs WHERE workspace_id=$1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM p1_product_billing_usage WHERE workspace_id=$1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM p1_product_billing_quotes WHERE workspace_id=$1',
        [workspaceId],
      );
      await pool.end();
    }
  },
);

test(
  'ready outbox recovers when a reservation sweeper writes the final carrier refund then stops',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const coordinator = new PostgresHarnessCarrierSettlementCoordinator(pool);
    const suffix = randomUUID();
    const workspaceId = `carrier-sweep-outbox-${suffix}`;
    const billingTaskId = `task-${suffix}`;
    const base = {
      workspaceId,
      taskId: billingTaskId,
      workId: `work-${suffix}`,
      quoteRef: { id: `quote-${suffix}`, revision: 'quote-r1' },
      reservationId: `consume:task:${billingTaskId}`,
      carrierUnitIds: ['copy', 'note'],
    };
    const packageBilling = frozenPackageBilling(suffix, { copy: 1, note: 1 });
    const copy = {
      workspaceId,
      taskId: `${billingTaskId}:carrier-copy`,
      billingTaskId,
      billingIdentity: {
        ...base,
        workflowId: `${billingTaskId}:carrier-copy`,
        carrierUnitId: 'copy',
        carrierBillableUnits: 1,
        packageBilling,
      },
      quoteId: base.quoteRef.id,
      quoteRevision: base.quoteRef.revision,
    };
    const note = {
      ...copy,
      taskId: `${billingTaskId}:carrier-note`,
      billingIdentity: {
        ...base,
        workflowId: `${billingTaskId}:carrier-note`,
        carrierUnitId: 'note',
        carrierBillableUnits: 1,
        packageBilling,
      },
    };
    let failedSweeps = 0;

    try {
      await pool.query('CREATE SCHEMA IF NOT EXISTS harness_runtime');
      await coordinator.migrate();
      assert.equal(
        await coordinator.recordCarrierTerminal({ action: 'commit', settlement: copy }),
        null,
      );
      const sweeper = new HarnessReservationSweeper(
        {
          async claimBatch() {
            return [
              {
                ...note,
                questionId: `question-${suffix}`,
                usageReservationId: `usage-${suffix}`,
                reservedUnits: [],
                heldSince: '2026-08-01T00:00:00.000Z',
                reason: 'hold_reservation_ttl_elapsed' as const,
                attempts: 1,
              },
            ];
          },
          async markCompleted() {
            assert.fail('aggregate crash must not complete the reservation sweep');
          },
          async markFailed() {
            failedSweeps += 1;
          },
        },
        {
          async commit() {
            assert.fail('reservation sweeper must not commit a carrier');
          },
          async refund(input) {
            const ready = await coordinator.recordCarrierTerminal({
              action: 'refund',
              settlement: input,
            });
            assert.equal(ready?.action, 'commit');
            throw new Error('simulated process loss after final carrier receipt');
          },
        },
        {
          now: () => new Date('2026-08-11T00:00:00.000Z'),
          reservationTtlSeconds: 1,
        },
      );

      assert.deepEqual(await sweeper.runOnce(), {
        claimed: 1,
        completed: 0,
        failed: 1,
      });
      assert.equal(failedSweeps, 1);

      const recovered: string[] = [];
      const worker = new HarnessCarrierSettlementWorker(coordinator, {
        async settleReadyWork(ready) {
          recovered.push(`${ready.action}:${ready.aggregateKey}`);
        },
      });
      assert.deepEqual(await worker.runOnce(), {
        claimed: 1,
        completed: 1,
        failed: 0,
      });
      assert.deepEqual(await worker.runOnce(), {
        claimed: 0,
        completed: 0,
        failed: 0,
      });
      assert.equal(recovered.length, 1);
      assert.match(recovered[0]!, /^commit:billing-work:/u);
    } finally {
      await pool.query(
        'DELETE FROM harness_runtime.billing_work_settlement_outbox WHERE workspace_id=$1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM harness_runtime.billing_carrier_receipts WHERE workspace_id=$1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM harness_runtime.billing_work_settlements WHERE workspace_id=$1',
        [workspaceId],
      );
      await pool.end();
    }
  },
);
