import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import sharp from 'sharp';
import { MemoryModelAssetStorage } from '../model-supply/index.js';
import {
  MemoryOperationsRepository,
  OperationsContentPackageExportAssetReader,
  OperationsFoundationModule,
  OperationsApplicationService,
  PersistentCanvasExportAdapter,
  RecordedImageGenerationAdapter,
  type OperationContext,
} from './index.js';

const owner: OperationContext = {
  actor: 'owner',
  correlationId: 'canvas-export-adoption',
  userId: 'owner-a',
  workspaceId: 'workspace-a',
};

async function setup() {
  const repository = new MemoryOperationsRepository();
  repository.grantMembership(owner.userId, owner.workspaceId);
  const storage = new MemoryModelAssetStorage();
  const service = new OperationsApplicationService(repository, {
    canvasExporter: new PersistentCanvasExportAdapter(storage),
    imageGenerator: new RecordedImageGenerationAdapter(),
    notifier: { async send() {} },
  });
  const work = await service.createBlankWork(owner, {
    height: 1350,
    name: 'Layout export adoption',
    width: 1080,
  });
  const bytes = await sharp({
    create: {
      background: { alpha: 0, b: 0, g: 0, r: 0 },
      channels: 4,
      height: 1350,
      width: 1080,
    },
  })
    .png()
    .toBuffer();
  const receipt = await service.exportWork(owner, work.id, {
    brandWatermarkEnabled: true,
    brandWatermarkText: 'Displayed layout brand',
    format: 'png',
    height: 1350,
    renderedDataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
    renderEvidenceMarker: {
      cjkLineBreakElementIds: [],
      fontFamilies: [],
      imageElementIds: [],
      rasterSha256: createHash('sha256').update(bytes).digest('hex'),
      version: 'canvas-raster-v1',
    },
    width: 1080,
    workRevisionId: work.currentRevisionId,
  });
  return { receipt, repository, service, storage, work };
}

describe('canvas export adoption', () => {
  it('persists the raster and idempotently adopts its exact revision into an accepted ContentPackage', async () => {
    const { receipt, repository, service, storage, work } = await setup();

    assert.equal(typeof receipt.assetId, 'string');
    assert.match(receipt.assetId!, /^owned-/);
    assert.match(
      receipt.objectKey,
      new RegExp(`^${owner.workspaceId}/owned/[a-f0-9]{64}\\.png$`)
    );
    assert.equal(
      await storage.inspectOwnedAsset?.({
        contentType: receipt.contentType,
        objectKey: receipt.objectKey,
        sha256: receipt.sha256,
        sizeBytes: receipt.bytes,
        workspaceId: owner.workspaceId,
      }),
      true
    );

    const first = (await new OperationsFoundationModule(service).execute({
      context: owner,
      input: {
        action: 'adopt_canvas_work_export',
        payload: {
          exportReceiptId: receipt.id,
          workId: work.id,
          workRevisionId: work.currentRevisionId,
        },
      },
    })) as Awaited<ReturnType<typeof service.adoptCanvasWorkExport>>;
    const replay = await service.adoptCanvasWorkExport(owner, {
      exportReceiptId: receipt.id,
      workId: work.id,
      workRevisionId: work.currentRevisionId,
    });

    assert.equal(replay.id, first.id);
    assert.equal(first.status, 'accepted');
    assert.equal(first.kind, 'image_text');
    assert.equal(first.currentVersionId, `${first.id}-v1`);
    assert.deepEqual(first.compliance, {
      aigcLabelEnabled: false,
      watermarkEnabled: true,
      watermarkText: 'Displayed layout brand',
    });
    assert.deepEqual(first.versions[0]?.orderedAssetIds, [receipt.assetId]);
    assert.deepEqual(first.source.layoutCanvas, {
      exportReceiptId: receipt.id,
      schemaVersion: 1,
      workId: work.id,
      workRevisionId: work.currentRevisionId,
    });
    assert.deepEqual(first.generated.ownedAssets, [
      {
        contentType: receipt.contentType,
        id: receipt.assetId,
        objectKey: receipt.objectKey,
        sha256: receipt.sha256,
        sizeBytes: receipt.bytes,
      },
    ]);
    const exportedSource = await new OperationsContentPackageExportAssetReader(
      repository,
      storage
    ).readOwnedAsset({
      assetId: receipt.assetId!,
      workspaceId: owner.workspaceId,
    });
    assert.equal(exportedSource.asset.sha256, receipt.sha256);
    assert.equal(exportedSource.bytes.byteLength, receipt.bytes);
    assert.equal(
      (await repository.loadWorkspace(owner.workspaceId))?.contentPackages
        .length,
      1
    );
  });

  it('rejects a receipt that does not belong to the exact work revision', async () => {
    const { receipt, service } = await setup();
    const other = await service.createBlankWork(owner, {
      height: 1350,
      name: 'Other layout work',
      width: 1080,
    });

    await assert.rejects(
      service.adoptCanvasWorkExport(owner, {
        exportReceiptId: receipt.id,
        workId: other.id,
        workRevisionId: other.currentRevisionId,
      }),
      /does not belong to the requested Canvas work revision/
    );
  });

  it('rejects adoption after the durable raster bytes are lost', async () => {
    const { receipt, repository, work } = await setup();
    const restarted = new OperationsApplicationService(repository, {
      canvasExporter: new PersistentCanvasExportAdapter(
        new MemoryModelAssetStorage()
      ),
      imageGenerator: new RecordedImageGenerationAdapter(),
      notifier: { async send() {} },
    });

    await assert.rejects(
      restarted.adoptCanvasWorkExport(owner, {
        exportReceiptId: receipt.id,
        workId: work.id,
        workRevisionId: work.currentRevisionId,
      }),
      /not available in workspace-owned storage/
    );
  });
});
