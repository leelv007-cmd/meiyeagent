import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CanvasExportReceiptError,
  MemoryCanvasExportReceiptRepository,
} from './canvas-export-receipt.js';

const request = {
  idempotencyKeyHash: 'a'.repeat(64),
  projectId: 'project-1',
  requestHash: 'b'.repeat(64),
  revisionId: 'revision-1',
  userId: 'user-1',
  workspaceId: 'workspace-1',
};

test('persists a completed export receipt and returns it to same-key retries', async () => {
  const receipts = fixture();
  const claimed = await receipts.claim(request);
  assert.equal(claimed.kind, 'claimed');
  if (claimed.kind !== 'claimed') throw new Error('Expected a new export receipt.');

  const completed = await receipts.complete({
    manifestSha256: 'c'.repeat(64),
    receipt: claimed.receipt,
    retrievals: [
      {
        assetId: 'asset-1',
        id: 'canvas-retrieval-1',
        sha256: 'd'.repeat(64),
        sizeBytes: 9,
        sourceReceiptId: 'asset-storage-receipt-1',
        storageRevision: 'storage-v1',
      },
    ],
    totalBytes: 42,
    warnings: [{ assetId: 'asset-2', code: 'ASSET_REVOKED' }],
    zipSha256: 'e'.repeat(64),
  });
  const retry = await receipts.claim(request);

  assert.equal(retry.kind, 'completed');
  if (retry.kind !== 'completed') throw new Error('Expected completed export receipt.');
  assert.deepEqual(retry.receipt, completed);
  assert.equal(retry.receipt.retrievals[0]?.id, 'canvas-retrieval-1');
  assert.deepEqual(
    receipts.inspectAudit().map((event) => event.action),
    ['canvas_export_receipt_started', 'canvas_export_receipt_completed'],
  );
  const audit = JSON.stringify(receipts.inspectAudit());
  assert.equal(audit.includes('a'.repeat(64)), true);
  assert.equal(audit.includes('raw-idempotency-key'), false);
});

test('recovers an unfinished receipt and preserves audit linkage without completing it twice', async () => {
  const receipts = fixture();
  const first = await receipts.claim(request);
  assert.equal(first.kind, 'claimed');
  if (first.kind !== 'claimed') throw new Error('Expected a new export receipt.');

  await receipts.recordFailure({
    assetId: 'asset-1',
    reason: 'asset_storage_unavailable',
    receipt: first.receipt,
  });
  const recovered = await receipts.claim(request);
  assert.equal(recovered.kind, 'recovered');
  if (recovered.kind !== 'recovered') throw new Error('Expected a recovered receipt.');
  assert.equal(recovered.receipt.id, first.receipt.id);

  await assert.rejects(
    receipts.complete({
      manifestSha256: 'c'.repeat(64),
      receipt: { ...recovered.receipt, id: 'other-receipt' },
      retrievals: [],
      totalBytes: 0,
      warnings: [],
      zipSha256: 'e'.repeat(64),
    }),
    (error: unknown) =>
      error instanceof CanvasExportReceiptError && error.code === 'INVALID_AUDIT',
  );
  assert.deepEqual(
    receipts.inspectAudit().map((event) => event.action),
    [
      'canvas_export_receipt_started',
      'canvas_export_receipt_failed',
      'canvas_export_receipt_resumed',
    ],
  );
  const failed = receipts.inspectAudit()[1];
  assert.ok(failed && 'receiptId' in failed.detail);
  assert.equal(failed.detail.receiptId, first.receipt.id);
});

test('rejects a changed frozen request that reuses an idempotency key', async () => {
  const receipts = fixture();
  await receipts.claim(request);
  const conflict = await receipts.claim({ ...request, revisionId: 'revision-2' });
  assert.deepEqual(conflict, { kind: 'conflict' });
});

function fixture() {
  let id = 0;
  return new MemoryCanvasExportReceiptRepository({
    clock: () => new Date('2026-07-23T00:00:00.000Z'),
    nextId: () => `canvas-export-receipt-${++id}`,
  });
}
