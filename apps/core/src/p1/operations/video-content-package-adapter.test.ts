import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MemoryOperationsRepository,
  OperationsApplicationService,
  RecordedCanvasExportAdapter,
  RecordedImageGenerationAdapter,
} from './index.js';
import { OperationsVideoContentPackageAdapter } from './video-content-package-adapter.js';

const confirmation = {
  actorId: 'owner-video',
  aigcLabelEnabled: true,
  catalogModelId: 'seedance-2',
  dataClass: ['contains_face'],
  referenceAssetIds: ['asset-storefront', 'asset-treatment-room'],
  shots: [{ id: 'opening', prompt: '门店开场' }],
  storyboardRevision: 'storyboard-v1',
  storyboardVersion: 1,
  workflowId: 'workflow-video-1',
  workspaceId: 'workspace-video',
  workId: 'work-video-1',
};

function setup() {
  const repository = new MemoryOperationsRepository();
  repository.grantMembership(confirmation.actorId, confirmation.workspaceId);
  const service = new OperationsApplicationService(repository, {
    canvasExporter: new RecordedCanvasExportAdapter(),
    imageGenerator: new RecordedImageGenerationAdapter(),
    notifier: { async send() {} },
    clock: () => new Date('2026-07-15T10:00:00.000Z'),
  });
  return {
    adapter: new OperationsVideoContentPackageAdapter(() => service),
    context: {
      actor: 'owner' as const,
      correlationId: 'video-package-test',
      userId: confirmation.actorId,
      workspaceId: confirmation.workspaceId,
    },
    repository,
    service,
  };
}

describe('video ContentPackage lifecycle adapter', () => {
  it('moves a failed video workflow to needs input without creating an empty version', async () => {
    const { adapter, context, service } = setup();
    await adapter.confirm({
      ...confirmation,
      workflowId: 'workflow-reference-failed',
    });
    const failure = {
      actorId: confirmation.actorId,
      failureCode: 'reference_asset_resolution_required',
      status: 'failed' as const,
      workflowId: 'workflow-reference-failed',
      workspaceId: confirmation.workspaceId,
    };

    await adapter.reconcile(failure);
    await adapter.reconcile(failure);

    const contentPackage = (await service.listContentPackages(context)).find(
      (item) => item.source.workflowId === failure.workflowId
    );
    assert.ok(contentPackage);
    assert.equal(contentPackage.status, 'needs_input');
    assert.equal(contentPackage.statusGroup, 'needs_attention');
    assert.equal(contentPackage.generated.childRuns[0]?.status, 'failed');
    assert.equal(
      contentPackage.generated.childRuns[0]?.failureCode,
      failure.failureCode,
    );
    assert.deepEqual(contentPackage.generated.ownedAssets, undefined);
    assert.deepEqual(contentPackage.versions, []);
  });

  it('records a terminal failure after quality review without duplicating the child run', async () => {
    const { adapter, context, service } = setup();
    await adapter.confirm({
      ...confirmation,
      workflowId: 'workflow-review-then-failed',
    });
    await adapter.reconcile({
      actorId: confirmation.actorId,
      status: 'awaiting_quality_review',
      workflowId: 'workflow-review-then-failed',
      workspaceId: confirmation.workspaceId,
    });
    const failure = {
      actorId: confirmation.actorId,
      failureCode: 'COMPOSED_VIDEO_TECHNICAL_VALIDATION_FAILED',
      status: 'failed' as const,
      workflowId: 'workflow-review-then-failed',
      workspaceId: confirmation.workspaceId,
    };

    await adapter.reconcile(failure);
    await adapter.reconcile(failure);

    const contentPackage = (await service.listContentPackages(context)).find(
      (item) => item.source.workflowId === failure.workflowId,
    );
    assert.ok(contentPackage);
    assert.equal(contentPackage.status, 'needs_input');
    assert.deepEqual(contentPackage.generated.childRuns, [
      {
        failureCode: failure.failureCode,
        runId: failure.workflowId,
        runType: 'durable_video_workflow',
        status: 'failed',
      },
    ]);
  });

  it('creates one package on confirm and advances review to one owned first version', async () => {
    const { adapter, context, repository, service } = setup();
    await service.createContentPackage(context, {
      kind: 'image_text',
      source: { assetIds: ['image-source'] },
    });

    await adapter.confirm(confirmation);
    await adapter.confirm(confirmation);

    let packages = await service.listContentPackages(context);
    assert.equal(packages.length, 2);
    const creating = packages.find((item) => item.kind === 'video');
    assert.ok(creating);
    assert.equal(creating.status, 'generating');
    assert.equal(creating.statusGroup, 'creating');
    assert.equal(creating.source.workflowId, confirmation.workflowId);
    assert.equal(creating.source.storyboardRevision, 'storyboard-v1');
    assert.deepEqual(creating.source.dataClass, ['contains_face']);
    assert.deepEqual(creating.source.assetIds, confirmation.referenceAssetIds);
    assert.equal(creating.generated.childRuns[0]?.runId, confirmation.workflowId);

    await adapter.reconcile({
      actorId: confirmation.actorId,
      status: 'awaiting_quality_review',
      workflowId: confirmation.workflowId,
      workspaceId: confirmation.workspaceId,
    });
    const needsReview = await service.getContentPackage(context, creating.id);
    assert.equal(needsReview.status, 'needs_input');
    assert.equal(needsReview.statusGroup, 'needs_attention');

    const completed = {
      actorId: confirmation.actorId,
      clipAssetIds: ['owned-clip-opening'],
      composedAsset: {
        contentType: 'video/mp4' as const,
        id: 'owned-composed-video',
        objectKey: 'workspace-video/composed/final.mp4',
        sha256: 'sha256-composed-video',
      },
      shots: confirmation.shots,
      status: 'completed' as const,
      storyboardRevision: confirmation.storyboardRevision,
      workflowId: confirmation.workflowId,
      workspaceId: confirmation.workspaceId,
    };
    await adapter.reconcile(completed);
    await adapter.reconcile(completed);

    packages = await service.listContentPackages(context);
    const usable = packages.find((item) => item.kind === 'video');
    assert.ok(usable);
    assert.equal(usable.status, 'accepted');
    assert.equal(usable.statusGroup, 'usable');
    assert.equal(usable.versions.length, 1);
    assert.deepEqual(usable.versions[0]?.orderedAssetIds, [
      'owned-composed-video',
    ]);
    assert.deepEqual(usable.generated.ownedAssets, [completed.composedAsset]);
    assert.deepEqual(usable.generated.childRuns[0]?.assetIds, [
      'owned-clip-opening',
    ]);

    const state = await repository.loadWorkspace(confirmation.workspaceId);
    assert.ok(state);
    assert.equal(state.creativeContents.length, 0);
  });

  it('cancels without creating a playable version and rejects temporary provider URLs', async () => {
    const { adapter, context, service } = setup();
    await adapter.confirm({ ...confirmation, workflowId: 'workflow-cancelled' });
    await adapter.reconcile({
      actorId: confirmation.actorId,
      status: 'cancelled',
      workflowId: 'workflow-cancelled',
      workspaceId: confirmation.workspaceId,
    });
    const cancelled = (await service.listContentPackages(context)).find(
      (item) => item.source.workflowId === 'workflow-cancelled',
    );
    assert.ok(cancelled);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.statusGroup, 'needs_attention');
    assert.equal(cancelled.versions.length, 0);

    await adapter.confirm({ ...confirmation, workflowId: 'workflow-temp-url' });
    await assert.rejects(
      adapter.reconcile({
        actorId: confirmation.actorId,
        clipAssetIds: [],
        composedAsset: {
          contentType: 'video/mp4',
          id: 'provider-video',
          objectKey: 'https://provider.example/video.mp4',
          sha256: 'provider-sha',
        },
        shots: confirmation.shots,
        status: 'completed',
        storyboardRevision: confirmation.storyboardRevision,
        workflowId: 'workflow-temp-url',
        workspaceId: confirmation.workspaceId,
      }),
      /owned object key/i,
    );
  });
});
