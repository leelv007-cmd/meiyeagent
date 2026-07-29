/**
 * Ticket 13: adopted Advanced Canvas packages participate in the same content
 * library lifecycle (export receipt, reuse) as mainline packages.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contentPackageVersionSchema } from '@meiye/contracts';
import { transitionContentPackage } from './content-package.js';
import {
  type ContentPackageExportPort,
  MemoryOperationsRepository,
  OperationsApplicationService,
  RecordedCanvasExportAdapter,
  RecordedImageGenerationAdapter,
} from './index.js';

const NOW = '2026-07-16T12:00:00.000Z';

function setup(options: { contentPackageExporter?: ContentPackageExportPort } = {}) {
  const operations = new MemoryOperationsRepository();
  const context = {
    actor: 'owner' as const,
    correlationId: 'corr-advanced-canvas-lifecycle',
    userId: 'owner-advanced-canvas',
    workspaceId: 'workspace-advanced-canvas',
  };
  operations.grantMembership(context.userId, context.workspaceId);
  const operationsService = new OperationsApplicationService(operations, {
    canvasExporter: new RecordedCanvasExportAdapter(),
    ...(options.contentPackageExporter
      ? { contentPackageExporter: options.contentPackageExporter }
      : {}),
    imageGenerator: new RecordedImageGenerationAdapter(),
    notifier: { async send() {} },
  });
  return { context, operations, operationsService };
}

async function seedAdvancedCanvasAcceptedPackage(
  operations: MemoryOperationsRepository,
  operationsService: OperationsApplicationService,
  context: { correlationId: string; userId: string; workspaceId: string },
) {
  const sourceRef = {
    advancedCanvas: {
      orderedMediaNodeIds: ['image-1'],
      projectId: 'advanced-project-1',
      revisionId: 'advanced-revision-1',
      schemaVersion: 1 as const,
      selectedNodeIds: ['text-1', 'image-1'],
    },
  };
  const created = await operationsService.createContentPackage(
    { ...context, actor: 'owner' },
    { kind: 'image_text', source: { assetIds: ['asset-1'] } },
  );
  const state = await operations.loadWorkspace(context.workspaceId);
  assert.ok(state);
  const draft = state.contentPackages.find((item) => item.id === created.id);
  assert.ok(draft);
  const versionId = `${created.id}-v1`;
  const version = contentPackageVersionSchema.parse({
    body: '画布采用正文：今日猫眼美甲',
    createdAt: NOW,
    id: versionId,
    orderedAssetIds: ['asset-1'],
    sourceRef,
    title: '画布采用标题',
    topics: ['美业'],
  });
  const accepted = transitionContentPackage(
    { ...draft, status: 'review_ready' },
    {
      type: 'adopted',
      version,
    },
    NOW,
  );
  state.contentPackages = state.contentPackages.map((item) =>
    item.id === accepted.id ? accepted : item,
  );
  await operations.saveWorkspace(state);
  return accepted;
}

describe('ticket 13 advanced canvas package library lifecycle', () => {
  it('exports an advanced-canvas package through the internal service and rejects direct copying', async () => {
    let exportEffects = 0;
    const contentPackageExporter: ContentPackageExportPort = {
      async export() {
        exportEffects += 1;
        return {
          artifactAssetId: 'owned-export-zip',
          artifactObjectKey: 'workspace-advanced-canvas/exports/package.zip',
          contentType: 'application/zip',
          sha256: 'c'.repeat(64),
          sizeBytes: 256,
        };
      },
    };
    const { context, operations, operationsService } = setup({
      contentPackageExporter,
    });
    const source = await seedAdvancedCanvasAcceptedPackage(
      operations,
      operationsService,
      context,
    );

    assert.equal(
      source.versions[0]?.sourceRef?.advancedCanvas?.projectId,
      'advanced-project-1',
    );

    const state = await operations.loadWorkspace(context.workspaceId);
    assert.ok(state);
    const stored = state.contentPackages.find((item) => item.id === source.id);
    assert.ok(stored);
    stored.variants = (['xiaohongshu', 'douyin', 'video_account'] as const).map(
      (platform) => {
        const versionId = `${platform}-export-v1`;
        return {
          currentVersionId: versionId,
          id: `${stored.id}-${platform}`,
          platform,
          versions: [
            {
              body: `${platform} 导出正文`,
              createdAt: NOW,
              id: versionId,
              orderedAssetIds: ['asset-1'],
              title: `${platform} 导出标题`,
              topics: ['美业'],
            },
          ],
        };
      },
    );
    await operations.saveWorkspace(state);

    const exported = await operationsService.exportContentPackage(
      context,
      {
        expectedRevision: stored.revision,
        packageId: source.id,
        platform: 'xiaohongshu',
      },
    );

    assert.equal(exportEffects, 1);
    assert.equal(exported.status, 'accepted');
    assert.equal(exported.exportReceipts.length, 1);

    await assert.rejects(
      operationsService.reuseContentPackage(
        context,
        { sourcePackageId: source.id },
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'REUSE_TASK_REQUIRED'
    );
  });
});
