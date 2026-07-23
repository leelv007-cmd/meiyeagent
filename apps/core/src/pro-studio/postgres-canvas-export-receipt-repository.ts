import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import {
  CANVAS_EXPORT_AUDIT_ACTIONS,
  CanvasExportReceiptError,
  type CanvasExportCompletedReceipt,
  type CanvasExportReceipt,
  type CanvasExportReceiptClaim,
  type CanvasExportReceiptFailureReason,
  type CanvasExportReceiptRepository,
  type CanvasExportReceiptRequest,
  type CanvasExportReceiptWarning,
  type CanvasExportRetrievalReceipt,
  sameCanvasExportCompletedReceipt,
  sameCanvasExportReceipt,
} from './canvas-export-receipt.js';

interface AuditRow extends QueryResultRow {
  detail: unknown;
}

/**
 * Durable Canvas export receipts are append-only events in the existing
 * pro_studio_audit_events ledger. An advisory transaction lock makes the
 * idempotency key a real cross-process claim without adding a parallel table.
 */
export class PostgresCanvasExportReceiptRepository
  implements CanvasExportReceiptRepository
{
  private readonly clock: () => Date;
  private readonly nextId: () => string;

  constructor(
    private readonly pool: Pool,
    options: { clock?: () => Date; nextId?: () => string } = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.nextId = options.nextId ?? (() => `canvas-export-${randomUUID()}`);
  }

  async claim(input: CanvasExportReceiptRequest): Promise<CanvasExportReceiptClaim> {
    return this.locked(input, async (client) => {
      const existing = await this.started(client, input);
      if (existing) {
        if (!sameRequest(existing, input)) return { kind: 'conflict' };
        const completed = await this.completed(client, existing);
        if (completed) return { kind: 'completed', receipt: completed };
        await this.append(client, CANVAS_EXPORT_AUDIT_ACTIONS.resumed, existing);
        return { kind: 'recovered', receipt: existing };
      }
      const receipt: CanvasExportReceipt = {
        ...input,
        createdAt: this.clock().toISOString(),
        id: this.nextId(),
      };
      await this.append(client, CANVAS_EXPORT_AUDIT_ACTIONS.started, receipt);
      return { kind: 'claimed', receipt };
    });
  }

  async complete(input: {
    manifestSha256: string;
    receipt: CanvasExportReceipt;
    retrievals: CanvasExportRetrievalReceipt[];
    totalBytes: number;
    warnings: CanvasExportReceiptWarning[];
    zipSha256: string;
  }): Promise<CanvasExportCompletedReceipt> {
    return this.locked(input.receipt, async (client) => {
      const started = await this.started(client, input.receipt);
      if (!started || !sameCanvasExportReceipt(started, input.receipt)) {
        throw new CanvasExportReceiptError(
          'INVALID_AUDIT',
          'Canvas export receipt was not claimed.',
        );
      }
      const candidate: CanvasExportCompletedReceipt = {
        ...input.receipt,
        completedAt: this.clock().toISOString(),
        manifestSha256: input.manifestSha256,
        retrievals: structuredClone(input.retrievals),
        totalBytes: input.totalBytes,
        warnings: structuredClone(input.warnings),
        zipSha256: input.zipSha256,
      };
      const existing = await this.completed(client, input.receipt);
      if (existing) {
        if (!sameCanvasExportCompletedReceipt(existing, candidate)) {
          throw new CanvasExportReceiptError(
            'CONFLICT',
            'Canvas export receipt completed with different output facts.',
          );
        }
        return existing;
      }
      await this.append(client, CANVAS_EXPORT_AUDIT_ACTIONS.completed, candidate);
      return candidate;
    });
  }

  async recordFailure(input: {
    assetId?: string;
    reason: CanvasExportReceiptFailureReason;
    receipt: CanvasExportReceipt;
  }) {
    await this.pool.query(
      `INSERT INTO pro_studio_audit_events
       (workspace_id, action, project_id, actor_id, detail, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)`,
      [
        input.receipt.workspaceId,
        CANVAS_EXPORT_AUDIT_ACTIONS.failed,
        input.receipt.projectId,
        input.receipt.userId,
        JSON.stringify({
          ...(input.assetId ? { assetId: input.assetId } : {}),
          reason: input.reason,
          receiptId: input.receipt.id,
        }),
        this.clock().toISOString(),
      ],
    );
  }

  private async locked<T>(
    input: Pick<CanvasExportReceiptRequest, 'idempotencyKeyHash' | 'userId' | 'workspaceId'>,
    operation: (client: PoolClient) => Promise<T>,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Postgres text cannot carry a NUL byte, so hash the NUL-delimited claim
      // tuple in JS and hand hashtext a NUL-free digest instead of the raw key.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        createHash('sha256')
          .update(
            `${input.workspaceId}\0${input.userId}\0${input.idempotencyKeyHash}`,
          )
          .digest('hex'),
      ]);
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async started(
    client: PoolClient,
    input: Pick<CanvasExportReceiptRequest, 'idempotencyKeyHash' | 'userId' | 'workspaceId'>,
  ) {
    const result = await client.query<AuditRow>(
      `SELECT detail
         FROM pro_studio_audit_events
        WHERE workspace_id = $1
          AND actor_id = $2
          AND action = $3
          AND detail->>'idempotencyKeyHash' = $4
        ORDER BY id DESC
        LIMIT 1`,
      [
        input.workspaceId,
        input.userId,
        CANVAS_EXPORT_AUDIT_ACTIONS.started,
        input.idempotencyKeyHash,
      ],
    );
    if (!result.rows[0]) return null;
    return parseReceipt(result.rows[0].detail);
  }

  private async completed(client: PoolClient, receipt: CanvasExportReceipt) {
    const result = await client.query<AuditRow>(
      `SELECT detail
         FROM pro_studio_audit_events
        WHERE workspace_id = $1
          AND actor_id = $2
          AND action = $3
          AND detail->>'receiptId' = $4
        ORDER BY id DESC
        LIMIT 1`,
      [
        receipt.workspaceId,
        receipt.userId,
        CANVAS_EXPORT_AUDIT_ACTIONS.completed,
        receipt.id,
      ],
    );
    if (!result.rows[0]) return null;
    const completed = parseCompletedReceipt(result.rows[0].detail);
    if (!sameCanvasExportReceipt(completed, receipt)) {
      throw new CanvasExportReceiptError(
        'INVALID_AUDIT',
        'Canvas export completion does not match its receipt.',
      );
    }
    return completed;
  }

  private async append(
    client: PoolClient,
    action:
      | typeof CANVAS_EXPORT_AUDIT_ACTIONS.completed
      | typeof CANVAS_EXPORT_AUDIT_ACTIONS.resumed
      | typeof CANVAS_EXPORT_AUDIT_ACTIONS.started,
    receipt: CanvasExportReceipt | CanvasExportCompletedReceipt,
  ) {
    await client.query(
      `INSERT INTO pro_studio_audit_events
       (workspace_id, action, project_id, actor_id, detail, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)`,
      [
        receipt.workspaceId,
        action,
        receipt.projectId,
        receipt.userId,
        JSON.stringify(auditDetail(action, receipt)),
        this.clock().toISOString(),
      ],
    );
  }
}

function auditDetail(
  action:
    | typeof CANVAS_EXPORT_AUDIT_ACTIONS.completed
    | typeof CANVAS_EXPORT_AUDIT_ACTIONS.resumed
    | typeof CANVAS_EXPORT_AUDIT_ACTIONS.started,
  receipt: CanvasExportReceipt | CanvasExportCompletedReceipt,
) {
  const base = {
    createdAt: receipt.createdAt,
    idempotencyKeyHash: receipt.idempotencyKeyHash,
    projectId: receipt.projectId,
    receiptId: receipt.id,
    requestHash: receipt.requestHash,
    revisionId: receipt.revisionId,
    schema: 'canvas_export_receipt/v1',
    userId: receipt.userId,
    workspaceId: receipt.workspaceId,
  };
  if (action !== CANVAS_EXPORT_AUDIT_ACTIONS.completed) return base;
  const completed = receipt as CanvasExportCompletedReceipt;
  return {
    ...base,
    completedAt: completed.completedAt,
    manifestSha256: completed.manifestSha256,
    retrievals: completed.retrievals,
    totalBytes: completed.totalBytes,
    warnings: completed.warnings,
    zipSha256: completed.zipSha256,
  };
}

function parseReceipt(value: unknown): CanvasExportReceipt {
  const record = object(value);
  const receipt: CanvasExportReceipt = {
    createdAt: text(record.createdAt),
    id: text(record.receiptId),
    idempotencyKeyHash: digest(record.idempotencyKeyHash),
    projectId: text(record.projectId),
    requestHash: digest(record.requestHash),
    revisionId: text(record.revisionId),
    userId: text(record.userId),
    workspaceId: text(record.workspaceId),
  };
  if (!validTimestamp(receipt.createdAt)) {
    throw new CanvasExportReceiptError(
      'INVALID_AUDIT',
      'Canvas export audit receipt timestamp is invalid.',
    );
  }
  return receipt;
}

function parseCompletedReceipt(value: unknown): CanvasExportCompletedReceipt {
  const record = object(value);
  const receipt = parseReceipt({
    ...record,
    createdAt: record.createdAt ?? record.completedAt,
  });
  const completedAt = text(record.completedAt);
  const manifestSha256 = digest(record.manifestSha256);
  const zipSha256 = digest(record.zipSha256);
  const totalBytes = positiveInteger(record.totalBytes);
  const retrievals = Array.isArray(record.retrievals)
    ? record.retrievals.map(parseRetrieval)
    : invalidAudit('Canvas export retrieval audit is invalid.');
  const warnings = Array.isArray(record.warnings)
    ? record.warnings.map(parseWarning)
    : invalidAudit('Canvas export warning audit is invalid.');
  if (!validTimestamp(completedAt)) {
    return invalidAudit('Canvas export completion timestamp is invalid.');
  }
  return {
    ...receipt,
    completedAt,
    manifestSha256,
    retrievals,
    totalBytes,
    warnings,
    zipSha256,
  };
}

function parseRetrieval(value: unknown): CanvasExportRetrievalReceipt {
  const record = object(value);
  const storageRevision = optionalText(record.storageRevision);
  return {
    assetId: text(record.assetId),
    id: text(record.id),
    sha256: digest(record.sha256),
    sizeBytes: positiveInteger(record.sizeBytes),
    sourceReceiptId: text(record.sourceReceiptId),
    ...(storageRevision ? { storageRevision } : {}),
  };
}

function parseWarning(value: unknown): CanvasExportReceiptWarning {
  const record = object(value);
  return { assetId: text(record.assetId), code: text(record.code) };
}

function sameRequest(
  receipt: CanvasExportReceipt,
  input: CanvasExportReceiptRequest,
) {
  return (
    receipt.idempotencyKeyHash === input.idempotencyKeyHash &&
    receipt.projectId === input.projectId &&
    receipt.requestHash === input.requestHash &&
    receipt.revisionId === input.revisionId &&
    receipt.userId === input.userId &&
    receipt.workspaceId === input.workspaceId
  );
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CanvasExportReceiptError(
      'INVALID_AUDIT',
      'Canvas export audit record is invalid.',
    );
  }
  return value as Record<string, unknown>;
}

function text(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new CanvasExportReceiptError(
      'INVALID_AUDIT',
      'Canvas export audit text is invalid.',
    );
  }
  return value;
}

function optionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function digest(value: unknown) {
  const parsed = text(value);
  if (!/^[a-f0-9]{64}$/u.test(parsed)) {
    throw new CanvasExportReceiptError(
      'INVALID_AUDIT',
      'Canvas export audit digest is invalid.',
    );
  }
  return parsed;
}

function positiveInteger(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new CanvasExportReceiptError(
      'INVALID_AUDIT',
      'Canvas export audit size is invalid.',
    );
  }
  return value;
}

function validTimestamp(value: string) {
  return Number.isFinite(Date.parse(value));
}

function invalidAudit(message: string): never {
  throw new CanvasExportReceiptError('INVALID_AUDIT', message);
}
