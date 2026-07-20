import assert from 'node:assert/strict';
import test from 'node:test';
import type { CreativeJob } from '@meiye/contracts';
import { QueryClient } from '@tanstack/react-query';
import { p1QueryKeys } from '@/p1/query-keys';
import {
  creativeJobObservation,
  isComposedVideoObservation,
  mergeVideoWorkflowList,
  providerTerminalResumeKey,
  refreshCreativeJobCanonicalState,
  refreshCreativeJobCanonicalStateOnVideoWorkflowChange,
  runTerminalRecoveryOnce,
  shouldPollVideoWorkflowList,
} from './creative-job-observer';

function job(overrides: Partial<CreativeJob> = {}): CreativeJob {
  return {
    contract: {
      aigcLabelEnabled: true,
      catalogModelId: 'fixture-image',
      catalogRevision: 'catalog-1',
      currency: 'CNY',
      dataClass: [],
      estimatedAmount: 1,
      operation: 'image.generate',
      outputCount: 1,
      outputLabel: '1 张图片',
      quoteAcceptedAt: '2026-07-13T00:00:00.000Z',
      quoteRevision: 'quote-1',
      watermarkEnabled: false,
    },
    createdAt: '2026-07-13T00:00:00.000Z',
    id: 'creative-job-1',
    outputAssetIds: [],
    outputContentIds: [],
    providerJobId: 'provider-job-1',
    status: 'running',
    submissionKey: 'submission-1',
    updatedAt: '2026-07-13T00:00:01.000Z',
    workId: 'work-1',
    workspaceId: 'workspace-1',
    ...overrides,
  };
}

test('only active image and video jobs with provider ids are observed', () => {
  assert.deepEqual(creativeJobObservation(job()), {
    creativeJobId: 'creative-job-1',
    operation: 'image.generate',
    providerJobId: 'provider-job-1',
    status: 'running',
    workId: 'work-1',
  });
  assert.equal(
    creativeJobObservation(
      job({ contract: { ...job().contract, operation: 'copy.generate' } })
    ),
    undefined
  );
  assert.equal(
    creativeJobObservation(job({ providerJobId: undefined })),
    undefined
  );
  assert.equal(creativeJobObservation(job({ status: 'completed' })), undefined);
});

test('recognizes only canonical composed-video workflow observations', () => {
  assert.equal(
    isComposedVideoObservation({
      creativeJobId: 'creative-job-video-1',
      operation: 'video.generate',
      providerJobId: 'video-workflow-canonical-1',
      status: 'running',
      workId: 'work-video-1',
    }),
    true
  );
  assert.equal(
    isComposedVideoObservation({
      operation: 'image.generate',
      providerJobId: 'video-workflow-canonical-1',
      status: 'running',
      workId: 'work-image-1',
    }),
    false
  );
});

test('terminal resume keys are stable and exclude active provider states', () => {
  assert.equal(
    providerTerminalResumeKey('creative-job-1', 'completed'),
    'resume-observed-creative-job-1-completed'
  );
  assert.equal(
    providerTerminalResumeKey('creative-job-1', 'cancelled'),
    'resume-observed-creative-job-1-cancelled'
  );
  assert.equal(
    providerTerminalResumeKey('creative-job-1', 'running'),
    undefined
  );
});

test('terminal recovery shares one attempt and retries only when explicitly requested', async () => {
  const key = `terminal-recovery-${crypto.randomUUID()}`;
  const failure = new Error('temporary recovery failure');
  let attempts = 0;
  let releaseFailure: (() => void) | undefined;
  const failureGate = new Promise<void>((resolve) => {
    releaseFailure = resolve;
  });
  const recover = async () => {
    attempts += 1;
    await failureGate;
    throw failure;
  };

  const first = runTerminalRecoveryOnce(key, recover);
  const second = runTerminalRecoveryOnce(key, recover);
  assert.equal(first, second);
  assert.equal(attempts, 0);
  releaseFailure?.();
  await assert.rejects(first, failure);
  await assert.rejects(second, failure);
  assert.equal(attempts, 1);

  await assert.rejects(
    runTerminalRecoveryOnce(key, async () => {
      attempts += 1;
    }),
    failure
  );
  assert.equal(attempts, 1);

  await runTerminalRecoveryOnce(
    key,
    async () => {
      attempts += 1;
    },
    { retryFailed: true }
  );
  await runTerminalRecoveryOnce(key, async () => {
    attempts += 1;
  });
  assert.equal(attempts, 2);
});

test('video status refresh invalidates every content package projection cache', async () => {
  const queryClient = new QueryClient();
  const contentPackagesKey = p1QueryKeys.request(
    'operations',
    'content_packages'
  );
  const filteredContentPackagesKey = p1QueryKeys.request(
    'operations',
    'content_packages',
    { status: 'generating' }
  );
  const unrelatedKey = p1QueryKeys.request('model-supply', 'video_workflows');
  queryClient.setQueryData(contentPackagesKey, []);
  queryClient.setQueryData(filteredContentPackagesKey, []);
  queryClient.setQueryData(unrelatedKey, []);

  await refreshCreativeJobCanonicalState(queryClient);

  assert.equal(
    queryClient.getQueryState(contentPackagesKey)?.isInvalidated,
    true
  );
  assert.equal(
    queryClient.getQueryState(filteredContentPackagesKey)?.isInvalidated,
    true
  );
  assert.equal(queryClient.getQueryState(unrelatedKey)?.isInvalidated, false);
});

test('video workflow status changes refresh content packages while unchanged ticks do not', async () => {
  const queryClient = new QueryClient();
  const contentPackagesKey = p1QueryKeys.request(
    'operations',
    'content_packages'
  );
  const running = [{ workflow: { id: 'video-workflow-a', status: 'running' } }];
  const completed = [
    { workflow: { id: 'video-workflow-a', status: 'completed' } },
  ];
  queryClient.setQueryData(contentPackagesKey, []);

  await refreshCreativeJobCanonicalStateOnVideoWorkflowChange(
    queryClient,
    running,
    completed
  );

  assert.equal(
    queryClient.getQueryState(contentPackagesKey)?.isInvalidated,
    true
  );

  queryClient.setQueryData(contentPackagesKey, []);
  await refreshCreativeJobCanonicalStateOnVideoWorkflowChange(
    queryClient,
    completed,
    completed
  );

  assert.equal(
    queryClient.getQueryState(contentPackagesKey)?.isInvalidated,
    false
  );
});

test('the shared composed-video list polls only while a workflow can advance', () => {
  const envelope = (input: {
    jobStatus: 'failed' | 'running';
    workflowStatus: 'completed' | 'draft' | 'running';
  }) => ({
    job:
      input.workflowStatus === 'draft'
        ? null
        : {
            createdAt: '2026-07-13T00:00:00.000Z',
            jobId: 'video-job-a',
            status: input.jobStatus,
            updatedAt: '2026-07-13T00:01:00.000Z',
          },
    workflow: {
      actorId: 'owner-a',
      aigcLabelEnabled: true,
      catalogModelId: 'seedance-2',
      confirmed: input.workflowStatus !== 'draft',
      createdAt: '2026-07-13T00:00:00.000Z',
      id: 'video-workflow-a',
      revision: 1,
      shots: [],
      status: input.workflowStatus,
      storyboardRevision: 'storyboard-a',
      storyboardVersion: 1,
      updatedAt: '2026-07-13T00:01:00.000Z',
      workId: 'work-a',
      workspaceId: 'workspace-a',
    },
  });

  assert.equal(shouldPollVideoWorkflowList(undefined), true);
  assert.equal(
    shouldPollVideoWorkflowList([
      envelope({ jobStatus: 'running', workflowStatus: 'draft' }),
    ]),
    true
  );
  assert.equal(
    shouldPollVideoWorkflowList([
      envelope({ jobStatus: 'running', workflowStatus: 'running' }),
    ]),
    true
  );
  assert.equal(
    shouldPollVideoWorkflowList([
      envelope({ jobStatus: 'failed', workflowStatus: 'running' }),
    ]),
    false
  );
  assert.equal(
    shouldPollVideoWorkflowList([
      envelope({ jobStatus: 'running', workflowStatus: 'completed' }),
    ]),
    false
  );
});

test('an individual workflow cache update wakes and replaces the shared list fact', () => {
  const envelope = {
    job: null,
    workflow: {
      actorId: 'owner-a',
      aigcLabelEnabled: true,
      catalogModelId: 'seedance-2',
      confirmed: false,
      createdAt: '2026-07-13T00:00:00.000Z',
      id: 'video-workflow-a',
      revision: 1,
      shots: [],
      status: 'draft' as const,
      storyboardRevision: 'storyboard-a',
      storyboardVersion: 1,
      updatedAt: '2026-07-13T00:01:00.000Z',
      workId: 'work-a',
      workspaceId: 'workspace-a',
    },
  };
  const confirmed = {
    ...envelope,
    job: {
      createdAt: '2026-07-13T00:02:00.000Z',
      jobId: 'video-job-a',
      status: 'queued' as const,
      updatedAt: '2026-07-13T00:02:00.000Z',
    },
    workflow: {
      ...envelope.workflow,
      confirmed: true,
      revision: 2,
      status: 'running' as const,
      updatedAt: '2026-07-13T00:02:00.000Z',
    },
  };

  assert.deepEqual(mergeVideoWorkflowList(undefined, envelope), [envelope]);
  assert.deepEqual(mergeVideoWorkflowList([envelope], confirmed), [confirmed]);
});
