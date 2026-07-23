import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { PostgresCanvasExportReceiptRepository } from './postgres-canvas-export-receipt-repository.js';

const request = {
  idempotencyKeyHash: 'a'.repeat(64),
  projectId: 'project-1',
  requestHash: 'b'.repeat(64),
  revisionId: 'revision-1',
  userId: 'user-1',
  workspaceId: 'workspace-1',
};

test('uses the existing audit ledger for durable completed and recovered export receipts', async () => {
  const audit: Array<{
    action: string;
    detail: Record<string, unknown>;
    userId: string;
    workspaceId: string;
  }> = [];
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const query = async (sql: string, values: unknown[] = []) => {
    queries.push({ sql, values });
    if (sql.includes("detail->>'idempotencyKeyHash'")) {
      const [workspaceId, userId, action, idempotencyKeyHash] = values;
      const row = audit
        .filter(
          (event) =>
            event.workspaceId === workspaceId &&
            event.userId === userId &&
            event.action === action &&
            event.detail.idempotencyKeyHash === idempotencyKeyHash,
        )
        .at(-1);
      return { rows: row ? [{ detail: row.detail }] : [] };
    }
    if (sql.includes("detail->>'receiptId'")) {
      const [workspaceId, userId, action, receiptId] = values;
      const row = audit
        .filter(
          (event) =>
            event.workspaceId === workspaceId &&
            event.userId === userId &&
            event.action === action &&
            event.detail.receiptId === receiptId,
        )
        .at(-1);
      return { rows: row ? [{ detail: row.detail }] : [] };
    }
    if (sql.includes('INSERT INTO pro_studio_audit_events')) {
      audit.push({
        action: String(values[1]),
        detail: JSON.parse(String(values[4])) as Record<string, unknown>,
        userId: String(values[3]),
        workspaceId: String(values[0]),
      });
    }
    return { rows: [] };
  };
  const client = {
    query,
    release() {},
  } as unknown as PoolClient;
  const pool = {
    connect: async () => client,
    query,
  } as unknown as Pool;
  const receipts = new PostgresCanvasExportReceiptRepository(pool, {
    clock: () => new Date('2026-07-23T00:00:00.000Z'),
    nextId: () => 'canvas-export-receipt-1',
  });

  const claimed = await receipts.claim(request);
  assert.equal(claimed.kind, 'claimed');
  if (claimed.kind !== 'claimed') throw new Error('Expected receipt claim.');
  await receipts.recordFailure({
    assetId: 'asset-1',
    reason: 'asset_storage_unavailable',
    receipt: claimed.receipt,
  });
  const recovered = await receipts.claim(request);
  assert.equal(recovered.kind, 'recovered');
  if (recovered.kind !== 'recovered') throw new Error('Expected receipt recovery.');
  assert.equal(recovered.receipt.id, claimed.receipt.id);

  await receipts.complete({
    manifestSha256: 'c'.repeat(64),
    receipt: recovered.receipt,
    retrievals: [
      {
        assetId: 'asset-1',
        id: 'canvas-retrieval-1',
        sha256: 'd'.repeat(64),
        sizeBytes: 9,
        sourceReceiptId: 'storage-receipt-1',
      },
    ],
    totalBytes: 42,
    warnings: [],
    zipSha256: 'e'.repeat(64),
  });
  const completed = await receipts.claim(request);
  assert.equal(completed.kind, 'completed');
  if (completed.kind !== 'completed') throw new Error('Expected completed receipt.');
  assert.equal(completed.receipt.id, claimed.receipt.id);
  assert.equal(completed.receipt.retrievals[0]?.id, 'canvas-retrieval-1');

  assert.match(
    queries.map((entry) => entry.sql).join('\n'),
    /pg_advisory_xact_lock\(hashtext\(\$1\)\)/u,
  );
  assert.deepEqual(
    audit.map((event) => event.action),
    [
      'canvas_export_receipt_started',
      'canvas_export_receipt_failed',
      'canvas_export_receipt_resumed',
      'canvas_export_receipt_completed',
    ],
  );
  const serializedAudit = JSON.stringify(audit);
  assert.equal(serializedAudit.includes('raw-idempotency-key'), false);
  assert.equal(serializedAudit.includes('object-key'), false);
  assert.equal(audit.at(-1)?.detail.receiptId, claimed.receipt.id);
});
