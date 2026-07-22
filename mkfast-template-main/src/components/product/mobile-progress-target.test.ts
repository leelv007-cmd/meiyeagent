import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  CreativeOperation,
  CreativeWorkbenchProjection,
} from '@meiye/contracts';

import { mobileProgressTarget } from './mobile-progress-target';

function activeProjection(input: {
  operation: CreativeOperation;
  updatedAt?: string;
  workId?: string;
}): CreativeWorkbenchProjection {
  const workId = input.workId ?? `work-${input.operation}`;
  const updatedAt = input.updatedAt ?? '2026-07-22T09:01:00.000Z';
  return {
    assets: [],
    contents: [],
    events: [],
    jobs: [
      {
        id: `job-${workId}`,
        workspaceId: 'workspace-1',
        workId,
        status: 'running',
        contract: {
          operation: input.operation,
          catalogModelId: 'merchant-visible-model-is-not-used-here',
          catalogRevision: 'catalog-1',
          quoteRevision: 'quote-1',
          quoteAcceptedAt: updatedAt,
          outputLabel: '输出',
          estimatedAmount: 1,
          currency: 'CNY',
          outputCount: 1,
          dataClass: [],
          watermarkEnabled: true,
          aigcLabelEnabled: true,
        },
        submissionKey: `submission-${workId}`,
        outputAssetIds: [],
        outputContentIds: [],
        createdAt: updatedAt,
        updatedAt,
      },
    ],
    works: [
      {
        id: workId,
        workspaceId: 'workspace-1',
        sessionId: 'session-1',
        intent: '真实进行中的商家创作',
        mode: 'direct',
        operation: input.operation,
        sourceReferences: [],
        status: 'running',
        currentJobId: `job-${workId}`,
        createdAt: updatedAt,
        updatedAt,
      },
    ],
  };
}

test('mobile progress stays unavailable until the canonical Work projection resolves', () => {
  assert.deepEqual(mobileProgressTarget(undefined), { kind: 'loading' });
});

test('mobile progress enters the exact Result route for a running Copy Work', () => {
  assert.deepEqual(
    mobileProgressTarget(
      activeProjection({ operation: 'copy.generate', workId: 'work-copy' })
    ),
    { kind: 'result', workId: 'work-copy' }
  );
});

test('mobile progress includes every Result-renderable Work operation', () => {
  const operations: readonly CreativeOperation[] = [
    'copy.generate',
    'copy.adapt',
    'image.generate',
    'image.edit',
    'video.generate',
    'audio.speech',
    'audio.sfx',
  ];

  for (const operation of operations) {
    assert.deepEqual(
      mobileProgressTarget(
        activeProjection({ operation, workId: `work-${operation}` })
      ),
      { kind: 'result', workId: `work-${operation}` },
      `${operation} must retain its exact Result target`
    );
  }
});

test('mobile progress uses the real task center only after the canonical projection has no active Work', () => {
  const projection = activeProjection({ operation: 'copy.generate' });
  projection.works[0]!.status = 'completed';
  projection.jobs[0]!.status = 'completed';

  assert.deepEqual(mobileProgressTarget(projection), {
    kind: 'task-center',
  });
});
