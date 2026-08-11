import {
  assistedReceiptSchema,
  consumeOneShotHandoffLink,
  type AssistedReceipt,
  type ConsumeHandoffLinkResult,
} from './assisted-receipt.js';

export type StoredAssistedReceipt = {
  receipt: AssistedReceipt;
  revision: number;
};

export class AssistedReceiptConflictError extends Error {
  readonly code = 'REVISION_CONFLICT';
  readonly status = 409;

  constructor(
    readonly receiptId: string,
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(
      `Assisted receipt ${receiptId} revision conflict: expected ${expectedRevision}, actual ${actualRevision}.`,
    );
    this.name = 'AssistedReceiptConflictError';
  }
}

export interface AssistedReceiptRepository {
  create(receipt: AssistedReceipt): Promise<StoredAssistedReceipt>;
  get(
    workspaceId: string,
    receiptId: string,
  ): Promise<StoredAssistedReceipt | null>;
  list(workspaceId: string): Promise<StoredAssistedReceipt[]>;
  save(
    receipt: AssistedReceipt,
    expectedRevision: number,
  ): Promise<StoredAssistedReceipt>;
  consumeHandoffLink(input: {
    workspaceId: string;
    token: string;
    now: string;
  }): Promise<ConsumeHandoffLinkResult>;
}

export class MemoryAssistedReceiptRepository
  implements AssistedReceiptRepository
{
  private readonly records = new Map<string, StoredAssistedReceipt>();

  private key(workspaceId: string, receiptId: string) {
    return `${workspaceId}:${receiptId}`;
  }

  async create(receipt: AssistedReceipt): Promise<StoredAssistedReceipt> {
    const parsed = assistedReceiptSchema.parse(receipt);
    const key = this.key(parsed.workspaceId, parsed.id);
    const existing = this.records.get(key);
    if (existing) {
      if (JSON.stringify(existing.receipt) === JSON.stringify(parsed)) {
        return structuredClone(existing);
      }
      throw new AssistedReceiptConflictError(parsed.id, 0, existing.revision);
    }
    const stored = { receipt: parsed, revision: 0 };
    this.records.set(key, structuredClone(stored));
    return structuredClone(stored);
  }

  async get(
    workspaceId: string,
    receiptId: string,
  ): Promise<StoredAssistedReceipt | null> {
    const stored = this.records.get(this.key(workspaceId, receiptId));
    return stored ? structuredClone(stored) : null;
  }

  async list(workspaceId: string): Promise<StoredAssistedReceipt[]> {
    return [...this.records.values()]
      .filter((stored) => stored.receipt.workspaceId === workspaceId)
      .sort((left, right) => left.receipt.id.localeCompare(right.receipt.id))
      .map((stored) => structuredClone(stored));
  }

  async save(
    receipt: AssistedReceipt,
    expectedRevision: number,
  ): Promise<StoredAssistedReceipt> {
    const parsed = assistedReceiptSchema.parse(receipt);
    const key = this.key(parsed.workspaceId, parsed.id);
    const current = this.records.get(key);
    if (!current || current.revision !== expectedRevision) {
      throw new AssistedReceiptConflictError(
        parsed.id,
        expectedRevision,
        current?.revision ?? -1,
      );
    }
    const stored = { receipt: parsed, revision: expectedRevision + 1 };
    this.records.set(key, structuredClone(stored));
    return structuredClone(stored);
  }

  async consumeHandoffLink(input: {
    workspaceId: string;
    token: string;
    now: string;
  }): Promise<ConsumeHandoffLinkResult> {
    const stored = [...this.records.values()].find(
      (candidate) =>
        candidate.receipt.workspaceId === input.workspaceId &&
        candidate.receipt.handoffLink?.token === input.token,
    );
    if (!stored) return { kind: 'not_found' };
    const outcome = consumeOneShotHandoffLink(stored.receipt, input);
    if (outcome.kind !== 'ok') return structuredClone(outcome);
    await this.save(outcome.receipt, stored.revision);
    return structuredClone(outcome);
  }
}
