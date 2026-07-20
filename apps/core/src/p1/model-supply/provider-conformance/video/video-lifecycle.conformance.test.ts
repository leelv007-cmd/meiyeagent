/**
 * MP-04V dual-channel video lifecycle conformance (recorded/fake + Ark durable).
 * Live Ark/Tuzi remain env-gated in live-*-media.integration.test.ts.
 *
 * Consumes #102 canonical video contract (projection/lift) only —
 * does not touch composed-video-workflow* or model-supply video segment ownership.
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
  Seedance2RecordedAdapter,
  VeoLatestRecordedAdapter,
  recordedRequest,
} from '../../adapters.js';
import type { MediaProviderEffectRequest } from '../../provider-lifecycle.js';
import {
  InMemoryCanonicalVideoRunStore,
  VideoWorkflowCanonicalCommands,
} from '../../video-workflow-canonical.js';
import {
  assertPublicProjectionIsSanitized,
  liftDurableToCanonical,
  projectDurableVideoWorkflow,
  projectVideoWorkflowPublic,
} from '../../video-workflow-projection.js';
import {
  createDualChannelHarnesses,
  FakeVideoChannelPort,
  FAKE_MP4,
  MemoryReceiptStore,
} from './fake-channel.js';
import {
  assertNoCrossChannelResubmit,
  runVideoLifecycleConformance,
  type VideoLifecycleConformanceHarness,
} from './suite.js';

test('MP-04V official_direct fake channel passes full video lifecycle conformance', async () => {
  const store = new MemoryReceiptStore();
  let port = new FakeVideoChannelPort({
    channelId: 'channel-ark-seedance-official',
    channelKind: 'official_direct',
    catalogModelId: 'seedance-2',
    costPerSecond: 0.05,
    currency: 'CNY',
    receiptStore: store,
  });
  const harness: VideoLifecycleConformanceHarness = {
    channelId: port.channelId,
    channelKind: 'official_direct',
    createPort: () => {
      port = new FakeVideoChannelPort({
        channelId: 'channel-ark-seedance-official',
        channelKind: 'official_direct',
        catalogModelId: 'seedance-2',
        costPerSecond: 0.05,
        currency: 'CNY',
        receiptStore: store,
      });
      return port;
    },
    restartPort: () =>
      new FakeVideoChannelPort({
        channelId: 'channel-ark-seedance-official',
        channelKind: 'official_direct',
        catalogModelId: 'seedance-2',
        costPerSecond: 0.05,
        currency: 'CNY',
        receiptStore: store,
      }),
    buildRequest: (input) => port.buildRequest(input),
    forceAcceptanceUnknown: (p) =>
      (p as FakeVideoChannelPort).forceAcceptanceUnknown(),
    forceLateTerminalSuccess: (p, taskRef) =>
      (p as FakeVideoChannelPort).forceLateTerminalSuccess(taskRef),
  };

  const report = await runVideoLifecycleConformance(harness);
  assert.equal(report.channelKind, 'official_direct');
  assert.ok(report.cases.length >= 13);
  assert.ok(report.cases.every((c) => c.ok));
  assert.ok(
    report.cases.some((c) => c.name === 'cross-process-durable-recover'),
  );
  assert.ok(report.cases.some((c) => c.name === 'drain-semantics'));
  assert.ok(report.cases.some((c) => c.name === 'late-terminal-reconciliation'));
  assert.ok(report.cases.some((c) => c.name === 'health-report'));
  assert.ok(report.cases.some((c) => c.name === 'duration-usage-evidence'));
  assert.ok(report.cases.some((c) => c.name === 'owned-persist-within-url-ttl'));
  assert.ok(report.cases.some((c) => c.name === 'burn-in-label-chain'));
});

test('MP-04V upstream_reseller fake channel passes full video lifecycle conformance', async () => {
  const store = new MemoryReceiptStore();
  let port = new FakeVideoChannelPort({
    channelId: 'channel-tuzi-veo-reseller',
    channelKind: 'upstream_reseller',
    catalogModelId: 'veo-latest',
    costPerSecond: 0.08,
    currency: 'USD',
    receiptStore: store,
  });
  const harness: VideoLifecycleConformanceHarness = {
    channelId: port.channelId,
    channelKind: 'upstream_reseller',
    createPort: () => {
      port = new FakeVideoChannelPort({
        channelId: 'channel-tuzi-veo-reseller',
        channelKind: 'upstream_reseller',
        catalogModelId: 'veo-latest',
        costPerSecond: 0.08,
        currency: 'USD',
        receiptStore: store,
      });
      return port;
    },
    restartPort: () =>
      new FakeVideoChannelPort({
        channelId: 'channel-tuzi-veo-reseller',
        channelKind: 'upstream_reseller',
        catalogModelId: 'veo-latest',
        costPerSecond: 0.08,
        currency: 'USD',
        receiptStore: store,
      }),
    buildRequest: (input) => port.buildRequest(input),
    forceAcceptanceUnknown: (p) =>
      (p as FakeVideoChannelPort).forceAcceptanceUnknown(),
    forceLateTerminalSuccess: (p, taskRef) =>
      (p as FakeVideoChannelPort).forceLateTerminalSuccess(taskRef),
  };

  const report = await runVideoLifecycleConformance(harness);
  assert.equal(report.channelKind, 'upstream_reseller');
  assert.ok(report.cases.some((c) => c.name === 'idempotent-replay'));
  assert.ok(report.cases.some((c) => c.name === 'unknown-no-resubmit'));
  assert.ok(report.cases.some((c) => c.name === 'duration-usage-evidence'));
});

test('MP-04V recorded dual-channel routers cover health/drain/idempotent video lifecycle', async () => {
  for (const channel of [
    {
      channelId: 'recorded-official-seedance',
      channelKind: 'official_direct' as const,
      catalogModelId: 'seedance-2' as const,
      createAdapter: () => new Seedance2RecordedAdapter(),
    },
    {
      channelId: 'recorded-reseller-veo',
      channelKind: 'upstream_reseller' as const,
      catalogModelId: 'veo-latest' as const,
      createAdapter: () => new VeoLatestRecordedAdapter(),
    },
  ]) {
    const harness: VideoLifecycleConformanceHarness = {
      channelId: channel.channelId,
      channelKind: channel.channelKind,
      createPort: () => new RecordedAdapterRouter([channel.createAdapter()]),
      buildRequest: (input) => {
        const effectKey =
          input?.effectIdempotencyKey ?? `${channel.channelId}-effect`;
        const jobId = `${channel.channelId}-${effectKey}`;
        const base = recordedRequest(
          channel.catalogModelId,
          'video.generate',
          { durationSeconds: input?.durationSeconds ?? 5 },
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
    const report = await runVideoLifecycleConformance(harness);
    assert.ok(report.cases.some((c) => c.name === 'health-report'));
    assert.ok(report.cases.some((c) => c.name === 'drain-semantics'));
    assert.ok(report.cases.some((c) => c.name === 'idempotent-replay'));
    assert.ok(report.cases.some((c) => c.name === 'submit/task-id/acceptance'));
    assert.ok(report.cases.some((c) => c.name === 'duration-usage-evidence'));
    assert.ok(report.cases.some((c) => c.name === 'burn-in-label-chain'));
  }
});

test('accepted or unknown primary video channel never cross-channel resubmits', async () => {
  const { official, reseller } = createDualChannelHarnesses();
  const primary = official.createPort() as FakeVideoChannelPort;
  const fallback = reseller.createPort() as FakeVideoChannelPort;

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

test('Ark video adapter survives kill-restart via durable receipt store', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'ark-video-receipts-'));
  t.after(() => rm(directory, { force: true, recursive: true }));

  const receiptStore = new FileSystemMediaProviderReceiptStore(directory);
  let providerCalls = 0;
  const fetchMock: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/contents/generations/tasks') && init?.method === 'POST') {
      providerCalls += 1;
      return Response.json({ id: 'ark-video-task-cross-process' });
    }
    if (url.endsWith('/contents/generations/tasks/ark-video-task-cross-process')) {
      return Response.json({
        id: 'ark-video-task-cross-process',
        status: 'succeeded',
        updated_at: Math.floor(Date.now() / 1_000),
        content: { video_url: 'https://media.example.test/cross-process.mp4' },
        usage: { completion_tokens: 50_000 },
      });
    }
    if (url === 'https://media.example.test/cross-process.mp4') {
      return new Response(FAKE_MP4, {
        headers: { 'content-type': 'video/mp4' },
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
    ...recordedRequest('seedance-2', 'video.generate', {
      durationSeconds: 5,
    }),
    effectIdempotencyKey: 'ark-video-cross-process-effect',
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
  assert.ok(
    (polled.providerCost.usage?.outputTokens ?? 0) > 0 ||
      (polled.providerCost.usage?.mediaUnits ?? 0) > 0,
    'finished duration usage evidence required',
  );
  const downloaded = await restarted.download({
    ...request,
    taskRef: submitted.taskRef!,
  });
  assert.equal(downloaded.contentType, 'video/mp4');
  assert.ok(downloaded.bytes.byteLength > 0);
  if (downloaded.sourceExpiresAt) {
    assert.ok(Date.parse(downloaded.sourceExpiresAt) > Date.now());
  }
});

test('Ark drain rejects new video submit while replaying accepted in-flight', async () => {
  let providerCalls = 0;
  const fetchMock: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/contents/generations/tasks') && init?.method === 'POST') {
      providerCalls += 1;
      return Response.json({ id: `ark-video-task-${providerCalls}` });
    }
    if (url.includes('/contents/generations/tasks/ark-video-task-')) {
      if (init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }
      return Response.json({
        id: url.split('/').pop(),
        status: 'succeeded',
        updated_at: Math.floor(Date.now() / 1_000),
        content: { video_url: 'https://media.example.test/drain.mp4' },
        usage: { completion_tokens: 40_000 },
      });
    }
    if (url === 'https://media.example.test/drain.mp4') {
      return new Response(FAKE_MP4, {
        headers: { 'content-type': 'video/mp4' },
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
          mimeType: 'video/mp4',
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
    ...recordedRequest('seedance-2', 'video.generate', {
      durationSeconds: 5,
    }),
    effectIdempotencyKey: 'ark-video-drain-inflight',
  };
  const accepted = await port.submit(inFlight);
  assert.equal(accepted.acceptance, 'accepted');
  assert.equal(providerCalls, 1);

  port.setDrainMode('draining');
  assert.equal(port.getDrainMode(), 'draining');
  assert.equal((await port.reportHealth()).drainMode, 'draining');

  const rejected = await port.submit({
    ...inFlight,
    effectIdempotencyKey: 'ark-video-drain-new-task',
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

test('Ark persists video acceptance_unknown so restart will not resubmit', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'ark-video-unknown-receipts-'));
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
    ...recordedRequest('seedance-2', 'video.generate', {
      durationSeconds: 5,
    }),
    effectIdempotencyKey: 'ark-video-unknown-effect',
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

test('canonical #102 command port preserves burn-in label chain under lifecycle effect keys', async () => {
  const store = new InMemoryCanonicalVideoRunStore();
  const commands = new VideoWorkflowCanonicalCommands(store);
  const now = '2026-07-20T12:00:00.000Z';

  const durable = commands.checkpoint({
    id: 'wf-canonical-burnin',
    workspaceId: 'ws-a',
    actorId: 'actor-a',
    workId: 'work-a',
    storyboardVersion: 1,
    dataClass: [],
    aigcLabelEnabled: true,
    brandWatermarkText: 'MeiYe-Brand',
    storyboardRevision: 'sb-1',
    confirmed: true,
    catalogModelId: 'seedance-2',
    shots: [
      {
        id: 'shot-1',
        prompt: 'label chain',
        candidatesPerShot: 1,
        candidates: [],
      },
    ],
    attempts: [],
    clipAssets: [],
    status: 'running',
    revision: 0,
    createdAt: now,
    updatedAt: now,
  });

  assert.equal(durable.aigcLabelEnabled, true);
  assert.equal(durable.brandWatermarkText, 'MeiYe-Brand');

  const fromStore = store.get('wf-canonical-burnin');
  assert.ok(fromStore);
  assert.equal(fromStore.task.aigcLabelEnabled, true);
  assert.equal(fromStore.task.brandWatermarkText, 'MeiYe-Brand');

  const projected = projectDurableVideoWorkflow(fromStore);
  assert.equal(projected.brandWatermarkText, 'MeiYe-Brand');
  const lifted = liftDurableToCanonical(projected);
  assert.equal(lifted.task.aigcLabelEnabled, true);

  const pub = projectVideoWorkflowPublic(fromStore);
  assertPublicProjectionIsSanitized(pub);
  assert.equal(pub.workflowId, 'wf-canonical-burnin');

  // Effect key pattern from #102 derivation doc — idempotent across fake channel.
  const effectKey = `${fromStore.runId}:shot:shot-1:candidate:0`;
  const channel = new FakeVideoChannelPort({
    channelId: 'channel-canonical-burnin',
    channelKind: 'official_direct',
    receiptStore: new MemoryReceiptStore(),
  });
  const request = channel.buildRequest({
    effectIdempotencyKey: effectKey,
    workspaceId: fromStore.workspaceId,
    durationSeconds: 5,
  });
  const first = await channel.submit(request);
  const second = await channel.submit(request);
  assert.equal(first.taskRef, second.taskRef);
  assert.equal(channel.submitCount, 1);
});
