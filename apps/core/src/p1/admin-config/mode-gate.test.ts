import assert from 'node:assert/strict';
import test from 'node:test';
import { recordedRequest } from '../model-supply/adapters.js';
import type { ProviderExecutionPort } from '../model-supply/index.js';
import type { MediaProviderLifecyclePort } from '../model-supply/index.js';
import { MemoryAdminConfigRepository } from './foundation-module.js';
import {
  ModeGateExecutionPort,
  ModeGateMediaLifecyclePort,
} from './mode-gate.js';

const globalConfig = {
  actorId: 'admin-1',
  correlationId: 'mode-gate-test',
  reason: 'mode gate test',
  scope: 'global' as const,
  workspaceId: '__global__',
};

test('blocks the next provider execution immediately after disabled is persisted', async () => {
  let now = 0;
  let effects = 0;
  const repository = new MemoryAdminConfigRepository();
  await repository.apply({
    ...globalConfig,
    expectedRevision: null,
    key: 'model.execution.mode',
    value: 'direct',
  });
  const inner: ProviderExecutionPort = {
    async execute(request) {
      effects += 1;
      return {
        acceptance: 'rejected_before_accept',
        kind: 'failure',
        message: 'inner execution reached',
        providerCost: {
          amount: 0,
          currency: request.deployment.region === 'domestic' ? 'CNY' : 'USD',
          usage: {},
        },
      };
    },
  };
  const gate = new ModeGateExecutionPort(inner, repository, 'direct', {
    clock: () => now,
    ttlMs: 5_000,
  });
  const request = recordedRequest('llm-openai', 'copy.generate');

  await gate.execute(request);
  await repository.apply({
    ...globalConfig,
    expectedRevision: 1,
    key: 'model.execution.mode',
    value: 'disabled',
  });
  now = 4_999;
  const blocked = await gate.execute(request);
  assert.equal(blocked.kind, 'failure');
  if (blocked.kind !== 'failure') return;
  assert.equal(blocked.acceptance, 'rejected_before_accept');
  assert.equal(blocked.errorCode, 'model_execution_disabled');
  assert.equal(blocked.providerCost.amount, 0);
  assert.deepEqual(blocked.providerCost.usage, {});
  assert.match(blocked.message, /模型执行已停用/);
  assert.equal(effects, 1);

  now = 5_001;
  await gate.execute(request);
  assert.equal(effects, 1);
});

test('keeps the last known enabled state when the config head cannot be read', async () => {
  let effects = 0;
  const inner: ProviderExecutionPort = {
    async execute(request) {
      effects += 1;
      return {
        acceptance: 'rejected_before_accept',
        kind: 'failure',
        message: 'inner execution reached',
        providerCost: {
          amount: 0,
          currency: request.deployment.region === 'domestic' ? 'CNY' : 'USD',
          usage: {},
        },
      };
    },
  };
  const gate = new ModeGateExecutionPort(
    inner,
    {
      async get() {
        throw new Error('database unavailable');
      },
    },
    'direct',
  );

  await gate.execute(recordedRequest('llm-openai', 'copy.generate'));
  assert.equal(effects, 1);
});

test('fails open to the assembled mode when a cached disabled head cannot be refreshed', async () => {
  let now = 0;
  let failReads = false;
  let effects = 0;
  const inner: ProviderExecutionPort = {
    async execute(request) {
      effects += 1;
      return {
        acceptance: 'rejected_before_accept',
        kind: 'failure',
        message: 'inner execution reached',
        providerCost: {
          amount: 0,
          currency: request.deployment.region === 'domestic' ? 'CNY' : 'USD',
          usage: {},
        },
      };
    },
  };
  const gate = new ModeGateExecutionPort(
    inner,
    {
      async get() {
        if (failReads) throw new Error('database unavailable');
        return { value: 'disabled' } as never;
      },
    },
    'direct',
    { clock: () => now, ttlMs: 1 },
  );

  await gate.execute(recordedRequest('llm-openai', 'copy.generate'));
  failReads = true;
  now = 2;
  await gate.execute(recordedRequest('llm-openai', 'copy.generate'));
  assert.equal(effects, 1);
});

test('blocks only new media submissions while allowing in-flight settlement', async () => {
  const repository = new MemoryAdminConfigRepository();
  await repository.apply({
    ...globalConfig,
    expectedRevision: null,
    key: 'model.media.execution.mode',
    value: 'disabled',
  });
  let submits = 0;
  let polls = 0;
  const inner: MediaProviderLifecyclePort = {
    async submit() {
      submits += 1;
      return {
        acceptance: 'accepted',
        providerCost: { amount: 1, currency: 'CNY', usage: {} },
        taskRef: 'provider-task',
      };
    },
    async recover() {
      return null;
    },
    async poll() {
      polls += 1;
      return {
        providerCost: { amount: 1, currency: 'CNY', usage: {} },
        status: 'completed',
      };
    },
    async download() {
      return { bytes: new Uint8Array(), contentType: 'video/mp4' };
    },
    async cancel() {},
  };
  const gate = new ModeGateMediaLifecyclePort(inner, repository, 'ark');
  const request = {
    ...recordedRequest('seedance-2', 'video.generate'),
    effectIdempotencyKey: 'media-effect-1',
  };

  const blocked = await gate.submit(request);
  assert.equal(blocked.acceptance, 'rejected_before_accept');
  assert.equal(blocked.errorCode, 'media_execution_disabled');
  assert.equal(blocked.providerCost.amount, 0);
  assert.match(blocked.error ?? '', /媒体执行已停用/);
  await gate.poll({ ...request, taskRef: 'provider-task' });
  assert.equal(submits, 0);
  assert.equal(polls, 1);
});
