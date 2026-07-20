import type { Pool, PoolClient } from 'pg';

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

type AssistedReceiptRow = {
  payload: unknown;
  revision: string;
};

function storedFromRow(row: AssistedReceiptRow): StoredAssistedReceipt {
  return {
    receipt: assistedReceiptSchema.parse(row.payload),
    revision: Number(row.revision),
  };
}

export class PostgresAssistedReceiptRepository
  implements AssistedReceiptRepository
{
  constructor(private readonly pool: Pool) {}

  async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS p1_assisted_receipts (
        workspace_id text NOT NULL,
        id text NOT NULL,
        payload jsonb NOT NULL,
        revision bigint NOT NULL DEFAULT 0,
        handoff_token text,
        handoff_expires_at timestamptz,
        handoff_consumed_at timestamptz,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id),
        UNIQUE (workspace_id, handoff_token)
      );
      CREATE INDEX IF NOT EXISTS p1_assisted_receipts_workspace_updated_idx
        ON p1_assisted_receipts (workspace_id, updated_at DESC, id);
    `);
  }

  async create(receipt: AssistedReceipt): Promise<StoredAssistedReceipt> {
    const parsed = assistedReceiptSchema.parse(receipt);
    const inserted = await this.pool.query<AssistedReceiptRow>(
      `INSERT INTO p1_assisted_receipts
         (workspace_id, id, payload, revision, handoff_token,
          handoff_expires_at, handoff_consumed_at, updated_at)
       VALUES ($1, $2, $3::jsonb, 0, $4, $5::timestamptz, $6::timestamptz, now())
       ON CONFLICT (workspace_id, id) DO NOTHING
       RETURNING payload, revision::text AS revision`,
      [
        parsed.workspaceId,
        parsed.id,
        JSON.stringify(parsed),
        parsed.handoffLink?.token ?? null,
        parsed.handoffLink?.expiresAt ?? null,
        parsed.handoffLink?.consumedAt ?? null,
      ],
    );
    if (inserted.rowCount === 1) {
      return storedFromRow(inserted.rows[0]!);
    }
    const existing = await this.get(parsed.workspaceId, parsed.id);
    if (existing && JSON.stringify(existing.receipt) === JSON.stringify(parsed)) {
      return existing;
    }
    throw new AssistedReceiptConflictError(
      parsed.id,
      0,
      existing?.revision ?? -1,
    );
  }

  async get(
    workspaceId: string,
    receiptId: string,
  ): Promise<StoredAssistedReceipt | null> {
    const result = await this.pool.query<AssistedReceiptRow>(
      `SELECT payload, revision::text AS revision
         FROM p1_assisted_receipts
        WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, receiptId],
    );
    return result.rows[0] ? storedFromRow(result.rows[0]) : null;
  }

  async list(workspaceId: string): Promise<StoredAssistedReceipt[]> {
    const result = await this.pool.query<AssistedReceiptRow>(
      `SELECT payload, revision::text AS revision
         FROM p1_assisted_receipts
        WHERE workspace_id = $1
        ORDER BY updated_at DESC, id`,
      [workspaceId],
    );
    return result.rows.map(storedFromRow);
  }

  async save(
    receipt: AssistedReceipt,
    expectedRevision: number,
  ): Promise<StoredAssistedReceipt> {
    const parsed = assistedReceiptSchema.parse(receipt);
    const nextRevision = expectedRevision + 1;
    const updated = await this.pool.query<AssistedReceiptRow>(
      `UPDATE p1_assisted_receipts
          SET payload = $4::jsonb,
              revision = $3,
              handoff_token = $5,
              handoff_expires_at = $6::timestamptz,
              handoff_consumed_at = $7::timestamptz,
              updated_at = now()
        WHERE workspace_id = $1 AND id = $2 AND revision = $8
        RETURNING payload, revision::text AS revision`,
      [
        parsed.workspaceId,
        parsed.id,
        nextRevision,
        JSON.stringify(parsed),
        parsed.handoffLink?.token ?? null,
        parsed.handoffLink?.expiresAt ?? null,
        parsed.handoffLink?.consumedAt ?? null,
        expectedRevision,
      ],
    );
    if (updated.rowCount === 1) {
      return storedFromRow(updated.rows[0]!);
    }
    const current = await this.get(parsed.workspaceId, parsed.id);
    throw new AssistedReceiptConflictError(
      parsed.id,
      expectedRevision,
      current?.revision ?? -1,
    );
  }

  async consumeHandoffLink(input: {
    workspaceId: string;
    token: string;
    now: string;
  }): Promise<ConsumeHandoffLinkResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query<AssistedReceiptRow>(
        `SELECT payload, revision::text AS revision
           FROM p1_assisted_receipts
          WHERE workspace_id = $1 AND handoff_token = $2
          FOR UPDATE`,
        [input.workspaceId, input.token],
      );
      if (!selected.rows[0]) {
        await client.query('COMMIT');
        return { kind: 'not_found' };
      }
      const stored = storedFromRow(selected.rows[0]);
      const outcome = consumeOneShotHandoffLink(stored.receipt, {
        now: input.now,
        token: input.token,
      });
      if (outcome.kind !== 'ok') {
        await client.query('COMMIT');
        return outcome;
      }
      await this.saveWithClient(client, outcome.receipt, stored.revision);
      await client.query('COMMIT');
      return outcome;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async saveWithClient(
    client: PoolClient,
    receipt: AssistedReceipt,
    expectedRevision: number,
  ): Promise<void> {
    const nextRevision = expectedRevision + 1;
    const updated = await client.query(
      `UPDATE p1_assisted_receipts
          SET payload = $4::jsonb,
              revision = $3,
              handoff_consumed_at = $5::timestamptz,
              updated_at = now()
        WHERE workspace_id = $1 AND id = $2 AND revision = $6`,
      [
        receipt.workspaceId,
        receipt.id,
        nextRevision,
        JSON.stringify(receipt),
        receipt.handoffLink?.consumedAt ?? null,
        expectedRevision,
      ],
    );
    if (updated.rowCount !== 1) {
      throw new AssistedReceiptConflictError(
        receipt.id,
        expectedRevision,
        expectedRevision + 1,
      );
    }
  }
}
