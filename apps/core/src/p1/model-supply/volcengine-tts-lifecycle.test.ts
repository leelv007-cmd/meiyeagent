import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { MediaActivationProbeExecutor } from './activation-probe-executor.js';
import { recordedRequest } from './adapters.js';
import {
  createDefaultCatalogModels,
  createDefaultDeployments,
} from './catalog.js';
import type { MediaProviderEffectRequest } from './index.js';
import {
  FileSystemVolcengineTtsTaskStore,
  VolcengineTtsLifecyclePort,
  type VolcengineTtsTaskStore,
  type VolcengineTtsSynthesisPort,
} from './volcengine-tts-lifecycle.js';

function request(
  format: 'mp3' | 'wav' = 'mp3',
  overrides: Record<string, unknown> = {},
): MediaProviderEffectRequest {
  const base = recordedRequest('seed-tts-2', 'audio.speech', {
    format,
    language: 'zh-CN',
    maxDurationSeconds: 30,
    speed: 1,
    tone: 'natural',
    voice: 'default',
    ...overrides,
  });
  return {
    ...base,
    deployment: {
      ...base.deployment,
      id: 'seed-tts-2-volcengine-direct',
      catalogModelId: 'seed-tts-2',
      credentialVersion: 'tts-credential-v1',
      executionChannelId: 'channel-seed-tts-volcengine-direct',
      priceRevision: 'tts-price-approved-v1',
      providerModel: 'seed-tts-2.0-standard',
      region: 'domestic',
      unitPrice: {
        amountMicros: 2_000,
        currency: 'CNY',
        unit: 'text_word',
      },
    },
    effectIdempotencyKey: 'tts-effect-a',
    model: {
      ...base.model,
      id: 'seed-tts-2',
      operations: ['audio.speech'],
    },
    submission: {
      ...base.submission,
      prompt: '欢迎体验。',
    },
  };
}

function lifecycle(
  synthesis: VolcengineTtsSynthesisPort,
  options: {
    approvedPricePerTextWordCny?: number;
    credentialVersion?: string;
    priceRevision?: string;
    taskStore?: VolcengineTtsTaskStore;
    validateAudio?: () => Promise<{ durationSeconds: number }>;
  } = {},
) {
  return new VolcengineTtsLifecyclePort({
    approvedPricePerTextWordCny:
      options.approvedPricePerTextWordCny ?? 0.002,
    credentialVersion: options.credentialVersion ?? 'tts-credential-v1',
    priceRevision: options.priceRevision ?? 'tts-price-approved-v1',
    synthesis,
    ...(options.taskStore ? { taskStore: options.taskStore } : {}),
    validateAudio:
      options.validateAudio ?? (async () => ({ durationSeconds: 1 })),
  });
}

test('normalizes completed synthesis into the durable media lifecycle', async () => {
  const requests: unknown[] = [];
  const provider = lifecycle({
    async synthesize(input) {
      requests.push(input);
      return {
        billedTextWords: 6,
        bytes: Uint8Array.from([0x49, 0x44, 0x33, 1]),
        contentType: 'audio/mpeg',
      };
    },
  });
  const input = request();

  const receipt = await provider.submit(input);
  assert.equal(receipt.acceptance, 'accepted');
  assert.match(receipt.taskRef ?? '', /^volcengine-tts-[a-f0-9]{32}$/u);
  assert.deepEqual(receipt.providerCost, {
    amount: 0.012,
    currency: 'CNY',
    usage: { mediaUnits: 6 },
  });
  assert.deepEqual(await provider.recover(input), receipt);
  assert.deepEqual(
    await provider.poll({ ...input, taskRef: receipt.taskRef! }),
    {
      providerCost: receipt.providerCost,
      status: 'completed',
    },
  );
  assert.deepEqual(
    await provider.download({ ...input, taskRef: receipt.taskRef! }),
    {
      bytes: Uint8Array.from([0x49, 0x44, 0x33, 1]),
      contentType: 'audio/mpeg',
    },
  );
  assert.equal((await provider.submit(input)).taskRef, receipt.taskRef);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    format: 'mp3',
    language: 'zh-CN',
    speaker: undefined,
    speed: 1,
    text: '欢迎体验。',
  });
});

test('never resubmits after an uncertain provider effect or cold recovery', async () => {
  let calls = 0;
  const input = request();
  const provider = lifecycle({
    async synthesize() {
      calls += 1;
      throw new Error('transport ended');
    },
  });

  const uncertain = await provider.submit(input);
  assert.equal(uncertain.acceptance, 'acceptance_unknown');
  assert.equal(uncertain.errorCode, 'tts_acceptance_unknown');
  assert.equal(calls, 1);
  assert.equal((await provider.recover(input))?.taskRef, uncertain.taskRef);
  assert.equal(calls, 1);
  assert.equal(
    (
      await provider.poll({ ...input, taskRef: uncertain.taskRef! })
    ).status,
    'unknown',
  );

  const restarted = lifecycle({
    async synthesize() {
      throw new Error('must not resubmit');
    },
  });
  const recovered = await restarted.recover(input);
  assert.equal(recovered?.acceptance, 'acceptance_unknown');
  assert.equal(recovered?.taskRef, uncertain.taskRef);
});

test('recovers completed output and cost from durable storage after a cold restart', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'volcengine-tts-tasks-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const input = request();
  const first = lifecycle(
    {
      async synthesize() {
        return {
          billedTextWords: 6,
          bytes: Uint8Array.from([0x49, 0x44, 0x33, 1]),
          contentType: 'audio/mpeg',
        };
      },
    },
    { taskStore: new FileSystemVolcengineTtsTaskStore(directory) },
  );
  const receipt = await first.submit(input);

  const restarted = lifecycle(
    {
      async synthesize() {
        throw new Error('cold recovery must not synthesize again');
      },
    },
    { taskStore: new FileSystemVolcengineTtsTaskStore(directory) },
  );
  assert.deepEqual(await restarted.recover(input), receipt);
  assert.deepEqual(
    await restarted.poll({ ...input, taskRef: receipt.taskRef! }),
    { providerCost: receipt.providerCost, status: 'completed' },
  );
  assert.deepEqual(
    await restarted.download({ ...input, taskRef: receipt.taskRef! }),
    {
      bytes: Uint8Array.from([0x49, 0x44, 0x33, 1]),
      contentType: 'audio/mpeg',
    },
  );

  const rotated = lifecycle(
    {
      async synthesize() {
        throw new Error('an old frozen task must not synthesize again');
      },
    },
    {
      approvedPricePerTextWordCny: 0.003,
      credentialVersion: 'tts-credential-v2',
      priceRevision: 'tts-price-approved-v2',
      taskStore: new FileSystemVolcengineTtsTaskStore(directory),
    },
  );
  assert.deepEqual(await rotated.recover(input), receipt);
  assert.deepEqual(await rotated.submit(input), receipt);
});

test('claims a durable task atomically before concurrent provider submission', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'volcengine-tts-claims-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  let calls = 0;
  const provider = lifecycle(
    {
      async synthesize() {
        calls += 1;
        return {
          billedTextWords: 6,
          bytes: Uint8Array.from([0x49, 0x44, 0x33, 1]),
          contentType: 'audio/mpeg',
        };
      },
    },
    { taskStore: new FileSystemVolcengineTtsTaskStore(directory) },
  );
  const input = request();

  await Promise.all([provider.submit(input), provider.submit(input)]);

  assert.equal(calls, 1);
});

test('resumes validation from provider output persisted before an interrupted handoff', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'volcengine-tts-received-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const durableStore = new FileSystemVolcengineTtsTaskStore(directory);
  let interruptReceivedWrite = true;
  const interruptedStore: VolcengineTtsTaskStore = {
    claim: (task) => durableStore.claim(task),
    get: (taskRef) => durableStore.get(taskRef),
    async put(task) {
      await durableStore.put(task);
      if (interruptReceivedWrite && task.status === 'received') {
        interruptReceivedWrite = false;
        throw new Error('simulated process interruption');
      }
    },
  };
  const input = request();
  const first = lifecycle(
    {
      async synthesize() {
        return {
          billedTextWords: 6,
          bytes: Uint8Array.from([0x49, 0x44, 0x33, 1]),
          contentType: 'audio/mpeg',
        };
      },
    },
    { taskStore: interruptedStore },
  );
  await assert.rejects(first.submit(input), /simulated process interruption/u);

  const restarted = lifecycle(
    {
      async synthesize() {
        throw new Error('recovery must continue validation without resynthesis');
      },
    },
    { taskStore: new FileSystemVolcengineTtsTaskStore(directory) },
  );
  const recovered = await restarted.recover(input);
  assert.equal(recovered.acceptance, 'accepted');
  assert.equal(recovered.providerCost.amount, 0.012);
  assert.deepEqual(
    await restarted.download({ ...input, taskRef: recovered.taskRef! }),
    {
      bytes: Uint8Array.from([0x49, 0x44, 0x33, 1]),
      contentType: 'audio/mpeg',
    },
  );
});

test('rejects unsupported tone and a stale price revision before provider acceptance', async () => {
  let calls = 0;
  const provider = lifecycle({
    async synthesize() {
      calls += 1;
      throw new Error('must not synthesize');
    },
  });

  const unsupportedTone = await provider.submit(request('mp3', { tone: 'warm' }));
  assert.equal(unsupportedTone.acceptance, 'rejected_before_accept');
  assert.equal(unsupportedTone.errorCode, 'tts_tone_unsupported');

  const stalePrice = request();
  stalePrice.deployment.priceRevision = 'tts-price-approved-v0';
  const staleReceipt = await provider.submit(stalePrice);
  assert.equal(staleReceipt.acceptance, 'rejected_before_accept');
  assert.equal(staleReceipt.errorCode, 'tts_price_revision_mismatch');
  assert.equal(calls, 0);
});

test('fails delivery when decoded audio exceeds the requested duration', async () => {
  const provider = lifecycle(
    {
      async synthesize() {
        return {
          billedTextWords: 6,
          bytes: Uint8Array.from([0x49, 0x44, 0x33, 1]),
          contentType: 'audio/mpeg',
        };
      },
    },
    { validateAudio: async () => ({ durationSeconds: 31 }) },
  );
  const input = request();
  const receipt = await provider.submit(input);
  const state = await provider.poll({ ...input, taskRef: receipt.taskRef! });

  assert.equal(receipt.acceptance, 'accepted');
  assert.equal(state.status, 'failed');
  assert.equal(state.errorCode, 'tts_duration_exceeded');
});

test('fails terminally when usage required for approved pricing is absent', async () => {
  const provider = lifecycle({
    async synthesize() {
      return {
        bytes: Uint8Array.from([0x49, 0x44, 0x33, 1]),
        contentType: 'audio/mpeg',
      };
    },
  });
  const input = request();
  const receipt = await provider.submit(input);
  assert.equal(receipt.acceptance, 'accepted');
  const state = await provider.poll({ ...input, taskRef: receipt.taskRef! });
  assert.equal(state.status, 'failed');
  assert.equal(state.errorCode, 'tts_usage_missing');
  await assert.rejects(
    provider.download({ ...input, taskRef: receipt.taskRef! }),
    /not completed/u,
  );
});

test('fails terminally when provider output type contradicts the request', async () => {
  const provider = lifecycle({
    async synthesize() {
      return {
        billedTextWords: 2,
        bytes: Uint8Array.from([0x52, 0x49, 0x46, 0x46]),
        contentType: 'audio/wav',
      };
    },
  });
  const input = request('mp3');
  const receipt = await provider.submit(input);
  const state = await provider.poll({ ...input, taskRef: receipt.taskRef! });

  assert.equal(state.status, 'failed');
  assert.equal(state.errorCode, 'tts_output_type_mismatch');
  assert.equal(state.providerCost.amount, 0.004);
});

test('runs the existing activation probe seam for real speech synthesis', async () => {
  const provider = lifecycle({
    async synthesize(input) {
      assert.equal(input.format, 'wav');
      return {
        billedTextWords: 11,
        bytes: Uint8Array.from([0x52, 0x49, 0x46, 0x46]),
        contentType: 'audio/wav',
      };
    },
  });
  const probe = new MediaActivationProbeExecutor(provider, {
    deployments: createDefaultDeployments({
      deploymentPricingById: {
        'seed-tts-2-volcengine-direct': {
          priceRevision: 'tts-price-approved-v1',
          unitPrice: {
            amountMicros: 2_000,
            currency: 'CNY',
            unit: 'text_word',
          },
        },
      },
    }).map((deployment) =>
      deployment.id === 'seed-tts-2-volcengine-direct'
        ? { ...deployment, credentialVersion: 'tts-credential-v1' }
        : deployment,
    ),
    models: createDefaultCatalogModels(),
  });

  const result = await probe.execute({
    actorId: 'admin-a',
    catalogModelId: 'seed-tts-2',
    correlationId: 'tts-probe-a',
    deploymentId: 'seed-tts-2-volcengine-direct',
    idempotencyKey: 'tts-probe-a',
    operation: 'audio.speech',
    workspaceId: 'workspace-a',
  });

  assert.equal(result.outputDigestSource.contentType, 'audio/wav');
  assert.equal(result.providerCost.amount, 0.022);
  assert.deepEqual(result.providerCost.usage, { mediaUnits: 11 });
});
