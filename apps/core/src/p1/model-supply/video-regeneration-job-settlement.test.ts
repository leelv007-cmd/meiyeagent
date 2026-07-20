import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COMPOSED_VIDEO_JOB_KIND,
  ComposedVideoJobEffect,
  DurableComposedVideoApplicationService,
  type ComposedVideoWorkflowRunnerPort,
} from './composed-video-workflow.js';
import type { DurableVideoWorkflow } from './video-workflow-contract.js';

describe('video regeneration worker settlement', () => {
  it('notifies the durable billing observer after content-package reconciliation, including replay', async () => {
    const order: string[] = [];
    const delivered = new Set<string>();
    const workflow = {
      actorId: 'owner-1',
      aigcLabelEnabled: true,
      attempts: [],
      catalogModelId: 'seedance-2',
      clipAssets: [],
      confirmed: true,
      createdAt: '2026-07-20T00:00:00.000Z',
      dataClass: [],
      failureCode: 'VIDEO_PROVIDER_FAILED',
      id: 'regen-task-1',
      revision: 2,
      shots: [],
      status: 'failed',
      storyboardRevision: 'story-1',
      storyboardVersion: 1,
      updatedAt: '2026-07-20T00:01:00.000Z',
      workspaceId: 'workspace-1',
    } as DurableVideoWorkflow;
    const runner = {
      async runVideoWorkflow() {
        return structuredClone(workflow);
      },
    } as unknown as ComposedVideoWorkflowRunnerPort;
    const effect = new ComposedVideoJobEffect(
      () => runner,
      {
        async confirm() {},
        async reconcile(input) {
          if (!delivered.has(input.workflowId)) {
            delivered.add(input.workflowId);
            order.push('content-package');
          }
        },
      },
      {
        async settle(terminal) {
          order.push(`billing:${terminal.status}`);
        },
      },
    );
    const request = {
      effectIdempotencyKey: 'effect-1',
      idempotencyKey: 'job-1',
      jobId: 'job-1',
      kind: COMPOSED_VIDEO_JOB_KIND,
      payload: { workflowId: workflow.id },
      workspaceId: workflow.workspaceId,
    };

    await effect.execute(request);
    await effect.reconcile(request);

    assert.deepEqual(order, [
      'content-package',
      'billing:failed',
      'billing:failed',
    ]);
  });

  it('settles a completed single-shot candidate without writing ContentPackage', async () => {
    const calls: string[] = [];
    const workflow = {
      actorId: 'owner-1',
      aigcLabelEnabled: true,
      attempts: [],
      catalogModelId: 'seedance-2',
      clipAssets: [],
      composedAsset: {
        compositionEvidence: {},
        contentType: 'video/mp4',
        id: 'candidate-video-1',
        objectKey: 'candidate-video-1.mp4',
        sha256: 'a'.repeat(64),
        sizeBytes: 1,
      },
      confirmed: true,
      createdAt: '2026-07-20T00:00:00.000Z',
      dataClass: [],
      deliveryMode: 'candidate_only',
      id: 'regen-shot-1',
      revision: 2,
      routeSnapshot: {},
      shots: [],
      status: 'completed',
      storyboardRevision: 'story-1',
      storyboardVersion: 1,
      updatedAt: '2026-07-20T00:01:00.000Z',
      workspaceId: 'workspace-1',
    } as unknown as DurableVideoWorkflow;
    const runner = {
      async getVideoWorkflow() {
        return workflow;
      },
      async runVideoWorkflow() {
        return workflow;
      },
    } as unknown as ComposedVideoWorkflowRunnerPort;
    const contentPackages = {
      async confirm() {
        calls.push('confirm');
      },
      async reconcile() {
        calls.push('reconcile');
      },
    };
    const effect = new ComposedVideoJobEffect(
      () => runner,
      contentPackages,
      {
        async settle() {
          calls.push('billing');
        },
      },
    );

    const outcome = await effect.execute({
      effectIdempotencyKey: 'effect-shot',
      idempotencyKey: 'job-shot',
      jobId: 'job-shot',
      kind: COMPOSED_VIDEO_JOB_KIND,
      payload: { workflowId: workflow.id },
      workspaceId: workflow.workspaceId,
    });

    assert.equal(outcome.delivery, 'completed');
    assert.deepEqual(calls, ['billing']);

    const application = new DurableComposedVideoApplicationService({
      contentPackages,
      jobs: {
        async cancel() {
          throw new Error('not used');
        },
        async get() {
          throw new Error('not used');
        },
        async submit() {
          throw new Error('not used');
        },
      },
      runnerForWorkspace: () => runner,
    });
    await application.adoptCandidate({
      workflowId: workflow.id,
      workspaceId: workflow.workspaceId,
    });
    assert.deepEqual(calls, ['billing', 'confirm', 'reconcile']);
  });
});
