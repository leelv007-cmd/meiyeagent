/**
 * Td-3: redemption code domain (workspace-scoped bar-count grants).
 *
 * Deliberately does NOT copy mkfast-app bugs:
 * - multi-step without a single atomic transaction
 * - dangling pre-generated creditTransactionId
 * - FIFO by createdAt instead of expirationDate
 *
 * Memory store is first; PG can implement the same RedemptionStore port.
 * Redeem is atomic: void/expire check + mark redeemed + grant lot in one
 * store transaction callback.
 */

import { createHash } from 'node:crypto';
import type {
  CreditGrantLot,
  GrantCreditsInput,
} from '../credit-billing/credit-ledger.js';
import {
  MemoryGrantLotLedger,
  type GrantLotResource,
  type GrantLotTransaction,
} from './grant-lot.js';
import { P1DomainError, USAGE_RESOURCES } from './domain.js';

export type RedemptionCodeStatus =
  | 'active'
  | 'redeemed'
  | 'voided'
  | 'expired';

export interface RedemptionCode {
  id: string;
  /** Public code string (unique). */
  code: string;
  status: RedemptionCodeStatus;
  /** Allowance per resource granted on redeem. */
  grants: Partial<Record<GrantLotResource, number>>;
  /** Authoritative credit amount granted in credit-billing mode. */
  credits?: number;
  /** Optional expiry (ISO). null = never. */
  expiresAt: string | null;
  /** CAS revision for admin void/update. */
  revision: number;
  createdAt: string;
  createdBy: string;
  voidedAt?: string;
  redeemedAt?: string;
  redeemedWorkspaceId?: string;
  redeemedByUserId?: string;
  /** Real grant-lot transaction id written on redeem (never pre-generated). */
  grantTransactionId?: string;
  /** Real credit-ledger transaction id written in credit-billing mode. */
  creditGrantTransactionId?: string;
  batchId?: string;
}

export interface CreateRedemptionCodeInput {
  code: string;
  grants: Partial<Record<GrantLotResource, number>>;
  credits?: number;
  expiresAt?: string | null;
  batchId?: string;
  createdBy: string;
  createdAt?: string;
}

export interface RedeemResult {
  code: RedemptionCode;
  grantTransactions: GrantLotTransaction[];
  creditGrant?: CreditGrantLot;
}

export interface CreditRedemptionGrantPort {
  grant(input: GrantCreditsInput): Promise<CreditGrantLot> | CreditGrantLot;
}

export interface RedemptionCommandIdentity {
  scope: string;
  idempotencyKey: string;
}

export interface RedemptionStoreCommand extends RedemptionCommandIdentity {
  payloadHash: string;
}

export interface RedemptionStore {
  /** Selects the explicit unit-of-work contract used for grant writes. */
  readonly grantStrategy: 'application_callback' | 'store_transaction';
  /**
   * Atomic redeem: load code → validate → mark redeemed → return grants.
   * Implementations must hold a row lock / transaction for the code.
   */
  redeemAtomic(input: {
    code: string;
    workspaceId: string;
    userId: string;
    correlationId: string;
    now: string;
    /** Required only when grantStrategy is application_callback. */
    grant?: (code: RedemptionCode) => Promise<{
      grantTransactionId: string;
      grantTransactions: GrantLotTransaction[];
      creditGrant?: CreditGrantLot;
    }>;
  }): Promise<RedeemResult>;

  create(
    codes: RedemptionCode[],
    command?: RedemptionStoreCommand
  ): Promise<RedemptionCode[]>;
  expireDue(now: string): Promise<void>;
  getByCode(code: string): Promise<RedemptionCode | null>;
  list(filter?: { batchId?: string; status?: RedemptionCodeStatus }): Promise<
    RedemptionCode[]
  >;
  voidCode(input: {
    code: string;
    expectedRevision: number;
    voidedAt: string;
    command?: RedemptionStoreCommand;
  }): Promise<RedemptionCode>;
}

function normalizeCode(code: string) {
  if (typeof code !== 'string') {
    throw new P1DomainError('INVALID_STATE', 'Redemption code is required.');
  }
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{4,64}$/.test(normalized)) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Redemption code must be 4-64 letters, numbers, hyphens, or underscores.'
    );
  }
  return normalized;
}

function assertGrants(grants: Partial<Record<GrantLotResource, number>>) {
  const entries = Object.entries(grants) as Array<[GrantLotResource, number]>;
  if (entries.length === 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Redemption grants require at least one resource amount.'
    );
  }
  for (const [resource, amount] of entries) {
    if (!USAGE_RESOURCES.includes(resource)) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Unknown redemption grant resource ${resource}.`
      );
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Grant amount for ${resource} must be a positive integer.`
      );
    }
  }
}

function assertCredits(credits: number | undefined) {
  if (!Number.isSafeInteger(credits) || (credits ?? 0) <= 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Redemption credits must be a positive integer.'
    );
  }
}

export class MemoryRedemptionStore implements RedemptionStore {
  readonly grantStrategy = 'application_callback' as const;

  private readonly byCode = new Map<string, RedemptionCode>();
  private readonly commandResults = new Map<
    string,
    { payloadHash: string; result: unknown }
  >();
  private transactionTail: Promise<void> = Promise.resolve();

  async create(codes: RedemptionCode[], command?: RedemptionStoreCommand) {
    return this.withLock(() =>
      this.executeCommand(command, () => this.createUnlocked(codes))
    );
  }

  private async createUnlocked(codes: RedemptionCode[]) {
    const keys = codes.map((code) => normalizeCode(code.code));
    if (new Set(keys).size !== keys.length) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Redemption batch contains duplicate codes.'
      );
    }
    for (const key of keys) {
      if (this.byCode.has(key)) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          `Redemption code ${key} already exists.`
        );
      }
    }
    const created: RedemptionCode[] = [];
    for (const code of codes) {
      const key = normalizeCode(code.code);
      const stored = structuredClone(code);
      this.byCode.set(key, stored);
      created.push(structuredClone(stored));
    }
    return created;
  }

  async expireDue(now: string) {
    assertTimestamp(now, 'now');
    for (const code of this.byCode.values()) {
      if (
        code.status === 'active' &&
        code.expiresAt !== null &&
        Date.parse(code.expiresAt) <= Date.parse(now)
      ) {
        code.status = 'expired';
        code.revision += 1;
      }
    }
  }

  async getByCode(code: string) {
    const found = this.byCode.get(normalizeCode(code));
    return found ? structuredClone(found) : null;
  }

  async list(filter?: { batchId?: string; status?: RedemptionCodeStatus }) {
    return [...this.byCode.values()]
      .filter((code) => {
        if (filter?.batchId && code.batchId !== filter.batchId) return false;
        if (filter?.status && code.status !== filter.status) return false;
        return true;
      })
      .map((code) => structuredClone(code));
  }

  async voidCode(input: {
    code: string;
    expectedRevision: number;
    voidedAt: string;
    command?: RedemptionStoreCommand;
  }) {
    return this.withLock(() =>
      this.executeCommand(input.command, () => this.voidCodeUnlocked(input))
    );
  }

  private voidCodeUnlocked(input: {
    code: string;
    expectedRevision: number;
    voidedAt: string;
  }) {
    const key = normalizeCode(input.code);
    const current = this.byCode.get(key);
    if (!current) {
      throw new P1DomainError('NOT_FOUND', 'Redemption code was not found.');
    }
    if (current.revision !== input.expectedRevision) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Redemption code revision conflict.'
      );
    }
    if (current.status === 'redeemed') {
      throw new P1DomainError(
        'INVALID_STATE',
        'A redeemed code cannot be voided.'
      );
    }
    if (current.status === 'voided') {
      return structuredClone(current);
    }
    current.status = 'voided';
    current.voidedAt = input.voidedAt;
    current.revision += 1;
    return structuredClone(current);
  }

  async redeemAtomic(input: {
    code: string;
    workspaceId: string;
    userId: string;
    correlationId: string;
    now: string;
    grant?: (code: RedemptionCode) => Promise<{
      grantTransactionId: string;
      grantTransactions: GrantLotTransaction[];
      creditGrant?: CreditGrantLot;
    }>;
  }): Promise<RedeemResult> {
    return this.withLock(() => this.redeemUnlocked(input));
  }

  private async redeemUnlocked(input: {
    code: string;
    workspaceId: string;
    userId: string;
    correlationId: string;
    now: string;
    grant?: (code: RedemptionCode) => Promise<{
      grantTransactionId: string;
      grantTransactions: GrantLotTransaction[];
      creditGrant?: CreditGrantLot;
    }>;
  }): Promise<RedeemResult> {
    const key = normalizeCode(input.code);
    const current = this.byCode.get(key);
    if (!current) {
      throw new P1DomainError('NOT_FOUND', 'Redemption code was not found.');
    }

    // Idempotent re-redeem by same workspace returns prior result shape.
    if (current.status === 'redeemed') {
      if (current.redeemedWorkspaceId !== input.workspaceId) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Redemption code was already redeemed.'
        );
      }
      if (!input.grant) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Memory redemption requires an application grant callback.'
        );
      }
      const granted = await input.grant(structuredClone(current));
      const persistedTransactionId = granted.creditGrant
        ? current.creditGrantTransactionId
        : current.grantTransactionId;
      if (granted.grantTransactionId !== persistedTransactionId) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Redeemed code grant transaction does not match persisted state.'
        );
      }
      return {
        code: structuredClone(current),
        grantTransactions: granted.grantTransactions,
        ...(granted.creditGrant
          ? { creditGrant: structuredClone(granted.creditGrant) }
          : {}),
      };
    }
    if (current.status === 'voided') {
      throw new P1DomainError('INVALID_STATE', 'Redemption code is voided.');
    }
    if (
      current.expiresAt &&
      Date.parse(current.expiresAt) <= Date.parse(input.now)
    ) {
      current.status = 'expired';
      current.revision += 1;
      throw new P1DomainError('INVALID_STATE', 'Redemption code is expired.');
    }
    if (current.status !== 'active') {
      throw new P1DomainError(
        'INVALID_STATE',
        `Redemption code is ${current.status}.`
      );
    }
    if (!input.grant) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Memory redemption requires an application grant callback.'
      );
    }

    // Reserve as redeemed before grant so concurrent redeem fails closed.
    const before = structuredClone(current);
    current.status = 'redeemed';
    current.redeemedAt = input.now;
    current.redeemedWorkspaceId = input.workspaceId;
    current.redeemedByUserId = input.userId;
    current.revision += 1;

    try {
      const granted = await input.grant(structuredClone(current));
      if (granted.creditGrant) {
        current.creditGrantTransactionId = granted.grantTransactionId;
      } else {
        current.grantTransactionId = granted.grantTransactionId;
      }
      return {
        code: structuredClone(current),
        grantTransactions: granted.grantTransactions,
        ...(granted.creditGrant
          ? { creditGrant: structuredClone(granted.creditGrant) }
          : {}),
      };
    } catch (error) {
      // Roll back reservation on grant failure (memory atomicity).
      this.byCode.set(key, before);
      throw error;
    }
  }

  private async withLock<T>(work: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }

  private async executeCommand<T>(
    command: RedemptionStoreCommand | undefined,
    execute: () => Promise<T> | T
  ): Promise<T> {
    if (!command) return execute();
    const key = JSON.stringify([command.scope, command.idempotencyKey]);
    const existing = this.commandResults.get(key);
    if (existing) {
      if (existing.payloadHash !== command.payloadHash) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'Redemption command key was reused with a different payload.'
        );
      }
      return structuredClone(existing.result) as T;
    }
    const result = await execute();
    this.commandResults.set(key, {
      payloadHash: command.payloadHash,
      result: structuredClone(result),
    });
    return result;
  }
}

export class RedemptionApplicationService {
  constructor(
    private readonly store: RedemptionStore,
    private readonly grantLots?: MemoryGrantLotLedger,
    private readonly clock: () => Date = () => new Date(),
    private readonly creditLedger?: CreditRedemptionGrantPort
  ) {}

  async createCodes(
    input: CreateRedemptionCodeInput,
    command?: RedemptionCommandIdentity
  ): Promise<RedemptionCode[]> {
    if (this.creditLedger) {
      assertCredits(input.credits);
      if (Object.keys(input.grants).length > 0) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Credit redemption codes cannot grant legacy resource buckets.'
        );
      }
    } else {
      assertGrants(input.grants);
      if (input.credits !== undefined) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Legacy redemption codes cannot grant credits.'
        );
      }
    }
    const code = normalizeCode(input.code);
    const now = input.createdAt ?? this.clock().toISOString();
    assertTimestamp(now, 'createdAt');
    if (input.expiresAt !== undefined && input.expiresAt !== null) {
      assertTimestamp(input.expiresAt, 'expiresAt');
      if (Date.parse(input.expiresAt) <= Date.parse(now)) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Redemption expiration must be after its creation time.'
        );
      }
    }
    const recorded: RedemptionCode = {
      id: `rc-${digest(`${code}:${now}`).slice(0, 20)}`,
      code,
      status: 'active',
      grants: { ...input.grants },
      ...(input.credits !== undefined ? { credits: input.credits } : {}),
      expiresAt: input.expiresAt ?? null,
      revision: 1,
      createdAt: now,
      createdBy: input.createdBy,
      ...(input.batchId ? { batchId: input.batchId } : {}),
    };
    return this.store.create(
      [recorded],
      command
        ? {
            ...command,
            payloadHash: digest(
              JSON.stringify({
                action: 'create',
                batchId: input.batchId ?? null,
                code,
                createdAt: input.createdAt ?? null,
                createdBy: input.createdBy,
                expiresAt: input.expiresAt ?? null,
                grants: Object.fromEntries(
                  Object.entries(input.grants).sort(([left], [right]) =>
                    left.localeCompare(right)
                  )
                ),
                credits: input.credits ?? null,
              })
            ),
          }
        : undefined
    );
  }

  async voidCode(
    input: {
      code: string;
      expectedRevision: number;
    },
    command?: RedemptionCommandIdentity
  ): Promise<RedemptionCode> {
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
      throw new P1DomainError(
        'INVALID_STATE',
        'expectedRevision must be a positive integer.'
      );
    }
    return this.store.voidCode({
      code: input.code,
      expectedRevision: input.expectedRevision,
      voidedAt: this.clock().toISOString(),
      ...(command
        ? {
            command: {
              ...command,
              payloadHash: digest(
                JSON.stringify({
                  action: 'void',
                  code: normalizeCode(input.code),
                  expectedRevision: input.expectedRevision,
                })
              ),
            },
          }
        : {}),
    });
  }

  async list(filter?: {
    batchId?: string;
    status?: RedemptionCodeStatus;
  }): Promise<RedemptionCode[]> {
    await this.store.expireDue(this.clock().toISOString());
    return this.store.list(filter);
  }

  async redeem(input: {
    code: string;
    workspaceId: string;
    userId: string;
    correlationId: string;
  }): Promise<RedeemResult> {
    const now = this.clock().toISOString();
    const commonInput = {
      code: input.code,
      workspaceId: input.workspaceId,
      userId: input.userId,
      correlationId: input.correlationId,
      now,
    };
    if (this.store.grantStrategy === 'store_transaction') {
      return this.store.redeemAtomic(commonInput);
    }
    if (this.creditLedger) {
      return this.store.redeemAtomic({
        ...commonInput,
        grant: async (code) => {
          assertCredits(code.credits);
          const lotId = creditRedemptionLotId(code.id, input.workspaceId);
          const creditGrant = await this.creditLedger!.grant({
            id: lotId,
            workspaceId: input.workspaceId,
            credits: code.credits!,
            expirationDate: null,
            transactionType: 'REDEMPTION_CODE',
            sourceRef: code.id,
            grantIdempotencyKey: `grant:redemption:${code.id}:${input.workspaceId}`,
            actorId: input.userId,
            correlationId: input.correlationId,
            createdAt: code.redeemedAt ?? now,
          });
          return {
            grantTransactionId: `credit-grant:${creditGrant.id}`,
            grantTransactions: [],
            creditGrant,
          };
        },
      });
    }
    if (!this.grantLots) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Redemption requires an atomic grant-lot ledger.'
      );
    }
    return this.grantLots.runAtomically(() =>
      this.store.redeemAtomic({
        ...commonInput,
        grant: async (code) => {
          const grantTransactions: GrantLotTransaction[] = [];
          let primaryTxId = '';
          for (const [resource, amount] of Object.entries(code.grants) as Array<
            [GrantLotResource, number]
          >) {
            if (!amount) continue;
            const lotId = `lot-redeem-${digest(
              `${code.id}:${input.workspaceId}:${resource}`
            ).slice(0, 24)}`;
            this.grantLots!.grant({
              id: lotId,
              workspaceId: input.workspaceId,
              resource,
              amount,
              expirationDate: null,
              transactionType: 'REDEMPTION_CODE',
              sourceRef: code.id,
              actorId: input.userId,
              correlationId: input.correlationId,
              createdAt: code.redeemedAt ?? now,
            });
            const transactions = this.grantLots!
              .listTransactions(input.workspaceId)
              .filter(
                (transaction) =>
                  transaction.lotId === lotId &&
                  transaction.transactionType === 'REDEMPTION_CODE'
              );
            grantTransactions.push(...transactions);
            if (!primaryTxId && transactions[0]) {
              primaryTxId = transactions[0].id;
            }
          }
          if (!primaryTxId) {
            throw new P1DomainError(
              'INVALID_STATE',
              'Redemption grant produced no transactions.'
            );
          }
          return {
            grantTransactionId: primaryTxId,
            grantTransactions,
          };
        },
      })
    );
  }
}

export function creditRedemptionLotId(codeId: string, workspaceId: string) {
  return `credit-redeem-${digest(`${codeId}:${workspaceId}`).slice(0, 24)}`;
}

function assertTimestamp(value: string, field: string) {
  if (!value.trim() || !Number.isFinite(Date.parse(value))) {
    throw new P1DomainError('INVALID_STATE', `${field} must be an ISO timestamp.`);
  }
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
