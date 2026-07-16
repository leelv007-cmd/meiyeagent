import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { auditLegacyCanvasAccess } from './polotno-retirement-access.js';
import { inventoryLegacyCanvasData } from './polotno-retirement-inventory.js';
import {
  exportLegacyCanvasProductionSnapshot,
  PostgresLegacyCanvasSnapshotSource,
  verifyLegacyCanvasProductionSnapshot,
  type LegacyCanvasSnapshotSource,
} from './polotno-retirement-snapshot.js';

const workspaceId = 'workspace-production';
const captureId = 'capture-2026-07-16T16-00-00Z';
const rasterBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const rasterSha256 = createHash('sha256').update(rasterBytes).digest('hex');
const objectKey = `${workspaceId}/owned/export-revision-1.png`;

const document = {
  height: 1350,
  pages: [{ elements: [], id: 'page-1' }],
  width: 1080,
};

function source(): LegacyCanvasSnapshotSource {
  return {
    async capture(requestedWorkspaceId) {
      assert.equal(requestedWorkspaceId, workspaceId);
      return {
        capturedAt: '2026-07-16T16:00:00.000Z',
        databaseLsn: '0/16B6C50',
        exportReceipts: [
          {
            bytes: rasterBytes.byteLength,
            contentType: 'image/png',
            createdAt: '2026-07-16T15:59:30.000Z',
            id: 'export-1',
            objectKey,
            sha256: rasterSha256,
            workId: 'work-1',
            workRevisionId: 'revision-1',
            workspaceId,
          },
        ],
        sourceCounts: {
          exportReceipts: 1,
          revisions: 1,
          templates: 1,
          templateVersions: 1,
          works: 1,
        },
        templates: [
          {
            canvasRevisionId: 'revision-1',
            id: 'template-1',
            sourceWorkId: 'work-1',
            workspaceId,
          },
        ],
        transactionSnapshot: '100:100:',
        works: [
          {
            currentRevisionId: 'revision-1',
            id: 'work-1',
            revisions: [
              {
                createdAt: '2026-07-16T15:59:00.000Z',
                document,
                id: 'revision-1',
              },
            ],
            workspaceId,
          },
        ],
      };
    },
  };
}

test('exports one provenance-bound snapshot accepted by inventory and access audits', async () => {
  const snapshot = await exportLegacyCanvasProductionSnapshot({
    captureId,
    deployment: 'production-cn',
    objectInventory: {
      captureId,
      capturedAt: '2026-07-16T16:00:01.000Z',
      deployment: 'production-cn',
      objects: [
        {
          contentType: 'image/png',
          objectKey,
          sha256: rasterSha256,
          sizeBytes: rasterBytes.byteLength,
        },
      ],
      schemaVersion: 1,
      workspaceId,
    },
    source: source(),
    workspaceId,
  });

  assert.equal(verifyLegacyCanvasProductionSnapshot(snapshot), true);
  assert.deepEqual(snapshot.provenance.database, {
    lsn: '0/16B6C50',
    transactionSnapshot: '100:100:',
  });
  assert.equal(snapshot.provenance.sourceCounts.works, 1);
  assert.equal(snapshot.provenance.snapshotCounts.managedRasters, 2);
  assert.match(snapshot.provenance.snapshotSha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(snapshot.exportReceipts[0], {
    bytes: rasterBytes.byteLength,
    contentType: 'image/png',
    createdAt: '2026-07-16T15:59:30.000Z',
    id: 'export-1',
    objectKey,
    sha256: rasterSha256,
    workId: 'work-1',
    workRevisionId: 'revision-1',
    workspaceId,
  });
  assert.deepEqual(inventoryLegacyCanvasData(snapshot).totals, {
    exportRecords: 1,
    pages: 2,
    revisions: 1,
    templateVersions: 1,
    templates: 1,
    works: 1,
  });

  const access = await auditLegacyCanvasAccess(snapshot, {
    async read(requestedWorkspaceId, requestedObjectKey) {
      assert.equal(requestedWorkspaceId, workspaceId);
      assert.equal(requestedObjectKey, objectKey);
      return rasterBytes;
    },
  });
  assert.equal(access.passed, true);
  assert.equal(access.targets.length, 4);

  const tampered = structuredClone(snapshot);
  tampered.works[0]!.id = 'work-tampered';
  assert.equal(verifyLegacyCanvasProductionSnapshot(tampered), false);

  const tamperedReceipt = structuredClone(snapshot);
  tamperedReceipt.exportReceipts[0]!.objectKey =
    `${workspaceId}/owned/other.png`;
  assert.equal(verifyLegacyCanvasProductionSnapshot(tamperedReceipt), false);
});

test('rejects an object inventory from another capture', async () => {
  await assert.rejects(
    exportLegacyCanvasProductionSnapshot({
      captureId,
      deployment: 'production-cn',
      objectInventory: {
        captureId: 'another-capture',
        capturedAt: '2026-07-16T16:00:01.000Z',
        deployment: 'production-cn',
        objects: [],
        schemaVersion: 1,
        workspaceId,
      },
      source: source(),
      workspaceId,
    }),
    /capture identity does not match/u
  );
});

test('rejects invalid historical timestamps instead of emitting misleading evidence', async () => {
  const invalidSource: LegacyCanvasSnapshotSource = {
    async capture(requestedWorkspaceId) {
      const capture = await source().capture(requestedWorkspaceId);
      capture.exportReceipts[0]!.createdAt = 'not-a-timestamp';
      return capture;
    },
  };

  await assert.rejects(
    exportLegacyCanvasProductionSnapshot({
      captureId,
      deployment: 'production-cn',
      objectInventory: {
        captureId,
        capturedAt: '2026-07-16T16:00:01.000Z',
        deployment: 'production-cn',
        objects: [
          {
            contentType: 'image/png',
            objectKey,
            sha256: rasterSha256,
            sizeBytes: rasterBytes.byteLength,
          },
        ],
        schemaVersion: 1,
        workspaceId,
      },
      source: invalidSource,
      workspaceId,
    }),
    /failed consistency checks/u
  );
});

test('captures PostgreSQL rows and independent counts in one read-only repeatable-read transaction', async () => {
  const queries: Array<{ parameters?: unknown[]; text: string }> = [];
  let released = false;
  const client = {
    async query(text: string, parameters?: unknown[]) {
      queries.push({ ...(parameters ? { parameters } : {}), text });
      if (text.includes('transaction_timestamp')) {
        return {
          rows: [
            {
              captured_at: '2026-07-16T16:00:00.000Z',
              database_lsn: '0/16B6C50',
              transaction_snapshot: '100:100:',
            },
          ],
        };
      }
      if (text.includes('source_counts')) {
        return {
          rows: [
            {
              export_receipts: '1',
              revisions: '1',
              templates: '1',
              template_versions: '1',
              works: '1',
            },
          ],
        };
      }
      if (text.includes('p1_canvas_works')) {
        return {
          rows: [{ payload: (await source().capture(workspaceId)).works[0] }],
        };
      }
      if (text.includes('p1_user_templates')) {
        return {
          rows: [
            { payload: (await source().capture(workspaceId)).templates[0] },
          ],
        };
      }
      if (text.includes('p1_export_receipts')) {
        return {
          rows: [
            {
              payload: (await source().capture(workspaceId)).exportReceipts[0],
            },
          ],
        };
      }
      return { rows: [] };
    },
    release() {
      released = true;
    },
  };
  const pool = {
    async connect() {
      return client;
    },
  };

  const capture = await new PostgresLegacyCanvasSnapshotSource(
    pool as never
  ).capture(workspaceId);

  assert.equal(
    queries[0]?.text,
    'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'
  );
  assert.deepEqual(queries.at(-1), { text: 'COMMIT' });
  assert.equal(released, true);
  assert.equal(capture.databaseLsn, '0/16B6C50');
  assert.deepEqual(capture.sourceCounts, {
    exportReceipts: 1,
    revisions: 1,
    templates: 1,
    templateVersions: 1,
    works: 1,
  });
  assert.equal(
    queries.some(({ text }) => /\b(?:delete|insert|update)\b/iu.test(text)),
    false
  );
  assert.equal(
    queries
      .filter(({ text }) => text.includes('p1_'))
      .every(({ parameters }) => parameters?.[0] === workspaceId),
    true
  );
});
