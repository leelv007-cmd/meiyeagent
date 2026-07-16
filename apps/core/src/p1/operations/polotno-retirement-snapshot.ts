import { createHash } from 'node:crypto';
import type { Pool } from 'pg';

import {
  inventoryLegacyCanvasData,
  type LegacyCanvasInventoryInput,
  type LegacyCanvasManagedRaster,
} from './polotno-retirement-inventory.js';

export interface LegacyCanvasSnapshotWork {
  currentRevisionId: string;
  id: string;
  revisions: Array<{ createdAt?: string; document: unknown; id: string }>;
  workspaceId: string;
}

export interface LegacyCanvasSnapshotTemplate {
  canvasRevisionId: string;
  id: string;
  sourceWorkId: string;
  workspaceId: string;
}

export interface LegacyCanvasSnapshotExportReceipt {
  bytes: number;
  contentType: 'image/jpeg' | 'image/png';
  createdAt: string;
  id: string;
  objectKey: string;
  sha256: string;
  workId: string;
  workRevisionId: string;
  workspaceId: string;
}

export interface LegacyCanvasSnapshotCounts {
  exportReceipts: number;
  revisions: number;
  templates: number;
  templateVersions: number;
  works: number;
}

export interface LegacyCanvasSnapshotCapture {
  capturedAt: string;
  databaseLsn: string;
  exportReceipts: LegacyCanvasSnapshotExportReceipt[];
  sourceCounts: LegacyCanvasSnapshotCounts;
  templates: LegacyCanvasSnapshotTemplate[];
  transactionSnapshot: string;
  works: LegacyCanvasSnapshotWork[];
}

export interface LegacyCanvasSnapshotSource {
  capture(workspaceId: string): Promise<LegacyCanvasSnapshotCapture>;
}

export class PostgresLegacyCanvasSnapshotSource
  implements LegacyCanvasSnapshotSource
{
  constructor(private readonly pool: Pool) {}

  async capture(workspaceId: string): Promise<LegacyCanvasSnapshotCapture> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const metadataResult = await client.query<{
        captured_at: Date | string;
        database_lsn: string;
        transaction_snapshot: string;
      }>(`
        SELECT
          transaction_timestamp() AS captured_at,
          pg_current_wal_lsn()::text AS database_lsn,
          txid_current_snapshot()::text AS transaction_snapshot
      `);
      const countsResult = await client.query<{
        export_receipts: string;
        revisions: string;
        templates: string;
        template_versions: string;
        works: string;
      }>(
        `
          SELECT
            (
              SELECT COUNT(*)::text
              FROM p1_canvas_works
              WHERE workspace_id = $1
            ) AS works,
            (
              SELECT COALESCE(SUM(jsonb_array_length(payload->'revisions')), 0)::text
              FROM p1_canvas_works
              WHERE workspace_id = $1
            ) AS revisions,
            (
              SELECT COUNT(*)::text
              FROM p1_user_templates
              WHERE workspace_id = $1
            ) AS templates,
            (
              SELECT COUNT(*)::text
              FROM p1_user_templates
              WHERE workspace_id = $1
            ) AS template_versions,
            (
              SELECT COUNT(*)::text
              FROM p1_export_receipts
              WHERE workspace_id = $1
            ) AS export_receipts
          /* source_counts */
        `,
        [workspaceId]
      );
      const worksResult = await client.query<{ payload: LegacyCanvasSnapshotWork }>(
        `SELECT payload FROM p1_canvas_works WHERE workspace_id = $1 ORDER BY id`,
        [workspaceId]
      );
      const templatesResult = await client.query<{
        payload: LegacyCanvasSnapshotTemplate;
      }>(
        `SELECT payload FROM p1_user_templates WHERE workspace_id = $1 ORDER BY id`,
        [workspaceId]
      );
      const receiptsResult = await client.query<{
        payload: LegacyCanvasSnapshotExportReceipt;
      }>(
        `SELECT payload FROM p1_export_receipts WHERE workspace_id = $1 ORDER BY id`,
        [workspaceId]
      );
      const metadata = requiredRow(metadataResult.rows[0], 'capture metadata');
      const counts = requiredRow(countsResult.rows[0], 'source counts');
      const capture = {
        capturedAt:
          metadata.captured_at instanceof Date
            ? metadata.captured_at.toISOString()
            : new Date(metadata.captured_at).toISOString(),
        databaseLsn: metadata.database_lsn,
        exportReceipts: receiptsResult.rows.map((row) => row.payload),
        sourceCounts: {
          exportReceipts: integer(counts.export_receipts),
          revisions: integer(counts.revisions),
          templates: integer(counts.templates),
          templateVersions: integer(counts.template_versions),
          works: integer(counts.works),
        },
        templates: templatesResult.rows.map((row) => row.payload),
        transactionSnapshot: metadata.transaction_snapshot,
        works: worksResult.rows.map((row) => row.payload),
      };
      await client.query('COMMIT');
      return capture;
    } catch (cause) {
      await client.query('ROLLBACK');
      throw cause;
    } finally {
      client.release();
    }
  }
}

export interface LegacyCanvasObjectInventory {
  captureId: string;
  capturedAt: string;
  deployment: string;
  objects: Array<{
    contentType: 'image/jpeg' | 'image/png';
    objectKey: string;
    sha256: string;
    sizeBytes: number;
  }>;
  schemaVersion: 1;
  workspaceId: string;
}

export interface LegacyCanvasProductionSnapshot
  extends LegacyCanvasInventoryInput {
  provenance: {
    captureId: string;
    capturedAt: string;
    database: { lsn: string; transactionSnapshot: string };
    deployment: string;
    objectInventory: {
      capturedAt: string;
      sha256: string;
      totalObjects: number;
    };
    snapshotCounts: LegacyCanvasSnapshotCounts & {
      managedRasters: number;
      objectInventoryEntries: number;
    };
    snapshotSha256: string;
    sourceCounts: LegacyCanvasSnapshotCounts;
  };
}

interface ExportSnapshotInput {
  captureId: string;
  deployment: string;
  objectInventory: LegacyCanvasObjectInventory;
  source: LegacyCanvasSnapshotSource;
  workspaceId: string;
}

export async function exportLegacyCanvasProductionSnapshot(
  input: ExportSnapshotInput
): Promise<LegacyCanvasProductionSnapshot> {
  assertCaptureIdentity(input);
  const capture = await input.source.capture(input.workspaceId);
  assertSourceCapture(input.workspaceId, capture);
  const objectByKey = new Map(
    input.objectInventory.objects.map((object) => [object.objectKey, object])
  );
  const receiptByRevision = new Map<string, LegacyCanvasSnapshotExportReceipt>();
  for (const receipt of capture.exportReceipts) {
    const object = objectByKey.get(receipt.objectKey);
    if (
      !object ||
      object.contentType !== receipt.contentType ||
      object.sha256 !== receipt.sha256 ||
      object.sizeBytes !== receipt.bytes
    ) {
      throw new Error('Legacy Canvas receipt does not match object inventory.');
    }
    const key = revisionKey(receipt.workId, receipt.workRevisionId);
    const current = receiptByRevision.get(key);
    if (
      !current ||
      receipt.createdAt > current.createdAt ||
      (receipt.createdAt === current.createdAt && receipt.id > current.id)
    ) {
      receiptByRevision.set(key, receipt);
    }
  }

  const templates = capture.templates.map((template) => {
    const work = capture.works.find((candidate) => candidate.id === template.sourceWorkId);
    const revision = work?.revisions.find(
      (candidate) => candidate.id === template.canvasRevisionId
    );
    if (!work || !revision) {
      throw new Error('Legacy Canvas template references an unknown revision.');
    }
    const versionId = templateVersionId(template);
    return {
      currentVersionId: versionId,
      id: template.id,
      versions: [{ document: revision.document, id: versionId }],
    };
  });
  const managedRasters: LegacyCanvasManagedRaster[] = [];
  for (const work of capture.works) {
    for (const revision of work.revisions) {
      const receipt = receiptByRevision.get(revisionKey(work.id, revision.id));
      if (receipt) {
        managedRasters.push({
          contentType: receipt.contentType,
          objectKey: receipt.objectKey,
          sha256: receipt.sha256,
          sizeBytes: receipt.bytes,
          target: { kind: 'work_revision', revisionId: revision.id, workId: work.id },
        });
      }
    }
  }
  for (const template of capture.templates) {
    const receipt = receiptByRevision.get(
      revisionKey(template.sourceWorkId, template.canvasRevisionId)
    );
    if (receipt) {
      managedRasters.push({
        contentType: receipt.contentType,
        objectKey: receipt.objectKey,
        sha256: receipt.sha256,
        sizeBytes: receipt.bytes,
        target: {
          kind: 'template_version',
          templateId: template.id,
          versionId: templateVersionId(template),
        },
      });
    }
  }

  const works = capture.works.map(({ currentRevisionId, id, revisions }) => ({
    currentRevisionId,
    id,
    revisions,
  }));
  const expectedInventory = {
    exportReceiptIds: capture.exportReceipts.map((receipt) => receipt.id),
    revisionIds: works.flatMap((work) => work.revisions.map((revision) => revision.id)),
    templateIds: templates.map((template) => template.id),
    templateVersionIds: templates.flatMap((template) =>
      template.versions.map((version) => version.id)
    ),
    workIds: works.map((work) => work.id),
  };
  const snapshotCounts = {
    ...capture.sourceCounts,
    managedRasters: managedRasters.length,
    objectInventoryEntries: input.objectInventory.objects.length,
  };
  const base: LegacyCanvasInventoryInput = {
    expectedInventory,
    exportReceipts: capture.exportReceipts.map(({ createdAt, id, workId }) => ({
      createdAt,
      id,
      workId,
    })),
    managedRasters,
    templates,
    workspaceId: input.workspaceId,
    works,
  };
  const provenanceWithoutHash = {
    captureId: input.captureId,
    capturedAt: capture.capturedAt,
    database: {
      lsn: capture.databaseLsn,
      transactionSnapshot: capture.transactionSnapshot,
    },
    deployment: input.deployment,
    objectInventory: {
      capturedAt: input.objectInventory.capturedAt,
      sha256: sha256(input.objectInventory),
      totalObjects: input.objectInventory.objects.length,
    },
    snapshotCounts,
    sourceCounts: capture.sourceCounts,
  };
  const unsigned = { ...base, provenance: provenanceWithoutHash };
  const snapshot: LegacyCanvasProductionSnapshot = {
    ...base,
    provenance: {
      ...provenanceWithoutHash,
      snapshotSha256: sha256(unsigned),
    },
  };
  inventoryLegacyCanvasData(snapshot);
  return snapshot;
}

export function verifyLegacyCanvasProductionSnapshot(
  snapshot: LegacyCanvasProductionSnapshot
) {
  try {
    inventoryLegacyCanvasData(snapshot);
    const { snapshotSha256, ...provenance } = snapshot.provenance;
    return sha256({ ...snapshot, provenance }) === snapshotSha256;
  } catch {
    return false;
  }
}

function assertCaptureIdentity(input: ExportSnapshotInput) {
  const inventory = input.objectInventory;
  const objectKeys = inventory.objects.map((object) => object.objectKey);
  if (
    !input.captureId.trim() ||
    !input.deployment.trim() ||
    !input.workspaceId.trim() ||
    inventory.schemaVersion !== 1 ||
    inventory.captureId !== input.captureId ||
    inventory.deployment !== input.deployment ||
    inventory.workspaceId !== input.workspaceId ||
    !validTimestamp(inventory.capturedAt) ||
    new Set(objectKeys).size !== objectKeys.length ||
    inventory.objects.some(
      (object) =>
        !managedObjectKeySafe(input.workspaceId, object.objectKey) ||
        !['image/jpeg', 'image/png'].includes(object.contentType) ||
        !/^[a-f0-9]{64}$/u.test(object.sha256) ||
        !Number.isSafeInteger(object.sizeBytes) ||
        object.sizeBytes <= 0
    )
  ) {
    throw new Error('Legacy Canvas object inventory capture identity does not match.');
  }
}

function assertSourceCapture(
  workspaceId: string,
  capture: LegacyCanvasSnapshotCapture
) {
  const counts: LegacyCanvasSnapshotCounts = {
    exportReceipts: capture.exportReceipts.length,
    revisions: capture.works.reduce((total, work) => total + work.revisions.length, 0),
    templates: capture.templates.length,
    templateVersions: capture.templates.length,
    works: capture.works.length,
  };
  if (
    Object.keys(counts).some(
      (key) =>
        counts[key as keyof LegacyCanvasSnapshotCounts] !==
        capture.sourceCounts[key as keyof LegacyCanvasSnapshotCounts]
    ) ||
    !validTimestamp(capture.capturedAt) ||
    !capture.databaseLsn.trim() ||
    !capture.transactionSnapshot.trim() ||
    capture.works.some((work) => work.workspaceId !== workspaceId) ||
    capture.templates.some((template) => template.workspaceId !== workspaceId) ||
    capture.exportReceipts.some((receipt) => receipt.workspaceId !== workspaceId)
  ) {
    throw new Error('Legacy Canvas database snapshot failed consistency checks.');
  }
  const revisions = new Map(
    capture.works.flatMap((work) =>
      work.revisions.map((revision) => [revisionKey(work.id, revision.id), revision])
    )
  );
  if (
    capture.works.some(
      (work) => !work.revisions.some((revision) => revision.id === work.currentRevisionId)
    ) ||
    capture.exportReceipts.some(
      (receipt) => !revisions.has(revisionKey(receipt.workId, receipt.workRevisionId))
    )
  ) {
    throw new Error('Legacy Canvas database snapshot contains orphaned references.');
  }
}

function templateVersionId(template: LegacyCanvasSnapshotTemplate) {
  return `template:${template.id}:revision:${template.canvasRevisionId}`;
}

function revisionKey(workId: string, revisionId: string) {
  return `${workId}\u0000${revisionId}`;
}

function managedObjectKeySafe(workspaceId: string, objectKey: string) {
  const segments = objectKey.split('/');
  return (
    objectKey.startsWith(`${workspaceId}/`) &&
    !objectKey.includes('://') &&
    segments.every((segment) => segment && segment !== '.' && segment !== '..')
  );
}

function validTimestamp(value: string) {
  return Boolean(value) && Number.isFinite(Date.parse(value));
}

function sha256(value: unknown) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
}

function requiredRow<T>(row: T | undefined, label: string): T {
  if (!row) throw new Error(`Legacy Canvas PostgreSQL ${label} was not returned.`);
  return row;
}

function integer(value: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('Legacy Canvas PostgreSQL returned an invalid source count.');
  }
  return parsed;
}
