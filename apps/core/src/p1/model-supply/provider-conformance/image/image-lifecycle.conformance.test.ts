/**
 * MP-04I dual-channel image lifecycle conformance (recorded/fake + Ark durable).
 * Live Ark/Tuzi remain env-gated in live-*-media.integration.test.ts.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  ArkMediaExecutionPort,
  FileSystemMediaProviderReceiptStore,
  type ProviderAssetFetchPort,
} from '../../ark-media-adapter.js';
import {
  RecordedAdapterRouter,
  Seedream5ProRecordedAdapter,
  GptImage2RecordedAdapter,
  recordedRequest,
} from '../../adapters.js';
import type { MediaProviderEffectRequest } from '../../provider-lifecycle.js';
import {
  createDualChannelHarnesses,
  FakeImageChannelPort,
  MemoryReceiptStore,
} from './fake-channel.js';
import {
  assertNoCrossChannelResubmit,
  runImageLifecycleConformance,
  type ImageLifecycleConformanceHarness,
} from './suite.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

test('MP-04I official_direct fake channel passes full image lifecycle conformance', async () => {
  const store = new MemoryReceiptStore();
  let port = new FakeImageChannelPort({
    channelId: 'channel-ark-seedream-official',
    channelKind: 'official_direct',
    catalogModelId: 'seedream-5-pro',
    costPerImage: 0.22,
    currency: 'CNY',
    receiptStore: store,
  });
  const harness: ImageLifecycleConformanceHarness = {
    channelId: port.channelId,
    channelKind: 'official_direct',
    createPort: () => {
      port = new FakeImageChannelPort({
        channelId: 'channel-ark-seedream-official',
        channelKind: 'official_direct',
        catalogModelId: 'seedream-5-pro',
        costPerImage: 0.22,
        currency: 'CNY',
        receiptStore: store,
      });
      return port;
    },
    restartPort: () =>
      new FakeImageChannelPort({
        channelId: 'channel-ark-seedream-official',
        channelKind: 'official_direct',
        catalogModelId: 'seedream-5-pro',
        costPerImage: 0.22,
        currency: 'CNY',
        receiptStore: store,
      }),
    buildRequest: (input) => port.buildRequest(input),
    forceAcceptanceUnknown: (p) =>
      (p as FakeImageChannelPort).forceAcceptanceUnknown(),
    forceLateTerminalSuccess: (p, taskRef) =>
      (p as FakeImageChannelPort).forceLateTerminalSuccess(taskRef),
  };

  const report = await runImageLifecycleConformance(harness);
  assert.equal(report.channelKind, 'official_direct');
  assert.ok(report.cases.length >= 10);
  assert.ok(report.cases.every((c) => c.ok));
  assert.ok(
    report.cases.some((c) => c.name === 'cross-process-durable-recover'),
  );
  assert.ok(report.cases.some((c) => c.name === 'drain-semantics'));
  assert.ok(report.cases.some((c) => c.name === 'late-terminal-reconciliation'));
  assert.ok(report.cases.some((c) => c.name === 'health-report'));
});

test('MP-04I upstream_reseller fake channel passes full image lifecycle conformance', async () => {
  const store = new MemoryReceiptStore();
  let port = new FakeImageChannelPort({
    channelId: 'channel-tuzi-seedream-reseller',
    channelKind: 'upstream_reseller',
    catalogModelId: 'gpt-image-2',
    costPerImage: 0.18,
    currency: 'USD',
    receiptStore: store,
  });
  const harness: ImageLifecycleConformanceHarness = {
    channelId: port.channelId,
    channelKind: 'upstream_reseller',
    createPort: () => {
      port = new FakeImageChannelPort({
        channelId: 'channel-tuzi-seedream-reseller',
        channelKind: 'upstream_reseller',
        catalogModelId: 'gpt-image-2',
        costPerImage: 0.18,
        currency: 'USD',
        receiptStore: store,
      });
      return port;
    },
    restartPort: () =>
      new FakeImageChannelPort({
        channelId: 'channel-tuzi-seedream-reseller',
        channelKind: 'upstream_reseller',
        catalogModelId: 'gpt-image-2',
        costPerImage: 0.18,
        currency: 'USD',
        receiptStore: store,
      }),
    buildRequest: (input) => port.buildRequest(input),
    forceAcceptanceUnknown: (p) =>
      (p as FakeImageChannelPort).forceAcceptanceUnknown(),
    forceLateTerminalSuccess: (p, taskRef) =>
      (p as FakeImageChannelPort).forceLateTerminalSuccess(taskRef),
  };

  const report = await runImageLifecycleConformance(harness);
  assert.equal(report.channelKind, 'upstream_reseller');
  assert.ok(report.cases.some((c) => c.name === 'idempotent-replay'));
  assert.ok(report.cases.some((c) => c.name === 'unknown-no-resubmit'));
});

test('MP-04I recorded dual-channel routers cover health/drain/idempotent image lifecycle', async () => {
  for (const channel of [
    {
      channelId: 'recorded-official-seedream',
      channelKind: 'official_direct' as const,
      catalogModelId: 'seedream-5-pro' as const,
      createAdapter: () => new Seedream5ProRecordedAdapter(),
    },
    {
      channelId: 'recorded-reseller-gpt-image',
      channelKind: 'upstream_reseller' as const,
      catalogModelId: 'gpt-image-2' as const,
      createAdapter: () => new GptImage2RecordedAdapter(),
    },
  ]) {
    const harness: ImageLifecycleConformanceHarness = {
      channelId: channel.channelId,
      channelKind: channel.channelKind,
      createPort: () => new RecordedAdapterRouter([channel.createAdapter()]),
      buildRequest: (input) => {
        const effectKey =
          input?.effectIdempotencyKey ?? `${channel.channelId}-effect`;
        const jobId = `${channel.channelId}-${effectKey}`;
        const base = recordedRequest(
          channel.catalogModelId,
          'image.generate',
          { width: 1024, height: 1024 },
        );
        return {
          ...base,
          jobId,
          effectIdempotencyKey: effectKey,
          submission: {
            ...base.submission,
            workspaceId: input?.workspaceId ?? 'workspace-a',
          },
        };
      },
    };
    // Recorded adapters recover by deterministic task ref (no durable store),
    // so skip cross-process / unknown / late-terminal optional hooks.
    const report = await runImageLifecycleConformance(harness);
    assert.ok(report.cases.some((c) => c.name === 'health-report'));
    assert.ok(report.cases.some((c) => c.name === 'drain-semantics'));
    assert.ok(report.cases.some((c) => c.name === 'idempotent-replay'));
    assert.ok(report.cases.some((c) => c.name === 'submit/task-id/acceptance'));
  }
});

test('accepted or unknown primary channel never cross-channel resubmits', async () => {
  const { official, reseller } = createDualChannelHarnesses();
  // Warm ports so counters are stable for this assertion.
  const primary = official.createPort() as FakeImageChannelPort;
  const fallback = reseller.createPort() as FakeImageChannelPort;

  await assertNoCrossChannelResubmit({
    primary: {
      ...official,
      createPort: () => primary,
      buildRequest: (input) => primary.buildRequest(input),
    },
    fallback: {
      ...reseller,
      createPort: () => fallback,
      buildRequest: (input) => fallback.buildRequest(input),
    },
    primarySubmitCount: () => primary.submitCount,
    fallbackSubmitCount: () => fallback.submitCount,
  });
  assert.equal(fallback.submitCount, 0);
  assert.equal(primary.submitCount, 1);
});

test('Ark image adapter survives kill-restart via durable receipt store', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'ark-image-receipts-'));
  t.after(() => rm(directory, { force: true, recursive: true }));

  const receiptStore = new FileSystemMediaProviderReceiptStore(directory);
  let providerCalls = 0;
  const fetchMock: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/images/generations')) {
      providerCalls += 1;
      return Response.json({
        created: 1_786_400_000,
        data: [{ url: 'https://media.example.test/cross-process.png' }],
        usage: { generated_images: 1, output_tokens: 100 },
      });
    }
    if (url === 'https://media.example.test/cross-process.png') {
      return new Response(PNG_1X1, {
        headers: { 'content-type': 'image/png' },
      });
    }
    throw new Error(`Unexpected ${url} ${init?.method ?? 'GET'}`);
  };
  const assetFetch: ProviderAssetFetchPort = {
    async get(target) {
      const response = await fetchMock(target);
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        finalUrl: target,
        mimeType: response.headers.get('content-type') ?? '',
      };
    },
  };

  const options = {
    apiKey: 'ark-test-secret',
    assetFetch,
    assetSourceHosts: ['media.example.test'],
    baseUrl: 'https://ark.example.test/api/v3',
    credentialVersion: 'ark-key-v3',
    endpointRevision: 'ark-media-v1',
    fetch: fetchMock,
    image: {
      catalogModelId: 'seedream-5-pro' as const,
      costPerImage: 0.22,
      model: 'doubao-seedream-5-0-test',
    },
    sourceUrlTtlSeconds: 3_600,
    video: {
      catalogModelId: 'seedance-2' as const,
      costPerMillionTokens: 28,
      estimatedTokensPerSecond: 10_000,
      model: 'doubao-seedance-2-0-test',
    },
    receiptStore,
  };

  const first = new ArkMediaExecutionPort(options);
  const request: MediaProviderEffectRequest = {
    ...recordedRequest('seedream-5-pro', 'image.generate', {
      width: 1024,
      height: 1024,
    }),
    effectIdempotencyKey: 'ark-cross-process-effect',
  };

  const submitted = await first.submit(request);
  assert.equal(submitted.acceptance, 'accepted');
  assert.ok(submitted.taskRef);
  assert.equal(providerCalls, 1);
  assert.equal(first.getDrainMode(), 'accepting');
  assert.equal((await first.reportHealth()).source, 'adapter');

  // Simulated process kill + restart with the same durable store.
  const restarted = new ArkMediaExecutionPort(options);
  const recovered = await restarted.recover(request);
  assert.equal(recovered.acceptance, 'accepted');
  assert.equal(recovered.taskRef, submitted.taskRef);

  const replay = await restarted.submit(request);
  assert.equal(replay.taskRef, submitted.taskRef);
  assert.equal(providerCalls, 1, 'idempotent replay must not re-hit provider');

  const polled = await restarted.poll({
    ...request,
    taskRef: submitted.taskRef!,
  });
  assert.equal(polled.status, 'completed');
  const downloaded = await restarted.download({
    ...request,
    taskRef: submitted.taskRef!,
  });
  assert.equal(downloaded.contentType, 'image/png');
  assert.ok(downloaded.bytes.byteLength > 0);
});

test('Ark drain rejects new image submit while replaying accepted in-flight', async () => {
  let providerCalls = 0;
  const fetchMock: typeof globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/images/generations')) {
      providerCalls += 1;
      return Response.json({
        created: 1_786_400_000,
        data: [{ url: 'https://media.example.test/drain.png' }],
        usage: { generated_images: 1 },
      });
    }
    if (url === 'https://media.example.test/drain.png') {
      return new Response(PNG_1X1, {
        headers: { 'content-type': 'image/png' },
      });
    }
    throw new Error(`Unexpected ${url}`);
  };
  const port = new ArkMediaExecutionPort({
    apiKey: 'ark-test-secret',
    assetFetch: {
      async get(target) {
        const response = await fetchMock(target);
        return {
          bytes: new Uint8Array(await response.arrayBuffer()),
          finalUrl: target,
          mimeType: 'image/png',
        };
      },
    },
    assetSourceHosts: ['media.example.test'],
    baseUrl: 'https://ark.example.test/api/v3',
    credentialVersion: 'ark-key-v3',
    endpointRevision: 'ark-media-v1',
    fetch: fetchMock,
    image: {
      catalogModelId: 'seedream-5-pro',
      costPerImage: 0.22,
      model: 'doubao-seedream-5-0-test',
    },
    sourceUrlTtlSeconds: 3_600,
    video: {
      catalogModelId: 'seedance-2',
      costPerMillionTokens: 28,
      estimatedTokensPerSecond: 10_000,
      model: 'doubao-seedance-2-0-test',
    },
  });

  const inFlight: MediaProviderEffectRequest = {
    ...recordedRequest('seedream-5-pro', 'image.generate', {
      width: 1024,
      height: 1024,
    }),
    effectIdempotencyKey: 'ark-drain-inflight',
  };
  const accepted = await port.submit(inFlight);
  assert.equal(accepted.acceptance, 'accepted');
  assert.equal(providerCalls, 1);

  port.setDrainMode('draining');
  assert.equal(port.getDrainMode(), 'draining');
  assert.equal((await port.reportHealth()).drainMode, 'draining');

  const rejected = await port.submit({
    ...inFlight,
    effectIdempotencyKey: 'ark-drain-new-task',
  });
  assert.equal(rejected.acceptance, 'rejected_before_accept');
  assert.equal(rejected.errorCode, 'channel_draining');
  assert.equal(providerCalls, 1);

  const replay = await port.submit(inFlight);
  assert.equal(replay.taskRef, accepted.taskRef);
  assert.equal(providerCalls, 1);

  const polled = await port.poll({
    ...inFlight,
    taskRef: accepted.taskRef!,
  });
  assert.equal(polled.status, 'completed');
});

test('Ark persists acceptance_unknown so restart will not resubmit', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'ark-unknown-receipts-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  let calls = 0;
  const fetchMock: typeof globalThis.fetch = async () => {
    calls += 1;
    throw new Error('socket hang up');
  };
  const options = {
    apiKey: 'ark-test-secret',
    baseUrl: 'https://ark.example.test/api/v3',
    credentialVersion: 'ark-key-v3',
    endpointRevision: 'ark-media-v1',
    fetch: fetchMock,
    image: {
      catalogModelId: 'seedream-5-pro' as const,
      costPerImage: 0.22,
      model: 'doubao-seedream-5-0-test',
    },
    sourceUrlTtlSeconds: 3_600,
    video: {
      catalogModelId: 'seedance-2' as const,
      costPerMillionTokens: 28,
      estimatedTokensPerSecond: 10_000,
      model: 'doubao-seedance-2-0-test',
    },
    receiptStore: new FileSystemMediaProviderReceiptStore(directory),
  };
  const request: MediaProviderEffectRequest = {
    ...recordedRequest('seedream-5-pro', 'image.generate', {
      width: 1024,
      height: 1024,
    }),
    effectIdempotencyKey: 'ark-unknown-effect',
  };

  const first = new ArkMediaExecutionPort(options);
  const unknown = await first.submit(request);
  assert.equal(unknown.acceptance, 'acceptance_unknown');
  assert.equal(calls, 1);

  const restarted = new ArkMediaExecutionPort(options);
  const recovered = await restarted.recover(request);
  assert.equal(recovered.acceptance, 'acceptance_unknown');
  const replay = await restarted.submit(request);
  assert.equal(replay.acceptance, 'acceptance_unknown');
  assert.equal(calls, 1, 'unknown must not resubmit after restart');
});
