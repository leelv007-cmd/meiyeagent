import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import {
  carrierReceiptFingerprint,
  frozenCarrierUnits,
  type CarrierTerminalAction,
  type ClaimedReadyWorkSettlement,
  type HarnessCarrierSettlementCoordinator,
  type ReadyWorkSettlementClaimInput,
  type ReadyWorkSettlementFailure,
  type ReadyWorkSettlement,
  type WorkSettlementCompletion,
  workSettlementKey,
  workspaceIdFromWorkSettlementKey,
} from './carrier-settlement-coordinator.js';
import type { HarnessBillingSettlementInput } from './billing-compensation.js';
import {
  billingPackageAllocation,
  billingIdentityReservationFingerprint,
  settlementIdempotencyKey,
} from '../execution-spine/billing-identity.js';

type StoredReceipt = {
  action: CarrierTerminalAction;
  fingerprint: string;
  payload: HarnessBillingSettlementInput;
};

/**
 * Stores carrier terminal receipts independently, then materializes exactly
 * one Work settlement after every carrier frozen at admission is terminal.
 * The ProductUsage ledger stays keyed by BillingIdentity.taskId and is touched
 * only by the caller that receives a ReadyWorkSettlement.
 */
export class PostgresHarnessCarrierSettlementCoordinator
  implements HarnessCarrierSettlementCoordinator
{
  constructor(private readonly pool: Pool) {}

  async migrate() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS harness_runtime.billing_work_settlements (
        workspace_id text NOT NULL,
        aggregate_key text NOT NULL,
        billing_task_id text NOT NULL,
        work_id text NOT NULL,
        quote_id text NOT NULL,
        quote_revision text NOT NULL,
        reservation_id text NOT NULL,
        carrier_unit_ids jsonb NOT NULL,
        status text NOT NULL DEFAULT 'collecting'
          CHECK (status IN ('collecting', 'ready', 'settled')),
        payload jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, aggregate_key),
        CHECK (jsonb_typeof(carrier_unit_ids) = 'array')
      );

      CREATE TABLE IF NOT EXISTS harness_runtime.billing_carrier_receipts (
        workspace_id text NOT NULL,
        settlement_idempotency_key text NOT NULL,
        aggregate_key text NOT NULL,
        carrier_unit_id text NOT NULL,
        action text NOT NULL CHECK (action IN ('commit', 'refund')),
        fingerprint text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, settlement_idempotency_key),
        FOREIGN KEY (workspace_id, aggregate_key)
          REFERENCES harness_runtime.billing_work_settlements(workspace_id, aggregate_key)
      );
      CREATE INDEX IF NOT EXISTS billing_carrier_receipts_aggregate_idx
        ON harness_runtime.billing_carrier_receipts(workspace_id, aggregate_key);

      ALTER TABLE harness_runtime.billing_work_settlements
        DROP CONSTRAINT IF EXISTS billing_work_settlements_status_check;
      ALTER TABLE harness_runtime.billing_work_settlements
        ADD CONSTRAINT billing_work_settlements_status_check
          CHECK (status IN ('collecting', 'ready', 'settled'));

      CREATE TABLE IF NOT EXISTS harness_runtime.billing_work_settlement_outbox (
        workspace_id text NOT NULL,
        aggregate_key text NOT NULL,
        action text NOT NULL CHECK (action IN ('commit', 'refund')),
        payload jsonb NOT NULL,
        status text NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'processing', 'completed')),
        attempts integer NOT NULL DEFAULT 0,
        next_attempt_at timestamptz NOT NULL DEFAULT now(),
        claim_token text,
        lease_expires_at timestamptz,
        last_error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, aggregate_key),
        FOREIGN KEY (workspace_id, aggregate_key)
          REFERENCES harness_runtime.billing_work_settlements(workspace_id, aggregate_key)
          ON DELETE CASCADE
      );
      ALTER TABLE harness_runtime.billing_work_settlement_outbox
        DROP CONSTRAINT IF EXISTS
          billing_work_settlement_outbox_workspace_id_aggregate_key_fkey;
      ALTER TABLE harness_runtime.billing_work_settlement_outbox
        ADD CONSTRAINT billing_work_settlement_outbox_workspace_id_aggregate_key_fkey
          FOREIGN KEY (workspace_id, aggregate_key)
          REFERENCES harness_runtime.billing_work_settlements(workspace_id, aggregate_key)
          ON DELETE CASCADE;
      CREATE INDEX IF NOT EXISTS billing_work_settlement_outbox_ready_idx
        ON harness_runtime.billing_work_settlement_outbox
          (status, next_attempt_at, created_at);

      -- Upgrade any aggregate that became ready before this outbox existed.
      INSERT INTO harness_runtime.billing_work_settlement_outbox
        (workspace_id, aggregate_key, action, payload)
      SELECT workspace_id, aggregate_key, payload->>'action', payload
        FROM harness_runtime.billing_work_settlements
       WHERE status='ready' AND payload IS NOT NULL
         AND payload->>'action' IN ('commit', 'refund')
      ON CONFLICT (workspace_id, aggregate_key) DO NOTHING;
    `);
  }

  async recordCarrierTerminal(input: {
    action: CarrierTerminalAction;
    settlement: HarnessBillingSettlementInput;
  }): Promise<ReadyWorkSettlement | null> {
    assertCarrierSettlementInput(input.settlement);
    const identity = input.settlement.billingIdentity;
    const aggregateKey = workSettlementKey(identity);
    const carrierUnitId = identity.carrierUnitId?.trim();
    if (!carrierUnitId) {
      throw new Error('Carrier settlement requires the frozen carrier unit id.');
    }
    const carrierUnitIds = frozenCarrierUnits(identity);
    const derivedReceiptKey = settlementIdempotencyKey(identity);
    const receiptKey = input.settlement.settlementIdempotencyKey ?? derivedReceiptKey;
    if (receiptKey !== derivedReceiptKey) {
      throw new Error('Carrier settlement idempotency key does not match its frozen identity.');
    }
    const fingerprint = carrierReceiptFingerprint(input);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [aggregateKey],
      );
      await this.insertOrVerifyAggregate(client, input.settlement, aggregateKey, carrierUnitIds);
      await this.insertOrVerifyReceipt(
        client,
        input,
        aggregateKey,
        carrierUnitId,
        receiptKey,
        fingerprint,
      );
      const aggregate = await client.query<{
        status: 'collecting' | 'ready' | 'settled';
        payload: ReadyWorkSettlement | null;
      }>(
        `SELECT status, payload
           FROM harness_runtime.billing_work_settlements
          WHERE workspace_id=$1 AND aggregate_key=$2
          FOR UPDATE`,
        [input.settlement.workspaceId, aggregateKey],
      );
      const stored = aggregate.rows[0];
      if (!stored) throw new Error('Carrier settlement aggregate disappeared.');
      if (stored.status === 'settled') {
        await client.query('COMMIT');
        return null;
      }
      if (stored.status === 'ready' && stored.payload) {
        await client.query('COMMIT');
        return stored.payload;
      }
      const receipts = await client.query<StoredReceipt>(
        `SELECT action, fingerprint, payload
           FROM harness_runtime.billing_carrier_receipts
          WHERE workspace_id=$1 AND aggregate_key=$2
          ORDER BY carrier_unit_id`,
        [input.settlement.workspaceId, aggregateKey],
      );
      const ready = reduceCarrierReceiptsForWork({
        aggregateKey,
        expectedCarrierUnitIds: carrierUnitIds,
        receipts: receipts.rows,
      });
      if (!ready) {
        await client.query('COMMIT');
        return null;
      }
      await client.query(
        `UPDATE harness_runtime.billing_work_settlements
            SET status='ready', payload=$3::jsonb, updated_at=now()
          WHERE workspace_id=$1 AND aggregate_key=$2`,
        [input.settlement.workspaceId, aggregateKey, JSON.stringify(ready)],
      );
      // This outbox insert shares the receipt/ready transaction. A process can
      // die immediately after commit without losing the one work-level owner.
      await client.query(
        `INSERT INTO harness_runtime.billing_work_settlement_outbox
           (workspace_id, aggregate_key, action, payload)
         VALUES ($1,$2,$3,$4::jsonb)
         ON CONFLICT (workspace_id, aggregate_key) DO NOTHING`,
        [
          input.settlement.workspaceId,
          aggregateKey,
          ready.action,
          JSON.stringify(ready),
        ],
      );
      await client.query('COMMIT');
      return ready;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async markWorkSettled(input: WorkSettlementCompletion) {
    const completion = normalizeWorkSettlementCompletion(input);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (completion.claimToken) {
        const claimed = await client.query(
          `UPDATE harness_runtime.billing_work_settlement_outbox
              SET status='completed', claim_token=NULL, lease_expires_at=NULL,
                  last_error=NULL, updated_at=now()
            WHERE workspace_id=$1 AND aggregate_key=$2
              AND status='processing' AND claim_token=$3
            RETURNING aggregate_key`,
          [
            completion.workspaceId,
            completion.aggregateKey,
            completion.claimToken,
          ],
        );
        if (!claimed.rows[0]) {
          const completed = await client.query<{ status: string }>(
            `SELECT status
               FROM harness_runtime.billing_work_settlement_outbox
              WHERE workspace_id=$1 AND aggregate_key=$2
              FOR UPDATE`,
            [completion.workspaceId, completion.aggregateKey],
          );
          if (completed.rows[0]?.status !== 'completed') {
            throw new Error('Work settlement ready outbox claim was lost.');
          }
        }
      } else {
        await client.query(
          `UPDATE harness_runtime.billing_work_settlement_outbox
              SET status='completed', claim_token=NULL, lease_expires_at=NULL,
                  last_error=NULL, updated_at=now()
            WHERE workspace_id=$1 AND aggregate_key=$2
              AND status <> 'completed'`,
          [completion.workspaceId, completion.aggregateKey],
        );
      }
      await client.query(
        `UPDATE harness_runtime.billing_work_settlements
            SET status='settled', updated_at=now()
          WHERE workspace_id=$1 AND aggregate_key=$2 AND status='ready'`,
        [completion.workspaceId, completion.aggregateKey],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async claimReadyWorkSettlements(
    input: ReadyWorkSettlementClaimInput,
  ): Promise<ClaimedReadyWorkSettlement[]> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1) {
      throw new Error('Ready work settlement claim requires a positive limit.');
    }
    const leaseMs = input.leaseMs ?? 60_000;
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1) {
      throw new Error('Ready work settlement claim requires a positive lease.');
    }
    const claimToken = randomUUID();
    const result = await this.pool.query<{
      aggregate_key: string;
      payload: ReadyWorkSettlement;
      workspace_id: string;
    }>(
      `WITH candidates AS (
         SELECT outbox.workspace_id, outbox.aggregate_key
           FROM harness_runtime.billing_work_settlement_outbox outbox
           JOIN harness_runtime.billing_work_settlements settlements
             ON settlements.workspace_id=outbox.workspace_id
            AND settlements.aggregate_key=outbox.aggregate_key
          WHERE settlements.status='ready'
            AND (
              (outbox.status='pending' AND outbox.next_attempt_at <= now())
              OR (
                outbox.status='processing'
                AND outbox.lease_expires_at < now()
              )
            )
          ORDER BY outbox.next_attempt_at, outbox.created_at
          LIMIT $1
          FOR UPDATE OF outbox SKIP LOCKED
       )
       UPDATE harness_runtime.billing_work_settlement_outbox outbox
          SET status='processing', attempts=outbox.attempts+1,
              claim_token=$2,
              lease_expires_at=now() + ($3 * interval '1 millisecond'),
              updated_at=now()
         FROM candidates
        WHERE outbox.workspace_id=candidates.workspace_id
          AND outbox.aggregate_key=candidates.aggregate_key
       RETURNING outbox.workspace_id, outbox.aggregate_key, outbox.payload`,
      [input.limit, claimToken, leaseMs],
    );
    return result.rows.map((row) => {
      assertReadyOutboxPayload(row.workspace_id, row.aggregate_key, row.payload);
      return { ...row.payload, claimToken };
    });
  }

  async markWorkSettlementFailed(input: ReadyWorkSettlementFailure) {
    if (!Number.isFinite(input.retryAt.getTime())) {
      throw new Error('Work settlement retry time is invalid.');
    }
    const result = await this.pool.query(
      `UPDATE harness_runtime.billing_work_settlement_outbox
          SET status='pending', claim_token=NULL, lease_expires_at=NULL,
              last_error=$4, next_attempt_at=$5, updated_at=now()
        WHERE workspace_id=$1 AND aggregate_key=$2
          AND status='processing' AND claim_token=$3
        RETURNING aggregate_key`,
      [
        input.workspaceId,
        input.aggregateKey,
        input.claimToken,
        input.error.slice(0, 2_000),
        input.retryAt.toISOString(),
      ],
    );
    if (!result.rows[0]) {
      throw new Error('Work settlement ready outbox claim was lost.');
    }
  }

  private async insertOrVerifyAggregate(
    client: PoolClient,
    settlement: HarnessBillingSettlementInput,
    aggregateKey: string,
    carrierUnitIds: readonly string[],
  ) {
    const identity = settlement.billingIdentity;
    await client.query(
      `INSERT INTO harness_runtime.billing_work_settlements
         (workspace_id, aggregate_key, billing_task_id, work_id, quote_id,
          quote_revision, reservation_id, carrier_unit_ids)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT (workspace_id, aggregate_key) DO NOTHING`,
      [
        settlement.workspaceId,
        aggregateKey,
        settlement.billingTaskId,
        identity.workId,
        settlement.quoteId,
        settlement.quoteRevision,
        billingIdentityReservationFingerprint(identity),
        JSON.stringify(carrierUnitIds),
      ],
    );
    const existing = await client.query<{
      billing_task_id: string;
      work_id: string;
      quote_id: string;
      quote_revision: string;
      reservation_id: string;
      carrier_unit_ids: string[];
    }>(
      `SELECT billing_task_id, work_id, quote_id, quote_revision, reservation_id,
              carrier_unit_ids
         FROM harness_runtime.billing_work_settlements
        WHERE workspace_id=$1 AND aggregate_key=$2
        FOR UPDATE`,
      [settlement.workspaceId, aggregateKey],
    );
    const row = existing.rows[0];
    if (
      !row ||
      row.billing_task_id !== settlement.billingTaskId ||
      row.work_id !== identity.workId ||
      row.quote_id !== settlement.quoteId ||
      row.quote_revision !== settlement.quoteRevision ||
      row.reservation_id !== billingIdentityReservationFingerprint(identity) ||
      JSON.stringify([...row.carrier_unit_ids].sort()) !== JSON.stringify(carrierUnitIds)
    ) {
      throw new Error('Carrier settlement aggregate does not match frozen identity facts.');
    }
  }

  private async insertOrVerifyReceipt(
    client: PoolClient,
    input: { action: CarrierTerminalAction; settlement: HarnessBillingSettlementInput },
    aggregateKey: string,
    carrierUnitId: string,
    receiptKey: string,
    fingerprint: string,
  ) {
    const inserted = await client.query<{ fingerprint: string }>(
      `INSERT INTO harness_runtime.billing_carrier_receipts
         (workspace_id, settlement_idempotency_key, aggregate_key, carrier_unit_id,
          action, fingerprint, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       ON CONFLICT (workspace_id, settlement_idempotency_key) DO NOTHING
       RETURNING fingerprint`,
      [
        input.settlement.workspaceId,
        receiptKey,
        aggregateKey,
        carrierUnitId,
        input.action,
        fingerprint,
        JSON.stringify(input.settlement),
      ],
    );
    if (inserted.rows[0]) return;
    const existing = await client.query<{
      action: CarrierTerminalAction;
      fingerprint: string;
      aggregate_key: string;
      carrier_unit_id: string;
    }>(
      `SELECT action, fingerprint, aggregate_key, carrier_unit_id
         FROM harness_runtime.billing_carrier_receipts
        WHERE workspace_id=$1 AND settlement_idempotency_key=$2
        FOR UPDATE`,
      [input.settlement.workspaceId, receiptKey],
    );
    const row = existing.rows[0];
    if (
      !row ||
      row.action !== input.action ||
      row.fingerprint !== fingerprint ||
      row.aggregate_key !== aggregateKey ||
      row.carrier_unit_id !== carrierUnitId
    ) {
      throw new Error('Carrier settlement receipt conflicts with its frozen idempotency key.');
    }
  }
}

function assertCarrierSettlementInput(input: HarnessBillingSettlementInput) {
  const identity = input.billingIdentity;
  // Validate the typed operation tuple before any aggregate/receipt write. The
  // legacy reservation_id column stores only its compatibility fingerprint;
  // it must never be accepted as an inferred credit refund operation.
  billingIdentityReservationFingerprint(identity);
  if (
    identity.workspaceId !== input.workspaceId ||
    identity.workflowId !== input.taskId ||
    identity.taskId !== input.billingTaskId ||
    identity.quoteRef.id !== input.quoteId ||
    identity.quoteRef.revision !== input.quoteRevision
  ) {
    throw new Error('Carrier settlement input does not match its frozen identity.');
  }
  const suppliedCreditUsageOperationId = input.creditUsageOperationId?.trim();
  if (
    suppliedCreditUsageOperationId &&
    suppliedCreditUsageOperationId !== identity.creditUsageOperationId
  ) {
    throw new Error(
      'Carrier settlement credit usage operation does not match its frozen identity.',
    );
  }
  frozenCarrierUnits(identity);
  if (identity.packageBilling) billingPackageAllocation(identity);
}

function normalizeWorkSettlementCompletion(
  input: WorkSettlementCompletion,
): {
  workspaceId: string;
  aggregateKey: string;
  claimToken?: string;
} {
  if (typeof input === 'string') {
    return {
      workspaceId: workspaceIdFromWorkSettlementKey(input),
      aggregateKey: input,
    };
  }
  if (!input.workspaceId.trim() || !input.aggregateKey.trim()) {
    throw new Error('Work settlement completion requires workspace and aggregate key.');
  }
  if (workspaceIdFromWorkSettlementKey(input.aggregateKey) !== input.workspaceId) {
    throw new Error('Work settlement completion workspace does not match aggregate key.');
  }
  if (input.claimToken !== undefined && !input.claimToken.trim()) {
    throw new Error('Work settlement completion claim token is invalid.');
  }
  return input;
}

function assertReadyOutboxPayload(
  workspaceId: string,
  aggregateKey: string,
  payload: ReadyWorkSettlement,
) {
  if (
    !payload ||
    payload.aggregateKey !== aggregateKey ||
    payload.settlement?.workspaceId !== workspaceId ||
    (payload.action !== 'commit' && payload.action !== 'refund')
  ) {
    throw new Error('Ready work settlement outbox payload does not match its row.');
  }
}

export function reduceCarrierReceiptsForWork(input: {
  aggregateKey: string;
  expectedCarrierUnitIds: readonly string[];
  receipts: readonly StoredReceipt[];
}): ReadyWorkSettlement | null {
  if (input.receipts.length !== input.expectedCarrierUnitIds.length) return null;
  const byCarrier = new Map<string, StoredReceipt>();
  for (const receipt of input.receipts) {
    const carrier = receipt.payload.billingIdentity.carrierUnitId?.trim();
    if (!carrier) {
      throw new Error('Carrier receipt is missing its frozen carrier unit id.');
    }
    if (!input.expectedCarrierUnitIds.includes(carrier) || byCarrier.has(carrier)) {
      throw new Error('Carrier receipt set does not match the frozen aggregate membership.');
    }
    byCarrier.set(carrier, receipt);
  }
  if (byCarrier.size !== input.expectedCarrierUnitIds.length) return null;
  const receipts = [...byCarrier.values()];
  const first = receipts[0];
  if (!first) return null;
  const canonical = first.payload;
  for (const receipt of receipts) {
    const settlement = receipt.payload;
    const identity = settlement.billingIdentity;
    if (
      settlement.workspaceId !== canonical.workspaceId ||
      settlement.billingTaskId !== canonical.billingTaskId ||
      identity.workId !== canonical.billingIdentity.workId ||
      settlement.quoteId !== canonical.quoteId ||
      settlement.quoteRevision !== canonical.quoteRevision ||
      identity.reservationId !== canonical.billingIdentity.reservationId ||
      billingIdentityReservationFingerprint(identity) !==
        billingIdentityReservationFingerprint(canonical.billingIdentity) ||
      JSON.stringify(frozenCarrierUnits(identity)) !==
        JSON.stringify(input.expectedCarrierUnitIds) ||
      JSON.stringify(identity.packageBilling ?? null) !==
        JSON.stringify(canonical.billingIdentity.packageBilling ?? null)
    ) {
      throw new Error('Carrier receipt facts cannot be combined into one Work settlement.');
    }
  }
  if (
    input.expectedCarrierUnitIds.length > 1 &&
    receipts.some((receipt) => receipt.payload.trustedUsage)
  ) {
    throw new Error(
      'Multi-carrier trusted usage requires a carrier-aware product quote reducer.',
    );
  }
  if (input.expectedCarrierUnitIds.length === 1) {
    return {
      aggregateKey: input.aggregateKey,
      action: first.action,
      settlement: canonical,
    };
  }
  const packageBilling = canonical.billingIdentity.packageBilling;
  if (!packageBilling) {
    throw new Error(
      'Multi-carrier settlement requires a frozen package billing contract.',
    );
  }
  return reducePackageCarrierReceiptsForWork({
    aggregateKey: input.aggregateKey,
    receipts,
    canonical,
  });
}

/**
 * Package reductions are keyed to the exact allocation id frozen in each
 * receipt identity. Do not replace this with a global delivered/total ratio:
 * note pages and copy outputs can have different prices and refund policies.
 */
function reducePackageCarrierReceiptsForWork(input: {
  aggregateKey: string;
  receipts: readonly StoredReceipt[];
  canonical: HarnessBillingSettlementInput;
}): ReadyWorkSettlement {
  const packageBilling = input.canonical.billingIdentity.packageBilling;
  if (!packageBilling) {
    throw new Error('Package receipt reducer requires a frozen package contract.');
  }
  const frozenAllocationIds = new Set(
    packageBilling.allocations.map((allocation) => allocation.allocationId),
  );
  const deliveredByAllocation = new Map<string, number>();
  for (const receipt of input.receipts) {
    const settlement = receipt.payload;
    if (settlement.packagePartialDelivery) {
      throw new Error(
        'Carrier receipts must not carry an aggregate package partial delivery basis.',
      );
    }
    const allocation = billingPackageAllocation(settlement.billingIdentity);
    if (!allocation) {
      throw new Error('Package carrier receipt is missing its frozen allocation.');
    }
    if (!frozenAllocationIds.has(allocation.allocationId)) {
      throw new Error('Package carrier receipt allocation is outside the frozen contract.');
    }
    if (deliveredByAllocation.has(allocation.allocationId)) {
      throw new Error('Package carrier receipts duplicate a frozen allocation.');
    }
    const partial = settlement.partialDelivery;
    if (
      partial &&
      (partial.totalUnits !== allocation.deliveryUnits ||
        !Number.isSafeInteger(partial.deliveredUnits) ||
        partial.deliveredUnits < 0 ||
        partial.deliveredUnits > allocation.deliveryUnits)
    ) {
      throw new Error(
        'Package carrier partial delivery must use its exact frozen allocation units.',
      );
    }
    if (receipt.action === 'refund' && partial?.deliveredUnits) {
      throw new Error('Refunded package carrier receipts cannot claim delivered units.');
    }
    deliveredByAllocation.set(
      allocation.allocationId,
      receipt.action === 'refund'
        ? 0
        : (partial?.deliveredUnits ?? allocation.deliveryUnits),
    );
  }
  if (deliveredByAllocation.size !== frozenAllocationIds.size) {
    throw new Error('Package carrier receipts do not cover every frozen allocation exactly once.');
  }
  const allocations = packageBilling.allocations.map((allocation) => {
    const deliveredUnits = deliveredByAllocation.get(allocation.allocationId);
    if (deliveredUnits === undefined) {
      throw new Error('Package carrier receipts are missing frozen allocation evidence.');
    }
    return { allocationId: allocation.allocationId, deliveredUnits };
  });
  const action: CarrierTerminalAction = allocations.some(
    (allocation) => allocation.deliveredUnits > 0,
  )
    ? 'commit'
    : 'refund';
  return {
    aggregateKey: input.aggregateKey,
    action,
    settlement: {
      ...input.canonical,
      trustedUsage: undefined,
      partialDelivery: undefined,
      packagePartialDelivery: { allocations },
      forceCreditRefund:
        action === 'refund' &&
        input.receipts.some((receipt) => receipt.payload.forceCreditRefund),
    },
  };
}
