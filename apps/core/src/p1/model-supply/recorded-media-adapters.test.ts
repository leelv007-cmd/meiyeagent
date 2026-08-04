import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { recordedRequest } from './adapters.js';
import {
  RECORDED_MEDIA_ADAPTER_CONTRACTS,
  RecordedAdapterRouter,
  RecordedMediaAdapterError,
  createRecordedMediaAdapter,
  defaultRecordedMediaAdapters,
} from './recorded-media-adapters.js';
import { resetSharedRecordedHealthOverlay } from '../supply-registry/health-overlay.js';

beforeEach(() => {
  resetSharedRecordedHealthOverlay();
});

const recordedMediaCatalog = [
  'gpt-image-2',
  'nano-banana-2',
  'nano-banana-pro',
  'seedream-4-5',
  'seedream-5-pro',
  'seedance-1-5-pro',
  'seedance-2',
  'kling-latest',
  'grok-latest-video',
  'veo-latest',
  'audio-speech-fixture',
  'audio-sfx-fixture',
] as const;

test('default factory preserves the recorded media catalog and order', () => {
  assert.deepEqual(
    defaultRecordedMediaAdapters().map((adapter) => {
      assert.ok('catalogModelId' in adapter);
      return adapter.catalogModelId;
    }),
    recordedMediaCatalog,
  );
});

test('router dispatches image, video, and audio model families', async () => {
  const router = new RecordedAdapterRouter();
  for (const scenario of [
    {
      contentType: 'image/png',
      input: { height: 1024, width: 1024 },
      modelId: 'gpt-image-2',
      operation: 'image.generate',
    },
    {
      contentType: 'video/mp4',
      input: { durationSeconds: 5 },
      modelId: 'seedance-2',
      operation: 'video.generate',
    },
    {
      contentType: 'audio/wav',
      input: {
        format: 'wav',
        language: 'zh-CN',
        maxDurationSeconds: 30,
        speed: 1,
        tone: 'natural',
        voice: 'recorded-voice',
      },
      modelId: 'audio-speech-fixture',
      operation: 'audio.speech',
    },
  ] as const) {
    const response = await router.execute(
      recordedRequest(scenario.modelId, scenario.operation, scenario.input),
    );
    assert.equal(response.kind, 'completed');
    if (response.kind === 'completed') {
      assert.equal(response.contentType, scenario.contentType);
    }
  }
});

test('one adapter per media family completes submit, poll, and download', async () => {
  for (const scenario of [
    {
      contentType: 'image/png',
      input: { height: 1024, width: 1024 },
      modelId: 'seedream-4-5',
      operation: 'image.generate',
    },
    {
      contentType: 'video/mp4',
      input: { durationSeconds: 5 },
      modelId: 'kling-latest',
      operation: 'video.generate',
    },
    {
      contentType: 'audio/wav',
      input: { durationSeconds: 2, format: 'wav' },
      modelId: 'audio-sfx-fixture',
      operation: 'audio.sfx',
    },
  ] as const) {
    const router = new RecordedAdapterRouter([
      createRecordedMediaAdapter(scenario.modelId),
    ]);
    const request = {
      ...recordedRequest(
        scenario.modelId,
        scenario.operation,
        scenario.input,
      ),
      effectIdempotencyKey: `happy-${scenario.modelId}`,
    };
    const submitted = await router.submit(request);
    assert.equal(submitted.acceptance, 'accepted');
    assert.ok(submitted.taskRef);
    const polled = await router.poll({
      ...request,
      taskRef: submitted.taskRef ?? '',
    });
    assert.equal(polled.status, 'completed');
    const downloaded = await router.download({
      ...request,
      taskRef: submitted.taskRef ?? '',
    });
    assert.equal(downloaded.contentType, scenario.contentType);
    assert.ok(downloaded.bytes.byteLength > 0);
  }
});

test('submit, poll, download, and cancel replay their declared error codes', async () => {
  const contract = RECORDED_MEDIA_ADAPTER_CONTRACTS['veo-latest'];
  const expectedCodes = {
    cancel: 'cancel_pending',
    download: 'download_failed',
    poll: 'logical_timeout',
    submit: 'region_unavailable',
  } as const;
  for (const [phase, code] of Object.entries(expectedCodes)) {
    assert.ok(
      contract.errorContracts.some(
        (candidate) => candidate.phase === phase && candidate.code === code,
      ),
    );
  }

  const submitAdapter = createRecordedMediaAdapter('veo-latest');
  const submitRequest = recordedRequest('veo-latest', 'video.generate', {
    durationSeconds: 5,
  });
  submitAdapter.setNextErrorCode(expectedCodes.submit);
  await assert.rejects(
    submitAdapter.submit(submitRequest),
    (error: unknown) =>
      error instanceof RecordedMediaAdapterError &&
      error.code === expectedCodes.submit,
  );

  const pollAdapter = createRecordedMediaAdapter('veo-latest');
  const pollRequest = recordedRequest('veo-latest', 'video.generate', {
    durationSeconds: 5,
  });
  const pollTask = await pollAdapter.submit(pollRequest);
  pollAdapter.setNextErrorCode(expectedCodes.poll);
  const polled = await pollAdapter.poll(pollTask.taskRef, pollRequest);
  assert.equal(polled.status, 'failed');
  assert.equal(polled.errorCode, expectedCodes.poll);

  const downloadAdapter = createRecordedMediaAdapter('veo-latest');
  const downloadRequest = recordedRequest('veo-latest', 'video.generate', {
    durationSeconds: 5,
  });
  const downloadTask = await downloadAdapter.submit(downloadRequest);
  downloadAdapter.setNextErrorCode(expectedCodes.download);
  await assert.rejects(
    downloadAdapter.download({
      ...downloadRequest,
      taskRef: downloadTask.taskRef,
    }),
    (error: unknown) =>
      error instanceof RecordedMediaAdapterError &&
      error.code === expectedCodes.download,
  );

  const cancelAdapter = createRecordedMediaAdapter('veo-latest');
  const cancelRequest = recordedRequest('veo-latest', 'video.generate', {
    durationSeconds: 5,
  });
  const cancelTask = await cancelAdapter.submit(cancelRequest);
  cancelAdapter.setNextErrorCode(expectedCodes.cancel);
  const cancelled = await cancelAdapter.cancel(
    cancelTask.taskRef,
    cancelRequest,
  );
  assert.equal(cancelled.status, 'cancel_requested');
  assert.equal(cancelled.errorCode, expectedCodes.cancel);
});
