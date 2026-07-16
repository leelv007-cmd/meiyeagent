import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createDefaultCatalogModels,
  createDefaultDeployments,
} from './catalog.js';
import {
  MediaActivationProbeError,
  MediaActivationProbeExecutor,
} from './activation-probe-executor.js';
import type {
  MediaProviderEffectRequest,
  MediaProviderLifecyclePort,
  ProviderCost,
} from './index.js';

function cost(): Omit<ProviderCost, 'id' | 'status'> {
  return {
    amount: 0.25,
    currency: 'CNY',
    usage: { mediaUnits: 1 },
  };
}

describe('MediaActivationProbeExecutor', () => {
  it('uses the production lifecycle for image and video smoke probes', async () => {
    const calls: string[] = [];
    const submissions: MediaProviderEffectRequest[] = [];
    const polls = new Map<string, number>();
    const provider: MediaProviderLifecyclePort = {
      async submit(request) {
        calls.push(`submit:${request.submission.operation}`);
        submissions.push(request);
        return {
          acceptance: 'accepted',
          providerCost: cost(),
          taskRef: `task-${request.submission.operation}`,
        };
      },
      async poll(request) {
        calls.push(`poll:${request.submission.operation}`);
        const count = (polls.get(request.taskRef) ?? 0) + 1;
        polls.set(request.taskRef, count);
        return {
          providerCost: cost(),
          status:
            request.submission.operation === 'video.generate' && count === 1
              ? ('running' as const)
              : ('completed' as const),
        };
      },
      async download(request) {
        calls.push(`download:${request.submission.operation}`);
        return {
          bytes: Uint8Array.from([1, 2, 3]),
          contentType:
            request.submission.operation === 'image.generate'
              ? ('image/png' as const)
              : ('video/mp4' as const),
        };
      },
      async recover(_request: MediaProviderEffectRequest) {
        return null;
      },
      async cancel() {},
    };
    const executor = new MediaActivationProbeExecutor(
      provider,
      {
        deployments: createDefaultDeployments(),
        models: createDefaultCatalogModels(),
      },
      { pollIntervalMs: 0, sleep: async () => {} }
    );

    const image = await executor.execute({
      actorId: 'admin-a',
      catalogModelId: 'seedream-5-pro',
      correlationId: 'corr-image',
      deploymentId: 'seedream-5-pro-direct',
      idempotencyKey: 'activation-probe-image',
      operation: 'image.generate',
      workspaceId: 'workspace-a',
    });
    const video = await executor.execute({
      actorId: 'admin-a',
      catalogModelId: 'seedance-2',
      correlationId: 'corr-video',
      deploymentId: 'seedance-2-direct',
      idempotencyKey: 'activation-probe-video',
      operation: 'video.generate',
      workspaceId: 'workspace-a',
    });

    assert.equal(image.providerCost.status, 'observed');
    assert.equal(video.providerCost.amount, 0.25);
    assert.deepEqual(submissions[0]?.submission.input, {});
    assert.deepEqual(submissions[1]?.submission.input, { durationSeconds: 5 });
    assert.equal(submissions[0]?.submission.productUsageQuantity, 0);
    assert.equal(submissions[1]?.submission.productUsageQuantity, 0);
    assert.deepEqual(calls, [
      'submit:image.generate',
      'poll:image.generate',
      'download:image.generate',
      'submit:video.generate',
      'poll:video.generate',
      'poll:video.generate',
      'download:video.generate',
    ]);
  });

  it('classifies provider failures and verifies cancellation through the same sanitized fixture', async () => {
    const submissions: MediaProviderEffectRequest[] = [];
    const provider: MediaProviderLifecyclePort = {
      async submit(request) {
        submissions.push(request);
        return {
          acceptance: 'rejected_before_accept',
          error: 'quota unavailable',
          errorCode: 'quota_exhausted',
          providerCost: cost(),
          retryable: false,
        };
      },
      async poll() {
        throw new Error('poll should not run');
      },
      async download() {
        throw new Error('download should not run');
      },
      async recover() {
        return null;
      },
      async cancel(request) {
        submissions.push(request);
        return { status: 'cancelled' };
      },
    };
    const executor = new MediaActivationProbeExecutor(provider, {
      deployments: createDefaultDeployments(),
      models: createDefaultCatalogModels(),
    });
    const input = {
      actorId: 'admin-a',
      catalogModelId: 'seedream-5-pro',
      correlationId: 'corr-image',
      deploymentId: 'seedream-5-pro-direct',
      idempotencyKey: 'activation-probe-classified',
      operation: 'image.generate' as const,
      workspaceId: 'workspace-a',
    };

    await assert.rejects(executor.execute(input), (error: unknown) => {
      assert.ok(error instanceof MediaActivationProbeError);
      assert.equal(error.failureCategory, 'submit:quota_exhausted');
      assert.deepEqual(error.providerCost, {
        amount: 0.25,
        currency: 'CNY',
        status: 'estimated',
        usage: { mediaUnits: 1 },
      });
      assert.equal(error.retryable, false);
      return true;
    });
    assert.deepEqual(
      await executor.cancel({ ...input, taskRef: 'provider-task-a' }),
      { status: 'cancelled' }
    );
    assert.equal(submissions[0]?.submission.productUsageQuantity, 0);
    assert.doesNotMatch(
      JSON.stringify(submissions),
      /api[_-]?key|secret[_-]?value|access[_-]?token/iu
    );
  });

  it('preserves observed provider cost when delivery fails after completion', async () => {
    const provider: MediaProviderLifecyclePort = {
      async submit() {
        return {
          acceptance: 'accepted',
          providerCost: cost(),
          taskRef: 'private-provider-task-ref',
        };
      },
      async poll() {
        return { providerCost: cost(), status: 'completed' };
      },
      async download() {
        return { bytes: new Uint8Array(), contentType: 'video/mp4' };
      },
      async recover() {
        return null;
      },
      async cancel() {},
    };
    const executor = new MediaActivationProbeExecutor(provider, {
      deployments: createDefaultDeployments(),
      models: createDefaultCatalogModels(),
    });

    await assert.rejects(
      executor.execute({
        actorId: 'admin-a',
        catalogModelId: 'seedance-2',
        correlationId: 'corr-download-failure',
        deploymentId: 'seedance-2-direct',
        idempotencyKey: 'activation-probe-download-failure',
        operation: 'video.generate',
        workspaceId: 'workspace-a',
      }),
      (error: unknown) => {
        assert.ok(error instanceof MediaActivationProbeError);
        assert.equal(error.failureCategory, 'download:empty_asset');
        assert.deepEqual(error.providerCost, {
          amount: 0.25,
          currency: 'CNY',
          status: 'observed',
          usage: { mediaUnits: 1 },
        });
        return true;
      }
    );
  });

  it('submits and cancels one async canary without exposing the provider task reference', async () => {
    const calls: string[] = [];
    const submissions: MediaProviderEffectRequest[] = [];
    const provider: MediaProviderLifecyclePort = {
      async submit(request) {
        calls.push('submit');
        submissions.push(request);
        return {
          acceptance: 'accepted',
          providerCost: cost(),
          taskRef: 'private-provider-task-ref',
        };
      },
      async poll() {
        calls.push('poll');
        return {
          errorCode: 'provider_cancelled',
          providerCost: cost(),
          retryable: false,
          status: 'failed',
        };
      },
      async download() {
        throw new Error('download should not run');
      },
      async recover() {
        return null;
      },
      async cancel(request) {
        calls.push('cancel');
        assert.equal(request.taskRef, 'private-provider-task-ref');
        return { status: 'cancelled' };
      },
    };
    const executor = new MediaActivationProbeExecutor(provider, {
      deployments: createDefaultDeployments(),
      models: createDefaultCatalogModels(),
    });

    const result = await executor.executeCancellation({
      actorId: 'admin-a',
      catalogModelId: 'seedance-2',
      correlationId: 'corr-cancel',
      deploymentId: 'seedance-2-direct',
      idempotencyKey: 'activation-probe-cancel',
      operation: 'video.generate',
      workspaceId: 'workspace-a',
    });

    assert.deepEqual(result, {
      providerCost: {
        amount: 0.25,
        currency: 'CNY',
        status: 'observed',
        usage: { mediaUnits: 1 },
      },
      status: 'cancelled',
    });
    assert.deepEqual(calls, ['submit', 'cancel', 'poll']);
    assert.equal(submissions[0]?.submission.productUsageQuantity, 0);
    assert.equal('taskRef' in result, false);
  });

  it('classifies cancel, poll-timeout, and poll-failure categories without leaking task refs', async () => {
    const catalog = {
      deployments: createDefaultDeployments(),
      models: createDefaultCatalogModels(),
    };
    const videoInput = {
      actorId: 'admin-a',
      catalogModelId: 'seedance-2',
      correlationId: 'corr-cancel-class',
      deploymentId: 'seedance-2-direct',
      idempotencyKey: 'activation-probe-cancel-class',
      operation: 'video.generate' as const,
      workspaceId: 'workspace-a',
    };

    await assert.rejects(
      new MediaActivationProbeExecutor(
        {
          async submit() {
            throw new Error('image cancel should not submit');
          },
          async poll() {
            throw new Error('image cancel should not poll');
          },
          async download() {
            throw new Error('image cancel should not download');
          },
          async recover() {
            return null;
          },
          async cancel() {
            throw new Error('image cancel should not cancel');
          },
        },
        catalog
      ).executeCancellation({
        ...videoInput,
        catalogModelId: 'seedream-5-pro',
        deploymentId: 'seedream-5-pro-direct',
        operation: 'image.generate',
      }),
      (error: unknown) => {
        assert.ok(error instanceof MediaActivationProbeError);
        assert.equal(error.failureCategory, 'cancel:unsupported_operation');
        assert.equal(error.retryable, false);
        return true;
      }
    );

    await assert.rejects(
      new MediaActivationProbeExecutor(
        {
          async submit() {
            return {
              acceptance: 'accepted',
              providerCost: cost(),
              taskRef: 'private-cancel-pending-ref',
            };
          },
          async poll() {
            throw new Error('poll should not run when cancel is unconfirmed');
          },
          async download() {
            throw new Error('download should not run');
          },
          async recover() {
            return null;
          },
          async cancel() {
            return {
              errorCode: 'cancel_pending',
              retryable: true,
              status: 'pending',
            };
          },
        },
        catalog
      ).executeCancellation(videoInput),
      (error: unknown) => {
        assert.ok(error instanceof MediaActivationProbeError);
        assert.equal(error.failureCategory, 'cancel:cancel_pending');
        assert.equal(error.retryable, true);
        assert.deepEqual(error.providerCost, {
          amount: 0.25,
          currency: 'CNY',
          status: 'estimated',
          usage: { mediaUnits: 1 },
        });
        assert.doesNotMatch(JSON.stringify(error), /private-cancel-pending-ref/);
        return true;
      }
    );

    await assert.rejects(
      new MediaActivationProbeExecutor(
        {
          async submit() {
            return {
              acceptance: 'accepted',
              providerCost: cost(),
              taskRef: 'private-late-complete-ref',
            };
          },
          async poll() {
            return { providerCost: cost(), status: 'completed' };
          },
          async download() {
            throw new Error('download should not run');
          },
          async recover() {
            return null;
          },
          async cancel() {
            return { status: 'cancelled' };
          },
        },
        catalog
      ).executeCancellation({
        ...videoInput,
        idempotencyKey: 'activation-probe-cancel-late-complete',
      }),
      (error: unknown) => {
        assert.ok(error instanceof MediaActivationProbeError);
        assert.equal(error.failureCategory, 'cancel:cancellation_unconfirmed');
        assert.equal(error.retryable, false);
        assert.deepEqual(error.providerCost, {
          amount: 0.25,
          currency: 'CNY',
          status: 'observed',
          usage: { mediaUnits: 1 },
        });
        assert.doesNotMatch(JSON.stringify(error), /private-late-complete-ref/);
        return true;
      }
    );

    await assert.rejects(
      new MediaActivationProbeExecutor(
        {
          async submit() {
            return {
              acceptance: 'accepted',
              providerCost: cost(),
              taskRef: 'private-timeout-ref',
            };
          },
          async poll() {
            return { providerCost: cost(), status: 'running' };
          },
          async download() {
            throw new Error('download should not run');
          },
          async recover() {
            return null;
          },
          async cancel() {},
        },
        catalog,
        { maxPollAttempts: 1, pollIntervalMs: 0, sleep: async () => {} }
      ).execute(videoInput),
      (error: unknown) => {
        assert.ok(error instanceof MediaActivationProbeError);
        assert.equal(error.failureCategory, 'poll:timeout');
        assert.equal(error.retryable, true);
        assert.deepEqual(error.providerCost, {
          amount: 0.25,
          currency: 'CNY',
          status: 'estimated',
          usage: { mediaUnits: 1 },
        });
        return true;
      }
    );

    await assert.rejects(
      new MediaActivationProbeExecutor(
        {
          async submit() {
            return {
              acceptance: 'accepted',
              providerCost: cost(),
              taskRef: 'private-failed-ref',
            };
          },
          async poll() {
            return {
              errorCode: 'content_policy',
              providerCost: cost(),
              retryable: false,
              status: 'failed',
            };
          },
          async download() {
            throw new Error('download should not run');
          },
          async recover() {
            return null;
          },
          async cancel() {},
        },
        catalog,
        { pollIntervalMs: 0, sleep: async () => {} }
      ).execute({
        ...videoInput,
        idempotencyKey: 'activation-probe-poll-failed',
      }),
      (error: unknown) => {
        assert.ok(error instanceof MediaActivationProbeError);
        assert.equal(error.failureCategory, 'poll:content_policy');
        assert.equal(error.retryable, false);
        assert.deepEqual(error.providerCost, {
          amount: 0.25,
          currency: 'CNY',
          status: 'estimated',
          usage: { mediaUnits: 1 },
        });
        return true;
      }
    );
  });
});
