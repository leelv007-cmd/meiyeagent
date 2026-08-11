import { createHash } from 'node:crypto';

import {
  billingPackageAllocation,
  billingIdentityReservationFingerprint,
  type BillingIdentity,
} from '../execution-spine/billing-identity.js';
import type {
  HarnessBillingSettlementInput,
} from './billing-compensation.js';

export type CarrierTerminalAction = 'commit' | 'refund';

export type ReadyWorkSettlement = {
  aggregateKey: string;
  action: CarrierTerminalAction;
  settlement: HarnessBillingSettlementInput;
};

/**
 * A leased ready-aggregate outbox record. `claimToken` is required when a
 * recovery worker acknowledges or releases the record, so an expired worker
 * cannot complete a newer owner's claim.
 */
export type ClaimedReadyWorkSettlement = ReadyWorkSettlement & {
  claimToken: string;
};

export type ReadyWorkSettlementClaimInput = {
  limit: number;
  leaseMs?: number;
};

export type ReadyWorkSettlementFailure = {
  workspaceId: string;
  aggregateKey: string;
  claimToken: string;
  error: string;
  retryAt: Date;
};

export type WorkSettlementCompletion =
  | string
  | {
      workspaceId: string;
      aggregateKey: string;
      /** Present only for a recovery-worker lease acknowledgement. */
      claimToken?: string;
    };

/**
 * Durable boundary between per-carrier Make completion and the one shared
 * ProductUsage settlement. Implementations must persist a carrier receipt
 * before reporting a Work settlement ready.
 */
export interface HarnessCarrierSettlementCoordinator {
  recordCarrierTerminal(input: {
    action: CarrierTerminalAction;
    settlement: HarnessBillingSettlementInput;
  }): Promise<ReadyWorkSettlement | null>;
  /**
   * A string is retained for synchronous callers while implementations derive
   * and bind the workspace from the encoded aggregate key. Recovery workers
   * must supply an explicit workspace and their claim token.
   */
  markWorkSettled(input: WorkSettlementCompletion): Promise<void>;
  /**
   * Coordinator-owned ready outbox. Optional during the compatibility rollout
   * so existing synchronous-only test coordinators remain valid.
   */
  claimReadyWorkSettlements?(
    input: ReadyWorkSettlementClaimInput,
  ): Promise<ClaimedReadyWorkSettlement[]>;
  markWorkSettlementFailed?(
    input: ReadyWorkSettlementFailure,
  ): Promise<void>;
}

/** The recovery worker requires all ready-outbox operations. */
export interface HarnessCarrierSettlementRecoveryStore
  extends HarnessCarrierSettlementCoordinator {
  claimReadyWorkSettlements(
    input: ReadyWorkSettlementClaimInput,
  ): Promise<ClaimedReadyWorkSettlement[]>;
  markWorkSettlementFailed(input: ReadyWorkSettlementFailure): Promise<void>;
}

export function workSettlementKey(identity: BillingIdentity): string {
  const carriers = frozenCarrierUnits(identity);
  // A package quote is a distinct immutable aggregate even if an erroneous
  // caller reuses its task/work/quote identifiers. Validate the explicit
  // carrier→allocation mapping before accepting its contract hash.
  const packageContractHash = identity.packageBilling
    ? (billingPackageAllocation(identity), identity.packageBilling.contractHash)
    : undefined;
  const facts = [
    identity.workspaceId,
    identity.taskId,
    identity.workId,
    identity.quoteRef.id,
    identity.quoteRef.revision,
    billingIdentityReservationFingerprint(identity),
    ...carriers,
    ...(packageContractHash ? [packageContractHash] : []),
  ];
  return `billing-work:${facts.map((value) => Buffer.from(value, 'utf8').toString('base64')).join(':')}`;
}

/**
 * `workSettlementKey` embeds workspace first. Keeping decoding here lets the
 * legacy synchronous acknowledgement remain tenant-scoped without asking its
 * callers to reconstruct an identity they no longer hold.
 */
export function workspaceIdFromWorkSettlementKey(aggregateKey: string): string {
  const [prefix, encodedWorkspace, ...remainder] = aggregateKey.split(':');
  if (
    prefix !== 'billing-work' ||
    !encodedWorkspace ||
    remainder.length < 6
  ) {
    throw new Error('Work settlement key does not contain a frozen workspace.');
  }
  const workspaceId = Buffer.from(encodedWorkspace, 'base64').toString('utf8');
  if (!workspaceId.trim()) {
    throw new Error('Work settlement key contains an empty frozen workspace.');
  }
  return workspaceId;
}

export function frozenCarrierUnits(identity: BillingIdentity): string[] {
  const carrier = identity.carrierUnitId?.trim();
  const units = identity.carrierUnitIds?.map((value) => value.trim());
  if (
    !carrier ||
    !units ||
    units.length === 0 ||
    units.some((value) => !value) ||
    new Set(units).size !== units.length ||
    !units.includes(carrier)
  ) {
    throw new Error('Carrier settlement requires an exact frozen carrier set.');
  }
  return [...units].sort();
}

export function carrierReceiptFingerprint(input: {
  action: CarrierTerminalAction;
  settlement: HarnessBillingSettlementInput;
}): string {
  // The compensation store adds this transport field before a worker retry.
  // Receipt identity is already derived and verified separately, so it must
  // not make a direct terminal write conflict with its queued replay.
  const { settlementIdempotencyKey: _settlementIdempotencyKey, ...settlement } =
    input.settlement;
  void _settlementIdempotencyKey;
  return createHash('sha256')
    .update(JSON.stringify({ action: input.action, settlement }))
    .digest('hex');
}
