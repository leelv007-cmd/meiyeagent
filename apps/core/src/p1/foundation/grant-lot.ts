/**
 * Td-1 grant-lot ledger domain model (bar-count metering, not currency credits).
 *
 * Existing p1_usage_events remain the reservation state machine
 * (reserve/commit/refund/expire/adjust/compensate). Grant lots track
 * where allowance came from and FIFO consumption by expiration.
 *
 * FIFO order: expirationDate ASC NULLS LAST (never-expiring lots last).
 * PG migration can follow; memory repo is sufficient for unit tests.
 */

import { P1DomainError } from './domain.js';

export const GRANT_LOT_TRANSACTION_TYPES = [
  'REGISTER_GIFT',
  'SUBSCRIPTION_RENEWAL',
  'PURCHASE_PACKAGE',
  'REDEMPTION_CODE',
  'REFUND',
  'USAGE',
  'EXPIRE',
] as const;

export type GrantLotTransactionType = (typeof GRANT_LOT_TRANSACTION_TYPES)[number];

export type GrantLotResource = 'copy' | 'image' | 'video' | 'audio';

/** Grant path idempotency key prefix (independent from consume). */
export const GRANT_IDEMPOTENCY_KEY_PREFIX = 'grant:' as const;
/** Consume / USAGE path idempotency key prefix (independent from grant). */
export const CONSUME_IDEMPOTENCY_KEY_PREFIX = 'consume:' as const;

/** Optional pool / entitlement source of a grant lot (H2 narrow extend). */
export type GrantLotGrantSource =
  | 'plan'
  | 'campaign'
  | 'purchase'
  | 'redemption'
  | 'register_gift'
  | 'pool_allocation'
  | 'support_compensation';

export interface GrantLot {
  id: string;
  workspaceId: string;
  resource: GrantLotResource;
  /** Original granted amount (immutable). */
  originalAmount: number;
  /** Current entitlement ceiling after plan reductions; never increases. */
  entitlementAmount?: number;
  /** Remaining unconsumed amount. */
  remainingAmount: number;
  /** ISO timestamp; null = no expiry (add-on / gift long-lived). */
  expirationDate: string | null;
  transactionType: Exclude<
    GrantLotTransactionType,
    'USAGE' | 'REFUND' | 'EXPIRE'
  >;
  /** Optional link to payment / redemption / plan event. */
  sourceRef?: string;
  /**
   * Optional SupplyPool that sourced this grant (H2 narrow extend).
   * Does not merge GrantLot with ProductUsage / ProviderCost chains.
   */
  supplyPoolId?: string;
  /** Optional grant source classification (H2 narrow extend). */
  grantSource?: GrantLotGrantSource;
  /**
   * Independent grant-path idempotency key (H2).
   * Must not share namespace with consume keys (`consume:…`).
   */
  grantIdempotencyKey?: string;
  /** Optimistic revision for projection repair / CAS writes. */
  revision?: number;
  createdAt: string;
}

export interface GrantLotTransaction {
  id: string;
  workspaceId: string;
  resource: GrantLotResource;
  transactionType: GrantLotTransactionType;
  amount: number;
  /** Lot this transaction mutates (USAGE/EXPIRE/REFUND consume or restore). */
  lotId: string;
  /** For REFUND: points at the failed USAGE transaction. */
  relatedTransactionId?: string;
  /** Stable idempotency key shared by every per-lot row of one operation. */
  operationId?: string;
  actorId: string;
  correlationId: string;
  createdAt: string;
}

/** Sort key for FIFO consumption: earliest expiry first, nulls last. */
export function compareGrantLotsForFifo(left: GrantLot, right: GrantLot): number {
  if (left.expirationDate === null && right.expirationDate === null) {
    return compareCreatedAtAndId(left, right);
  }
  if (left.expirationDate === null) return 1;
  if (right.expirationDate === null) return -1;
  const byExpiry =
    Date.parse(left.expirationDate) - Date.parse(right.expirationDate);
  if (byExpiry !== 0) return byExpiry;
  return compareCreatedAtAndId(left, right);
}

function compareCreatedAtAndId(left: GrantLot, right: GrantLot) {
  const byCreatedAt = Date.parse(left.createdAt) - Date.parse(right.createdAt);
  return byCreatedAt !== 0 ? byCreatedAt : left.id.localeCompare(right.id);
}

/**
 * Consume `amount` from lots using FIFO. Returns per-lot deductions.
 * Does not mutate inputs.
 */
export function allocateFifoConsumption(
  lots: readonly GrantLot[],
  amount: number
): Array<{ lotId: string; amount: number }> {
  if (!Number.isInteger(amount) || amount <= 0) {
    return [];
  }
  const ordered = [...lots]
    .filter((lot) => lot.remainingAmount > 0)
    .sort(compareGrantLotsForFifo);
  let remaining = amount;
  const allocations: Array<{ lotId: string; amount: number }> = [];
  for (const lot of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(lot.remainingAmount, remaining);
    if (take > 0) {
      allocations.push({ lotId: lot.id, amount: take });
      remaining -= take;
    }
  }
  return allocations;
}

export interface GrantLotProjection {
  resource: GrantLotResource;
  grantedAmount: number;
  usedAmount: number;
  refundedAmount: number;
  expiredAmount: number;
  remainingAmount: number;
}

export type GrantLotGrantInput = Omit<
  GrantLot,
  'remainingAmount' | 'originalAmount' | 'revision' | 'grantIdempotencyKey'
> & {
  amount: number;
  actorId?: string;
  correlationId?: string;
  /**
   * Independent grant idempotency key (defaults to `grant:${id}`).
   * Must not collide with consume keys — see assertIndependentGrantConsumeIdempotencyKeys.
   */
  grantIdempotencyKey?: string;
};

/**
 * Normalize a grant idempotency key. Always under the `grant:` namespace so it
 * cannot silently collide with consume (`consume:`) keys (MkImage lesson).
 */
export function normalizeGrantIdempotencyKey(
  lotId: string,
  explicit?: string
): string {
  if (explicit !== undefined && explicit.trim()) {
    if (explicit.startsWith(CONSUME_IDEMPOTENCY_KEY_PREFIX)) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Grant idempotency key must not use the consume: namespace.'
      );
    }
    return explicit.startsWith(GRANT_IDEMPOTENCY_KEY_PREFIX)
      ? explicit
      : `${GRANT_IDEMPOTENCY_KEY_PREFIX}${explicit}`;
  }
  return `${GRANT_IDEMPOTENCY_KEY_PREFIX}${lotId}`;
}

/**
 * Normalize a consume / USAGE idempotency key.
 * Rejects the grant: namespace. Does not rewrite legacy bare keys so existing
 * operationId callers remain stable; new callers should prefer `consume:…`.
 */
export function normalizeConsumeIdempotencyKey(explicit: string): string {
  if (!explicit.trim()) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Consume idempotency key is required.'
    );
  }
  if (explicit.startsWith(GRANT_IDEMPOTENCY_KEY_PREFIX)) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Consume idempotency key must not use the grant: namespace.'
    );
  }
  return explicit;
}

/**
 * Build a namespaced consume key for new call sites (H2 preference).
 */
export function buildConsumeIdempotencyKey(operationId: string): string {
  const normalized = normalizeConsumeIdempotencyKey(operationId);
  return normalized.startsWith(CONSUME_IDEMPOTENCY_KEY_PREFIX)
    ? normalized
    : `${CONSUME_IDEMPOTENCY_KEY_PREFIX}${normalized}`;
}

/**
 * Hard requirement (D-066 / MkImage lessons): grant and consume keys are
 * independent — never share a single idempotency key across paths.
 */
export function assertIndependentGrantConsumeIdempotencyKeys(
  grantKey: string,
  consumeKey: string
): void {
  if (!grantKey.trim() || !consumeKey.trim()) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Grant and consume idempotency keys are both required.'
    );
  }
  if (grantKey === consumeKey) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Grant and consume must use independent idempotency keys.'
    );
  }
  if (consumeKey.startsWith(GRANT_IDEMPOTENCY_KEY_PREFIX)) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Consume idempotency key must not use the grant: namespace.'
    );
  }
  if (grantKey.startsWith(CONSUME_IDEMPOTENCY_KEY_PREFIX)) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Grant idempotency key must not use the consume: namespace.'
    );
  }
}

export interface GrantLotEntitlementReconciliationInput {
  workspaceId: string;
  resource: GrantLotResource;
  lotIds: string[];
  /** Total plan allowance represented by these lots after reconciliation. */
  targetAmount: number;
  /** Effective plan boundary; reconciliation may only shorten a lot boundary. */
  expirationDate: string;
  operationId: string;
  actorId: string;
  correlationId: string;
  asOf: string;
}

export interface LegacyGrantLotMigrationInput {
  workspaceId: string;
  resource: GrantLotResource;
  legacyAvailable: number;
  legacySnapshotId: string;
  balanceLotId: string;
  createdAt: string;
  asOf: string;
}

const grantTransactionTypes = new Set<GrantLotTransactionType>([
  'REGISTER_GIFT',
  'SUBSCRIPTION_RENEWAL',
  'PURCHASE_PACKAGE',
  'REDEMPTION_CODE',
]);

export function assertGrantLotGrantInput(input: GrantLotGrantInput) {
  if (!input.id.trim() || !input.workspaceId.trim()) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Grant lot identity and workspace are required.'
    );
  }
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Grant lot amount must be a positive integer.'
    );
  }
  if (!grantTransactionTypes.has(input.transactionType)) {
    throw new P1DomainError('INVALID_STATE', 'Grant transaction type is invalid.');
  }
  assertIsoTimestamp(input.createdAt, 'createdAt');
  if (input.expirationDate !== null) {
    assertIsoTimestamp(input.expirationDate, 'expirationDate');
    if (Date.parse(input.expirationDate) <= Date.parse(input.createdAt)) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Grant expiration must be after its creation time.'
      );
    }
  }
}

function assertIsoTimestamp(value: string, field: string) {
  if (!value.trim() || !Number.isFinite(Date.parse(value))) {
    throw new P1DomainError('INVALID_STATE', `${field} must be an ISO timestamp.`);
  }
}

export class MemoryGrantLotLedger {
  private readonly lots: GrantLot[] = [];
  private readonly transactions: GrantLotTransaction[] = [];
  private readonly legacyBalanceMigrations = new Set<string>();
  private transactionTail: Promise<void> = Promise.resolve();

  listLots(workspaceId: string, resource?: GrantLotResource): GrantLot[] {
    return this.lots
      .filter(
        (lot) =>
          lot.workspaceId === workspaceId &&
          (resource === undefined || lot.resource === resource)
      )
      .map((lot) => structuredClone(lot));
  }

  listTransactions(workspaceId: string): GrantLotTransaction[] {
    return this.transactions
      .filter((tx) => tx.workspaceId === workspaceId)
      .map((tx) => structuredClone(tx));
  }

  isLegacyBalanceMigrated(
    workspaceId: string,
    resource: GrantLotResource
  ) {
    return this.legacyBalanceMigrations.has(`${workspaceId}:${resource}:v1`);
  }

  markLegacyBalanceMigrated(input: {
    workspaceId: string;
    resource: GrantLotResource;
    completedAt: string;
  }) {
    assertIsoTimestamp(input.completedAt, 'completedAt');
    this.legacyBalanceMigrations.add(
      `${input.workspaceId}:${input.resource}:v1`
    );
  }

  migrateLegacyBalance(input: LegacyGrantLotMigrationInput) {
    if (this.isLegacyBalanceMigrated(input.workspaceId, input.resource)) return;
    if (!Number.isInteger(input.legacyAvailable) || input.legacyAvailable < 0) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Legacy available balance must be a non-negative integer.'
      );
    }
    assertIsoTimestamp(input.createdAt, 'createdAt');
    assertIsoTimestamp(input.asOf, 'asOf');
    const lotsBefore = structuredClone(this.lots);
    const transactionsBefore = structuredClone(this.transactions);
    try {
      const mirroredLots = this.lots.filter(
        (lot) =>
          lot.workspaceId === input.workspaceId &&
          lot.resource === input.resource &&
          lot.transactionType !== 'REDEMPTION_CODE'
      );
      const mirroredRemaining = mirroredLots.reduce(
        (total, lot) => total + lot.remainingAmount,
        0
      );
      const historicalUsage = Math.max(
        0,
        mirroredRemaining - input.legacyAvailable
      );
      if (historicalUsage > 0) {
        const operationId =
          `legacy-usage-migration:${input.resource}:${input.legacySnapshotId}`;
        const allocations = allocateFifoConsumption(
          mirroredLots,
          historicalUsage
        );
        for (const [index, allocation] of allocations.entries()) {
          const lot = this.lots.find(
            (candidate) =>
              candidate.workspaceId === input.workspaceId &&
              candidate.id === allocation.lotId
          );
          if (!lot) continue;
          lot.remainingAmount -= allocation.amount;
          lot.revision = (lot.revision ?? 1) + 1;
          this.transactions.push({
            id: `${operationId}:${index}`,
            workspaceId: input.workspaceId,
            resource: input.resource,
            transactionType: 'USAGE',
            amount: allocation.amount,
            lotId: lot.id,
            operationId,
            actorId: 'system-legacy-grant-migration',
            correlationId: `legacy-grant-migration:${input.workspaceId}`,
            createdAt: input.asOf,
          });
        }
      } else {
        const missingBalance = Math.max(
          0,
          input.legacyAvailable - mirroredRemaining
        );
        if (missingBalance > 0) {
          this.grant({
            id: input.balanceLotId,
            workspaceId: input.workspaceId,
            resource: input.resource,
            amount: missingBalance,
            expirationDate: null,
            transactionType: 'PURCHASE_PACKAGE',
            sourceRef: `legacy-usage-balance:${input.resource}:v1`,
            actorId: 'system-legacy-grant-migration',
            correlationId: `legacy-grant-migration:${input.workspaceId}`,
            createdAt: input.createdAt,
          });
        }
      }
      this.markLegacyBalanceMigrated({
        workspaceId: input.workspaceId,
        resource: input.resource,
        completedAt: input.asOf,
      });
    } catch (error) {
      this.lots.splice(0, this.lots.length, ...lotsBefore);
      this.transactions.splice(
        0,
        this.transactions.length,
        ...transactionsBefore
      );
      throw error;
    }
  }

  grant(input: GrantLotGrantInput): GrantLot {
    assertGrantLotGrantInput(input);
    const grantKey = normalizeGrantIdempotencyKey(
      input.id,
      input.grantIdempotencyKey
    );
    const existingByKey = this.lots.find(
      (lot) =>
        lot.workspaceId === input.workspaceId &&
        lot.grantIdempotencyKey === grantKey
    );
    const existing =
      existingByKey ??
      this.lots.find(
        (lot) => lot.workspaceId === input.workspaceId && lot.id === input.id
      );
    if (existing) {
      const same =
        existing.resource === input.resource &&
        existing.originalAmount === input.amount &&
        expirationIsSameOrShorter(
          existing.expirationDate,
          input.expirationDate
        ) &&
        existing.transactionType === input.transactionType &&
        existing.sourceRef === input.sourceRef &&
        existing.createdAt === input.createdAt &&
        existing.supplyPoolId === input.supplyPoolId &&
        existing.grantSource === input.grantSource &&
        (existing.grantIdempotencyKey === undefined ||
          existing.grantIdempotencyKey === grantKey);
      if (!same) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          `Grant lot ${input.id} already exists with different facts.`
        );
      }
      return structuredClone(existing);
    }
    const lot: GrantLot = {
      id: input.id,
      workspaceId: input.workspaceId,
      resource: input.resource,
      originalAmount: input.amount,
      entitlementAmount: input.amount,
      remainingAmount: input.amount,
      expirationDate: input.expirationDate,
      transactionType: input.transactionType,
      ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
      ...(input.supplyPoolId ? { supplyPoolId: input.supplyPoolId } : {}),
      ...(input.grantSource ? { grantSource: input.grantSource } : {}),
      grantIdempotencyKey: grantKey,
      revision: 1,
      createdAt: input.createdAt,
    };
    this.lots.push(lot);
    this.transactions.push({
      id: `tx-grant-${input.id}`,
      workspaceId: input.workspaceId,
      resource: input.resource,
      transactionType: input.transactionType,
      amount: input.amount,
      lotId: input.id,
      operationId: grantKey,
      actorId: input.actorId ?? 'system',
      correlationId: input.correlationId ?? 'grant',
      createdAt: input.createdAt,
    });
    return structuredClone(lot);
  }

  consume(input: {
    workspaceId: string;
    resource: GrantLotResource;
    amount: number;
    transactionId: string;
    actorId: string;
    correlationId: string;
    createdAt: string;
  }): GrantLotTransaction[] {
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Usage amount must be a positive integer.'
      );
    }
    assertIsoTimestamp(input.createdAt, 'createdAt');
    const consumeKey = normalizeConsumeIdempotencyKey(input.transactionId);
    // Grant and consume keys must remain independent (H2 hard requirement).
    for (const lot of this.lots) {
      if (
        lot.workspaceId === input.workspaceId &&
        lot.grantIdempotencyKey !== undefined
      ) {
        assertIndependentGrantConsumeIdempotencyKeys(
          lot.grantIdempotencyKey,
          consumeKey
        );
      }
    }
    const replay = this.transactions.filter(
      (transaction) =>
        transaction.workspaceId === input.workspaceId &&
        transaction.transactionType === 'USAGE' &&
        transaction.operationId === consumeKey
    );
    if (replay.length > 0) {
      const replayedAmount = replay.reduce(
        (total, transaction) => total + transaction.amount,
        0
      );
      if (
        replayedAmount !== input.amount ||
        replay.some((transaction) => transaction.resource !== input.resource)
      ) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'Usage operation was replayed with different facts.'
        );
      }
      return structuredClone(replay);
    }
    const lots = this.lots.filter(
      (lot) =>
        lot.workspaceId === input.workspaceId &&
        lot.resource === input.resource &&
        lot.remainingAmount > 0 &&
        (lot.expirationDate === null ||
          Date.parse(lot.expirationDate) > Date.parse(input.createdAt))
    );
    this.expireLots({
      workspaceId: input.workspaceId,
      now: input.createdAt,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });
    const allocations = allocateFifoConsumption(
      lots.filter((lot) => lot.remainingAmount > 0),
      input.amount
    );
    if (
      allocations.reduce((total, allocation) => total + allocation.amount, 0) !==
      input.amount
    ) {
      throw new P1DomainError(
        'INSUFFICIENT_ENTITLEMENT',
        `Insufficient ${input.resource} allowance.`
      );
    }
    const written: GrantLotTransaction[] = [];
    for (const [index, allocation] of allocations.entries()) {
      const lot = this.lots.find(
        (candidate) =>
          candidate.workspaceId === input.workspaceId &&
          candidate.id === allocation.lotId
      );
      if (!lot) continue;
      lot.remainingAmount -= allocation.amount;
      lot.revision = (lot.revision ?? 1) + 1;
      const tx: GrantLotTransaction = {
        id: `${consumeKey}:${index}`,
        workspaceId: input.workspaceId,
        resource: input.resource,
        transactionType: 'USAGE',
        amount: allocation.amount,
        lotId: allocation.lotId,
        operationId: consumeKey,
        actorId: input.actorId,
        correlationId: input.correlationId,
        createdAt: input.createdAt,
      };
      this.transactions.push(tx);
      written.push(structuredClone(tx));
    }
    return written;
  }

  /**
   * Refund a prior USAGE transaction by restoring remainingAmount on its lot.
   * Idempotent on relatedTransactionId.
   */
  refundUsage(input: {
    workspaceId: string;
    usageTransactionId: string;
    refundTransactionId: string;
    actorId: string;
    correlationId: string;
    createdAt: string;
  }): GrantLotTransaction | null {
    assertIsoTimestamp(input.createdAt, 'createdAt');
    const already = this.transactions.find(
      (tx) =>
        tx.workspaceId === input.workspaceId &&
        tx.transactionType === 'REFUND' &&
        tx.relatedTransactionId === input.usageTransactionId
    );
    if (already) return structuredClone(already);

    const usage = this.transactions.find(
      (tx) =>
        tx.id === input.usageTransactionId &&
        tx.workspaceId === input.workspaceId &&
        tx.transactionType === 'USAGE'
    );
    if (!usage) return null;

    const lot = this.lots.find(
      (candidate) =>
        candidate.workspaceId === input.workspaceId && candidate.id === usage.lotId
    );
    if (!lot) return null;
    const transactionConflict = this.transactions.find(
      (transaction) =>
        transaction.workspaceId === input.workspaceId &&
        transaction.id === input.refundTransactionId
    );
    if (transactionConflict) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        `Grant transaction ${input.refundTransactionId} already exists.`
      );
    }
    const tx: GrantLotTransaction = {
      id: input.refundTransactionId,
      workspaceId: input.workspaceId,
      resource: usage.resource,
      transactionType: 'REFUND',
      amount: usage.amount,
      lotId: usage.lotId,
      relatedTransactionId: usage.id,
      operationId: input.refundTransactionId,
      actorId: input.actorId,
      correlationId: input.correlationId,
      createdAt: input.createdAt,
    };
    this.transactions.push(tx);
    this.rebuildWorkspaceRemaining(input.workspaceId);
    this.expireLots({
      workspaceId: input.workspaceId,
      now: input.createdAt,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });
    return structuredClone(tx);
  }

  refundUsageOperation(input: {
    workspaceId: string;
    usageOperationId: string;
    refundOperationId: string;
    actorId: string;
    correlationId: string;
    createdAt: string;
  }): GrantLotTransaction[] {
    const usages = this.transactions.filter(
      (transaction) =>
        transaction.workspaceId === input.workspaceId &&
        transaction.transactionType === 'USAGE' &&
        transaction.operationId === input.usageOperationId
    );
    const refunds: GrantLotTransaction[] = [];
    for (const [index, usage] of usages.entries()) {
      const refund = this.refundUsage({
        workspaceId: input.workspaceId,
        usageTransactionId: usage.id,
        refundTransactionId: `${input.refundOperationId}:${index}`,
        actorId: input.actorId,
        correlationId: input.correlationId,
        createdAt: input.createdAt,
      });
      if (refund) refunds.push(refund);
    }
    return refunds;
  }

  reconcileEntitlementLots(
    input: GrantLotEntitlementReconciliationInput
  ): GrantLotTransaction[] {
    assertGrantLotEntitlementReconciliationInput(input);
    const selected = input.lotIds
      .map((lotId) =>
        this.lots.find(
          (lot) =>
            lot.workspaceId === input.workspaceId &&
            lot.resource === input.resource &&
            lot.id === lotId
        )
      )
      .filter((lot): lot is GrantLot => Boolean(lot));

    for (const lot of selected) {
      if (
        lot.expirationDate === null ||
        Date.parse(input.expirationDate) < Date.parse(lot.expirationDate)
      ) {
        lot.expirationDate = input.expirationDate;
        lot.revision = (lot.revision ?? 1) + 1;
      }
    }

    const replay = this.transactions.filter(
      (transaction) =>
        transaction.workspaceId === input.workspaceId &&
        transaction.transactionType === 'EXPIRE' &&
        transaction.operationId === input.operationId
    );
    if (replay.length > 0) {
      this.rebuildWorkspaceRemaining(input.workspaceId);
      return structuredClone(replay);
    }

    const currentEntitlement = selected.reduce(
      (total, lot) =>
        total + (lot.entitlementAmount ?? lot.originalAmount),
      0
    );
    const effectiveTarget =
      Date.parse(input.expirationDate) <= Date.parse(input.asOf)
        ? 0
        : input.targetAmount;
    let amountToReduce = Math.max(
      0,
      currentEntitlement - effectiveTarget
    );
    const written: GrantLotTransaction[] = [];
    const newestFirst = [...selected].sort((left, right) => {
      const created = Date.parse(right.createdAt) - Date.parse(left.createdAt);
      return created !== 0 ? created : right.id.localeCompare(left.id);
    });
    for (const lot of newestFirst) {
      if (amountToReduce === 0) break;
      const currentCap = lot.entitlementAmount ?? lot.originalAmount;
      const capReduction = Math.min(amountToReduce, currentCap);
      const amount = Math.min(lot.remainingAmount, capReduction);
      lot.entitlementAmount = currentCap - capReduction;
      lot.revision = (lot.revision ?? 1) + 1;
      amountToReduce -= capReduction;
      if (amount === 0) continue;
      lot.remainingAmount -= amount;
      const transaction: GrantLotTransaction = {
        id: `${input.operationId}:${written.length}`,
        workspaceId: input.workspaceId,
        resource: input.resource,
        transactionType: 'EXPIRE',
        amount,
        lotId: lot.id,
        operationId: input.operationId,
        actorId: input.actorId,
        correlationId: input.correlationId,
        createdAt: input.asOf,
      };
      this.transactions.push(transaction);
      written.push(structuredClone(transaction));
    }
    this.rebuildWorkspaceRemaining(input.workspaceId);
    return written;
  }

  expireLots(input: {
    workspaceId: string;
    now: string;
    actorId: string;
    correlationId: string;
  }): GrantLotTransaction[] {
    assertIsoTimestamp(input.now, 'now');
    const expired: GrantLotTransaction[] = [];
    const lots = this.lots
      .filter(
        (lot) =>
          lot.workspaceId === input.workspaceId &&
          lot.expirationDate !== null &&
          Date.parse(lot.expirationDate) <= Date.parse(input.now) &&
          (lot.entitlementAmount ?? lot.originalAmount) > 0
      )
      .sort(compareGrantLotsForFifo);
    for (const lot of lots) {
      const amount = lot.remainingAmount;
      lot.remainingAmount = 0;
      lot.entitlementAmount = 0;
      lot.revision = (lot.revision ?? 1) + 1;
      if (amount === 0) continue;
      const transaction: GrantLotTransaction = {
        id: `tx-expire-${lot.id}-${lot.revision}`,
        workspaceId: input.workspaceId,
        resource: lot.resource,
        transactionType: 'EXPIRE',
        amount,
        lotId: lot.id,
        operationId: `expire:${lot.id}:${lot.revision}`,
        actorId: input.actorId,
        correlationId: input.correlationId,
        createdAt: input.now,
      };
      this.transactions.push(transaction);
      expired.push(structuredClone(transaction));
    }
    return expired;
  }

  rebuildProjection(input: {
    workspaceId: string;
    asOf: string;
    actorId: string;
    correlationId: string;
  }): GrantLotProjection[] {
    assertIsoTimestamp(input.asOf, 'asOf');
    this.rebuildWorkspaceRemaining(input.workspaceId);
    this.expireLots({
      workspaceId: input.workspaceId,
      now: input.asOf,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });

    const resources = new Set(
      this.lots
        .filter((lot) => lot.workspaceId === input.workspaceId)
        .map((lot) => lot.resource)
    );
    return [...resources].sort().map((resource) => {
      const transactions = this.transactions.filter(
        (transaction) =>
          transaction.workspaceId === input.workspaceId &&
          transaction.resource === resource
      );
      const amountFor = (...types: GrantLotTransactionType[]) =>
        transactions
          .filter((transaction) => types.includes(transaction.transactionType))
          .reduce((total, transaction) => total + transaction.amount, 0);
      return {
        resource,
        grantedAmount: amountFor(
          'REGISTER_GIFT',
          'SUBSCRIPTION_RENEWAL',
          'PURCHASE_PACKAGE',
          'REDEMPTION_CODE'
        ),
        usedAmount: amountFor('USAGE'),
        refundedAmount: amountFor('REFUND'),
        expiredAmount: amountFor('EXPIRE'),
        remainingAmount: this.lots
          .filter(
            (lot) =>
              lot.workspaceId === input.workspaceId && lot.resource === resource
          )
          .reduce((total, lot) => total + lot.remainingAmount, 0),
      };
    });
  }

  /** Memory-only unit of work used by redemption tests and local fixtures. */
  async runAtomically<T>(work: () => Promise<T> | T): Promise<T> {
    let release!: () => void;
    const previous = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const lots = structuredClone(this.lots);
    const transactions = structuredClone(this.transactions);
    const migrations = new Set(this.legacyBalanceMigrations);
    try {
      return await work();
    } catch (error) {
      this.lots.splice(0, this.lots.length, ...lots);
      this.transactions.splice(0, this.transactions.length, ...transactions);
      this.legacyBalanceMigrations.clear();
      for (const migration of migrations) {
        this.legacyBalanceMigrations.add(migration);
      }
      throw error;
    } finally {
      release();
    }
  }

  withResourceLocks<T>(
    _workspaceId: string,
    _resources: readonly GrantLotResource[],
    work: () => Promise<T>
  ): Promise<T> {
    return this.runAtomically(work);
  }

  private rebuildWorkspaceRemaining(workspaceId: string) {
    const lots = this.lots.filter((lot) => lot.workspaceId === workspaceId);
    const transactions = this.transactions.filter(
      (transaction) => transaction.workspaceId === workspaceId
    );
    for (const cohort of groupGrantLotCohorts(lots)) {
      const netUsage = transactions
        .filter((transaction) =>
          cohort.some((lot) => lot.id === transaction.lotId)
        )
        .reduce((total, transaction) => {
          if (transaction.transactionType === 'USAGE') {
            return total + transaction.amount;
          }
          if (transaction.transactionType === 'REFUND') {
            return total - transaction.amount;
          }
          return total;
        }, 0);
      let usageDebt = Math.max(0, netUsage);
      for (const lot of [...cohort].sort(compareGrantLotsForFifo)) {
        const entitlement = lot.entitlementAmount ?? lot.originalAmount;
        const repaired = Math.max(0, entitlement - usageDebt);
        usageDebt = Math.max(0, usageDebt - entitlement);
        if (lot.remainingAmount !== repaired) {
          lot.remainingAmount = repaired;
          lot.revision = (lot.revision ?? 1) + 1;
        }
      }
    }
  }
}

export function assertGrantLotEntitlementReconciliationInput(
  input: GrantLotEntitlementReconciliationInput
) {
  if (!Number.isInteger(input.targetAmount) || input.targetAmount < 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Entitlement target amount must be a non-negative integer.'
    );
  }
  assertIsoTimestamp(input.expirationDate, 'expirationDate');
  assertIsoTimestamp(input.asOf, 'asOf');
  if (!input.operationId.trim()) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Entitlement reconciliation operation is required.'
    );
  }
}

function groupGrantLotCohorts(lots: readonly GrantLot[]) {
  const groups = new Map<string, GrantLot[]>();
  for (const lot of lots) {
    const isPeriodGrant =
      lot.transactionType === 'REGISTER_GIFT' ||
      lot.transactionType === 'SUBSCRIPTION_RENEWAL';
    const key =
      isPeriodGrant && lot.expirationDate !== null
        ? `period:${lot.resource}:${Date.parse(lot.expirationDate)}`
        : `lot:${lot.id}`;
    const group = groups.get(key) ?? [];
    group.push(lot);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function expirationIsSameOrShorter(
  current: string | null,
  original: string | null
) {
  if (current === original) return true;
  if (current === null || original === null) return original === null;
  return Date.parse(current) <= Date.parse(original);
}
