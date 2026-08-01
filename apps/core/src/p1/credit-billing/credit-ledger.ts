import { P1DomainError } from '../foundation/domain.js';

export const CREDIT_GRANT_IDEMPOTENCY_PREFIX = 'grant:' as const;
export const CREDIT_CONSUME_IDEMPOTENCY_PREFIX = 'consume:' as const;

export const CREDIT_GRANT_TRANSACTION_TYPES = [
  'REGISTER_GIFT',
  'SUBSCRIPTION_RENEWAL',
  'PURCHASE_PACKAGE',
  'REDEMPTION_CODE',
] as const;

export type CreditGrantTransactionType =
  (typeof CREDIT_GRANT_TRANSACTION_TYPES)[number];

export type CreditTransactionType =
  | CreditGrantTransactionType
  | 'USAGE'
  | 'REFUND'
  | 'EXPIRE';

export interface CreditGrantLot {
  id: string;
  workspaceId: string;
  originalCredits: number;
  remainingCredits: number;
  expirationDate: string | null;
  transactionType: CreditGrantTransactionType;
  sourceRef?: string;
  grantIdempotencyKey: string;
  revision: number;
  createdAt: string;
}

export interface CreditLotTransaction {
  id: string;
  workspaceId: string;
  transactionType: CreditTransactionType;
  credits: number;
  lotId: string;
  relatedTransactionId?: string;
  operationId: string;
  actorId: string;
  correlationId: string;
  createdAt: string;
  /** A refund against an expired source lot is visible but does not restore balance. */
  credited: boolean;
}

export interface CreditBalanceProjection {
  grantedCredits: number;
  usedCredits: number;
  refundedCredits: number;
  expiredCredits: number;
  availableCredits: number;
}

export type GrantCreditsInput = Omit<
  CreditGrantLot,
  'originalCredits' | 'remainingCredits' | 'grantIdempotencyKey' | 'revision'
> & {
  credits: number;
  actorId?: string;
  correlationId?: string;
  grantIdempotencyKey?: string;
};

export interface ConsumeCreditsInput {
  workspaceId: string;
  credits: number;
  transactionId: string;
  actorId: string;
  correlationId: string;
  createdAt: string;
}

export function compareCreditLotsForFefo(
  left: CreditGrantLot,
  right: CreditGrantLot,
) {
  if (left.expirationDate === null && right.expirationDate === null) {
    return compareCreatedAtAndId(left, right);
  }
  if (left.expirationDate === null) return 1;
  if (right.expirationDate === null) return -1;
  const byExpiry =
    Date.parse(left.expirationDate) - Date.parse(right.expirationDate);
  return byExpiry === 0 ? compareCreatedAtAndId(left, right) : byExpiry;
}

export function allocateCreditConsumption(
  lots: readonly CreditGrantLot[],
  credits: number,
): Array<{ lotId: string; credits: number }> {
  if (!Number.isSafeInteger(credits) || credits <= 0) return [];
  let remaining = credits;
  const allocations: Array<{ lotId: string; credits: number }> = [];
  for (const lot of [...lots]
    .filter((candidate) => candidate.remainingCredits > 0)
    .sort(compareCreditLotsForFefo)) {
    if (remaining === 0) break;
    const amount = Math.min(lot.remainingCredits, remaining);
    allocations.push({ lotId: lot.id, credits: amount });
    remaining -= amount;
  }
  return allocations;
}

export function normalizeCreditGrantIdempotencyKey(
  lotId: string,
  explicit?: string,
) {
  const value = explicit?.trim() || `${CREDIT_GRANT_IDEMPOTENCY_PREFIX}${lotId}`;
  if (value.startsWith(CREDIT_CONSUME_IDEMPOTENCY_PREFIX)) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Credit grant idempotency key must not use the consume: namespace.',
    );
  }
  return value.startsWith(CREDIT_GRANT_IDEMPOTENCY_PREFIX)
    ? value
    : `${CREDIT_GRANT_IDEMPOTENCY_PREFIX}${value}`;
}

export function normalizeCreditConsumeIdempotencyKey(value: string) {
  if (!value.trim()) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Credit consume idempotency key is required.',
    );
  }
  if (value.startsWith(CREDIT_GRANT_IDEMPOTENCY_PREFIX)) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Credit consume idempotency key must not use the grant: namespace.',
    );
  }
  return value.startsWith(CREDIT_CONSUME_IDEMPOTENCY_PREFIX)
    ? value
    : `${CREDIT_CONSUME_IDEMPOTENCY_PREFIX}${value}`;
}

export function creditUsageOperationId(taskId: string) {
  return normalizeCreditConsumeIdempotencyKey(`task:${taskId}`);
}

function assertCredits(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      `${field} must be a positive integer credit amount.`,
    );
  }
}

function assertTimestamp(value: string, field: string) {
  if (!value.trim() || !Number.isFinite(Date.parse(value))) {
    throw new P1DomainError('INVALID_STATE', `${field} must be an ISO timestamp.`);
  }
}

function assertGrantInput(input: GrantCreditsInput) {
  if (!input.id.trim() || !input.workspaceId.trim()) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Credit grant identity and workspace are required.',
    );
  }
  assertCredits(input.credits, 'credits');
  assertTimestamp(input.createdAt, 'createdAt');
  if (input.expirationDate !== null) {
    assertTimestamp(input.expirationDate, 'expirationDate');
    if (Date.parse(input.expirationDate) <= Date.parse(input.createdAt)) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Credit grant expiration must be after its creation time.',
      );
    }
  }
}

function compareCreatedAtAndId(
  left: Pick<CreditGrantLot, 'createdAt' | 'id'>,
  right: Pick<CreditGrantLot, 'createdAt' | 'id'>,
) {
  const byCreatedAt = Date.parse(left.createdAt) - Date.parse(right.createdAt);
  return byCreatedAt === 0 ? left.id.localeCompare(right.id) : byCreatedAt;
}

/**
 * Deterministic in-memory implementation used by unit tests and recorded mode.
 * PostgresCreditLedger is the production implementation.
 */
export class MemoryCreditLedger {
  private readonly lots: CreditGrantLot[] = [];
  private readonly transactions: CreditLotTransaction[] = [];
  private tail: Promise<void> = Promise.resolve();

  listLots(workspaceId: string) {
    return this.lots
      .filter((lot) => lot.workspaceId === workspaceId)
      .map((lot) => structuredClone(lot));
  }

  listTransactions(workspaceId: string) {
    return this.transactions
      .filter((transaction) => transaction.workspaceId === workspaceId)
      .map((transaction) => structuredClone(transaction));
  }

  grant(input: GrantCreditsInput) {
    assertGrantInput(input);
    const key = normalizeCreditGrantIdempotencyKey(
      input.id,
      input.grantIdempotencyKey,
    );
    const existing = this.lots.find(
      (lot) =>
        lot.workspaceId === input.workspaceId &&
        (lot.id === input.id || lot.grantIdempotencyKey === key),
    );
    if (existing) {
      const identical =
        existing.originalCredits === input.credits &&
        existing.expirationDate === input.expirationDate &&
        existing.transactionType === input.transactionType &&
        existing.sourceRef === input.sourceRef &&
        existing.createdAt === input.createdAt &&
        existing.grantIdempotencyKey === key;
      if (!identical) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          `Credit grant ${input.id} already exists with different facts.`,
        );
      }
      return structuredClone(existing);
    }
    const lot: CreditGrantLot = {
      id: input.id,
      workspaceId: input.workspaceId,
      originalCredits: input.credits,
      remainingCredits: input.credits,
      expirationDate: input.expirationDate,
      transactionType: input.transactionType,
      ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
      grantIdempotencyKey: key,
      revision: 1,
      createdAt: input.createdAt,
    };
    this.lots.push(lot);
    this.transactions.push({
      id: `credit-grant:${lot.id}`,
      workspaceId: lot.workspaceId,
      transactionType: lot.transactionType,
      credits: lot.originalCredits,
      lotId: lot.id,
      operationId: key,
      actorId: input.actorId ?? 'system',
      correlationId: input.correlationId ?? 'credit-grant',
      createdAt: lot.createdAt,
      credited: true,
    });
    return structuredClone(lot);
  }

  consume(input: ConsumeCreditsInput) {
    assertCredits(input.credits, 'credits');
    assertTimestamp(input.createdAt, 'createdAt');
    const operationId = normalizeCreditConsumeIdempotencyKey(input.transactionId);
    const replay = this.transactions.filter(
      (transaction) =>
        transaction.workspaceId === input.workspaceId &&
        transaction.transactionType === 'USAGE' &&
        transaction.operationId === operationId,
    );
    if (replay.length > 0) {
      const total = replay.reduce((sum, transaction) => sum + transaction.credits, 0);
      if (total !== input.credits) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'Credit usage operation was replayed with different facts.',
        );
      }
      return structuredClone(replay);
    }
    this.expireLots({
      workspaceId: input.workspaceId,
      now: input.createdAt,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });
    const allocations = allocateCreditConsumption(
      this.lots.filter(
        (lot) =>
          lot.workspaceId === input.workspaceId &&
          (lot.expirationDate === null ||
            Date.parse(lot.expirationDate) > Date.parse(input.createdAt)),
      ),
      input.credits,
    );
    if (
      allocations.reduce((sum, allocation) => sum + allocation.credits, 0) !==
      input.credits
    ) {
      throw new P1DomainError(
        'INSUFFICIENT_ENTITLEMENT',
        'Insufficient credits.',
      );
    }
    return allocations.map((allocation, index) => {
      const lot = this.lots.find(
        (candidate) =>
          candidate.workspaceId === input.workspaceId && candidate.id === allocation.lotId,
      );
      if (!lot) throw new Error('Credit lot allocation disappeared.');
      lot.remainingCredits -= allocation.credits;
      lot.revision += 1;
      const transaction: CreditLotTransaction = {
        id: `${operationId}:${index}`,
        workspaceId: input.workspaceId,
        transactionType: 'USAGE',
        credits: allocation.credits,
        lotId: lot.id,
        operationId,
        actorId: input.actorId,
        correlationId: input.correlationId,
        createdAt: input.createdAt,
        credited: false,
      };
      this.transactions.push(transaction);
      return structuredClone(transaction);
    });
  }

  refundUsageOperation(input: {
    workspaceId: string;
    usageOperationId: string;
    refundOperationId: string;
    credits?: number;
    actorId: string;
    correlationId: string;
    createdAt: string;
  }) {
    assertTimestamp(input.createdAt, 'createdAt');
    if (input.credits !== undefined) assertCredits(input.credits, 'credits');
    const usageOperationId = normalizeCreditConsumeIdempotencyKey(input.usageOperationId);
    const usages = this.transactions.filter(
      (transaction) =>
        transaction.workspaceId === input.workspaceId &&
        transaction.transactionType === 'USAGE' &&
        transaction.operationId === usageOperationId,
    );
    let remaining = input.credits;
    const refunds: CreditLotTransaction[] = [];
    for (const [index, usage] of usages.entries()) {
      if (remaining === 0) break;
      const existing = this.transactions.find(
        (transaction) =>
          transaction.workspaceId === input.workspaceId &&
          transaction.transactionType === 'REFUND' &&
          transaction.relatedTransactionId === usage.id,
      );
      if (existing) {
        refunds.push(structuredClone(existing));
        if (remaining !== undefined) remaining -= existing.credits;
        continue;
      }
      const credits = remaining === undefined ? usage.credits : Math.min(usage.credits, remaining);
      const lot = this.lots.find(
        (candidate) =>
          candidate.workspaceId === input.workspaceId && candidate.id === usage.lotId,
      );
      if (!lot) throw new Error('Credit lot for usage transaction is missing.');
      const active =
        lot.expirationDate === null ||
        Date.parse(lot.expirationDate) > Date.parse(input.createdAt);
      if (active) {
        lot.remainingCredits = Math.min(
          lot.originalCredits,
          lot.remainingCredits + credits,
        );
        lot.revision += 1;
      }
      const transaction: CreditLotTransaction = {
        id: `${input.refundOperationId}:${index}`,
        workspaceId: input.workspaceId,
        transactionType: 'REFUND',
        credits,
        lotId: lot.id,
        relatedTransactionId: usage.id,
        operationId: input.refundOperationId,
        actorId: input.actorId,
        correlationId: input.correlationId,
        createdAt: input.createdAt,
        credited: active,
      };
      this.transactions.push(transaction);
      refunds.push(structuredClone(transaction));
      if (remaining !== undefined) remaining -= credits;
    }
    if (remaining !== undefined && remaining !== 0) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Credit refund exceeds the original usage operation.',
      );
    }
    return refunds;
  }

  expireLots(input: {
    workspaceId: string;
    now: string;
    actorId: string;
    correlationId: string;
  }) {
    assertTimestamp(input.now, 'now');
    const expired: CreditLotTransaction[] = [];
    for (const lot of this.lots
      .filter(
        (candidate) =>
          candidate.workspaceId === input.workspaceId &&
          candidate.expirationDate !== null &&
          Date.parse(candidate.expirationDate) <= Date.parse(input.now) &&
          candidate.remainingCredits > 0,
      )
      .sort(compareCreditLotsForFefo)) {
      const credits = lot.remainingCredits;
      lot.remainingCredits = 0;
      lot.revision += 1;
      const transaction: CreditLotTransaction = {
        id: `credit-expire:${lot.id}:${lot.revision}`,
        workspaceId: input.workspaceId,
        transactionType: 'EXPIRE',
        credits,
        lotId: lot.id,
        operationId: `expire:${lot.id}:${lot.revision}`,
        actorId: input.actorId,
        correlationId: input.correlationId,
        createdAt: input.now,
        credited: false,
      };
      this.transactions.push(transaction);
      expired.push(structuredClone(transaction));
    }
    return expired;
  }

  expireSubscriptionLots(input: {
    workspaceId: string;
    subscriptionId: string;
    actorId: string;
    correlationId: string;
    createdAt: string;
  }) {
    const expired: CreditLotTransaction[] = [];
    for (const lot of this.lots.filter(
      (candidate) =>
        candidate.workspaceId === input.workspaceId &&
        candidate.transactionType === 'SUBSCRIPTION_RENEWAL' &&
        candidate.sourceRef === input.subscriptionId &&
        candidate.remainingCredits > 0,
    )) {
      const credits = lot.remainingCredits;
      lot.remainingCredits = 0;
      lot.revision += 1;
      const transaction: CreditLotTransaction = {
        id: `credit-expire-subscription:${lot.id}:${lot.revision}`,
        workspaceId: input.workspaceId,
        transactionType: 'EXPIRE',
        credits,
        lotId: lot.id,
        operationId: `expire-subscription:${lot.id}:${lot.revision}`,
        actorId: input.actorId,
        correlationId: input.correlationId,
        createdAt: input.createdAt,
        credited: false,
      };
      this.transactions.push(transaction);
      expired.push(structuredClone(transaction));
    }
    return expired;
  }

  project(workspaceId: string): CreditBalanceProjection {
    const transactions = this.transactions.filter(
      (transaction) => transaction.workspaceId === workspaceId,
    );
    const total = (...types: CreditTransactionType[]) =>
      transactions
        .filter((transaction) => types.includes(transaction.transactionType))
        .reduce((sum, transaction) => sum + transaction.credits, 0);
    return {
      grantedCredits: total(...CREDIT_GRANT_TRANSACTION_TYPES),
      usedCredits: total('USAGE'),
      refundedCredits: transactions
        .filter(
          (transaction) => transaction.transactionType === 'REFUND' && transaction.credited,
        )
        .reduce((sum, transaction) => sum + transaction.credits, 0),
      expiredCredits: total('EXPIRE'),
      availableCredits: this.lots
        .filter((lot) => lot.workspaceId === workspaceId)
        .reduce((sum, lot) => sum + lot.remainingCredits, 0),
    };
  }

  async runAtomically<T>(work: () => T | Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const lots = structuredClone(this.lots);
    const transactions = structuredClone(this.transactions);
    try {
      return await work();
    } catch (error) {
      this.lots.splice(0, this.lots.length, ...lots);
      this.transactions.splice(0, this.transactions.length, ...transactions);
      throw error;
    } finally {
      release();
    }
  }

  withWorkspaceCreditLock<T>(
    _workspaceId: string,
    work: () => T | Promise<T>,
  ) {
    return this.runAtomically(work);
  }
}
