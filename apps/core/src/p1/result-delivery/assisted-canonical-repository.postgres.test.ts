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
  CanonicalAssistedDeliveryError,
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

function deliveredCanonicalPackage(
  input: Parameters<typeof canonicalPackage>[0],
): ContentPackage {
  const contentPackage = canonicalPackage(input);
  const approval = contentPackage.approvalReceipts?.[0];
  assert.ok(approval);
  const occurredAt = '2026-07-20T00:05:00.000Z';
  const deliveryAttemptId = `content-package-delivery:${approval.id}`;
  return contentPackageSchema.parse({
    ...contentPackage,
    approvalReceipts: [
      approvalReceiptSchema.parse({
        ...approval,
        events: [
          ...approval.events,
          {
            actorId: 'owner-1',
            eventId: `${approval.id}:consumed`,
            externalEffectId: deliveryAttemptId,
            occurredAt,
            type: 'consumed',
          },
        ],
        status: 'consumed',
      }),
    ],
    deliveryEvents: [
      {
        actorId: 'owner-1',
        artifactReceiptId: input.exportReceiptId,
        deliveryIdentity: {
          approvalReceiptId: approval.id,
          deliveryAttemptId,
          schema: 'approval_receipt_v1',
        },
        id: `delivery-${input.packageId}`,
        occurredAt,
        platform: 'xiaohongshu',
        source: 'native',
        type: 'assisted_handoff_prepared',
        variantVersionId: input.versionId,
      },
    ],
    revision: 5,
    updatedAt: occurredAt,
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
      const forgedReceiptId = `assisted-forged-${suffix}`;
      const prepared = await service.prepare(context, {
        ...prepare,
        id: forgedReceiptId,
      });
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
          receiptId: forgedReceiptId,
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
        receiptId: forgedReceiptId,
      });
      assert.equal(handed.receipt.status, 'handed_over');
      assert.equal(handed.receipt.canonicalTarget?.contentPackageRevision, 4);
      assert.equal(handed.receipt.canonicalTarget?.currentPackageRevision, 5);

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
        `assisted-delivery:${forgedReceiptId}`,
      );

      await assert.rejects(
        service.prepare(context, { ...prepare, id: `assisted-replay-${suffix}`, contentPackageRevision: 4 }),
        /revision/u,
      );

      const attempts = await Promise.all([
        service.consume(context, {
          now: '2026-07-20T00:20:00.000Z',
          token: `handoff-${suffix}`,
        }),
        service.consume(context, {
          now: '2026-07-20T00:20:00.000Z',
          token: `handoff-${suffix}`,
        }),
      ]);
      assert.deepEqual(
        attempts.map(({ kind }) => kind).sort(),
        ['consumed', 'ok'],
      );
      const resolved = attempts.find(({ kind }) => kind === 'ok');
      assert.ok(resolved);
      assert.ok('handoff' in resolved);
      if (!('handoff' in resolved)) return;
      assert.equal(resolved.handoff.title, '夏日美甲');
      assert.equal(resolved.handoff.exportReceiptId, exportReceiptId);
      assert.deepEqual(
        attempts.find(({ kind }) => kind === 'consumed'),
        { kind: 'consumed' },
      );
      const consumptionAudits = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM p1_operations_audit_events
          WHERE workspace_id = $1
            AND payload->>'action' = $2`,
        [
          workspaceId,
          'result_delivery.assisted_handoff_link_consumed',
        ],
      );
      assert.equal(consumptionAudits.rows[0]?.count, '1');

      const reported = await service.recordPublishResult(context, {
        expectedRevision: resolved.revision,
        receiptId: forgedReceiptId,
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

test(
  'delivered assisted handoff issues one stable token without consuming approval twice',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const suffix = randomUUID();
    const workspaceId = `workspace-assisted-delivered-${suffix}`;
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
    const contentPackage = deliveredCanonicalPackage({
      approvalReceiptId,
      exportReceiptId,
      packageId,
      versionId,
      workspaceId,
    });
    const prepare = {
      contentPackageRevision: 5,
      exportReceiptId,
      id: `assisted-delivered-${suffix}`,
      occurredAt: '2026-07-20T00:10:00.000Z',
      packageId,
      platform: 'xiaohongshu' as const,
      variantVersionId: versionId,
    };
    const binding = {
      accountId: 'account-1',
      approvalReceiptId,
      contentPackageRevision: 5,
      costRange: { currency: 'CNY' as const, minAmount: 0, maxAmount: 10 },
      packageId,
      platform: 'xiaohongshu' as const,
      purpose: 'public_content',
      responsibilityRole: 'self_publish' as const,
      scheduledAt: '2026-07-20T01:00:00.000Z',
      variantVersionId: versionId,
      workspaceId,
    };

    try {
      await repository.migrate();
      await new PostgresOperationsRepository(pool).migrate();
      await pool.query(
        `INSERT INTO p1_content_packages
           (workspace_id, id, payload, revision, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, $5::timestamptz)`,
        [workspaceId, packageId, JSON.stringify(contentPackage), 5, contentPackage.updatedAt],
      );

      const first = await service.prepareHandoff(context, {
        binding,
        linkToken: `first-handoff-${suffix}`,
        prepare,
      });
      const refreshed = await service.prepareHandoff(context, {
        binding,
        linkToken: `second-handoff-${suffix}`,
        prepare: { ...prepare, occurredAt: '2026-07-20T00:11:00.000Z' },
      });
      assert.equal(first.receipt.handoffLink?.token, `first-handoff-${suffix}`);
      assert.equal(refreshed.receipt.handoffLink?.token, first.receipt.handoffLink?.token);
      assert.equal(refreshed.revision, 1);
      const consumed = await service.consume(context, {
        now: '2026-07-20T00:12:00.000Z',
        token: `first-handoff-${suffix}`,
      });
      assert.equal(consumed.kind, 'ok');

      const canonical = await pool.query<{ payload: ContentPackage; revision: string }>(
        `SELECT payload, revision::text AS revision
           FROM p1_content_packages
          WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, packageId],
      );
      assert.equal(canonical.rows[0]?.revision, '5');
      assert.equal(canonical.rows[0]?.payload.approvalReceipts?.[0]?.events.length, 2);

      const publishedAt = '2026-07-20T00:20:00.000Z';
      const publishedPackage = contentPackageSchema.parse({
        ...canonical.rows[0]!.payload,
        deliveryEvents: [
          ...(canonical.rows[0]!.payload.deliveryEvents ?? []),
          {
            actorId: 'owner-1',
            afterRevision: 6,
            artifactReceiptId: exportReceiptId,
            beforeRevision: 5,
            deliveryIdentity: {
              approvalReceiptId,
              deliveryAttemptId: `content-package-delivery:${approvalReceiptId}`,
              schema: 'approval_receipt_v1',
            },
            id: `manual-published-${suffix}`,
            occurredAt: publishedAt,
            platform: 'xiaohongshu',
            source: 'native',
            status: 'published',
            type: 'manual_publish_result',
            variantVersionId: versionId,
          },
        ],
        revision: 6,
        updatedAt: publishedAt,
      });
      await pool.query(
        `UPDATE p1_content_packages
            SET payload = $3::jsonb, revision = 6, updated_at = $4::timestamptz
          WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, packageId, JSON.stringify(publishedPackage), publishedAt],
      );
      const afterPublishRefresh = await service.prepareHandoff(context, {
        binding: { ...binding, contentPackageRevision: 6 },
        linkToken: `third-handoff-${suffix}`,
        prepare: {
          ...prepare,
          contentPackageRevision: 6,
          occurredAt: '2026-07-20T00:21:00.000Z',
        },
      });
      assert.equal(
        afterPublishRefresh.receipt.handoffLink?.token,
        `first-handoff-${suffix}`,
      );
    } finally {
      await pool.query('DELETE FROM p1_assisted_receipts WHERE workspace_id = $1', [workspaceId]).catch(() => undefined);
      await pool.query('DELETE FROM p1_content_packages WHERE workspace_id = $1', [workspaceId]).catch(() => undefined);
      await pool.query('DELETE FROM p1_operations_audit_events WHERE workspace_id = $1', [workspaceId]).catch(() => undefined);
      await pool.end();
    }
  },
);

test(
  'a consumed canonical handoff stays closed after a not_published result',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const suffix = randomUUID();
    const workspaceId = `workspace-assisted-closed-${suffix}`;
    const packageId = `package-${suffix}`;
    const versionId = `version-${suffix}`;
    const exportReceiptId = `export-${suffix}`;
    const approvalReceiptId = `approval-${suffix}`;
    const receiptId = `assisted-closed-${suffix}`;
    const repository = new PostgresCanonicalAssistedReceiptRepository(pool);
    const service = new AssistedReceiptService(repository);
    const context = {
      correlationId: `corr-${suffix}`,
      userId: 'owner-1',
      workspaceId,
    } as const;
    const contentPackage = deliveredCanonicalPackage({
      approvalReceiptId,
      exportReceiptId,
      packageId,
      versionId,
      workspaceId,
    });
    const binding = {
      accountId: 'account-1',
      approvalReceiptId,
      contentPackageRevision: 5,
      costRange: { currency: 'CNY' as const, minAmount: 0, maxAmount: 10 },
      packageId,
      platform: 'xiaohongshu' as const,
      purpose: 'public_content',
      responsibilityRole: 'self_publish' as const,
      scheduledAt: '2026-07-20T01:00:00.000Z',
      variantVersionId: versionId,
      workspaceId,
    };
    const prepare = {
      contentPackageRevision: 5,
      exportReceiptId,
      id: receiptId,
      occurredAt: '2026-07-20T00:10:00.000Z',
      packageId,
      platform: 'xiaohongshu' as const,
      variantVersionId: versionId,
    };

    try {
      await repository.migrate();
      await new PostgresOperationsRepository(pool).migrate();
      await pool.query(
        `INSERT INTO p1_content_packages
           (workspace_id, id, payload, revision, updated_at)
         VALUES ($1, $2, $3::jsonb, 5, $4::timestamptz)`,
        [workspaceId, packageId, JSON.stringify(contentPackage), contentPackage.updatedAt],
      );
      const initial = await service.prepareHandoff(context, {
        binding,
        linkToken: `handoff-${suffix}`,
        prepare,
      });
      const token = initial.receipt.handoffLink?.token;
      assert.ok(token);
      const consumed = await service.consume(context, {
        now: '2026-07-20T00:12:00.000Z',
        token,
      });
      assert.equal(consumed.kind, 'ok');
      assert.ok('handoff' in consumed);
      if (!('handoff' in consumed)) return;
      const recorded = await service.recordPublishResult(context, {
        expectedRevision: consumed.revision,
        receiptId,
        result: {
          recordedAt: '2026-07-20T00:20:00.000Z',
          source: 'manual_record',
          status: 'not_published',
        },
      });
      assert.equal(
        recorded.receipt.canonicalTarget?.currentPackageRevision,
        5,
      );
      const afterResult = await pool.query<{
        payload: ContentPackage;
        revision: string;
      }>(
        `SELECT payload, revision::text AS revision
           FROM p1_content_packages
          WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, packageId],
      );
      assert.equal(afterResult.rows[0]?.revision, '5');
      assert.equal(
        afterResult.rows[0]?.payload.deliveryEvents?.at(-1)?.type,
        'assisted_handoff_prepared',
      );

      await assert.rejects(
        service.prepareHandoff(context, {
          binding,
          linkToken: `reissue-${suffix}`,
          prepare: {
            ...prepare,
            occurredAt: '2026-07-20T00:21:00.000Z',
          },
        }),
        (error: unknown) =>
          error instanceof CanonicalAssistedDeliveryError &&
          error.code === 'CANONICAL_HANDOFF_REPREPARE_REQUIRED',
      );
      assert.deepEqual(
        await service.consume(context, {
          now: '2026-07-20T00:22:00.000Z',
          token,
        }),
        { kind: 'consumed' },
      );
    } finally {
      await pool.query('DELETE FROM p1_assisted_receipts WHERE workspace_id = $1', [workspaceId]).catch(() => undefined);
      await pool.query('DELETE FROM p1_content_packages WHERE workspace_id = $1', [workspaceId]).catch(() => undefined);
      await pool.query('DELETE FROM p1_operations_audit_events WHERE workspace_id = $1', [workspaceId]).catch(() => undefined);
      await pool.end();
    }
  },
);
