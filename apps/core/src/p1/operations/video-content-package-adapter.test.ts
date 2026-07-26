import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  VideoContentPackageConfirmation,
  VideoContentPackageOutcome,
} from '../video-content-package-port.js';
import {
  MemoryOperationsRepository,
  OperationsApplicationService,
  RecordedCanvasExportAdapter,
  RecordedImageGenerationAdapter,
} from './index.js';
import { OperationsVideoContentPackageAdapter } from './video-content-package-adapter.js';

const confirmation: VideoContentPackageConfirmation = {
  actorId: 'owner-1',
  aigcLabelEnabled: true,
  catalogModelId: 'seedance-2',
  dataClass: ['contains_face'],
  executionContract: {
    aigcLabelEnabled: true,
    aspectRatio: '9:16',
    catalogModelId: 'seedance-2',
    catalogRevision: 'catalog-video-v1',
    currency: 'CNY',
    dataClass: ['contains_face'],
    durationSeconds: 15,
    estimatedAmount: 12,
    operation: 'video.generate',
    outputCount: 1,
    outputLabel: '15 second video',
    quoteAcceptedAt: '2026-07-18T00:00:00.000Z',
    quoteRevision: 'quote-video-v1',
    watermarkEnabled: false,
  },
  referenceAssetIds: [],
  shots: [{ id: 'opening', prompt: 'Show the service.' }],
  storyboardRevision: 'storyboard-v1',
  storyboardVersion: 1,
  workflowId: 'workflow-1',
  workspaceId: 'workspace-1',
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
    service,
  };
}

describe('video ContentPackage lifecycle adapter', () => {
  it('delegates confirmation with trusted workspace context', async () => {
    const calls: unknown[] = [];
    const service = {
      async confirmVideoContentPackage(context: unknown, input: unknown) {
        calls.push({ context, input });
      },
    } as unknown as OperationsApplicationService;
    const adapter = new OperationsVideoContentPackageAdapter(() => service);

    await adapter.confirm(confirmation);

    assert.deepEqual(calls, [
      {
        context: {
          actor: 'owner',
          correlationId: 'video-content-package:workflow-1:confirm',
          userId: 'owner-1',
          workspaceId: 'workspace-1',
        },
        input: confirmation,
      },
    ]);
  });

  it('delegates review, failure, and cancellation outcomes without assembly fields', async () => {
    const calls: unknown[] = [];
    const service = {
      async reconcileVideoContentPackage(context: unknown, input: unknown) {
        calls.push({ context, input });
      },
    } as unknown as OperationsApplicationService;
    const adapter = new OperationsVideoContentPackageAdapter(() => service);
    const outcomes: VideoContentPackageOutcome[] = [
      {
        actorId: 'owner-1',
        status: 'awaiting_quality_review',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      {
        actorId: 'owner-1',
        failureCode: 'VIDEO_PROVIDER_FAILED',
        status: 'failed',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      {
        actorId: 'owner-1',
        status: 'cancelled',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
    ];

    for (const outcome of outcomes) {
      await adapter.reconcile(outcome);
    }

    assert.deepEqual(
      calls.map((call) => (call as { input: VideoContentPackageOutcome }).input),
      outcomes,
    );
  });

  it('settles confirm through failure without creating an empty version', async () => {
    const { adapter, context, service } = setup();
    const workflowId = 'workflow-reference-failed';
    await adapter.confirm({ ...confirmation, workflowId });
    const failure = {
      actorId: confirmation.actorId,
      failureCode: 'REFERENCE_ASSET_RESOLUTION_REQUIRED',
      status: 'failed' as const,
      workflowId,
      workspaceId: confirmation.workspaceId,
    };

    await adapter.reconcile(failure);
    await adapter.reconcile(failure);

    const contentPackage = (await service.listContentPackages(context)).find(
      (item) => item.source.workflowId === workflowId,
    );
    assert.ok(contentPackage);
    assert.equal(contentPackage.status, 'needs_input');
    assert.equal(contentPackage.statusGroup, 'needs_attention');
    assert.deepEqual(contentPackage.versions, []);
    assert.deepEqual(contentPackage.generated.childRuns, [
      {
        failureCode: failure.failureCode,
        runId: workflowId,
        runType: 'durable_video_workflow',
        status: 'failed',
      },
    ]);
  });

  it('settles quality review through terminal failure exactly once', async () => {
    const { adapter, context, service } = setup();
    const workflowId = 'workflow-review-then-failed';
    await adapter.confirm({ ...confirmation, workflowId });
    await adapter.reconcile({
      actorId: confirmation.actorId,
      status: 'awaiting_quality_review',
      workflowId,
      workspaceId: confirmation.workspaceId,
    });
    const review = (await service.listContentPackages(context)).find(
      (item) => item.source.workflowId === workflowId,
    );
    assert.ok(review);
    assert.equal(review.status, 'needs_input');

    const failure = {
      actorId: confirmation.actorId,
      failureCode: 'VIDEO_ASSET_TECHNICAL_VALIDATION_FAILED',
      status: 'failed' as const,
      workflowId,
      workspaceId: confirmation.workspaceId,
    };
    await adapter.reconcile(failure);
    await adapter.reconcile(failure);

    const terminal = (await service.listContentPackages(context)).find(
      (item) => item.source.workflowId === workflowId,
    );
    assert.ok(terminal);
    assert.equal(terminal.status, 'needs_input');
    assert.deepEqual(terminal.generated.childRuns, [
      {
        failureCode: failure.failureCode,
        runId: workflowId,
        runType: 'durable_video_workflow',
        status: 'failed',
      },
    ]);
  });

  it('settles confirm through cancellation without a playable version', async () => {
    const { adapter, context, service } = setup();
    const workflowId = 'workflow-cancelled';
    await adapter.confirm({ ...confirmation, workflowId });
    const cancellation = {
      actorId: confirmation.actorId,
      status: 'cancelled' as const,
      workflowId,
      workspaceId: confirmation.workspaceId,
    };

    await adapter.reconcile(cancellation);
    await adapter.reconcile(cancellation);

    const contentPackage = (await service.listContentPackages(context)).find(
      (item) => item.source.workflowId === workflowId,
    );
    assert.ok(contentPackage);
    assert.equal(contentPackage.status, 'cancelled');
    assert.equal(contentPackage.statusGroup, 'needs_attention');
    assert.deepEqual(contentPackage.versions, []);
    assert.equal(contentPackage.generated.childRuns[0]?.status, 'cancelled');
  });
});
