import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import {
  approvalReceiptSchema,
  contentPackageSchema,
  type ContentPackage,
} from '@meiye/contracts';
import { Pool } from 'pg';

import { PostgresOperationsRepository } from '../operations/postgres-repository.js';
import { AssistedReceiptService } from './assisted-receipt-service.js';
import {
  PostgresCanonicalAssistedReceiptRepository,
  type CanonicalAssistedPrepareInput,
} from './assisted-canonical-repository.js';

const connectionString = process.env.TEST_DATABASE_URL;

function canonicalPackage(input: {
  workspaceId: string;
  packageId: string;
  versionId: string;
  exportReceiptId: string;
  approvalReceiptId: string;
}): ContentPackage {
  const createdAt = '2026-07-20T00:00:00.000Z';
  const approval = approvalReceiptSchema.parse({
    binding: {
      accountId: 'account-1',
      actionKind: 'publish',
      actionScheduledAt: '2026-07-20T01:00:00.000Z',
      contextBundle: { bundleId: 'bundle-1', hash: 'hash-1', revision: 1 },
      cost: { amount: 8, currency: 'CNY' },
      contentRevision: 1,
      packageId: input.packageId,
      platform: 'xiaohongshu',
      purpose: 'public_content',
      variantVersionId: input.versionId,
      workspaceId: input.workspaceId,
    },
    events: [
      {
        actorId: 'owner-1',
        eventId: `${input.approvalReceiptId}:approved`,
        occurredAt: createdAt,
        type: 'approved',
      },
    ],
    id: input.approvalReceiptId,
    idempotencyKey: `${input.approvalReceiptId}:key`,
    payloadFingerprint: `${input.approvalReceiptId}:fingerprint`,
    status: 'approved',
  });
  const version = {
    body: '到店立减 50',
    conversionHook: '私信预约',
    createdAt,
    id: input.versionId,
    orderedAssetIds: ['asset-cover-1'],
    title: '夏日美甲',
    topics: ['美甲'],
  };
  return contentPackageSchema.parse({
    approvalReceipts: [approval],
    compliance: { aigcLabelEnabled: true, watermarkEnabled: false },
    createdAt,
    exportReceipts: [
      {
        artifactAssetId: 'asset-export-1',
        artifactObjectKey: `${input.workspaceId}/exports/package.zip`,
        contentType: 'application/zip',
        createdAt,
        id: input.exportReceiptId,
        platform: 'xiaohongshu',
        status: 'succeeded',
        variantVersionId: input.versionId,
      },
    ],
    generated: {
      assetIds: ['asset-cover-1'],
      childRuns: [],
      ownedAssets: [
        {
          contentType: 'image/jpeg',
          id: 'asset-cover-1',
          objectKey: `${input.workspaceId}/assets/cover.jpg`,
          sha256: 'a'.repeat(64),
          sizeBytes: 1200,
        },
      ],
    },
    id: input.packageId,
    kind: 'image_text',
    lineage: {},
    revision: 4,
    rights: { state: 'authorized' },
    source: { assetIds: [], workId: 'work-1' },
    status: 'accepted',
    updatedAt: createdAt,
    variants: [
      { id: 'variant-xhs', platform: 'xiaohongshu', currentVersionId: input.versionId, versions: [version] },
      { id: 'variant-douyin', platform: 'douyin', currentVersionId: 'douyin-v1', versions: [{ ...version, id: 'douyin-v1' }] },
      { id: 'variant-video-account', platform: 'video_account', currentVersionId: 'video-account-v1', versions: [{ ...version, id: 'video-account-v1' }] },
    ],
    versions: [version],
    currentVersionId: input.versionId,
    workspaceId: input.workspaceId,
  });
}

test(
  'canonical assisted chain verifies exact package/export/approval and consumes approval atomically',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const suffix = randomUUID();
    const workspaceId = `workspace-assisted-canonical-${suffix}`;
    const packageId = `package-${suffix}`;
    const versionId = `version-${suffix}`;
    const exportReceiptId = `export-${suffix}`;
    const approvalReceiptId = `approval-${suffix}`;
    const repository = new PostgresCanonicalAssistedReceiptRepository(pool);
    const service = new AssistedReceiptService(repository);
    const context = {
      correlationId: `corr-${suffix}`,
      userId: 'owner-1',
      workspaceId,
    } as const;
    const contentPackage = canonicalPackage({
      approvalReceiptId,
      exportReceiptId,
      packageId,
      versionId,
      workspaceId,
    });
    const prepare: CanonicalAssistedPrepareInput = {
      contentPackageRevision: 4,
      exportReceiptId,
      id: `assisted-${suffix}`,
      occurredAt: '2026-07-20T00:10:00.000Z',
      packageId,
      platform: 'xiaohongshu',
      variantVersionId: versionId,
    };

    try {
      await repository.migrate();
      // p1_content_packages is owned by the operations migration; app boot
      // creates it, a provisioned-but-never-booted database does not.
      await new PostgresOperationsRepository(pool).migrate();
      await pool.query(
        `INSERT INTO p1_content_packages
           (workspace_id, id, payload, revision, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, $5::timestamptz)`,
        [workspaceId, packageId, JSON.stringify(contentPackage), 4, contentPackage.updatedAt],
      );

      await assert.rejects(
        service.prepare(context, { ...prepare, exportReceiptId: 'forged-export' }),
        /exact successful ExportReceipt/u,
      );
      const prepared = await service.prepare(context, prepare);
      assert.equal(prepared.revision, 0);

      await assert.rejects(
        service.handOver(context, {
          binding: {
            accountId: 'forged-account',
            approvalReceiptId,
            contentPackageRevision: 4,
            costRange: { currency: 'CNY', minAmount: 0, maxAmount: 10 },
            packageId,
            platform: 'xiaohongshu',
            purpose: 'public_content',
            responsibilityRole: 'self_publish',
            scheduledAt: '2026-07-20T01:00:00.000Z',
            variantVersionId: versionId,
            workspaceId,
          },
          expectedRevision: 0,
          linkToken: `handoff-${suffix}`,
          occurredAt: '2026-07-20T00:15:00.000Z',
          receiptId: prepare.id!,
        }),
        /account/u,
      );

      const handed = await service.handOver(context, {
        binding: {
          accountId: 'account-1',
          approvalReceiptId,
          contentPackageRevision: 4,
          costRange: { currency: 'CNY', minAmount: 0, maxAmount: 10 },
          packageId,
          platform: 'xiaohongshu',
          purpose: 'public_content',
          responsibilityRole: 'self_publish',
          scheduledAt: '2026-07-20T01:00:00.000Z',
          variantVersionId: versionId,
          workspaceId,
        },
        expectedRevision: 0,
        linkToken: `handoff-${suffix}`,
        occurredAt: '2026-07-20T00:15:00.000Z',
        receiptId: prepare.id!,
      });
      assert.equal(handed.receipt.status, 'handed_over');

      const canonical = await pool.query<{ payload: ContentPackage }>(
        `SELECT payload FROM p1_content_packages WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, packageId],
      );
      const consumed = canonical.rows[0]!.payload.approvalReceipts?.find(
        ({ id }) => id === approvalReceiptId,
      );
      assert.equal(consumed?.status, 'consumed');
      const terminal = consumed?.events.at(-1);
      assert.equal(
        terminal?.type === 'consumed' ? terminal.externalEffectId : undefined,
        `assisted-delivery:${prepare.id}`,
      );

      await assert.rejects(
        service.prepare(context, { ...prepare, id: `assisted-replay-${suffix}`, contentPackageRevision: 4 }),
        /revision/u,
      );

      const resolved = await service.consume(context, {
        now: '2026-07-20T00:20:00.000Z',
        token: `handoff-${suffix}`,
      });
      assert.equal(resolved.kind, 'ok');
      assert.ok('handoff' in resolved);
      if (!('handoff' in resolved)) return;
      assert.equal(resolved.handoff.title, '夏日美甲');
      assert.equal(resolved.handoff.exportReceiptId, exportReceiptId);

      const reported = await service.recordPublishResult(context, {
        expectedRevision: resolved.revision,
        receiptId: prepare.id!,
        result: {
          platformUrl: 'https://example.com/published/1',
          recordedAt: '2026-07-20T00:30:00.000Z',
          source: 'manual_record',
          status: 'published',
        },
      });
      assert.equal(reported.receipt.publishResult?.status, 'published');
      const afterReport = await pool.query<{ payload: ContentPackage }>(
        `SELECT payload FROM p1_content_packages WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, packageId],
      );
      assert.equal(
        afterReport.rows[0]!.payload.deliveryEvents?.at(-1)?.type,
        'manual_publish_result',
      );
    } finally {
      await pool.query('DELETE FROM p1_assisted_receipts WHERE workspace_id = $1', [workspaceId]).catch(() => undefined);
      await pool.query('DELETE FROM p1_content_packages WHERE workspace_id = $1', [workspaceId]).catch(() => undefined);
      await pool.query('DELETE FROM p1_operations_audit_events WHERE workspace_id = $1', [workspaceId]).catch(() => undefined);
      await pool.end();
    }
  },
);
